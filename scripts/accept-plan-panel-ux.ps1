$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root "node_modules\.bin\electron.cmd"
if (-not (Test-Path -LiteralPath $electron)) { throw "Electron is required for plan UX acceptance" }
$temp = Join-Path $env:TEMP ("qnector-panel-ux-" + [Guid]::NewGuid().ToString("N"))
$artifacts = Join-Path $root "apps\desktop\release\qc-plan-panel-ux"
New-Item -ItemType Directory -Force -Path $temp, $artifacts | Out-Null
$generate = Join-Path $temp "generate.mjs"
$test = Join-Path $temp "test.cjs"
$html = Join-Path $temp "panel.html"
try {
  @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const entry=pathToFileURL(path.join(process.cwd(),"packages/mcp-server/dist/plan-view.js")).href;
const {PLAN_VIEW_HTML}=await import(entry);
const initial={
 scopeId:"task:task_ux_acceptance",workspace:"C:\\Projects\\Qnector",mode:"plan",
 plan:{revision:3,approvedRevision:null,approvedAt:null,
  title:"QC Plan Mode: QNECTOR UX and performance review",
  summary:"Goal: UX first. Inspect components, verify performance and safety; the panel should replace lengthy duplicate narrative. ".repeat(15),
  steps:Array.from({length:10},(_,index)=>({
   id:"step-"+index,done:false,text:"Phase "+(index+1)+" - Verify quality gates, UX and accessibility without duplicate output."
  }))
 }
};
const code=[
 "window.__calls=[];window.__followUps=[];",
 "window.__state="+JSON.stringify(initial)+";",
 "window.openai={",
 "toolInput:{memoryTaskId:'task_ux_acceptance'},",
 "toolOutput:{ok:true,data:{data:window.__state}},widgetState:{},",
 "setWidgetState:function(next){window.__persisted=next;},",
 "callTool:async function(name,args){",
 "window.__calls.push({name:name,args:args});",
 "var current=window.__state;",
 "if(name==='mode_approve'){if(args.expectedRevision!==current.plan.revision)",
 "return {structuredContent:{ok:false,error:{message:'Revision mismatch'}}};",
 "current.mode='act';current.plan.approvedRevision=current.plan.revision;current.plan.approvedAt='2026-10-11T09:00:00.000Z';}",
 "if(name==='mode'&&args.action==='back_to_plan'){",
 "if(args.expectedRevision!==current.plan.revision||args.expectedApprovedAt!==current.plan.approvedAt)",
 "return {structuredContent:{ok:false,error:{message:'Approval stale'}}};",
 "current.mode='plan';current.plan.approvedRevision=null;current.plan.approvedAt=null;}",
 "if(name==='mode'&&args.action==='step'){",
 "if(args.expectedRevision!==current.plan.revision||args.expectedStepId!==current.plan.steps[args.index].id||args.expectedApprovedAt!==current.plan.approvedAt)",
 "return {structuredContent:{ok:false,error:{message:'Checklist stale'}}};",
 "current.plan.steps[args.index].done=args.done;}",
 "return {structuredContent:{ok:true,data:{data:structuredClone(current)}}};",
 "},sendFollowUpMessage:function(message){window.__followUps.push(message);}};"
].join("\n");
const marker="<script>\n(function(){";
if(!PLAN_VIEW_HTML.includes(marker))throw Error("Panel init marker missing");
const injected="<script>"+code+"</script>\n"+marker;
fs.writeFileSync(process.argv[2],PLAN_VIEW_HTML.replace(marker,injected),"utf8");
'@ | Set-Content -LiteralPath $generate -Encoding UTF8
  @'
const {app,BrowserWindow}=require("electron");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed",()=>{});
const {pathToFileURL}=require("node:url");
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const html=process.argv[2],folder=process.argv[3],results=[];
 for(const [width,height] of [[435,900],[451,978],[700,900]]){
  const win=new BrowserWindow({width,height,show:false,useContentSize:true,webPreferences:{sandbox:true}});
  try{
   await win.loadURL(pathToFileURL(html).href);await pause(75);
   const sample=await win.webContents.executeJavaScript(
    "({summaryChars:document.getElementById('planSummary').textContent.length,"+
    "steps:document.querySelectorAll('#steps li').length,"+
    "progress:document.getElementById('progressCount').textContent,"+
    "approveVisible:!document.getElementById('approve').hidden,"+
    "height:Math.round(document.querySelector('main').getBoundingClientRect().height),"+
    "scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth})");
   assert.equal(sample.steps,3);
   assert.ok(sample.summaryChars<=281);
   assert.ok(sample.progress.startsWith("0/10 "),"progress must show zero of ten");
   assert.equal(sample.approveVisible,true);
   assert.ok(sample.scrollWidth<=sample.viewportWidth,"horizontal overflow");
   assert.ok(sample.height<height,"collapsed panel must fit viewport");
   const png=path.join(folder,"plan-panel-"+width+".png");
   fs.writeFileSync(png,(await win.webContents.capturePage()).toPNG());
   results.push({width,...sample,screenshot:png});
   await win.webContents.executeJavaScript(
    "document.getElementById('summaryToggle').click();document.getElementById('stepsToggle').click()");
   const expanded=await win.webContents.executeJavaScript(
    "({summaryLength:document.getElementById('planSummary').textContent.length,"+
    "steps:document.querySelectorAll('#steps li').length,"+
    "aria:document.getElementById('stepsToggle').getAttribute('aria-expanded'),"+
    "persisted:window.__persisted})");
   assert.ok(expanded.summaryLength>1000);
   assert.equal(expanded.steps,10);
   assert.equal(expanded.aria,"true");
   assert.equal(expanded.persisted.fullSteps,true);
   await win.webContents.executeJavaScript("document.getElementById('actTab').click()");
   const review=await win.webContents.executeJavaScript(
    "({mode:document.getElementById('controller').dataset.mode,"+
    "approvalCalls:window.__calls.filter(c=>c.name==='mode_approve').length,"+
    "focused:document.activeElement.id,"+
    "message:document.getElementById('message').textContent})");
   assert.equal(review.mode,"plan","Act tab alone must never approve writes");
   assert.equal(review.approvalCalls,0,"Act tab must not call mode_approve");
   assert.equal(review.focused,"approve","Act tab should focus the explicit revision CTA");
   assert.ok(review.message.includes("Revision 3"),"review message should name the revision");
   await win.webContents.executeJavaScript("document.getElementById('approve').click()");
   await pause(75);
   const approved=await win.webContents.executeJavaScript(
    "({mode:document.getElementById('controller').dataset.mode,"+
    "continueVisible:!document.getElementById('continue').hidden,calls:window.__calls})");
   assert.equal(approved.mode,"act");
   assert.equal(approved.continueVisible,true);
   assert.ok(approved.calls.some(c=>c.name==="mode_approve"&&
    c.args.expectedRevision===3&&c.args.memoryTaskId==="task_ux_acceptance"));
   await win.webContents.executeJavaScript(
    "document.getElementById('summaryToggle').click();"+
    "document.getElementById('stepsToggle').click();"+
    "var item=document.querySelector('#steps input');item.checked=true;"+
    "item.dispatchEvent(new Event('change',{bubbles:true}))");
   await pause(75);
   const updated=await win.webContents.executeJavaScript(
    "({progress:document.getElementById('progressCount').textContent,"+
    "steps:document.querySelectorAll('#steps li').length})");
   assert.ok(updated.progress.startsWith("1/10 "),"Act checklist should update from real tool result");
   assert.equal(updated.steps,3,"Act view should return to next three pending steps");
   const actPng=path.join(folder,"plan-panel-act-"+width+".png");
   fs.writeFileSync(actPng,(await win.webContents.capturePage()).toPNG());
   results[results.length-1].actScreenshot=actPng;
   await win.webContents.executeJavaScript("document.getElementById('continue').click()");
   const follow=await win.webContents.executeJavaScript("window.__followUps");
   assert.equal(follow.length,1);
   assert.ok(follow[0].prompt.includes("task_ux_acceptance"));
   await win.webContents.executeJavaScript("document.getElementById('planTab').click()");
   const nonDestructive=await win.webContents.executeJavaScript(
    "({mode:document.getElementById('controller').dataset.mode,"+
    "revocations:window.__calls.filter(c=>c.name==='mode'&&c.args.action==='back_to_plan').length,"+
    "focused:document.activeElement.id})");
   assert.equal(nonDestructive.mode,"act","Plan tab alone must NOT revoke approval");
   assert.equal(nonDestructive.revocations,0,"Plan tab should be navigation only");
   assert.equal(nonDestructive.focused,"backToPlan");
   await win.webContents.executeJavaScript("document.getElementById('backToPlan').click()");
   const confirmation=await win.webContents.executeJavaScript(
    "({visible:!document.getElementById('revokeConfirmation').hidden,"+
    "focused:document.activeElement.id,mode:document.getElementById('controller').dataset.mode,"+
    "revocations:window.__calls.filter(c=>c.name==='mode'&&c.args.action==='back_to_plan').length})");
   assert.equal(confirmation.visible,true,"Explicit revocation confirmation is required");
   assert.equal(confirmation.focused,"confirmBackToPlan");
   assert.equal(confirmation.mode,"act","Opening confirmation must not change mode");
   assert.equal(confirmation.revocations,0);
   fs.writeFileSync(path.join(folder,"plan-revoke-confirm-"+width+".png"),
    (await win.webContents.capturePage()).toPNG());
   await win.webContents.executeJavaScript("document.getElementById('cancelBackToPlan').click()");
   assert.equal(await win.webContents.executeJavaScript(
    "document.getElementById('revokeConfirmation').hidden"),true,"Cancel should preserve Act Mode");
   await win.webContents.executeJavaScript("document.getElementById('backToPlan').click()");
   await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
   assert.equal(await win.webContents.executeJavaScript(
    "document.getElementById('revokeConfirmation').hidden"),true,"Escape should dismiss confirmation");
   await win.webContents.executeJavaScript(
    "document.getElementById('backToPlan').click();document.getElementById('confirmBackToPlan').click()");
   await pause(75);
   const revoked=await win.webContents.executeJavaScript(
    "({mode:document.getElementById('controller').dataset.mode,"+
    "revocations:window.__calls.filter(c=>c.name==='mode'&&c.args.action==='back_to_plan')})");
   assert.equal(revoked.mode,"plan","Only explicit confirmation should revoke approval");
   assert.equal(revoked.revocations.length,1);
   assert.equal(revoked.revocations[0].args.expectedRevision,3);
   assert.equal(revoked.revocations[0].args.expectedApprovedAt,"2026-10-11T09:00:00.000Z");
   assert.equal(revoked.revocations[0].args.memoryTaskId,"task_ux_acceptance");
  }finally{win.destroy();}
 }
 const report={ok:true,views:results,approval:true,disclosure:true};
 fs.writeFileSync(path.join(folder,"acceptance-result.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
app.whenReady().then(main).then(()=>app.quit()).catch(error=>{
 console.error(error.stack||String(error));app.exit(1);
});
'@ | Set-Content -LiteralPath $test -Encoding UTF8
  Push-Location $root
  try {
    & node $generate $html
    if ($LASTEXITCODE -ne 0) { throw "Panel fixture generation failed" }
    $result = Join-Path $artifacts "acceptance-result.json"
    Remove-Item -LiteralPath $result -Force -ErrorAction SilentlyContinue
    & $electron $test $html $artifacts
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $result)) {
      throw "Plan Panel UX acceptance failed (no verified result marker)"
    }
    $verified = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
    if ($verified.ok -ne $true -or $verified.views.Count -ne 3) { throw "Incomplete UX acceptance" }
  } finally { Pop-Location }
} finally {
  Remove-Item -LiteralPath $temp -Force -Recurse -ErrorAction SilentlyContinue
}
