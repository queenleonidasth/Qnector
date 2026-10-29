const { app, BrowserWindow } = require("electron");
const path = require("node:path"),
  assert = require("node:assert/strict");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = process.cwd(),
  preload = path.join(root, "scripts", "native-renderer-qc-preload.cjs");
const sampleJS =
  '(()=>{const orb=document.querySelector(".orb-travel-stage"),hdr=document.querySelector(".app-header"),text=document.querySelector(".brand-copy"),green=document.querySelector(".bridge-active-caption"),feed=document.querySelector(".activity-glass-card");if(!orb||!hdr||!text||!green||!feed)return null;const m=new DOMMatrix(getComputedStyle(orb).transform);return {connected:hdr.classList.contains("orb-in-header"),headerHeight:hdr.getBoundingClientRect().height,headerBasis:getComputedStyle(hdr).flexBasis,animations:hdr.getAnimations().map(a=>({time:a.currentTime,playState:a.playState})),orbAnimations:orb.getAnimations().map(a=>({time:a.currentTime,playState:a.playState})),orbX:m.m41,orbY:m.m42,orbScale:m.a,travelling:orb.dataset.travelling,brandX:text.getBoundingClientRect().left,captionOpacity:Number(getComputedStyle(green).opacity),greenMotion:getComputedStyle(green.querySelector("span:last-child")).animationName,activityHeight:feed.getBoundingClientRect().height,orbCount:document.querySelectorAll(".orb-travel-stage").length,oldConnectButton:!!document.querySelector(".hero-glass-section .btn-liquid-action"),prompt:document.body.textContent.includes("Press QNECTOR orb to connect"),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};})()';
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const results = [];
  try {
    for (const [width, height] of [
      [451, 978],
      [420, 620],
      [700, 900],
    ]) {
      const win = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        show: true,
        frame: false,
        webPreferences: {
          preload,
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      const errors = [];
      win.webContents.on("console-message", (e) => {
        if (e.level === "error") errors.push(String(e.message));
      });
      await win.loadFile(path.join(root, "apps", "desktop", "index.html"));
      win.showInactive();
      const run = (js) => win.webContents.executeJavaScript(js, true);
      const sample = () => run(sampleJS);
      let initial;
      for (let i = 0; i < 40; i++) {
        await sleep(70);
        initial = await sample();
        if (initial?.orbCount && initial?.prompt) break;
      }
      assert.ok(initial, "Renderer did not mount");
      assert.equal(initial.connected, false);
      assert.equal(initial.orbCount, 1);
      assert.equal(initial.oldConnectButton, false);
      assert.equal(initial.horizontalOverflow, false);
      await run('window.__qcFixture.setBridgeState("connected")');
      let mid = null;
      for (let i = 0; i < 60; i++) {
        await sleep(65);
        const x = await sample();
        if (
          x.headerHeight > 70.1 &&
          x.headerHeight < 115.999 &&
          x.orbScale < 0.99 &&
          x.orbScale > (height <= 760 ? 0.501 : 0.382)
        ) {
          mid = x;
          break;
        }
      }
      assert.ok(mid, "No actual animated intermediate frame was observed");
      let final = null;
      for (let i = 0; i < 75; i++) {
        await sleep(65);
        const x = await sample();
        if (x.travelling === "false" && x.connected && x.headerHeight >= 115) {
          final = x;
          break;
        }
      }
      assert.ok(final, "Orb transition did not complete");
      assert.equal(mid.connected, true);
      assert.equal(final.connected, true);
      assert.equal(final.orbCount, 1);
      assert.equal(final.travelling, "false");
      assert.ok(
        mid.headerHeight > initial.headerHeight + 0.1 && mid.headerHeight < 116,
        "Header jump " +
          JSON.stringify([initial.headerHeight, mid.headerHeight]),
      );
      assert.ok(
        mid.brandX > initial.brandX + 0.1 && mid.brandX < final.brandX - 0.1,
        "Brand jump " +
          JSON.stringify([initial.brandX, mid.brandX, final.brandX]),
      );
      assert.ok(
        Math.abs(mid.orbX - initial.orbX) > 0.2 &&
          Math.abs(mid.orbX - final.orbX) > 0.2,
        "Orb motion lacks middle frames",
      );
      assert.ok(
        mid.orbScale < initial.orbScale && mid.orbScale > final.orbScale,
        "Orb scale skipped middle",
      );
      assert.ok(
        final.activityHeight > initial.activityHeight + 80,
        "Activity feed did not expand",
      );
      // Optical—not merely bounding-box—alignment of the trademark:
      // its opaque-pixel centroid is (129.2, 137.1) in a 256x256 PNG.
      const optical = await run(
        '(()=>{const img=document.querySelector(".orb-compact .queen-orb-portrait"),sphere=document.querySelector(".orb-compact .glass-sphere-enclosure"),anchor=document.querySelector(".brand-crest");' +
          "const a=img.getBoundingClientRect(),s=sphere.getBoundingClientRect(),h=anchor.getBoundingClientRect();" +
          "return {dx:a.left+a.width*(129.2/256)-(s.left+s.width/2),dy:a.top+a.height*(137.1/256)-(s.top+s.height/2)," +
          "anchorDx:(s.left+s.width/2)-(h.left+h.width/2),anchorDy:(s.top+s.height/2)-(h.top+h.height/2)," +
          'translate:getComputedStyle(img).translate,header:document.querySelector(".app-header").getBoundingClientRect().toJSON(),anchor:h.toJSON(),sphere:s.toJSON(),stage:document.querySelector(".orb-travel-stage").getBoundingClientRect().toJSON(),stageTransform:getComputedStyle(document.querySelector(".orb-travel-stage")).transform,sphereOffsetTop:sphere.offsetTop,sphereOffsetLeft:sphere.offsetLeft,stageOffsetHeight:document.querySelector(".orb-travel-stage").offsetHeight};})()',
      );
      assert.ok(
        Math.abs(optical.dx) < 1 && Math.abs(optical.dy) < 1,
        "Crest optical center shifted: " + JSON.stringify(optical),
      );
      assert.ok(
        Math.abs(optical.anchorDx) < 1 && Math.abs(optical.anchorDy) < 1,
        "Orb outside header icon anchor: " + JSON.stringify(optical),
      );
      assert.equal(final.captionOpacity, 1);
      assert.ok(final.greenMotion.includes("qnBridgeGreenTravel"));
      await run('window.__qcFixture.setBridgeState("disconnected")');
      let back = null;
      for (let i = 0; i < 60; i++) {
        await sleep(65);
        const x = await sample();
        if (
          !x.connected &&
          x.headerHeight > 73 &&
          x.headerHeight < 113 &&
          x.orbScale > final.orbScale + 0.04 &&
          x.orbScale < 0.96
        ) {
          back = x;
          break;
        }
      }
      assert.ok(back, "No reverse animation middle frame");
      let returned = null;
      for (let i = 0; i < 75; i++) {
        await sleep(65);
        const x = await sample();
        if (
          x.travelling === "false" &&
          !x.connected &&
          x.headerHeight <= 70.5
        ) {
          returned = x;
          break;
        }
      }
      assert.ok(returned, "Orb reverse travel did not complete");
      assert.equal(returned.connected, false);
      assert.ok(
        Math.abs(returned.orbX - initial.orbX) < 2,
        "Orb missed offline anchor",
      );
      assert.ok(
        back.orbScale > final.orbScale && back.orbScale < 1,
        "Reverse transition skipped middle",
      );
      assert.equal(returned.captionOpacity, 0);
      assert.equal(errors.length, 0, errors.join("\n"));
      results.push({
        width,
        height,
        header: [initial.headerHeight, mid.headerHeight, final.headerHeight],
        brand: [initial.brandX, mid.brandX, final.brandX],
        scale: [initial.orbScale, mid.orbScale, final.orbScale],
        backScale: back.orbScale,
        activityGrowth: final.activityHeight - initial.activityHeight,
      });
      win.destroy();
    }
    console.log(JSON.stringify({ passed: true, results }, null, 2));
    app.quit();
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
