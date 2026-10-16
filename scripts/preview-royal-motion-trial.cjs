"use strict";
/**
 * Isolated preview for the ACTUAL QNECTOR Electron renderer built from source.
 * The synthetic preload forbids all mutations. It never connects to real MCP,
 * writes user settings, or starts the installed app/tunnel.
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const root = process.cwd();
let win;
app.on("window-all-closed", () => app.quit());
app.whenReady().then(async () => {
  win = new BrowserWindow({
    title:"QNECTOR - Royal Liquid Motion Trial (DEMO DATA / NOT INSTALLED)",
    width:475,height:865,minWidth:435,minHeight:680,
    show:false,frame:true,autoHideMenuBar:true,
    backgroundColor:"#080a0d",
    webPreferences:{
      preload:path.join(root,"scripts","native-renderer-motion-preload.cjs"),
      contextIsolation:true,sandbox:false,nodeIntegration:false,backgroundThrottling:false,
    },
  });
  win.webContents.session.webRequest.onBeforeRequest(
    { urls:["http://*/*","https://*/*"] },
    (_r,callback)=>callback({cancel:true}),
  );
  await win.loadFile(path.join(root,"apps","desktop","index.html"));
  await win.webContents.executeJavaScript('(()=>{const b=document.createElement("div");b.textContent="ROYAL MOTION TEST - SIMULATED DATA";b.style.cssText="position:fixed;bottom:1px;left:50%;transform:translateX(-50%);z-index:9999;font:10px Segoe UI,sans-serif;letter-spacing:.09em;padding:3px 10px;border:1px solid rgba(249,213,148,.42);border-radius:8px;color:#ffe6ad;background:rgba(18,17,18,.88);pointer-events:none;white-space:nowrap";document.body.append(b);document.title="QNECTOR Motion Trial — SIMULATED DATA (not installed)"})()');
  win.show();
  win.focus();
}).catch(error => {
  console.error(error.stack||error);
  app.exit(1);
});
