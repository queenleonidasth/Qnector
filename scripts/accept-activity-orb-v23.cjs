"use strict";
/* V2.3 acceptance: activity feed uses remaining space, Queen crest is a
 * stationary bitmap above an animated glass layer, no real bridge writes. */
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=process.cwd();
const out=path.join(root,"docs","design","visual-parity-20261021");
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
let win;
const errors=[];
app.on("window-all-closed",()=>{});
async function evaluate(src) {return win.webContents.executeJavaScript(src,true)}
const metricsExpr='(()=>{const get=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}; const img=document.querySelector(".queen-orb-portrait");const style=e=>e?{transform:getComputedStyle(e).transform,filter:getComputedStyle(e).filter,animationName:getComputedStyle(e).animationName}:null;return {head:get(".app-header"),orb:get(".glass-sphere-enclosure"),stage:get(".orb-stage"),activity:get(".activity-glass-card"),feed:get(".activity-stream"),dock:get(".floating-glass-dock"),image:get(".queen-orb-portrait"),bitmapWidth:img?.naturalWidth,logoStyle:style(img),emblemStyle:style(document.querySelector(".queen-orb-emblem-layer")),orbButtonStyle:style(document.querySelector(".glass-sphere-enclosure")),floatStyle:style(document.querySelector(".queen-orb-float")),overflow:document.documentElement.scrollWidth>innerWidth,quality:document.documentElement.dataset.motionQuality,bodyHeight:innerHeight,bodyWidth:innerWidth}})()';
async function check(width,height) {
 win=new BrowserWindow({width,height,show:false,frame:false,backgroundColor:"#07090d",
  webPreferences:{preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
   partition:"inmemory:royal-activity-v23-"+width+"x"+height,
   contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(_req,cb)=>cb({cancel:true}));
 win.webContents.on("console-message",e=>{const m=String(e.message??"");if((e.level===2||e.level===3)&&!m.includes("Electron Security Warning"))errors.push(m.slice(0,500))});
 await win.loadFile(path.join(root,"apps","desktop","index.html"));
 win.showInactive();await sleep(450);
 const before=await evaluate(metricsExpr);
 const minFeed=height>=890?205:height>=850?170:80;
 assert.ok(before.feed?.height>=minFeed,"Feed viewport too small "+width+"x"+height+": "+JSON.stringify(before));
 assert.ok(before.activity.width>=width-28,"Live Activity Feed is not full available width");
 assert.ok(before.orb.width<=195,"Orb remains oversized "+before.orb.width);
 assert.ok(before.orb.y<150,"Too much dead upper space "+before.orb.y);
 assert.equal(before.overflow,false,"Horizontal overflow");
 assert.equal(before.bitmapWidth,256,"Original sharp Queen asset absent");
 assert.equal(before.logoStyle.transform,"none","Portrait subject to compositor transform");
 assert.equal(before.logoStyle.filter,"none","Portrait must be unfiltered");
 assert.equal(before.emblemStyle.transform,"none","Emblem layer is animated");
 assert.equal(before.orbButtonStyle.transform,"none","Outer orb button rescales bitmap");
 fs.mkdirSync(out,{recursive:true});
 const dest=path.join(out,"v23-compact-idle-"+width+"x"+height+".png");
 fs.writeFileSync(dest,(await win.webContents.capturePage()).toPNG());

 const emblemBefore=before.image;
 // Resize the *live* native window rather than reconstructing the renderer.
 // The silk canvas must keep its node and a painted frame at the new size.
 await evaluate('window.__motionSilkCanvas = document.querySelector(".liquid-silk-canvas")');
 win.setSize(width+20,height+14);
 await sleep(180);
 const resized=await evaluate('(()=>{const c=document.querySelector(".liquid-silk-canvas");const pixel=c.getContext("2d").getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return {same:window.__motionSilkCanvas===c,alpha:pixel[3],width:c.width,height:c.height}})()');
 assert.equal(resized.same,true,"Silk canvas remounted during live resize");
 assert.ok(resized.alpha>0,"Silk canvas blank after live resize");
 assert.ok(resized.width>0&&resized.height>0,"Silk backing store missing after resize");
 win.setSize(width,height);
 await sleep(650);
 const after=await evaluate(metricsExpr);
 assert.ok(Math.abs(after.image.x-emblemBefore.x)<0.02 && Math.abs(after.image.y-emblemBefore.y)<0.02,"Queen logo moves with orbital animation");
 await evaluate('(()=>{const orb=document.querySelector(".glass-sphere-enclosure");orb.classList.add("holding");return getComputedStyle(orb).transform})()').then(s=>assert.equal(s,"none","Hold still scales original crest"));
 await evaluate('document.querySelector(".glass-sphere-enclosure").classList.remove("holding")');
 await evaluate("window.__qcFixture.emitActivityBurst(16)");
 await sleep(2450);
 const populated=await evaluate('(()=>{const nodes=[...document.querySelectorAll(".activity-virtual-row")];return {count:nodes.length,y:nodes.map(n=>Math.round(n.getBoundingClientRect().y)),timelineNodes:document.querySelectorAll(".activity-entry-rail").length,timestamps:document.querySelectorAll("time.activity-entry-time").length,statusPills:document.querySelectorAll(".activity-result-pill").length,streamScrollHeight:document.querySelector(".activity-stream")?.scrollHeight,streamHeight:document.querySelector(".activity-stream")?.clientHeight}})()');
 assert.ok(populated.count>0,"Activity synthetic events did not show");
 assert.equal(new Set(populated.y).size,populated.count,"Virtualized feed rows overlap");
 assert.equal(populated.timelineNodes,populated.count);
 assert.equal(populated.timestamps,populated.count);
 assert.equal(populated.statusPills,populated.count);
 // Confirm the running state actually renders a 2px sweep and a bright
 // signal badge in Chromium, rather than the legacy 92px yellow halo.
 const runningStyle=await evaluate('(()=>{const row=document.querySelector(".activity-item"),pill=row?.querySelector(".activity-result-pill");if(!row||!pill)return null;const oldRow=row.classList.contains("running"),oldPill=pill.classList.contains("running");row.classList.add("running");pill.classList.add("running");const stripe=getComputedStyle(row,"::before"),beacon=getComputedStyle(pill,"::before");const result={stripeHeight:parseFloat(stripe.height),stripeWidth:parseFloat(stripe.width),stripeAnimation:stripe.animationName,beaconWidth:parseFloat(beacon.width),beaconBackground:beacon.backgroundColor};row.classList.toggle("running",oldRow);pill.classList.toggle("running",oldPill);return result})()');
 assert.ok(runningStyle&&runningStyle.stripeHeight<=3,"Legacy oversized running ring still visible "+JSON.stringify(runningStyle));
 assert.ok(runningStyle.stripeWidth>=25&&runningStyle.stripeAnimation.includes("royalTaskProgressSweep"),"Running progress sweep absent "+JSON.stringify(runningStyle));
 assert.ok(runningStyle.beaconWidth>=5,"Running signal beacon absent "+JSON.stringify(runningStyle));
 const activeImage=path.join(out,"v23-compact-live-"+width+"x"+height+".png");
 fs.writeFileSync(activeImage,(await win.webContents.capturePage()).toPNG());
 const result={width,height,orb:before.orb,feed:before.feed,activity:before.activity,dock:before.dock,portrait:before.image,portraitUnfiltered:before.logoStyle,overlap:false,populated,preview:activeImage};
 win.destroy();win=null;
 console.log("VIEW_PASS "+JSON.stringify({width,height,orb:Math.round(before.orb.width),activityHeight:Math.round(before.activity.height),feedHeight:Math.round(before.feed.height),rows:populated.count,portrait:"static"}));
 return result;
}
async function run(){
 const results=[];
 for(const pair of [[475,865],[435,900],[420,620],[700,900]])results.push(await check(pair[0],pair[1]));
 assert.deepEqual(errors,[],"Native renderer warnings found");
 const report={ok:true,results,errors,source:"actual native renderer / synthetic mutation-blocked bridge",timestamp:new Date().toISOString()};
 fs.writeFileSync(path.join(out,"v23-activity-emblem-native-qa.json"),JSON.stringify(report,null,2));
 console.log("V23_ACTIVITY_EMBLEM_QC_PASS "+results.length);
}
app.whenReady().then(run).then(()=>{win?.destroy();app.quit()}).catch(e=>{console.error("V23_QC_FAILED",e.stack||e);win?.destroy();app.exit(1)});
