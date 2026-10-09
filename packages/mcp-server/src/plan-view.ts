/** Stable, versioned MCP Apps resource URI. Changing the view requires a new URI
 * so a host does not reuse an older cached HTML template. */
export const PLAN_VIEW_URI = "ui://qnector/plan-act-v2.html";

/** Self-contained ChatGPT-compatible task controller. No remote scripts or user tokens. */
export const PLAN_VIEW_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Qnector Task Controller</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:12px;color:var(--text-primary,#e8e8e8);background:var(--surface-background,transparent);font-size:13px;line-height:1.5}
main{max-width:780px;margin:0 auto;border:1px solid var(--border-color,#353535);border-radius:12px;padding:14px 16px}
header,.topline,.mode-label,.step,.actions{display:flex;align-items:center;gap:9px}
header{justify-content:space-between;flex-wrap:wrap;margin-bottom:15px}
h1{font-size:15px;line-height:1.3;margin:0;font-weight:650}
.pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:100px;background:var(--surface-secondary,#242424);color:var(--text-secondary,#bcbcbc)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:17px}
.tabs button{height:34px;border:0;border-radius:10px;background:transparent;color:var(--text-secondary,#bdbdbd);font:inherit;cursor:pointer}
.tabs button[aria-selected="true"]{background:var(--surface-secondary,#252525);color:var(--text-primary,#f5f5f5)}
.tabs button:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #7bc4ff;outline-offset:2px}
.mode-label{font-size:14px;font-weight:650}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;background:#38c78b;box-shadow:0 0 0 2px #38c78b20}
[data-mode="act"] .dot{background:#70aaff;box-shadow:0 0 0 2px #70aaff20}
.description{font-size:12px;color:var(--text-secondary,#c0c0c0);margin:11px 0 20px;white-space:pre-wrap}
.rule{border:0;border-top:1px solid var(--border-color,#333);margin:0 0 15px}
.topline{justify-content:space-between;align-items:baseline;flex-wrap:wrap}
strong{font-weight:650}
.small{font-size:11px;color:var(--text-secondary,#b1b1b1)}
.scope{word-break:break-all;max-width:100%;font-family:ui-monospace,Consolas,monospace;font-size:11px}
h2{font-size:14px;margin:12px 0 6px}
.summary{color:var(--text-secondary,#cecece);white-space:pre-wrap;margin:0 0 6px}
ol{list-style:none;margin:11px 0 0;padding:0}
li{display:flex;gap:10px;align-items:flex-start;border-top:1px solid var(--border-color,#323232);padding:9px 0}
li input{margin-top:3px;accent-color:#76b7ff}
li label{flex:1}
li.done label{text-decoration:line-through;opacity:.55}
button{font:inherit}
.actions{flex-wrap:wrap;justify-content:flex-end;margin-top:14px}
.actions button{cursor:pointer;padding:8px 12px;border-radius:8px;color:inherit;background:transparent;border:1px solid var(--border-color,#555)}
.actions .primary{background:#3269b1;border-color:#3269b1;color:white}
button:disabled{cursor:not-allowed!important;opacity:.4}
#message{min-height:18px;margin-top:12px;font-size:12px;color:var(--text-secondary,#aeb6c2);overflow-wrap:anywhere}
#message.error{color:#ff9b9b}
.empty{font-size:12px;color:var(--text-secondary,#bcbcbc);margin-top:8px}
@media(max-width:480px){main{padding:12px}.actions button{flex:1}.scope{font-size:10px}}
</style>
</head>
<body>
<main id="controller" data-mode="plan">
<header><h1>⌘ QNECTOR — Task Controller</h1><span class="pill">LIVE MCP</span></header>
<div class="tabs" role="tablist" aria-label="Task mode">
  <button id="planTab" role="tab" aria-selected="true">Plan</button>
  <button id="actTab" role="tab" aria-selected="false">Act</button>
</div>
<div class="mode-label"><span class="dot" aria-hidden="true"></span><span id="modeLabel">Connecting…</span></div>
<p class="description" id="modeDescription">Loading the live task state from Qnector.</p>
<hr class="rule">
<div class="topline"><strong id="taskTitle">Qnector Plan / Act</strong><span id="revision" class="small"></span></div>
<div class="small scope" id="taskScope"></div>
<h2 id="planTitle">Task plan</h2>
<p class="summary" id="planSummary">Loading…</p>
<ol id="steps" aria-label="Plan checklist"></ol>
<div class="actions">
 <button id="refresh">Refresh</button>
 <button id="continue" class="primary" disabled>Continue in ChatGPT</button>
</div>
<div id="message" role="status" aria-live="polite"></div>
</main>
<script>
(function(){
"use strict";
var api=window.openai;
var state=null;
var busy=false;
var input=api && api.toolInput && typeof api.toolInput==="object"?api.toolInput:{};
var saved=api && api.widgetState && typeof api.widgetState==="object"?api.widgetState:{};
var taskId=typeof input.memoryTaskId==="string"?input.memoryTaskId:null;
var $=function(id){return document.getElementById(id);};
function extract(value){
 var payload=value&&(value.structuredContent||value);
 return payload&&payload.data&&payload.data.data&&typeof payload.data.data==="object"?payload.data.data:null;
}
function report(message,error){
 $("message").textContent=message||"";
 $("message").className=error?"error":"";
}
function persist(){if(api&&typeof api.setWidgetState==="function")api.setWidgetState({memoryTaskId:taskId});}
function render(next){
 if(!next)return;
 state=next;
 if(!taskId&&typeof next.scopeId==="string"&&next.scopeId.indexOf("task:")===0)taskId=next.scopeId.slice(5);
 var plan=next.plan;
 var planning=next.mode==="plan";
 $("controller").dataset.mode=planning?"plan":"act";
 $("planTab").setAttribute("aria-selected",String(planning));
 $("actTab").setAttribute("aria-selected",String(!planning));
 $("modeLabel").textContent=planning?"Read-only exploration":plan?"Act Mode · Execution enabled":"Act Mode · No plan";
 $("modeDescription").textContent=planning?
  "วิเคราะห์โค้ด ตรวจสอบปัญหา และเตรียมแผน โดยไม่แก้ไขโปรเจกต์":
  plan?"อนุมัติแผนแล้ว สามารถดำเนินงานตามขั้นตอนที่กำหนดได้":"เริ่ม Task และสร้างแผนก่อน หากต้องการกระบวนการ Plan / Act";
 $("taskTitle").textContent=plan?"Task: "+plan.title:"Task: Qnector Plan / Act";
 $("taskScope").textContent=next.scopeId==="unscoped"?"No task scope — ask ChatGPT to create a task":next.scopeId;
 $("revision").textContent=plan?"Revision "+plan.revision+(plan.approvedRevision===plan.revision?" · Approved":" · Awaiting approval"):"No saved plan";
 $("planTitle").textContent=plan?"Implementation plan":"No plan created";
 $("planSummary").textContent=plan?plan.summary:"Ask ChatGPT to start a Qnector task and draft a plan before editing files.";
 var list=$("steps");list.replaceChildren();
 (plan?plan.steps:[]).forEach(function(step,index){
  var li=document.createElement("li");
  if(step.done)li.className="done";
  var check=document.createElement("input");
  check.type="checkbox";check.checked=!!step.done;check.disabled=planning||busy;
  check.setAttribute("aria-label","Complete step "+(index+1));
  check.addEventListener("change",function(){
   invoke("mode",{action:"step",index:index,done:check.checked}).catch(function(){check.checked=!check.checked;});
  });
  var label=document.createElement("label");label.textContent=(index+1)+". "+step.text;
  li.append(check,label);list.appendChild(li);
 });
 $("planTab").disabled=busy;
 $("actTab").disabled=busy||(!plan&&next.mode==="plan");
 $("continue").disabled=busy||planning||!plan;
 persist();
}
async function invoke(name,args){
 if(!api||typeof api.callTool!=="function"){
  report("ChatGPT does not expose the app tool bridge. Refresh the Qnector app tools and open the panel in a new chat.",true);
  throw Error("APP_HOST_UNAVAILABLE");
 }
 busy=true;if(state)render(state);
 report("Syncing with Qnector…");
 try{
  var call=Object.assign({},args);
  if(taskId)call.memoryTaskId=taskId;
  var result=await api.callTool(name,call);
  var payload=result&&(result.structuredContent||result);
  if(result&&(result.isError||(payload&&payload.ok===false))){
   throw Error(payload&&payload.error&&payload.error.message||"Qnector rejected the operation.");
  }
  var next=extract(result);
  if(!next)throw Error("Qnector returned no task state.");
  state=next;
  report("Synced with Qnector");
  return next;
 }catch(error){
  report(error&&error.message||"Operation failed",true);
  throw error;
 }finally{
  busy=false;if(state)render(state);
 }
}
function followUp(message){
 if(api&&typeof api.sendFollowUpMessage==="function"){
  api.sendFollowUpMessage({prompt:message});
 }else report("Ask ChatGPT: "+message);
}
$("refresh").addEventListener("click",function(){
 invoke("inspect",{target:"mode",request:{action:"get"}}).catch(function(){});
});
$("planTab").addEventListener("click",function(){
 if(busy||!state)return;
 if(state.mode==="plan")return;
 if(!state.plan){
  followUp("Use Qnector to start a task and create a Plan Mode proposal before making changes.");
  return;
 }
 invoke("mode",{action:"back_to_plan"}).catch(function(){});
});
$("actTab").addEventListener("click",function(){
 if(busy||!state||state.mode==="act"||!state.plan)return;
 // Exact revision approval is a user-initiated host tool call; ChatGPT may
 // require an additional confirmation before granting Act Mode.
 invoke("mode_approve",{expectedRevision:state.plan.revision}).catch(function(){});
});
$("continue").addEventListener("click",function(){
 if(!state||state.mode!=="act"||!state.plan)return;
 var suffix=taskId?" Use memoryTaskId "+taskId+" on every Qnector call.":"";
 followUp("Continue the approved Qnector plan revision "+state.plan.revision+" and update the task checklist after verified steps."+suffix);
});
var initial=extract(api&&api.toolOutput);
if(!taskId&&initial&&typeof initial.scopeId==="string"&&initial.scopeId.indexOf("task:")===0)taskId=initial.scopeId.slice(5);
if(!taskId&&typeof saved.memoryTaskId==="string")taskId=saved.memoryTaskId;
if(initial)render(initial);
if(api&&typeof api.callTool==="function"){
 invoke("inspect",{target:"mode",request:{action:"get"}}).catch(function(){});
}else{
 report("Qnector panel requires a compatible ChatGPT MCP Apps host.",true);
}
})();
</script>
</body>
</html>`;
