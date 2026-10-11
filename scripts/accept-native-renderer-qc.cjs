const {app,BrowserWindow}=require("electron");
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=process.cwd();
const output=path.join(root,"apps","desktop","release","qc-plan-panel-ux");
const preload=path.join(root,"scripts","native-renderer-qc-preload.cjs");
fs.mkdirSync(output,{recursive:true});
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed",()=>{});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function openNav(name){
 const options=[...document.querySelectorAll(".drawer-menu-tabs button")];
 const fromTabs=options.find(b=>b.textContent.trim()===name);
 const fromDock=[...document.querySelectorAll("button")]
  .find(b=>b.textContent.trim().endsWith(name) && !b.closest(".drawer-card"));
 const b=fromTabs||fromDock;
 if(!b)return {ok:false,available:[...document.querySelectorAll("button")].map(b=>b.textContent.trim().slice(0,80))};
 b.click();return {ok:true};
}
function runtimeNav(){
 const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Runtime & Diagnostics"));
 if(!b)return false;
 b.click();return true;
}
function snapshot(){
 const dialog=document.querySelector('[role="dialog"][aria-modal="true"]');
 const content=document.querySelector(".drawer-content");
 const skillsList=document.querySelector(".skills-modal,.skills-discover-results,.skills-content");
 const runtimeScroll=document.querySelector("[data-testid=runtime-scroll]");
 const snapScroll=el=>el?{
  scrollHeight:el.scrollHeight,
  clientHeight:el.clientHeight,
  overflow:getComputedStyle(el).overflowY
 }:null;
 return {
  text:document.body.innerText.slice(-5000),
  modal:!!dialog,
  label:dialog?.getAttribute("aria-label")||null,
  tabs:[...document.querySelectorAll(".drawer-menu-tabs button")].map(b=>b.textContent.trim()),
  overflowX:document.documentElement.scrollWidth>innerWidth,
  content:snapScroll(content),skills:snapScroll(skillsList),runtime:snapScroll(runtimeScroll),
  lastFocus:document.activeElement?.getAttribute("aria-label")||document.activeElement?.tagName,
  reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,
  motion:document.documentElement.dataset.motion
 };
}
function keyboard(key,shift=false){
 const event=new KeyboardEvent("keydown",{key,shiftKey:shift,bubbles:true,cancelable:true});
 document.dispatchEvent(event);
 const dialog=document.querySelector('[role="dialog"][aria-modal="true"]');
 return {prevented:event.defaultPrevented,activeInside:!!dialog?.contains(document.activeElement),
  tag:document.activeElement?.tagName,aria:document.activeElement?.getAttribute("aria-label")};
}
async function main(){
 const views=[];
 for(const [width,height] of [[420,620],[435,900],[451,978],[700,900]]){
  const errors=[];
  const win=new BrowserWindow({
   width,height,show:false,useContentSize:true,frame:false,
   webPreferences:{preload,contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false}
  });
  win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_r,callback)=>callback({cancel:true}));
  win.webContents.on("console-message",(event)=>{
   const level=event.level;
   const message=String(event.message??"");
   if((level==="error"||level==="warning"||level===2||level===3||message.includes("Uncaught"))
     && !message.includes("Electron Security Warning"))errors.push(message.slice(0,450));
  });
  try{
   await win.loadFile(path.join(root,"apps","desktop","index.html"));
   const evaluate=(f,...args)=>win.webContents.executeJavaScript("("+f.toString()+")("+args.map(x=>JSON.stringify(x)).join(",")+")",true);
   let start;
   for(let attempt=0;attempt<30;attempt++){
    await delay(75);
    start=await evaluate(snapshot);
    if(start.motion==="off" && start.text.includes("QNECTOR"))break;
   }
   assert.equal(start.motion,"off","The synthetic animation setting did not apply before the UI QC deadline");
   assert.equal(start.overflowX,false,"root overflow at "+width);
   if(width===451){
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{
     features:[{name:"prefers-reduced-motion",value:"reduce"}]
    });
    const reduced=await win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches');
    assert.equal(reduced,true,"Reduced motion emulation did not activate");
    win.webContents.debugger.detach();
   }
   assert.ok(start.text.includes("QNECTOR"),"main renderer failed to load");
   const data={width,height,main:true,reducedMotion:start.motion==="off",screens:[]};
   for(const name of ["Workspace","Memory","Skills","Settings"]){
    const clicked=await evaluate(openNav,name);
    assert.equal(clicked.ok,true,"Could not open "+name+": "+JSON.stringify(clicked.available));
    await delay(95);
    const current=await evaluate(snapshot);
    assert.equal(current.modal,true,"Missing dialog "+name+" at "+width);
    assert.equal(current.overflowX,false,"Horizontal page overflow "+name+" at "+width);
    assert.equal(current.tabs.length,4,"Wrong nav tab count "+name);
    if(name==="Memory")assert.ok(current.text.includes("Memory at a glance"),"Memory content missing");
    if(name==="Skills")assert.ok(current.text.includes("SKILL MANAGER"),"Skills content missing");
    if(name==="Settings"){
     assert.ok(current.content?.scrollHeight>=current.content?.clientHeight,"Settings scroll data missing");
     assert.ok(["auto","scroll"].includes(current.content?.overflow),"Settings scroll not enabled");
    }
    data.screens.push({
     name,accessibleDialog:current.modal,hasLabel:!!current.label,
     innerScroll:current.content?.overflow,
     scrollExtent:current.content?current.content.scrollHeight-current.content.clientHeight:0,
     overflowX:current.overflowX
    });
   }
   const settingsScroll=await win.webContents.executeJavaScript('(()=>{const e=document.querySelector(".drawer-content");if(!e)return null;e.scrollTop=e.scrollHeight;return {top:e.scrollTop,extent:e.scrollHeight-e.clientHeight};})()');
   if(settingsScroll?.extent>0)assert.ok(settingsScroll.top>0,"Settings page cannot scroll");
   data.settingsScroll=settingsScroll;
   const clickedRuntime=await evaluate(runtimeNav);
   assert.equal(clickedRuntime,true,"Runtime not reachable from Settings");
   await delay(135);
   const runtime=await evaluate(snapshot);
   assert.equal(runtime.modal,true,"Runtime dialog disappeared at "+width);
   assert.ok(runtime.text.includes("Health") && runtime.text.includes("Durable jobs"),
     "Runtime content missing at "+width);
   assert.equal(runtime.overflowX,false,"Runtime overflow at "+width);
   data.screens.push({name:"Runtime",accessibleDialog:runtime.modal,hasLabel:!!runtime.label,
    runtimeScroll:runtime.runtime,overflowX:runtime.overflowX});
   // Keyboard focus must move inside the active modal on Tab, even if this
   // hidden window does not dispatch normal requestAnimationFrame callbacks.
   const failureTriggered=await win.webContents.executeJavaScript('(()=>{window.__qcFixture.failRuntimeOnce();const btn=document.querySelector(".runtime-footer button");if(!btn)return false;btn.click();return true;})()');
   assert.equal(failureTriggered,true,"Could not trigger synthetic runtime error state");
   await delay(90);
   const toast=await win.webContents.executeJavaScript('(()=>{const e=document.querySelector(".error-toast");return e?{text:e.textContent,role:e.getAttribute("role"),ariaLive:e.getAttribute("aria-live"),dismiss:e.querySelector("button")?.getAttribute("aria-label")}:null;})()');
   assert.ok(toast?.text.includes("QC_SYNTHETIC_RUNTIME_FAILURE"),"Runtime error not surfaced in UI");
   assert.equal(toast.role,"alert","Runtime error is not announced to screen readers");
   assert.equal(toast.ariaLive,"assertive");
   assert.equal(toast.dismiss,"Dismiss error");
   const dismissed=await win.webContents.executeJavaScript('(()=>{const b=document.querySelector(".error-toast button");if(!b)return false;b.click();return true;})()');
   assert.equal(dismissed,true,"Cannot dismiss runtime error");
   await delay(35);
   const dismissedToast=await win.webContents.executeJavaScript('document.querySelector(".error-toast")===null');
   assert.equal(dismissedToast,true,"Error dismissal did not clear toast");
   data.errorStateAnnounced=true;
   const tab=await evaluate(keyboard,"Tab",false);
   assert.equal(tab.activeInside,true,"Tab not trapped in Runtime modal");
   data.tabTrapped=true;
   const escape=await evaluate(keyboard,"Escape",false);
   assert.equal(escape.prevented,true,"Escape not consumed by modal");
   await delay(120);
   const closed=await evaluate(snapshot);
   assert.equal(closed.modal,false,"Escape did not close Runtime");
   data.escapeClosesDialog=true;
   data.errors=errors;
   assert.equal(data.reducedMotion,true,"User animation-off setting was not applied");
   assert.equal(errors.length,0,"Renderer console errors at "+width+": "+errors.join("; "));
   views.push(data);
  }finally{win.destroy();}
 }
 const result={ok:true,source:"Compiled Qnector renderer running in isolated Electron with synthetic preload",
  preventsLiveMachineChanges:true,viewports:views,
  note:"No installed Qnector.exe, live tunnel, Windows user config or real ChatGPT iframe was touched."};
 const report=path.join(output,"native-renderer-acceptance.json");
 fs.writeFileSync(report,JSON.stringify(result,null,2),"utf8");
 console.log(JSON.stringify({ok:result.ok,views:views.map(v=>({
  viewport:v.width+"x"+v.height,screenNames:v.screens.map(s=>s.name),
  overflow:v.screens.some(s=>s.overflowX),escape:v.escapeClosesDialog,tab:v.tabTrapped,errors:v.errors
 })),report},null,2));
}
app.whenReady().then(main).then(()=>app.quit()).catch(e=>{console.error(e.stack||String(e));app.exit(1)});
