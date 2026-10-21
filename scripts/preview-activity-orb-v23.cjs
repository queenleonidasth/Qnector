"use strict";
/* QNECTOR V2.3: actual Electron renderer, isolated read-only synthetic bridge.
 * Intentionally does NOT install, modify credentials, connect to a tunnel,
 * or write to the production profile.
 */
const {app,BrowserWindow}=require("electron");
const path=require("node:path");
const root=process.cwd();
let win;
app.on("window-all-closed",()=>app.quit());
app.whenReady().then(async()=>{
 win=new BrowserWindow({
  title:"QNECTOR Preview - SIMULATED DATA",
  width:475,height:900,minWidth:420,minHeight:620,
  show:false,frame:true,autoHideMenuBar:true,backgroundColor:"#07090d",
  webPreferences:{
   preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
   partition:"inmemory:qnector-v23-activity-sharp-preview",
   contextIsolation:true,sandbox:false,nodeIntegration:false,
   backgroundThrottling:false,
  },
 });
 win.webContents.session.webRequest.onBeforeRequest(
   {urls:["http://*/*","https://*/*"]},(_request,callback)=>callback({cancel:true}),
 );
 await win.loadFile(path.join(root,"apps","desktop","index.html"));
 await win.webContents.executeJavaScript(
  '(()=>{document.title="QNECTOR Preview - SIMULATED DATA";window.__qcFixture.emitActivityBurst(18,true)})()',
  true,
 );
 win.show();
 win.focus();
 console.log("QNECTOR_V23_PREVIEW_READY",win.webContents.id,"synthetic UI only");
}).catch(err=>{console.error("QNECTOR_V23_PREVIEW_FAILED",err.stack||err);win?.destroy();app.exit(1)});
