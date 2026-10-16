"use strict";
const { app, BrowserWindow }=require("electron");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=process.cwd();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const picture=path.join(root,"docs","design","royal-motion-orb-hold-electron.png");
const failures=[];
let win;
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.on("window-all-closed",()=>{});
async function snapshot(){
 const ring=document.querySelector(".charge-svg-ring");
 const meter=document.querySelector(".charge-meter");
 const orb=document.querySelector(".glass-sphere-enclosure");
 const images=[...document.querySelectorAll(".brand-queen-mark,.queen-orb-portrait")];
 const portraitStyle=getComputedStyle(document.querySelector(".queen-orb-portrait"));
 const reflectionStyle=getComputedStyle(document.querySelector(".queen-orb-reflection"));
 return {
  queenBlend:portraitStyle.mixBlendMode,
  queenImageBorder:portraitStyle.borderTopWidth,
  queenImageBackground:portraitStyle.backgroundColor,
  queenImageContrast:portraitStyle.filter,
  reflectionMask:reflectionStyle.maskImage,
  hasSilk:!!document.querySelector(".liquid-silk-canvas"),
  hasMatrix:!!document.querySelector(".gold-matrix-canvas"),
  hasOrbFluid:!!document.querySelector(".queen-orb-fluid"),
  imageWidths:images.map(img=>img.naturalWidth),
  active:ring?.classList.contains("active")||false,
  visible:ring?getComputedStyle(ring).visibility:null,
  progress:Number(meter?.style.strokeDashoffset||364.42),
  connected:document.querySelector(".status-pill")?.textContent?.trim(),
  countdown:document.querySelector(".hero-state-title")?.textContent?.trim(),
  error:document.querySelector(".error-toast")?.textContent?.trim()||null,
  inWindow:document.visibilityState,
 };
}
async function main(){
 win=new BrowserWindow({width:440,height:790,show:false,frame:false,skipTaskbar:true,
   webPreferences:{preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
     contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on("console-message",e=>{
   const str=String(e.message||"");
   if(e.level===2||e.level===3||str.includes("Uncaught"))failures.push(str);
 });
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_r,callback)=>callback({cancel:true}));
 await win.loadFile(path.join(root,"apps","desktop","index.html"));
 win.showInactive();await sleep(250);
 const evaluate=(fn)=>win.webContents.executeJavaScript("("+fn.toString()+")()",true);
 let result=await evaluate(snapshot);
 assert.equal(result.hasSilk,true);
 assert.equal(result.hasMatrix,false);
 assert.equal(result.hasOrbFluid,true);
 assert.deepEqual(result.imageWidths,[256,256]);
 assert.equal(result.queenBlend,"normal","Preserve original black/gold portrait contrast");
 assert.equal(result.queenImageBorder,"0px","No square icon border");
 assert.equal(result.queenImageBackground,"rgba(0, 0, 0, 0)","No square background plate");
 assert.match(result.queenImageContrast,/contrast\(1\.15\)/,"Retain crisp source detail");
 assert.match(result.reflectionMask,/radial-gradient/,"Glass reflection must avoid the face center");
 assert.equal(result.active,false);
 assert.equal(result.visible,"hidden","No waiting ring at idle");
 assert.equal(result.inWindow,"visible");
 // Real main-process visibility messages must pause both liquid canvases.
 await evaluate(()=>window.__qcFixture.setWindowVisible(false));
 await sleep(120);
 const paused1=await evaluate(()=>document.querySelector(".queen-orb-fluid").toDataURL());
 await sleep(220);
 const paused2=await evaluate(()=>document.querySelector(".queen-orb-fluid").toDataURL());
 assert.equal(paused1,paused2,"Orb Canvas must stop on native hide event");
 await evaluate(()=>window.__qcFixture.setWindowVisible(true));
 await sleep(230);
 const resumed=await evaluate(()=>document.querySelector(".queen-orb-fluid").toDataURL());
 assert.notEqual(resumed,paused2,"Orb Canvas should resume from native show event");

 await evaluate(()=>document.querySelector(".glass-sphere-enclosure")?.dispatchEvent(
   new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0})
 ));
 await sleep(540);
 result=await evaluate(snapshot);
 assert.equal(result.active,true);
 assert.equal(result.visible,"visible");
 assert.ok(result.progress<364.42 && result.progress>100,"Radial ring should advance without a React render");
 assert.ok(/2\.[0-9]s/.test(result.countdown),"Hold countdown should update outside React");
 fs.mkdirSync(path.dirname(picture),{recursive:true});
 fs.writeFileSync(picture,(await win.webContents.capturePage()).toPNG());

 await evaluate(()=>document.querySelector(".glass-sphere-enclosure")?.dispatchEvent(
   new MouseEvent("mouseup",{bubbles:true,cancelable:true,button:0})
 ));
 await sleep(120);
 result=await evaluate(snapshot);
 assert.equal(result.active,false,"Early release must hide ring");
 assert.equal(result.visible,"hidden");
 assert.equal(result.connected?.toLowerCase(),"active","Early release must not disconnect");

 await evaluate(()=>document.querySelector(".glass-sphere-enclosure")?.dispatchEvent(
   new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0})
 ));
 await sleep(3220);
 result=await evaluate(snapshot);
 assert.equal(result.active,false,"Ring hidden after backend completion/error");
 assert.equal(result.visible,"hidden");
 assert.ok(result.error?.includes("QC_FIXTURE_BLOCKS_MUTATING_ACTIONS"),
   "Fake backend rejects disconnect; UI must surface failure instead of falsely showing success");
 assert.equal(result.connected?.toLowerCase(),"active","Failed disconnect must keep accurate connection state");
 assert.equal(failures.length,0,"Console exceptions: "+failures.join("; "));
 console.log(JSON.stringify({ok:true,queenImagesLoaded:true,silkBackground:true,
   ringHiddenWhenIdle:true,earlyReleaseCancels:true,fullHoldCallsBackend:true,
   fakeBackendFailureSurfaced:true,actualConnectionUnchanged:true,
   screenshot:picture,consoleErrors:failures},null,2));
}
app.whenReady().then(main).then(()=>{win?.destroy();app.quit()}).catch(error=>{
 console.error("ROYAL_MOTION_QC_FAIL",error.stack||error);
 if(win)win.destroy();app.exit(1);
});
