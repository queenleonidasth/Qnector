/* Offline Chrome CDP smoke tests for the QNECTOR liquid glass HTML concept.
   No external services or application runtime are touched.
   node docs/design/qnector-liquid-glass-v2-qc.cjs
*/
"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {pathToFileURL}=require("node:url");
const {spawn}=require("node:child_process");
const assert=require("node:assert/strict");
const DIR=__dirname,FILE=path.join(DIR,"qnector-liquid-glass-motion-v2.html");
const CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT=39827,PROFILE=path.join(os.tmpdir(),"qnector-v2-cdp-"+process.pid);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const chrome=spawn(CHROME,["--headless=new","--disable-extensions","--no-first-run","--disable-gpu",
 "--remote-debugging-port="+PORT,"--remote-allow-origins=*",
 "--user-data-dir="+PROFILE,"--window-size=1600,970",pathToFileURL(FILE).href],
 {stdio:"ignore",windowsHide:true});
let ws,errors=[];
async function target(){
 for(let i=0;i<90;i++){
  try{
    const r=await fetch("http://127.0.0.1:"+PORT+"/json");if(!r.ok)throw Error("http "+r.status);
    const pages=await r.json();
    const page=pages.find(x=>x.type==="page"&&x.url.includes("qnector-liquid-glass-motion-v2.html"));
    if(page)return page;
  }catch{}
  await delay(110);
 }
 throw Error("Chrome CDP not ready");
}
async function client(page){
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
   ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});
 });
 let id=0;const pending=new Map();
 ws.addEventListener("message",event=>{
  const payload=JSON.parse(event.data);
  if(payload.method==="Runtime.exceptionThrown")errors.push(payload.params.exceptionDetails.text);
  if(payload.id&&pending.has(payload.id)){
    const {resolve,reject}=pending.get(payload.id);pending.delete(payload.id);
    if(payload.error)reject(Error(payload.error.message));else resolve(payload.result||{});
  }
 });
 return (method,params={})=>new Promise((resolve,reject)=>{
  const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));
 });
}
async function main(){
 const send=await client(await target());
 await send("Runtime.enable");await send("Page.enable");
 async function evalJs(expression){
  const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 }
 async function click(sel){
  const ok=await evalJs("(()=>{const e=document.querySelector("+JSON.stringify(sel)+");if(!e)return false;e.click();return true})()");
  assert.ok(ok,"Selector not found "+sel);
 }
 async function screenshot(name){
  const r=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  const file=path.join(DIR,"qnector-liquid-v2-"+name+".png");
  fs.writeFileSync(file,Buffer.from(r.data,"base64"));
  console.log("SCREENSHOT "+name+" "+fs.statSync(file).size+" bytes");
 }
 await delay(800);
 assert.equal(await evalJs("document.querySelector('#centerHero').dataset.status"),"connected");
 assert.equal(await evalJs("document.querySelectorAll('img[src^=\"data:image/png;base64,\"]').length"),2);
 assert.equal(await evalJs("document.getElementById('ambient').width>0"),true);
 assert.equal(await evalJs("getComputedStyle(document.getElementById('holdSvg')).visibility"),"hidden","Hold ring must not show while idle");
 assert.equal(await evalJs("getComputedStyle(document.getElementById('holdSvg')).opacity"),"0");
 assert.equal(await evalJs("document.querySelectorAll('.glass').length>=6"),true);
 assert.equal(await evalJs("document.querySelectorAll('#ambient glyph,#ambient text').length"),0);
 await screenshot("dashboard");
 await click('[data-section="memory"]');await delay(330);
 assert.equal(await evalJs("document.getElementById('drawerTitle').textContent"),"AI Project Memory");
 assert.equal(await evalJs("document.getElementById('drawer').getAttribute('aria-hidden')"),"false");
 await screenshot("memory");
 await evalJs("(()=>{let e=document.querySelector('#memoryFilter');e.value='Background';e.dispatchEvent(new Event('input',{bubbles:true}))})()");
 assert.equal(await evalJs("Array.from(document.querySelectorAll('[data-memory]')).filter(e=>!e.hidden).length"),1);
 const trap=await evalJs("(()=>{const first=document.querySelector('#drawerClose');first.focus();const e=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,cancelable:true,bubbles:true});first.dispatchEvent(e);return e.defaultPrevented && document.querySelector('#drawer').contains(document.activeElement)&&document.activeElement!==first})()");
 assert.equal(trap,true,"Focus Shift+Tab should wrap within drawer");
 await click('.tabs [data-section="skills"]');await delay(260);
 await screenshot("skills");
 assert.equal(await evalJs("document.querySelectorAll('[data-skill]').length"),4);
 await click('[data-skill="Filesystem"] .switch');
 assert.equal(await evalJs("document.getElementById('skillCount').textContent.trim()"),"02 / 04");
 await click('.tabs [data-section="workspace"]');await delay(260);
 await screenshot("workspace");
 await click('.tabs [data-section="skills"]');
 assert.equal(await evalJs("document.querySelector('[data-skill=\"Filesystem\"] .switch').checked"),false);
 await click('[data-skill="Filesystem"] .switch');
 await click('.tabs [data-section="runtime"]');await delay(260);
 await screenshot("runtime");
 await click('.tabs [data-section="settings"]');await delay(260);
 await click('#drawerQuality [data-quality="full"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"full");
 await click('#drawerQuality [data-quality="eco"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"eco");
 await click('#drawerQuality [data-quality="off"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"off");
 await click('#drawerQuality [data-quality="balanced"]');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"balanced");
 await click('#reducedEnabled');
 assert.equal(await evalJs("document.documentElement.dataset.quality"),"off");
 await click('#reducedEnabled');
 await screenshot("settings");
 await click('[data-demo-action="motion-lab"]');await delay(230);
 assert.equal(await evalJs("document.getElementById('motionDialog').open"),true);
 await click('[data-sample="spring"]');await screenshot("motion-lab");
 await click('[data-close-modal="motionDialog"]');
 // Retargetable navigation is not blocked by current animation.
 await evalJs("(()=>{const names=['memory','skills','runtime','settings','workspace'];for(let i=0;i<30;i++){document.querySelector('.tabs [data-section='+names[i%5]+']').click()}})()");
 assert.equal(await evalJs("document.querySelector('#drawerTitle').textContent"),"Workspace");
 await evalJs("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
 assert.equal(await evalJs("document.querySelector('#drawer').getAttribute('aria-hidden')"),"true");
 await click("#openSearch");await delay(100);
 assert.equal(await evalJs("document.getElementById('commandDialog').open"),true);
 await evalJs("(()=>{const e=document.querySelector('#commandInput');e.value='skills';e.dispatchEvent(new Event('input',{bubbles:true}))})()");
 assert.equal(await evalJs("document.querySelectorAll('#commandResults button').length"),1);
 await click('#commandResults button');assert.equal(await evalJs("document.querySelector('#drawerTitle').textContent"),"Skill Manager");
 await click("#drawerClose");await delay(360);
 // Test idle progress absence, early release, full 3-second hold and reconnect.
 const pos=await evalJs("(()=>{const r=document.querySelector('#orbAction').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:pos.x,y:pos.y});
 await send("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x,y:pos.y,button:"left",buttons:1,clickCount:1});
 await delay(950);
 assert.equal(await evalJs("getComputedStyle(document.getElementById('holdSvg')).visibility"),"visible","Hold ring must appear during actual hold");
 assert.ok(await evalJs("Number(document.querySelector('#holdCount').textContent)>0.6"));
 await screenshot("orb-holding");
 await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:pos.x,y:pos.y,button:"left",buttons:0,clickCount:1});
 assert.equal(await evalJs("document.querySelector('#centerHero').dataset.status"),"connected","Early release must not disconnect");
 assert.equal(await evalJs("getComputedStyle(document.getElementById('holdSvg')).visibility"),"hidden","Hold ring must disappear on release");
 await send("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x,y:pos.y,button:"left",buttons:1,clickCount:1});
 await delay(3210);
 await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:pos.x,y:pos.y,button:"left",buttons:0,clickCount:1});
 assert.equal(await evalJs("document.querySelector('#centerHero').dataset.status"),"disconnected","Completed hold must disconnect");
 await delay(780);
 await click("#orbAction");await delay(1660);
 assert.equal(await evalJs("document.querySelector('#centerHero').dataset.status"),"connected","Click should reconnect");
 await send("Emulation.setDeviceMetricsOverride",{width:420,height:860,deviceScaleFactor:1,mobile:true});
 await send("Page.reload",{ignoreCache:true});await delay(900);
 assert.equal(await evalJs("document.documentElement.scrollWidth<=window.innerWidth+3"),true,"Mobile horizontal overflow");
 await screenshot("mobile");
 await send("Emulation.clearDeviceMetricsOverride");
 assert.deepEqual(errors,[],"No JS runtime exceptions");
 console.log("PASS all: actual Queen PNG x2; liquid glass; animated non-matrix canvas; hidden idle hold; active/cancel/full hold; reconnect; drawers; search; 30 rapid switches; quality/reduced; Focus; responsive; 0 JS exceptions");
}
main().catch(e=>{console.error("FAIL: "+(e.stack||e));process.exitCode=1})
.finally(async()=>{
  if(ws)try{ws.close()}catch{}
  try{chrome.kill()}catch{}
  await delay(180);
});
