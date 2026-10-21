"use strict";
/* Native activity/nav soak on synthetic bridge only. Not GPU-present or gameplay. */
const {app,BrowserWindow}=require("electron");
const path=require("node:path"),fs=require("node:fs"),assert=require("node:assert/strict");
const root=process.cwd(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const folder=path.join(root,"docs","design","royal-motion-native-system");
const seconds=Math.max(30,Math.min(300,Number(process.env.QN_QC_SOAK_SECONDS)||120));
app.on("window-all-closed",()=>{});
let win;const errors=[];
async function evaluate(source){return win.webContents.executeJavaScript(source,true);}
async function view(){
 return await evaluate('(()=>{const rows=[...document.querySelectorAll(".activity-virtual-row")];return {rows:rows.length,ids:rows.map(el=>el.querySelector(".activity-item")?.dataset.activityId||""),quality:document.documentElement.dataset.motionQuality,overflow:document.documentElement.scrollWidth>innerWidth}})()');
}
async function sample(index,sent,start){
 const metrics=app.getAppMetrics();
 const metric=metrics.find(item=>item.pid===win.webContents.getOSProcessId());
 const mem=metric?.memory??null;
 const dom=await view();
 const s={index,ms:Date.now()-start,eventsSent:sent,privateKb:mem?.privateBytes??null,residentKb:mem?.workingSetSize??null,...dom};
 assert.equal(s.overflow,false,"Horizontal overflow");
 assert.ok(s.rows<=18,"Visible feed is no longer virtualized: "+s.rows);
 assert.equal(s.ids.length,new Set(s.ids).size,"Duplicate visible activity row");
 console.log("SAMPLE "+JSON.stringify(s));return s;
}
async function main(){
 fs.mkdirSync(folder,{recursive:true});
 win=new BrowserWindow({width:435,height:900,show:false,frame:false,
  webPreferences:{preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
   contextIsolation:true,sandbox:false,nodeIntegration:false,
   backgroundThrottling:false,partition:"inmemory:royal-motion-soak-20261021"}});
 win.webContents.on("console-message",e=>{const m=String(e.message||"");
  if((e.level===2||e.level===3||m.includes("Uncaught"))&&!m.includes("Electron Security Warning"))
    errors.push(m.slice(0,250));});
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_r,cb)=>cb({cancel:true}));
 await win.loadFile(path.join(root,"apps","desktop","index.html"));
 win.showInactive();await sleep(550);
 const start=Date.now(),stop=start+seconds*1000;
 const samples=[];let sent=0,loop=0,next=start+20000;
 samples.push(await sample(0,sent,start));
 while(Date.now()<stop){
  await evaluate("window.__qcFixture.emitActivityBurst(8)");sent+=8;
  if(loop%20===0){
   await evaluate('(()=>{const order=["Workspace","Memory","Skills","Settings"];for(let i=0;i<12;i++){const b=[...document.querySelectorAll(".drawer-menu-tabs button,.dock-pill-btn")].find(x=>x.textContent.trim().endsWith(order[i%4]));b?.click()} document.querySelector(".btn-drawer-close")?.click()})()');
  }
  if(Date.now()>=next){samples.push(await sample(samples.length,sent,start));next=Date.now()+20000}
  await sleep(250);loop++;
 }
 samples.push(await sample(samples.length,sent,start));
 const begin=samples[0].privateKb,end=samples.at(-1).privateKb;
 const delta=begin!==null&&end!==null?end-begin:null;
 const result={ok:errors.length===0,seconds,eventsSent:sent,routeInteractions:Math.ceil(loop/20)*12,
  privateMemoryDeltaKb:delta,samples,errors,measuredAt:new Date().toISOString(),
  limitation:"Synthetic 120s soak, not a 20-minute real-game GPU-present or memory-leak guarantee."};
 const dest=path.join(folder,"motion-activity-soak.json");
 fs.writeFileSync(dest,JSON.stringify(result,null,2));
 console.log("FINAL "+JSON.stringify({ok:result.ok,seconds,eventsSent:sent,deltaKb:delta,errors:errors.length,report:dest}));
 assert.equal(errors.length,0,"Renderer console errors during soak");
}
app.whenReady().then(main).then(()=>{win?.destroy();app.quit()}).catch(e=>{
 console.error("MOTION_SOAK_FAILED",e.stack||String(e));win?.destroy();app.exit(1);
});
