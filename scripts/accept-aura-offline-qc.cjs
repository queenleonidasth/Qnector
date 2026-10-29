const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = process.cwd();
const sizes = [
  [435, 900],
  [420, 620],
  [451, 978],
  [700, 900],
];
const probe =
  '(()=>{const $=s=>document.querySelector(s),c=e=>getComputedStyle(e);const stage=$(".orb-travel-stage"),plasma=$(".plasma-aura"),orbit=$(".orb-astral-orbit"),inner=$(".orb-astral-orbit.inner"),comet=$(".orb-comet-track"),sphere=$(".glass-sphere-enclosure"),hero=$(".hero-glass-section"),title=$(".hero-state-title"),feed=$(".activity-glass-card"),hdr=$(".app-header");const r=e=>e.getBoundingClientRect();return {expanded:stage.classList.contains("orb-expanded"),docked:stage.classList.contains("orb-compact"),plasmaDisplay:c(plasma).display,plasmaAnimation:c(plasma).animationName,orbitOpacity:c(orbit).opacity,innerOpacity:c(inner).opacity,cometOpacity:c(comet).opacity,sphereBorder:c(sphere).borderColor,sphereShadow:c(sphere).boxShadow,sphereBackground:c(sphere).backgroundImage,portraitFilter:c($(".queen-orb-portrait")).filter,position:{sphereY:r(sphere).y,sphereH:r(sphere).height,titleY:r(title).y,feedY:r(feed).y,heroH:r(hero).height,headerH:r(hdr).height},horizontalOverflow:document.documentElement.scrollWidth>innerWidth};})()';
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const outcomes = [];
  try {
    for (const [width, height] of sizes) {
      const win = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        frame: false,
        show: true,
        webPreferences: {
          preload: path.join(root, "scripts", "native-renderer-qc-preload.cjs"),
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      await win.loadFile(path.join(root, "apps", "desktop", "index.html"));
      win.showInactive();
      const run = (js) => win.webContents.executeJavaScript(js, true);
      await sleep(450);
      await run('window.__qcFixture.setBridgeState("connected")');
      await sleep(1100);
      const connected = await run(probe);
      assert.equal(
        connected.plasmaDisplay,
        "none",
        "Aura visible while connected",
      );
      assert.equal(connected.docked, true);
      await run('window.__qcFixture.setBridgeState("disconnected")');
      const flight = [];
      for (let i = 0; i < 11; i++) {
        await sleep(105);
        flight.push(await run(probe));
      }
      await sleep(200);
      const disconnected = await run(probe);
      assert.equal(disconnected.expanded, true);
      assert.equal(
        disconnected.plasmaDisplay,
        "none",
        "Offline aura must stay disabled",
      );
      assert.equal(disconnected.plasmaAnimation, "none");
      assert.equal(disconnected.orbitOpacity, "0");
      assert.equal(disconnected.innerOpacity, "0");
      assert.equal(disconnected.cometOpacity, "0");
      assert.equal(disconnected.portraitFilter, "none");
      assert.equal(disconnected.horizontalOverflow, false);
      assert.ok(
        disconnected.position.titleY -
          (disconnected.position.sphereY + disconnected.position.sphereH) >
          38,
        "Orb overlaps offline title",
      );
      const middle = flight.filter(
        (x) =>
          x.position.headerH > 71 &&
          x.position.headerH < 115 &&
          x.position.heroH > 1,
      );
      assert.ok(
        middle.length > 1,
        "Lost Orb/Header intermediate motion frames",
      );
      assert.ok(
        !flight.some((x) => x.plasmaDisplay !== "none"),
        "Aura flashed during Disconnect",
      );
      if (width === 435)
        fs.writeFileSync(
          path.join(
            root,
            "apps",
            "desktop",
            "release",
            "aura-offline-new-qc.png",
          ),
          (await win.webContents.capturePage()).toPNG(),
        );
      outcomes.push({
        width,
        height,
        connected: connected.plasmaDisplay,
        offline: disconnected.plasmaDisplay,
        ringOpacity: disconnected.orbitOpacity,
        offlineTitleGap:
          disconnected.position.titleY -
          (disconnected.position.sphereY + disconnected.position.sphereH),
        motionFrames: middle.length,
      });
      win.destroy();
    }
    console.log(JSON.stringify({ passed: true, results: outcomes }, null, 2));
    app.quit();
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
