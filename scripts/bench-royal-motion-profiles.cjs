"use strict";
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path");
const root=process.cwd();
const quality=process.argv.find(x=>x.startsWith("--quality="))?.slice(10)||"balanced";
if(!["full","balanced","eco","off"].includes(quality))throw Error("Unknown quality");
const output=path.join(root,"docs","design","royal-motion-native-system","profile-"+quality+"-fps.json");
let win;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.on("window-all-closed",()=>{});
async function sample(){
 const dt=[];let last=0;const start=performance.now();
 await new Promise(done=>{
   const tick=t=>{
     if(last>0)dt.push(t-last);
     last=t;
     if(t-start<4100)requestAnimationFrame(tick);else done();
   };
   requestAnimationFrame(tick);
 });
 const sorted=dt.slice().sort((a,b)=>a-b);
 const pct=p=>Math.round((sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0)*100)/100;
 const ms=dt.reduce((a,b)=>a+b,0);
 return {frames:dt.length,sampleMs:Math.round(ms),
   averageCallbackFps:Math.round(dt.length/ms*100000)/100,
   p50Ms:pct(.50),p95Ms:pct(.95),p99Ms:pct(.99),worstMs:pct(1),
   over17Ms:dt.filter(x=>x>17).length,
   over25Ms:dt.filter(x=>x>25).length,
   activeQuality:document.documentElement.dataset.motionQuality,
   windowVisibility:document.visibilityState};
}
async function run(){
 win=new BrowserWindow({width:475,height:865,show:false,frame:false,skipTaskbar:true,
  webPreferences:{preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
   contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];
 win.webContents.on("console-message",e=>{
   if((e.level===2||e.level===3)&&!String(e.message).includes("Electron Security Warning"))
     errors.push(String(e.message).slice(0,250));
 });
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_r,next)=>next({cancel:true}));
 await win.loadFile(path.join(root,"apps","desktop","index.html"));
 win.showInactive();await sleep(460);
 await win.webContents.executeJavaScript('(()=>{const b=[...document.querySelectorAll(".dock-pill-btn")].find(x=>/Settings/.test(x.textContent));b?.click()})()',true);
 await sleep(120);
 const click="(()=>{const b=[...document.querySelectorAll('.motion-quality-segments button')].find(x=>x.textContent.trim().toLowerCase()==="+JSON.stringify(quality)+");if(!b)throw Error('Quality control absent');b.click()})()";
 await win.webContents.executeJavaScript(click,true);
 await sleep(600);
 const data=await win.webContents.executeJavaScript("("+sample.toString()+")()",true);
 if(data.activeQuality!==quality)throw Error("Wrong quality "+data.activeQuality);
 const result={source:"actual Electron renderer under synthetic mutation-blocked bridge",
  measure:"rAF callback cadence, not GPU-present FPS",observedAt:new Date().toISOString(),
  display:"475x865",quality, ...data,errors};
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 if(errors.length)throw Error("Renderer errors: "+errors.join("; "));
}
app.whenReady().then(run).then(()=>{win?.destroy();app.quit()}).catch(e=>{
 console.error("BENCH_FAILED",e.stack||e);win?.destroy();app.exit(1);
});
