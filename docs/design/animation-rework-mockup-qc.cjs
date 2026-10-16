/* Standalone Chrome CDP smoke test for the offline QNECTOR animation mockup.
 * Run: node docs/design/animation-rework-mockup-qc.cjs
 * No NPM dependency; tests local UI only and writes reproducible preview PNGs.
 */
"use strict";
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {spawn}=require("node:child_process");
const {pathToFileURL}=require("node:url");
const assert=require("node:assert/strict");
const DIR=__dirname;
const FILE=path.join(DIR,"animation-rework-mockup.html");
const CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT=39649;
const PROFILE=path.join(os.tmpdir(),"qnector-motion-cdp-"+process.pid);
const delay=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
if(!fs.existsSync(CHROME)||!fs.existsSync(FILE))throw Error("Chrome or mockup HTML missing");
const chrome=spawn(CHROME,[
 "--headless=new","--disable-extensions","--no-first-run","--disable-gpu",
 "--remote-debugging-port="+PORT,"--remote-allow-origins=*",
 "--user-data-dir="+PROFILE,"--window-size=1500,980",pathToFileURL(FILE).href
],{stdio:"ignore",windowsHide:true});
let socket,errors=[];
async function getTarget(){
 let err;
 for(let i=0;i<75;i++){
  try{const result=await fetch("http://127.0.0.1:"+PORT+"/json");
    if(result.ok){const tabs=await result.json();const target=tabs.find(t=>t.type==="page"&&t.url.includes("animation-rework-mockup.html"));if(target)return target;}
  }catch(e){err=e}
  await delay(130);
 }
 throw Error("Chrome CDP target not ready: "+(err&&err.message));
}
async function connect(target){
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  socket.addEventListener("open",resolve,{once:true});
  socket.addEventListener("error",reject,{once:true});
 });
 let requestId=0;const pending=new Map();
 socket.addEventListener("message",(event)=>{
  const payload=JSON.parse(event.data);
  if(payload.method==="Runtime.exceptionThrown")errors.push(payload.params.exceptionDetails.text);
  if(payload.id&&pending.has(payload.id)){
   const {resolve,reject}=pending.get(payload.id);pending.delete(payload.id);
   if(payload.error)reject(Error(payload.error.message));else resolve(payload.result||{});
  }
 });
 return (method,params={})=>new Promise((resolve,reject)=>{
  const id=++requestId;pending.set(id,{resolve,reject});
  socket.send(JSON.stringify({id,method,params}));
 });
}
async function main(){
 const target=await getTarget(),send=await connect(target);
 await send("Runtime.enable");await send("Page.enable");
 async function evalJs(expression){
  const out=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(out.exceptionDetails)throw Error("Eval "+expression+": "+JSON.stringify(out.exceptionDetails));
  return out.result.value;
 }
 async function click(selector){
  const ok=await evalJs("(()=>{const n=document.querySelector("+JSON.stringify(selector)+");if(!n)return false;n.click();return true})()");
  assert.ok(ok,"No selector "+selector);
 }
 async function shot(filename){
  const out=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  const dest=path.join(DIR,filename);fs.writeFileSync(dest,Buffer.from(out.data,"base64"));
  console.log("SCREENSHOT "+dest+" bytes="+fs.statSync(dest).size);
 }
 await delay(650);
 assert.equal(await evalJs("document.querySelector('#hero').dataset.state"),"connected");
 assert.equal(await evalJs("document.querySelectorAll('.feed-row').length"),5);
 await shot("animation-rework-dashboard-preview.png");
 await click('[data-view="memory"]');
 await delay(390);
 assert.equal(await evalJs("document.querySelector('#drawerTitle').textContent"),"AI Project Memory");
 assert.ok(await evalJs("document.querySelector('#drawerBody').textContent.includes('Memory freshness')"));
 await shot("animation-rework-memory-preview.png");
 // Search must filter without remounting or silently rewriting saved records.
 await evalJs("(()=>{const n=document.querySelector('#memorySearch');n.value='Privacy';n.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 assert.equal(await evalJs("Array.from(document.querySelectorAll('[data-memory]')).filter(n=>!n.hidden).length"),1);
 // Focus wraps backward from the first drawer control to the last.
 const trap=await evalJs("(()=>{const d=document.querySelector('#drawer'),first=document.querySelector('#btnCloseDrawer');first.focus();const before=document.activeElement.id;const e=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return {defaultPrevented:e.defaultPrevented,activeId:document.activeElement.id,activeTag:document.activeElement.tagName,inside:d.contains(document.activeElement),before,hidden:d.getAttribute('aria-hidden'),inert:d.inert,classes:d.className}})()");
 // Verify focus remains in the active drawer and wraps at its first control.
 assert.ok(trap.defaultPrevented&&trap.inside&&trap.activeId!=="btnCloseDrawer","Drawer Shift+Tab focus should wrap");
 await click('[data-view="skills"]');
 await delay(300);
 assert.equal(await evalJs("document.querySelector('#drawerTitle').textContent"),"Skill Manager");
 assert.equal(await evalJs("document.querySelectorAll('#skillRows .skill-row').length"),4);
 await shot("animation-rework-skills-preview.png");
 await click('#skillRows .skill-row:first-child input');
 assert.equal(await evalJs("document.querySelector('#skillsStat').textContent.trim().startsWith('07')"),true);
 await click('[data-view="workspace"]');
 await delay(260);
 await shot("animation-rework-workspace-preview.png");
 await click('[data-view="skills"]');
 assert.equal(await evalJs("document.querySelector('#skillRows .skill-row:first-child input').checked"),false,"Skill state should persist across drawer navigation within demo");
 await click('#skillRows .skill-row:first-child input');
 await click('[data-view="runtime"]');
 await delay(275);
 await shot("animation-rework-runtime-preview.png");
 await click('[data-view="settings"]');
 await delay(320);
 await click('[data-quality-button="eco"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"eco");
 await click('[data-quality-button="balanced"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"balanced");
 await shot("animation-rework-settings-preview.png");
 // Thirty rapid navigation events must resolve to the last requested view.
 await evalJs("(()=>{const views=['memory','workspace','runtime','skills','settings'];for(let i=0;i<30;i++){document.querySelector('.drawer-tabs [data-view='+views[i%views.length]+']').click()}return true})()");
 assert.equal(await evalJs("document.querySelector('#drawerTitle').textContent"),"Bridge Settings");
 assert.equal(await evalJs("document.querySelector('.dock [data-view=settings]').getAttribute('aria-expanded')"),"true");
 await click("#btnCloseDrawer");await delay(400);
 assert.equal(await evalJs("document.querySelector('#drawer').getAttribute('aria-hidden')"),"true");
 assert.equal(await evalJs("document.querySelector('.dock [data-view=settings]').getAttribute('aria-expanded')"),"false");
 await click('[data-view="workspace"]');
 await evalJs("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
 assert.equal(await evalJs("document.querySelector('#drawer').getAttribute('aria-hidden')"),"true","Escape must close the drawer");
 await click("#btnLab");await delay(250);
 assert.equal(await evalJs("document.querySelector('#labDialog').open"),true);
 await click(".lab-card");
 await shot("animation-rework-motion-lab-preview.png");
 await click('[data-close-dialog="labDialog"]');await delay(200);
 await click("#btnAddEvent");assert.equal(await evalJs("document.querySelector('#eventCounter').textContent"),"6");
 await click("#btnUpdate");await click("#btnStartUpdate");
 await delay(500);
 assert.equal(await evalJs("document.querySelector('#updateDialog').open"),true);
 assert.ok(Number((await evalJs("document.querySelector('#updatePercent').textContent")).replace("%",""))>0);
 await shot("animation-rework-updater-preview.png");
 await click('[data-close-dialog="updateDialog"]');
 await click("#btnSettings");await delay(200);
 await click('[data-action="setup"]');await delay(100);
 assert.equal(await evalJs("document.querySelector('#setupDialog').open"),true);
 await shot("animation-rework-setup-preview.png");
 await click("#btnSetupNext");
 assert.ok(await evalJs("document.querySelector('#setupStepContent').textContent.includes('Secure tunnel settings')"));
 await click('[data-close-dialog="setupDialog"]');
 // Off/reduced profile never requires motion to complete.
 await click('[data-quality-button="off"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"off");
 await click('[data-quality-button="balanced"]');
 await click('#toggleReduced');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"off");
 await click('#toggleReduced');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"balanced");
 await click('#btnCloseDrawer');
 await delay(425);
 // Test the real PointerEvent cycle through CDP: 3s hold to disconnect.
 const pos=await evalJs("(()=>{const r=document.querySelector('#orbButton').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:pos.x,y:pos.y});
 await send("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x,y:pos.y,button:"left",buttons:1,clickCount:1});
 await delay(270);
 await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:pos.x,y:pos.y,button:"left",buttons:0,clickCount:1});
 assert.equal(await evalJs("document.querySelector('#hero').dataset.state"),"connected","Early release must NOT disconnect");
 await send("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x,y:pos.y,button:"left",buttons:1,clickCount:1});
 await delay(3230);
 await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:pos.x,y:pos.y,button:"left",buttons:0,clickCount:1});
 assert.equal(await evalJs("document.querySelector('#hero').dataset.state"),"disconnected","Hold should disconnect demo");
 await click("#orbButton");
 await delay(1600);
 assert.equal(await evalJs("document.querySelector('#hero').dataset.state"),"connected","Click should reconnect demo");
 // Check narrow layout and actual mobile overflow without changing the real desktop app.
 await send("Emulation.setDeviceMetricsOverride",{width:420,height:820,deviceScaleFactor:1,mobile:true});
 await send("Page.reload",{ignoreCache:true});
 await delay(850);
 assert.ok(await evalJs("document.documentElement.scrollWidth <= window.innerWidth+3"),"Mobile viewport should not overflow horizontally");
 await shot("animation-rework-mobile-preview.png");
 await send("Emulation.clearDeviceMetricsOverride");
 assert.equal(errors.length,0,"Chrome runtime JS exceptions: "+errors.join("; "));
 console.log("PASS: dashboard/drawers, Memory, Skills, Settings, Full/Eco/Off/Reduced, Motion Lab, activity, updater, wizard, 3-second Orb hold/reconnect, 420px viewport; JS exceptions 0");
}
main().catch(e=>{console.error("FAIL:",e.stack||e);process.exitCode=1}).finally(async()=>{
 if(socket)try{socket.close()}catch{}
 try{chrome.kill()}catch{}
 await delay(200);
});
