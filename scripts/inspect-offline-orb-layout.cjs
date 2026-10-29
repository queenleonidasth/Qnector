const { app, BrowserWindow } = require("electron");
const path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizes = [
  [435, 900],
  [420, 620],
  [451, 978],
  [700, 900],
];
const script =
  '(()=>{const selectors={hero:".hero-glass-section",anchor:".orb-home-anchor",stage:".orb-travel-stage",orb:".glass-sphere-enclosure",title:".hero-state-title",prompt:".orb-connect-prompt",feed:".activity-glass-card",header:".app-header",main:".app-main"};const out={};for(const [key,sel] of Object.entries(selectors)){const e=document.querySelector(sel);if(!e){out[key]=null;continue;}const r=e.getBoundingClientRect(),s=getComputedStyle(e);out[key]={x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),margin:s.margin,padding:s.padding,display:s.display};}out.overflow=document.documentElement.scrollWidth>innerWidth;return out;})()';
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    for (const [width, height] of sizes) {
      const win = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        show: true,
        frame: false,
        webPreferences: {
          preload: path.join(
            process.cwd(),
            "scripts",
            "native-renderer-qc-preload.cjs",
          ),
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      await win.loadFile(
        path.join(process.cwd(), "apps", "desktop", "index.html"),
      );
      win.showInactive();
      await sleep(480);
      const probe = () => win.webContents.executeJavaScript(script, true);
      let offline = await probe();
      await win.webContents.executeJavaScript(
        'window.__qcFixture.setBridgeState("connected")',
      );
      await sleep(1250);
      await win.webContents.executeJavaScript(
        'window.__qcFixture.setBridgeState("disconnected")',
      );
      await sleep(1200);
      let disconnected = await probe();
      const clearance =
        disconnected.title.y - (disconnected.orb.y + disconnected.orb.h);
      // Geometric center of the PAINTED sphere, not its 380px stage or
      // the asymmetric orbit decoration. The short layout prioritizes text safety.
      const centerErrorX =
        disconnected.orb.x +
        disconnected.orb.w / 2 -
        (disconnected.main.x + disconnected.main.w / 2);
      const sphereCenterY = disconnected.orb.y + disconnected.orb.h / 2;
      const upperSpaceCenterY =
        (disconnected.hero.y + disconnected.title.y) / 2;
      const maxSafeCenterY = disconnected.title.y - disconnected.orb.h / 2 - 40;
      const expectedCenterY = Math.min(upperSpaceCenterY, maxSafeCenterY);
      const upperSpaceCenterErrorY = sphereCenterY - expectedCenterY;
      assert.ok(
        Math.abs(centerErrorX) <= 1,
        "Orb is not horizontally centered: " + centerErrorX,
      );
      assert.ok(
        Math.abs(upperSpaceCenterErrorY) <= 5,
        "Orb is not centered above Offline heading: " + upperSpaceCenterErrorY,
      );
      assert.ok(
        clearance >= 40,
        "Offline Orb overlaps title: " +
          width +
          "x" +
          height +
          " gap=" +
          clearance,
      );
      assert.ok(
        disconnected.feed.h >= 200,
        "Feed too short: " + width + "x" + height,
      );
      assert.ok(
        disconnected.prompt.y > disconnected.title.y + 16,
        "Prompt overlaps heading",
      );
      assert.ok(
        disconnected.feed.y >= disconnected.prompt.y + 16,
        "Feed overlaps prompt",
      );
      assert.equal(disconnected.overflow, false, "Horizontal overflow");
      console.log(JSON.stringify({ width, height, offline, disconnected }));
      if (width === 435)
        fs.writeFileSync(
          path.join(
            process.cwd(),
            "apps",
            "desktop",
            "release",
            "orb-offline-before.png",
          ),
          (await win.webContents.capturePage()).toPNG(),
        );
      win.destroy();
    }
    app.quit();
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
