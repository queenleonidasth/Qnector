"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const mode = process.argv.includes("--baseline") ? "baseline" : "candidate";
const dest = path.join(root,"docs","design","royal-motion-"+mode+"-fps.json");
const picture = path.join(root,"docs","design","royal-motion-"+mode+"-electron.png");
const preload = path.join(root,"scripts","native-renderer-motion-preload.cjs");
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
let win;
const errors=[];
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-features","CalculateNativeWinOcclusion");
app.on("window-all-closed",()=>{});
async function sampleRenderer() {
  const delays=[];
  const start=performance.now();
  let last=0;
  await new Promise(resolve=>{
    const tick=(t)=>{
      if(last) delays.push(t-last);
      last=t;
      if(t-start<4200)requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  delays.sort((a,b)=>a-b);
  const p=q=>delays[Math.min(delays.length-1,Math.floor(delays.length*q))]??null;
  const elapsed=delays.reduce((a,b)=>a+b,0);
  return {
    frames:delays.length,sampleMs:Math.round(elapsed),
    avgFps:Math.round((delays.length/(elapsed/1000))*100)/100,
    p50FrameMs:p(.50),p95FrameMs:p(.95),p99FrameMs:p(.99),
    over17ms:delays.filter(v=>v>17).length,
    over25ms:delays.filter(v=>v>25).length,
    maxFrameMs:delays[delays.length-1],
    hasMatrix:Boolean(document.querySelector(".gold-matrix-canvas")),
    hasSilk:Boolean(document.querySelector(".liquid-silk-canvas")),
    hasOrbCanvas:Boolean(document.querySelector(".queen-orb-fluid")),
    hasQueenEmblem:Boolean(document.querySelector(".queen-orb-portrait")),
    queenImageWidths:Array.from(document.querySelectorAll(".brand-queen-mark, .queen-orb-portrait")).map(img=>img.naturalWidth),
    visible:document.visibilityState,motion:document.documentElement.dataset.motion,
    width:innerWidth,height:innerHeight
  };
}
async function measure() {
  win = new BrowserWindow({
    width:440,height:790,show:false,frame:false,skipTaskbar:true,backgroundColor:"#07080c",
    webPreferences:{preload,contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false}
  });
  win.webContents.on("console-message", e => {
    const m=String(e.message??"");
    if(e.level===2 || e.level===3 || /uncaught|failed to load/i.test(m))
      errors.push(m.slice(0,500));
  });
  win.webContents.session.webRequest.onBeforeRequest({urls:["https://*/*","http://*/*"]},(_r,callback)=>callback({cancel:true}));
  await win.loadFile(path.join(root,"apps","desktop","index.html"));
  win.showInactive();
  await sleep(1000);
  const script="("+sampleRenderer.toString()+")()";
  const data=await win.webContents.executeJavaScript(script,true);
  data.mode=mode;data.rendererErrors=errors;data.experimentOnly=true;data.observedAt=new Date().toISOString();
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,JSON.stringify(data,null,2));
  const screenshot=await win.webContents.capturePage();
  fs.writeFileSync(picture,screenshot.toPNG());
  console.log(JSON.stringify(data,null,2));
}
app.whenReady().then(measure).then(()=>{win?.destroy();app.quit()}).catch(e=>{
  console.error("BENCH_FAIL",e.stack||e);if(win)win.destroy();app.exit(1);
});
