/** Versioned MCP Apps resource. A new URI prevents stale host HTML caching. */
export const PLAN_VIEW_URI = "ui://qnector/plan-act-v4.html";

/** Compact, progressive-disclosure Plan/Act UI. No remote assets or credentials. */
export const PLAN_VIEW_HTML = String.raw`<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Qnector Task Controller</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:8px;color:var(--text-primary,#e8e8e8);background:var(--surface-background,transparent);font-size:13px;line-height:1.45}
main{max-width:740px;margin:auto;padding:15px 16px;border:1px solid var(--border-color,#3c3c3c);border-radius:12px;background:var(--surface-primary,transparent)}
header,.mode-label,.topline,.actions,.progress-line{display:flex;align-items:center;gap:8px}
header{justify-content:space-between;margin-bottom:12px}
h1{font-size:15px;font-weight:650;line-height:1.35;margin:0}
.pill{font-size:10px;letter-spacing:.03em;border:1px solid var(--border-color,#444);border-radius:5px;padding:2px 6px;color:var(--text-secondary,#bdbdbd)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:3px;background:var(--surface-secondary,#242424);border-radius:9px}
button{font:inherit;cursor:pointer}
.tabs button{height:33px;border:0;border-radius:7px;background:transparent;color:var(--text-secondary,#bdbdbd)}
.tabs button[aria-pressed="true"]{background:var(--surface-primary,#3a3a3a);color:var(--text-primary,#f5f5f5);font-weight:650}
button:focus-visible,input:focus-visible{outline:2px solid #73bbff;outline-offset:2px}
button:disabled{opacity:.45;cursor:not-allowed}
.mode-label{margin-top:12px;font-weight:620}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#47bc8f}
[data-mode="act"] .dot{background:#85adff}
.description{font-size:12px;color:var(--text-secondary,#bcbcbc);margin:4px 0 14px}
.topline{justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:4px}
h2{font-size:14px;margin:0;font-weight:650;overflow-wrap:anywhere}
.meta,.small{font-size:11px;color:var(--text-secondary,#b1b1b1)}
.summary{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 2px;color:var(--text-secondary,#cecece)}
.text-button{border:0;background:none;color:var(--link-color,#93c3fc);padding:4px 0;text-align:left;font-size:12px}
.text-button:hover{text-decoration:underline}
button[hidden],section[hidden],div[hidden]{display:none!important}
hr{border:0;border-top:1px solid var(--border-color,#373737);margin:13px 0}
.progress-line{justify-content:space-between;margin:0 0 5px}
progress{display:block;width:100%;height:6px;appearance:none;accent-color:#78b7ff;border:0;border-radius:9px;overflow:hidden;margin:0 0 9px}
progress::-webkit-progress-bar{background:var(--surface-secondary,#333)}
progress::-webkit-progress-value{background:#78b7ff;border-radius:9px}
ol{margin:0;padding:0;list-style:none}
li{display:flex;gap:9px;align-items:flex-start;border-top:1px solid var(--border-color,#333);padding:10px 0}
li input{margin:3px 0 0;flex-shrink:0;accent-color:#78b7ff}
li label{flex:1;min-width:0;overflow-wrap:anywhere}
li.done label{text-decoration:line-through;opacity:.6}
.actions{justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
.actions button{border:1px solid var(--border-color,#5a5a5a);background:transparent;color:inherit;border-radius:8px;padding:9px 12px;min-height:36px}
.actions .primary{background:#3679bd;border-color:#3679bd;color:#fff;font-weight:600}
#message{font-size:11px;color:var(--text-secondary,#aaa);margin-top:8px;min-height:15px;overflow-wrap:anywhere}
#message.error{color:#ff9b9b}
.revoke-confirmation{margin-top:10px;padding:12px;border:1px solid var(--border-color,#555);border-radius:9px}
.revoke-confirmation p{margin:0 0 8px;color:var(--text-secondary,#d1d1d1)}
.revoke-confirmation .actions{margin-top:0}
@media(max-width:440px){body{padding:5px}main{padding:12px}.actions .primary{flex:1}.actions button{padding:9px}.meta{font-size:10px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<main id="controller" data-mode="plan">
<header><h1>QNECTOR · Task Controller</h1><span class="pill">LIVE MCP</span></header>
<div class="tabs" role="group" aria-label="Task mode actions">
 <button id="planTab" type="button" aria-pressed="true" aria-label="Plan Mode">Plan</button>
 <button id="actTab" type="button" aria-pressed="false" aria-label="Act Mode">Act</button>
</div>
<div class="mode-label"><span class="dot" aria-hidden="true"></span><span id="modeLabel">กำลังเชื่อมต่อ</span></div>
<p class="description" id="modeDescription">กำลังอ่านสถานะจริงจาก Qnector</p>
<hr>
<section aria-labelledby="taskTitle">
 <div class="topline"><h2 id="taskTitle">แผนงาน</h2><span id="revision" class="meta"></span></div>
 <p class="summary" id="planSummary">กำลังโหลดแผน…</p>
 <button id="summaryToggle" class="text-button" aria-expanded="false" hidden>อ่านรายละเอียดทั้งหมด</button>
</section>
<hr>
<section aria-labelledby="progressLabel">
 <div class="progress-line"><strong id="progressLabel">ขั้นตอน</strong><span id="progressCount" class="meta">—</span></div>
 <progress id="taskProgress" max="1" value="0" aria-label="ความคืบหน้าของแผน"></progress>
 <ol id="steps" aria-label="รายการตรวจสอบ"></ol>
 <button id="stepsToggle" class="text-button" aria-expanded="false" hidden>ดูทุกขั้นตอน</button>
</section>
<div class="actions">
 <button id="refresh">รีเฟรช</button>
 <button id="backToPlan" hidden>กลับไป Plan…</button>
 <button id="approve" class="primary" hidden>อนุมัติแผน</button>
 <button id="continue" class="primary" hidden>ดำเนินงานใน ChatGPT</button>
</div>
<section id="revokeConfirmation" class="revoke-confirmation" aria-label="ยืนยันกลับสู่ Plan Mode" hidden>
 <p>กลับไป Plan Mode จะยกเลิกสิทธิ์แก้ไขสำหรับแผนนี้ทันที โดยไม่ยกเลิกงานที่กำลังรัน</p>
 <div class="actions"><button id="cancelBackToPlan" type="button">ยกเลิก</button><button id="confirmBackToPlan" class="primary" type="button">ยืนยันกลับ Plan</button></div>
</section>
<div id="message" role="status" aria-live="polite"></div>
</main>
<script>
(function(){
"use strict";
var api=window.openai;
var state=null;
var busy=false;
var revokePending=false;
var input=api&&api.toolInput&&typeof api.toolInput==="object"?api.toolInput:{};
var saved=api&&api.widgetState&&typeof api.widgetState==="object"?api.widgetState:{};
var taskId=typeof input.memoryTaskId==="string"?input.memoryTaskId:null;
var fullSummary=!!saved.fullSummary;
var fullSteps=!!saved.fullSteps;
var previousRevision=typeof saved.planRevision==="number"?saved.planRevision:null;
var summaryLimit=280;
var visibleLimit=3;
var $=function(id){return document.getElementById(id);};
function extract(value){
 var payload=value&&(value.structuredContent||value);
 return payload&&payload.data&&payload.data.data&&typeof payload.data.data==="object"?payload.data.data:null;
}
function report(message,error){
 $("message").textContent=message||"";
 $("message").className=error?"error":"";
}
function persist(){
 if(api&&typeof api.setWidgetState==="function")api.setWidgetState({
  memoryTaskId:taskId,planRevision:previousRevision,fullSummary:fullSummary,fullSteps:fullSteps
 });
}
function render(next){
 if(!next)return;
 state=next;
 if(!taskId&&typeof next.scopeId==="string"&&next.scopeId.indexOf("task:")===0)taskId=next.scopeId.slice(5);
 var plan=next.plan;
 var revision=plan?plan.revision:null;
 if(previousRevision!==null&&previousRevision!==revision){fullSummary=false;fullSteps=false;}
 previousRevision=revision;
 var planning=next.mode==="plan";
 if(planning)revokePending=false;
 $("controller").dataset.mode=planning?"plan":"act";
 $("planTab").setAttribute("aria-pressed",String(planning));
 $("actTab").setAttribute("aria-pressed",String(!planning));
 $("planTab").setAttribute("aria-label",planning?"Plan Mode (active)":"Review return to Plan Mode; revoking approval requires confirmation");
 $("actTab").setAttribute("aria-label",planning&&plan?"Review approval for revision "+plan.revision+" before entering Act Mode":"Act Mode (active)");
 $("modeLabel").textContent=planning?"Plan Mode · พร้อมตรวจทาน":plan?"Act Mode · กำลังดำเนินงาน":"ยังไม่มีแผน";
 $("modeDescription").textContent=planning?
  "แผนพร้อมให้ตรวจสอบและอนุมัติ · ยังไม่อนุญาตให้แก้ไขโปรเจกต์":
  plan?"แผนได้รับอนุมัติแล้ว · ติดตามความคืบหน้าได้ที่นี่":"เริ่ม Task และสร้างแผนก่อนดำเนินงาน";
 $("taskTitle").textContent=plan?plan.title:"ยังไม่มีแผนงาน";
 $("revision").textContent=plan?"Revision "+plan.revision+(plan.approvedRevision===plan.revision?" · Approved":" · Review"):"";
 var summary=plan?String(plan.summary||""):"สร้างแผนด้วย Qnector ก่อนเพื่อให้ตรวจสอบและอนุมัติได้จากที่นี่";
 var longer=summary.length>summaryLimit;
 $("planSummary").textContent=longer&&!fullSummary?summary.slice(0,summaryLimit).trimEnd()+"…":summary;
 $("summaryToggle").hidden=!longer;
 $("summaryToggle").textContent=fullSummary?"ย่อรายละเอียด":"อ่านรายละเอียดทั้งหมด";
 $("summaryToggle").setAttribute("aria-expanded",String(fullSummary));
 var steps=plan?plan.steps:[];
 var done=steps.filter(function(step){return !!step.done;}).length;
 $("progressCount").textContent=done+"/"+steps.length+" ขั้นตอนสำเร็จ";
 $("taskProgress").max=Math.max(1,steps.length);
 $("taskProgress").value=done;
 var indexed=steps.map(function(step,index){return {step:step,index:index};});
 var pending=indexed.filter(function(entry){return !entry.step.done;});
 var shown=fullSteps?indexed:(pending.length?pending.slice(0,visibleLimit):indexed.slice(-visibleLimit));
 var list=$("steps");list.replaceChildren();
 shown.forEach(function(entry){
  var step=entry.step,index=entry.index;
  var li=document.createElement("li");
  if(step.done)li.className="done";
  var check=document.createElement("input");
  check.type="checkbox";check.id="qnector-step-"+index;check.checked=!!step.done;check.disabled=planning||busy;
  check.setAttribute("aria-label","ขั้นตอน "+(index+1));
  check.addEventListener("change",function(){
   invoke("mode",{action:"step",index:index,done:check.checked,expectedRevision:plan.revision,expectedStepId:step.id,expectedApprovedAt:plan.approvedAt}).catch(function(){check.checked=!check.checked;});
  });
  var label=document.createElement("label");label.htmlFor=check.id;
  label.textContent=(index+1)+". "+step.text;
  li.append(check,label);list.appendChild(li);
 });
 var canExpand=steps.length>visibleLimit;
 $("stepsToggle").hidden=!canExpand;
 $("stepsToggle").textContent=fullSteps?"แสดงเฉพาะขั้นตอนสำคัญ":"ดูทั้งหมด "+steps.length+" ขั้นตอน";
 $("stepsToggle").setAttribute("aria-expanded",String(fullSteps));
 $("planTab").disabled=busy;
 $("actTab").disabled=busy||!plan;
 $("refresh").disabled=busy;
 $("backToPlan").hidden=planning||!plan||revokePending;
 $("backToPlan").disabled=busy;
 $("revokeConfirmation").hidden=planning||!plan||!revokePending;
 $("confirmBackToPlan").disabled=busy;
 $("cancelBackToPlan").disabled=busy;
 $("approve").hidden=!planning||!plan;
 $("approve").disabled=busy||!taskId;
 $("approve").textContent=plan?"อนุมัติ Revision "+plan.revision+" · เข้า Act":"อนุมัติแผน";
 $("continue").hidden=planning||!plan;
 $("continue").disabled=busy;
 persist();
}
async function invoke(name,args){
 if(!api||typeof api.callTool!=="function"){
  report("ChatGPT ไม่รองรับการเชื่อมต่อเครื่องมือใน Panel นี้ โปรดรีเฟรช Qnector tools",true);
  throw Error("APP_HOST_UNAVAILABLE");
 }
 busy=true;if(state)render(state);
 report("กำลังอัปเดตสถานะกับ Qnector…");
 try{
  var call=Object.assign({},args);
  if(taskId)call.memoryTaskId=taskId;
  var result=await api.callTool(name,call);
  var payload=result&&(result.structuredContent||result);
  if(result&&(result.isError||(payload&&payload.ok===false)))
   throw Error(payload&&payload.error&&payload.error.message||"Qnector ปฏิเสธการดำเนินการ");
  var next=extract(result);
  if(!next)throw Error("Qnector ไม่ส่งข้อมูลสถานะกลับมา");
  state=next;report("อัปเดตสถานะแล้ว");return next;
 }catch(error){
  report(error&&error.message||"ไม่สามารถดำเนินการได้",true);throw error;
 }finally{busy=false;if(state)render(state);}
}
function followUp(message){
 if(api&&typeof api.sendFollowUpMessage==="function")
  api.sendFollowUpMessage({prompt:message});
 else report("ส่งคำสั่งใน ChatGPT: "+message);
}
function approve(){
 if(busy||!state||state.mode!=="plan"||!state.plan)return;
 invoke("mode_approve",{expectedRevision:state.plan.revision}).catch(function(){});
}
function requestBack(){
 if(busy||!state||state.mode!=="act"||!state.plan)return;
 revokePending=true;render(state);
 $("confirmBackToPlan").focus();
 report("ยืนยันอีกครั้งเพื่อกลับ Plan Mode และยกเลิกการอนุมัติ Revision "+state.plan.revision);
}
function confirmBack(){
 if(busy||!revokePending||!state||state.mode!=="act"||!state.plan)return;
 var args={action:"back_to_plan",expectedRevision:state.plan.revision,expectedApprovedAt:state.plan.approvedAt};
 invoke("mode",args).catch(function(){revokePending=false;if(state)render(state);});
}
function cancelBack(){
 if(busy||!revokePending)return;
 revokePending=false;if(state)render(state);
 $("backToPlan").focus();report("ยกเลิกการกลับ Plan Mode");
}
$("refresh").addEventListener("click",function(){
 invoke("inspect",{target:"mode",request:{action:"get"}}).catch(function(){});
});
$("summaryToggle").addEventListener("click",function(){
 fullSummary=!fullSummary;if(state)render(state);
});
$("stepsToggle").addEventListener("click",function(){
 fullSteps=!fullSteps;if(state)render(state);
});
$("planTab").addEventListener("click",function(){
 if(!state||state.mode!=="act"||!state.plan||busy)return;
 if(revokePending){$("confirmBackToPlan").focus();return;}
 $("backToPlan").focus();
 report("ต้องกด กลับไป Plan แล้วเลือกยืนยัน จึงจะยกเลิกการอนุมัติ");
});
// Mode tabs are navigation, not a substitute for explicit revision approval.
// Requiring the dedicated CTA prevents an accidental switch to write-enabled Act Mode.
$("actTab").addEventListener("click",function(){
 if(!state||state.mode!=="plan"||!state.plan||busy)return;
 $("approve").focus();
 report("ตรวจแผนก่อน แล้วกด อนุมัติ Revision "+state.plan.revision+" เพื่อเข้า Act Mode");
});
$("approve").addEventListener("click",approve);
$("backToPlan").addEventListener("click",requestBack);
$("confirmBackToPlan").addEventListener("click",confirmBack);
$("cancelBackToPlan").addEventListener("click",cancelBack);
window.addEventListener("keydown",function(event){
 if(event.key==="Escape"&&revokePending){cancelBack();event.preventDefault();}
});
$("continue").addEventListener("click",function(){
 if(!state||state.mode!=="act"||!state.plan)return;
 var suffix=taskId?" Use memoryTaskId "+taskId+" on every Qnector call.":"";
 followUp("Continue the approved Qnector plan revision "+state.plan.revision+". Update the live checklist only after verified work; keep user-facing progress concise and prioritize UX."+suffix);
});
var initial=extract(api&&api.toolOutput);
if(!taskId&&initial&&typeof initial.scopeId==="string"&&initial.scopeId.indexOf("task:")===0)taskId=initial.scopeId.slice(5);
if(!taskId&&typeof saved.memoryTaskId==="string")taskId=saved.memoryTaskId;
if(initial)render(initial);
if(api&&typeof api.callTool==="function")
 invoke("inspect",{target:"mode",request:{action:"get"}}).catch(function(){});
else report("Panel นี้ต้องใช้ ChatGPT ที่รองรับ MCP Apps",true);
})();
</script>
</body>
</html>`;
