"use strict";
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path");
const root=process.cwd(),dir=path.join(root,"docs/design/visual-parity-20261021");
const sleep=t=>new Promise(r=>setTimeout(r,t));
let win;
app.on("window-all-closed",()=>{});
async function capture(spec,width,height,name){
 win=new BrowserWindow({width,height,show:false,frame:false,backgroundColor:"#07090d",
  webPreferences:{preload:spec==="actual"?path.join(root,"scripts/native-renderer-motion-preload.cjs"):undefined,
    contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false,
    partition:"inmemory:parity-"+spec+"-"+name}});
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_req,next)=>next({cancel:true}));
 const errors=[];
 win.webContents.on("console-message",e=>{if(e.level>=2)errors.push(String(e.message).slice(0,250))});
 await win.loadFile(path.join(root,spec==="mock"?"docs/design/qnector-liquid-glass-motion-v2-1.html":"apps/desktop/index.html"));
 win.showInactive();
 await sleep(1300);
 const measure=await win.webContents.executeJavaScript("(()=>{const get=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return{selector:sel,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),background:c.backgroundImage?.slice(0,100),opacity:c.opacity}};return{body:[document.documentElement.scrollWidth,document.documentElement.scrollHeight,innerWidth,innerHeight],orb:get('.orb-shell')||get('.queen-orb-inner-glass'),aura:get('.orb-glow')||get('.plasma-aura'),ambient:get('#ambient')||get('.liquid-silk-canvas'),hero:get('.center-hero')||get('.hero-glass-section'),nav:get('.dock')||get('.floating-glass-dock'),status:get('.center-status')||get('.hero-status-title'),title:document.title}})()",true);
 const png=(await win.webContents.capturePage()).toPNG();
 if(spec==="actual"&&width===475){
   const orb=measure.orb,ambient=measure.ambient;
   if(!orb||Math.abs(orb.width-249)>3||Math.abs(orb.y-165)>30)throw Error("Orb size/placement diverges from V2.1 reference "+JSON.stringify(orb));
   if(!ambient||ambient.width<width-10||ambient.height<height-10)throw Error("Silk canvas is not full-window "+JSON.stringify(ambient));
   if(measure.body[0]>width)throw Error("Horizontal overflow after parity");
 }
 fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,name+".png");fs.writeFileSync(file,png);
 console.log("CAPTURE "+JSON.stringify({file,size:png.length,measure,errors}));
 win.destroy();win=null;
}
app.whenReady().then(async()=>{
 for(const [w,h] of [[475,865],[420,620],[435,900],[1280,850]]) {
   await capture("mock",w,h,"approved-mock-"+w+"x"+h);
   if(w!==1280)await capture("actual",w,h,"actual-after-parity-"+w+"x"+h);
 }
 app.quit();
}).catch(e=>{console.error(e.stack||e);win?.destroy();app.exit(1)});
