"use strict";
/* Native QNECTOR renderer on a synthetic, mutation-blocked preload.
 * Verifies OS reduced-motion and original global-off over every drawer,
 * quality overrides, focus, update/setup controls and hidden window behavior.
 */
const {app,BrowserWindow}=require("electron");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=process.cwd();
const output=path.join(root,"docs","design","royal-motion-native-system");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let win;
const errors=[];
app.on("window-all-closed",()=>{});
async function evaluate(fn,...args) {
  return win.webContents.executeJavaScript(
    "("+fn.toString()+")("+args.map(x=>JSON.stringify(x)).join(",")+")",true);
}
function profile(name) {
 const button=[...document.querySelectorAll(".motion-quality-segments button")]
  .find(b=>b.textContent.trim().toLowerCase()===name);
 if(!button)return false;
 button.click();return true;
}
function go(name){
 const button=[...document.querySelectorAll(".drawer-menu-tabs button")]
   .find(b=>b.textContent.trim()===name);
 const dock=[...document.querySelectorAll(".dock-pill-btn")]
   .find(b=>b.textContent.trim().endsWith(name));
 if(!button&&!dock)return false;
 (button||dock).click();return true;
}
function snap(){
 const r=document.documentElement,dialog=document.querySelector(".drawer-card");
 return {
  title:document.querySelector(".drawer-title")?.textContent?.trim()||"",
  modal:!!dialog,
  quality:r.dataset.motionQuality,
  legacy:r.dataset.motion,
  reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,
  scrollOverflow:r.scrollWidth>innerWidth,
  tabsDisabled:[...document.querySelectorAll(".drawer-menu-tabs button")].some(b=>b.disabled),
  pageAnimation:document.querySelector(".drawer-page")?getComputedStyle(document.querySelector(".drawer-page")).animationName:null,
  setup:!!document.querySelector(".setup-card"),
  runtime:!!document.querySelector(".runtime-scroll"),
  accessible:dialog?.getAttribute("aria-modal")==="true",
  orb:document.querySelector(".queen-orb-fluid")?.toDataURL()||"",
  silk:document.querySelector(".liquid-silk-canvas")?.toDataURL()||"",
 };
}
async function ensureMode(value){
 const p=await evaluate(profile,value);
 assert.equal(p,true,"Profile click failed "+value);
 await sleep(95);
 const s=await evaluate(snap);
 assert.equal(s.quality,value,"Profile not effective "+value);
 return {quality:s.quality,legacy:s.legacy,reduced:s.reduced,modal:s.modal};
}
async function testPages(label){
 const pages=["Workspace","Memory","Skills","Settings"];
 const seen=[];
 for(const name of pages){
  assert.equal(await evaluate(go,name),true,label+": nav to "+name);
  await sleep(95);
  const s=await evaluate(snap);
  assert.equal(s.modal,true,label+": missing drawer "+name);
  assert.equal(s.tabsDisabled,false,label+": input disabled "+name);
  assert.equal(s.scrollOverflow,false,label+": overflow "+name);
  assert.equal(s.accessible,true,label+": missing modal accessibility "+name);
  if(s.quality==="off"||s.quality==="reduced")
    assert.equal(s.pageAnimation,"none",label+": unexpected spatial animation "+name+" "+s.pageAnimation);
  seen.push({name,quality:s.quality,title:s.title});
 }
 assert.equal(await evaluate(()=>{
  const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("Runtime & Diagnostics"));
  if(!b)return false;b.click();return true;
 }),true,label+": runtime route button missing");
 await sleep(120);
 const rt=await evaluate(snap);
 assert.equal(rt.modal,true);
 assert.equal(rt.runtime,true,label+": runtime scroll missing");
 assert.equal(rt.scrollOverflow,false,label+": runtime overflow");
 seen.push({name:"Runtime",quality:rt.quality,title:rt.title});
 return seen;
}
async function currentCanvas(){
 return await evaluate(()=>{
  const ids=[".queen-orb-fluid",".liquid-silk-canvas"];
  return ids.map(id=>document.querySelector(id)?.toDataURL()||"");
 });
}
async function assertStatic(reason){
 const before=await currentCanvas();
 await sleep(330);
 const after=await currentCanvas();
 assert.deepEqual(after,before,"Decorative canvases redraw while "+reason);
}
async function run(){
 fs.mkdirSync(output,{recursive:true});
 win=new BrowserWindow({
  width:435,height:900,show:false,frame:false,backgroundColor:"#08090c",
  webPreferences:{
   preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
   contextIsolation:true,sandbox:false,nodeIntegration:false,
   backgroundThrottling:false,partition:"inmemory:motion-matrix-20261021"
  }
 });
 win.webContents.on("console-message",event=>{
  const str=String(event.message??"");
  if((event.level===2||event.level===3||str.includes("Uncaught"))&&
    !str.includes("Electron Security Warning"))errors.push(str.slice(0,300));
 });
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_r,callback)=>callback({cancel:true}));
 await win.loadFile(path.join(root,"apps","desktop","index.html"));
 win.showInactive();await sleep(350);
 assert.equal(await evaluate(go,"Settings"),true);
 await sleep(90);
 const base=await ensureMode("balanced");
 assert.equal(base.legacy,"on");
 const snapshots={balanced:await testPages("balanced")};
 assert.equal(await evaluate(go,"Settings"),true);
 snapshots.full=await ensureMode("full");
 snapshots.eco=await ensureMode("eco");
 assert.equal(await evaluate(go,"Settings"),true);
 snapshots.off=await ensureMode("off");
 await assertStatic("Motion Quality Off");
 snapshots.offPages=await testPages("quality-off");
 assert.equal(await evaluate(go,"Settings"),true);
 assert.equal(await evaluate(profile,"balanced"),true);
 await sleep(115);

 // The original global switch must win even with a moving profile.
 const toggled=await evaluate(()=>{
   const row=[...document.querySelectorAll(".setting-toggle-card")].find(x=>x.textContent.includes("Interface Animations"));
   const checkbox=row?.querySelector('input[type="checkbox"]');
   if(!checkbox||!checkbox.checked)return false;checkbox.click();return true;
 });
 assert.equal(toggled,true,"Original animations switch missing");
 await sleep(180);
 const legacyOff=await evaluate(snap);
 assert.equal(legacyOff.legacy,"off","Legacy boolean animation switch ignored");
 assert.equal(legacyOff.quality,"off","Legacy global off did not override Balanced");
 await assertStatic("legacy Interface Animations=false");
 snapshots.legacyOffPages=await testPages("legacy-off");
 assert.equal(await evaluate(go,"Settings"),true);
 const restored=await evaluate(()=>{
   const row=[...document.querySelectorAll(".setting-toggle-card")].find(x=>x.textContent.includes("Interface Animations"));
   const checkbox=row?.querySelector('input[type="checkbox"]');
   if(!checkbox||checkbox.checked)return false;checkbox.click();return true;
 });
 assert.equal(restored,true);
 await sleep(130);
 assert.equal((await evaluate(snap)).quality,"balanced");

 // Emulate OS prefers-reduced-motion while the React app is mounted.
 win.webContents.debugger.attach("1.3");
 await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{
  features:[{name:"prefers-reduced-motion",value:"reduce"}]
 });
 await sleep(180);
 const reduced=await evaluate(snap);
 assert.equal(reduced.reduced,true);
 assert.equal(reduced.quality,"reduced","OS reduced-motion is not overriding persisted quality");
 await assertStatic("OS Reduced Motion");
 snapshots.reducedPages=await testPages("reduced");
 assert.equal(await evaluate(go,"Settings"),true);
 await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{
  features:[{name:"prefers-reduced-motion",value:"no-preference"}]
 });
 await sleep(150);
 assert.equal((await evaluate(snap)).quality,"balanced");
 win.webContents.debugger.detach();

 // Native host-hide event must suspend continuous animation and restore later.
 await evaluate(()=>window.__qcFixture.setWindowVisible(false));
 await sleep(90);
 await assertStatic("native-hidden window");
 await evaluate(()=>window.__qcFixture.setWindowVisible(true));
 await sleep(140);
 const movingBefore=await currentCanvas();
 await sleep(250);
 const movingAfter=await currentCanvas();
 assert.notDeepEqual(movingAfter,movingBefore,"Visible canvases did not resume");
 snapshots.nativeHideResume=true;

 // All routes remain usable and accessible after toggling global and OS states.
 assert.equal(await evaluate(go,"Settings"),true);
 const setupClicked=await evaluate(()=>{
  const row=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Connection Setup")&&!b.closest(".setup-card"));
  if(!row)return false;row.click();return true;
 });
 assert.equal(setupClicked,true,"Setup opener not reachable");
 await sleep(200);
 const setup=await evaluate(snap);
 assert.equal(setup.setup,true,"Connection Setup modal did not mount");
 const setPage=await evaluate(()=>({
  label:document.querySelector(".setup-card")?.getAttribute("aria-label"),
  count:document.querySelectorAll(".setup-progress-step").length,
  overflow:document.documentElement.scrollWidth>innerWidth
 }));
 assert.ok(setPage.label?.includes("connection setup"));
 assert.equal(setPage.overflow,false);
 snapshots.setup={...setPage};

 // Setup forms must preserve typed values while walking backward and forward,
 // and show validation errors locally without touching any real tunnel credentials.
 const continued=await evaluate(()=>{
   const b=[...document.querySelectorAll(".setup-footer button")].find(x=>x.textContent.trim()==="Continue");
   if(!b||b.disabled)return false;b.click();return true;
 });
 assert.equal(continued,true,"Setup cannot advance to credentials step");
 await sleep(65);
 const submittedEmpty=await evaluate(()=>{
   const b=[...document.querySelectorAll(".setup-footer button")].find(x=>x.textContent.includes("Save & Connect"));
   if(!b)return false;b.click();return true;
 });
 assert.equal(submittedEmpty,true,"Setup credential submit is missing");
 await sleep(70);
 const emptyError=await evaluate(()=>document.querySelector(".setup-error")?.textContent?.trim()||"");
 assert.match(emptyError,/Tunnel ID/,"Missing Tunnel ID validation did not appear");
 const filled=await evaluate(()=>{
   const fields=[...document.querySelectorAll(".setup-field input")];
   if(fields.length!==3)return false;
   const write=(input,value)=>{
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);
     input.dispatchEvent(new Event("input",{bubbles:true}));
   };
   write(fields[0],"tunnel_qc_no_network");
   write(fields[1],"qc_dummy_do_not_transmit");
   write(fields[2],"qc-profile");
   return true;
 });
 assert.equal(filled,true,"Setup credential fields missing");
 await sleep(75);
 const backed=await evaluate(()=>{
   const b=[...document.querySelectorAll(".setup-footer button")].find(x=>x.textContent.trim()==="Back");
   if(!b)return false;b.click();return true;
 });
 assert.equal(backed,true);
 await sleep(45);
 const continuedAgain=await evaluate(()=>{
   const b=[...document.querySelectorAll(".setup-footer button")].find(x=>x.textContent.trim()==="Continue");
   if(!b)return false;b.click();return true;
 });
 assert.equal(continuedAgain,true);
 await sleep(65);
 const restoredFields=await evaluate(()=>
   [...document.querySelectorAll(".setup-field input")].map(x=>x.value)
 );
 assert.deepEqual(restoredFields,["tunnel_qc_no_network","qc_dummy_do_not_transmit","qc-profile"],
   "Setup lost field state across Back and Continue");
 snapshots.setup.credentialsRetained=true;
 snapshots.setup.requiredFieldError=emptyError;
 const saveStarted=await evaluate(()=>{
   const b=[...document.querySelectorAll(".setup-footer button")].find(x=>x.textContent.includes("Save & Connect"));
   if(!b)return false;b.click();return true;
 });
 assert.equal(saveStarted,true);
 await sleep(65);
 const submission=await evaluate(()=>{
   const b=document.querySelector(".setup-footer .setup-primary");
   return {busy:b?.disabled,text:b?.textContent?.trim()};
 });
 assert.equal(submission.busy,true,"Submit should be disabled while backend is pending");
 assert.match(submission.text,/Connecting/);
 await sleep(550);
 const rejected=await evaluate(()=>({
   error:document.querySelector(".setup-error")?.textContent?.trim(),
   busy:document.querySelector(".setup-footer .setup-primary")?.disabled
 }));
 assert.match(rejected.error,/QC_FIXTURE_BLOCKS_MUTATING_ACTIONS/);
 assert.equal(rejected.busy,false,"Submit button did not recover after rejected request");
 snapshots.setup.pendingSubmission=true;
 snapshots.setup.rejectedSubmission=true;


 // Escape must close the topmost dialog and never leave inert focus content.
 await evaluate(()=>{
  document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
 });
 await sleep(130);
 assert.equal((await evaluate(snap)).setup,false,"Escape does not close Setup");


 // Updater is entirely synthetic here; evidence must track only backend-
 // supplied phases/bytes. This is not an actual GitHub update or installation.
 const updates=[];
 const emit=async(next)=>{
   await evaluate((data)=>window.__qcFixture.emitUpdate(data),next);
   await sleep(75);
   return await evaluate(()=>({
     phase:document.querySelector(".update-settings-card")?.className,
     badge:document.querySelector(".update-status-badge")?.textContent?.trim(),
     progress:document.querySelector(".update-progress-track > span")?.style.width??null,
     primary:document.querySelector(".btn-update-primary")?.textContent?.trim(),
     panel:document.querySelector(".update-status-panel")?.textContent?.trim(),
     iconAnimation:document.querySelector(".update-status-panel-icon")
      ?getComputedStyle(document.querySelector(".update-status-panel-icon")).animationName:null
   }));
 };
 updates.push(await emit({phase:"checking",message:"QC: checking",progress:0,canDownload:false,canInstall:false}));
 assert.match(updates.at(-1).badge,/Checking/i);
 assert.equal(updates.at(-1).progress,null,"Checking must not fabricate download progress");
 updates.push(await emit({phase:"available",latestVersion:"0.4.58",message:"QC fixture available",canDownload:true,canInstall:false}));
 assert.match(updates.at(-1).primary,/Download/);
 updates.push(await emit({phase:"downloading",progress:.37,bytesDownloaded:37000,totalBytes:100000,
   canDownload:false,canInstall:false,message:"QC downloading"}));
 assert.equal(updates.at(-1).progress,"37%","Download fill must match verified bytes/progress");
 assert.equal(updates.at(-1).iconAnimation,"none","Download bar must not compete with a second spinner");
 updates.push(await emit({phase:"downloaded",progress:1,canInstall:true,canDownload:false,message:"QC checksum verified"}));
 assert.match(updates.at(-1).primary,/Restart & Update/);
 assert.equal(updates.at(-1).progress,null,"Downloaded state must not remain indeterminate");
 updates.push(await emit({phase:"error",message:"QC_SYNTHETIC_VERIFICATION_FAILED",
   canInstall:false,canDownload:false}));
 assert.match(updates.at(-1).primary,/Retry/);
 assert.match(updates.at(-1).panel,/QC_SYNTHETIC_VERIFICATION_FAILED/);
 updates.push(await emit({phase:"up-to-date",latestVersion:"0.4.57",progress:0,
   canDownload:false,canInstall:false,message:"Current fixture version"}));
 assert.match(updates.at(-1).badge,/Up to date/i);
 snapshots.updater=updates.map(x=>({badge:x.badge,progress:x.progress,primary:x.primary,iconAnimation:x.iconAnimation}));

 const result={ok:true,screen:{width:435,height:900},snapshots,
  noRemoteWrites:true,consoleErrors:errors,at:new Date().toISOString()};
 assert.equal(errors.length,0,"Renderer console warnings/errors detected");
 fs.writeFileSync(path.join(output,"motion-reduced-off-matrix.json"),JSON.stringify(result,null,2));
 console.log(JSON.stringify({ok:result.ok,sections:{
  balanced:snapshots.balanced.length,
  qualityOff:snapshots.offPages.length,
  legacyOff:snapshots.legacyOffPages.length,
  reduced:snapshots.reducedPages.length
 },setup:snapshots.setup,errors},null,2));
}
app.whenReady().then(run).then(()=>{win?.destroy();app.quit()}).catch(error=>{
 console.error("ROYAL_MOTION_MATRIX_FAILED",error.stack||String(error));
 win?.destroy();app.exit(1);
});
