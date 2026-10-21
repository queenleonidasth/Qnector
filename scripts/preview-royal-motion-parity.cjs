"use strict";
/**
 * LIVE MOCKUP-PARITY REVIEW WINDOW — actual QNECTOR Vite/Electron renderer,
 * synthetic read-only preload, independent in-memory session.
 * Does not install, connect, update, or modify the user's real QNECTOR.
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const root = process.cwd();
let win;
app.on("window-all-closed", () => app.quit());
app.whenReady().then(async () => {
  win = new BrowserWindow({
    title: "QNECTOR Liquid Glass V2.2 - Visual Parity Preview (SIMULATED DATA)",
    width: 475,
    height: 900,
    minWidth: 420,
    minHeight: 620,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: "#07090d",
    webPreferences: {
      preload: path.join(root,"scripts","native-renderer-motion-preload.cjs"),
      partition: "inmemory:royal-v22-parity-preview-20261021",
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_request, callback) => callback({cancel:true}),
  );
  await win.loadFile(path.join(root, "apps", "desktop", "index.html"));
  await win.webContents.executeJavaScript(
    '(()=>{document.title="QNECTOR Liquid Glass V2.2 - Visual Parity Preview (SIMULATED DATA)";const b=document.createElement("div");b.textContent="SIMULATED UI DATA - REAL V2.2 RENDERER";b.style.cssText="position:fixed;top:1px;right:20px;z-index:99999;pointer-events:none;font:8px Segoe UI,sans-serif;letter-spacing:.06em;color:#d2c3a4;opacity:.8";document.body.appendChild(b)})()',
  );
  win.show();
  win.focus();
  console.log("PARITY_PREVIEW_OPENED", win.webContents.id, "no real MCP/profile");
}).catch(error => {
  console.error("PARITY_PREVIEW_FAILED",error.stack||error);
  win?.destroy();
  app.exit(1);
});
