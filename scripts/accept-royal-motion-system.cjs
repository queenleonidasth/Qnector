"use strict";
/* Native Electron liquid-glass interaction audit, with mutation-blocked MCP preload. */
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const cwd=process.cwd(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=path.join(cwd,"docs","design","royal-motion-native-system");
let win;
const errors=[];
app.on("window-all-closed",()=>{});
async function evaluate(fn,...args){
 return win.webContents.executeJavaScript("("+fn.toString()+")("+args.map(a=>JSON.stringify(a)).join(",")+")",true);
}
async function shot(name){
 const p=path.join(out,name+".png");
 fs.writeFileSync(p,(await win.webContents.capturePage()).toPNG());
 return p;
}
function basic(){
 const root=document.documentElement,canvas=document.querySelector(".liquid-silk-canvas");
 return {
  rootMotion:root.dataset.motion,
  quality:root.dataset.motionQuality,
  telemetry:root.dataset.motionTelemetry,
  tabs:[...document.querySelectorAll(".drawer-menu-tabs button")].map(e=>({text:e.textContent.trim(),disabled:e.disabled,active:e.getAttribute("aria-current")})),
  title:document.querySelector(".drawer-title")?.textContent,
  modal:!!document.querySelector(".drawer-card"),
  scrollX:document.documentElement.scrollWidth>innerWidth,
  canvasWidth:canvas?.width,
  queenWidth:document.querySelector(".queen-orb-portrait")?.naturalWidth,
  canvasSample:document.querySelector(".queen-orb-fluid")?.toDataURL(),
  settingQualityButtons:document.querySelectorAll(".motion-quality-segments button").length
 };
}
async function main(){
 fs.mkdirSync(out,{recursive:true});
 win=new BrowserWindow({width:475,height:865,show:false,frame:false,
  webPreferences:{preload:path.join(cwd,"scripts","native-renderer-motion-preload.cjs"),
   contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on("console-message",event=>{
   const m=String(event.message||"");
   if((event.level===2||event.level===3||/Uncaught|ResizeObserver loop/i.test(m))&&!m.includes("Electron Security Warning"))
     errors.push(m.slice(0,500));
 });
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_req,callback)=>callback({cancel:true}));
 await win.loadFile(path.join(cwd,"apps","desktop","index.html"));
 win.showInactive();
 await sleep(550);
 assert.equal((await evaluate(basic)).rootMotion,"on","Synthetic config should enable animation");
 assert.equal((await evaluate(basic)).queenWidth,256,"Real Queen asset missing");
 await shot("dashboard");

 await evaluate(()=>window.__qcFixture.emitActivityBurst(16));
 await sleep(2400);
 const activityRows=await evaluate(()=>{
   const rows=[...document.querySelectorAll(".activity-virtual-row")];
   return rows.map(node=>{
     const b=node.querySelector(".activity-item");
     const outer=getComputedStyle(node),inner=getComputedStyle(b);
     return {keyVisible:!!b?.dataset.activityId,position:outer.position,offset:outer.transform,
       innerPosition:inner.position,innerTransform:inner.transform,
       top:node.getBoundingClientRect().top};
   });
 });
 assert.ok(activityRows.length>=3,"Virtualized activity entries did not appear");
 assert.ok(activityRows.every(row=>row.position==="absolute" && row.innerPosition==="relative" && row.keyVisible),
   "Virtualized layout/animation layers must be separate");
 assert.ok(new Set(activityRows.map(row=>Math.round(row.top))).size===activityRows.length,
   "Activity Feed stacked rows at identical Y after entrance");
 await shot("activity-feed");

 const open=await evaluate(()=>{
   const b=[...document.querySelectorAll(".dock-pill-btn")].find(x=>/Settings/i.test(x.textContent));
   if(!b)return false;b.click();return true;
 });
 assert.equal(open,true,"Could not open settings");
 await sleep(400);
 let s=await evaluate(basic);
 assert.equal(s.settingQualityButtons,4,"Motion profiles missing from real Settings UI");
 assert.equal(s.modal,true);
 await shot("settings-balanced");
 const profiles=["full","balanced","eco","off"];
 const evidence=[];
 for(const name of profiles){
   const clicked=await evaluate((name)=>{
     const b=[...document.querySelectorAll(".motion-quality-segments button")].find(e=>e.textContent.trim().toLowerCase()===name);
     if(!b)return false;b.click();return true;
   },name);
   assert.equal(clicked,true,"Profile not clickable "+name);
   await sleep(300);
   s=await evaluate(basic);
   assert.equal(s.quality,name,"Profile did not apply "+name);
   const before=s.canvasSample;
   await sleep(340);
   const after=(await evaluate(basic)).canvasSample;
   if(name==="off")assert.equal(after,before,"Off must stop the continuous Orb painting");
   if(name!=="off")assert.notEqual(after,before,"Active profile must animate liquid glass Orb "+name);
   evidence.push({profile:name,orbMoved:before!==after});
   await shot("settings-"+name);
 }
 await evaluate(()=>{
  const b=[...document.querySelectorAll(".motion-quality-segments button")].find(x=>x.textContent.trim()==="Balanced");b.click();
 });
 await sleep(100);
 const telemetry=await evaluate(()=>{
  const input=document.querySelector(".motion-telemetry-toggle input");if(!input)return false;
  if(!input.checked)input.click();return input.checked;
 });
 assert.equal(telemetry,true,"Telemetry switch inaccessible");
 await sleep(1400);
 const fpsText=await evaluate(()=>document.querySelector(".motion-telemetry-result")?.textContent?.trim()||"");
 assert.match(fpsText,/\d+(\.\d+)? FPS/,"Opt-in FPS telemetry must report real frame cadence");
 await shot("telemetry");
 // Rapid route switching; the old implementation disabled all tabs for 200ms.
 const switched=await evaluate(()=>{
   const items=["Workspace","Memory","Skills","Settings"];
   for(let i=0;i<40;i++){
     const b=[...document.querySelectorAll(".drawer-menu-tabs button")].find(e=>e.textContent.trim()===items[i%4]);
     if(!b||b.disabled)return false;
     b.click();
   }
   return true;
 });
 assert.equal(switched,true,"Drawer tab clicks blocked");
 await sleep(190);
 assert.ok((await evaluate(basic)).title?.includes("BRIDGE SETTINGS"),"Rapid tabs did not land on Settings");
 assert.ok((await evaluate(basic)).tabs.every(t=>!t.disabled),"Drawer tabs must not be disabled during transitions");
 // Content scroll preservation is checked only when Settings genuinely scrolls.
 const startScroll=await evaluate(()=>{
  const el=document.querySelector(".drawer-page > .drawer-content");
  if(!el)return null;el.scrollTop=Math.min(230,el.scrollHeight-el.clientHeight);
  return {value:el.scrollTop,extent:el.scrollHeight-el.clientHeight};
 });
 await evaluate(()=>{
  const b=[...document.querySelectorAll(".drawer-menu-tabs button")].find(e=>e.textContent.trim()==="Memory");b?.click();
 });
 await sleep(65);
 await evaluate(()=>{
  const b=[...document.querySelectorAll(".drawer-menu-tabs button")].find(e=>e.textContent.trim()==="Settings");b?.click();
 });
 await sleep(200);
 const endScroll=await evaluate(()=>document.querySelector(".drawer-page > .drawer-content")?.scrollTop??null);
 if(startScroll?.extent>0)assert.ok(Math.abs(endScroll-startScroll.value)<=2,"Drawer lost prior scroll offset");
 await shot("settings-return");
 // Profile stored as a local UI preference (no actual backend config write).
 assert.equal(await evaluate(()=>localStorage.getItem("qnector:motion-quality:v1")),"balanced");
 await evaluate(()=>document.querySelector(".btn-drawer-close")?.click());
 await sleep(260);
 assert.equal((await evaluate(basic)).modal,false,"Close should complete promptly");
 assert.deepEqual(errors,[],"No renderer warnings/errors");
 const result={ok:true,observedProfiles:evidence,fpsText,retargetedSwitches:40,
  settingsScrollRestored:startScroll?.extent>0?Math.abs(endScroll-startScroll.value)<=2:"not scrollable",
  portraitPx:256,screenshots:fs.readdirSync(out).filter(x=>x.endsWith(".png")),errors};
 fs.writeFileSync(path.join(out,"motion-system-acceptance.json"),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}
app.whenReady().then(main).then(()=>{win?.destroy();app.quit()}).catch(err=>{
 console.error("NATIVE_MOTION_SYSTEM_QC_FAILED",err.stack||err);win?.destroy();app.exit(1);
});
