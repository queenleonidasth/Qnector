const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path"),
  fs = require("node:fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = process.cwd();
const sizes = [
  [420, 620],
  [435, 900],
  [451, 978],
  [700, 900],
];
const inspect =
  '(()=>{const q=s=>document.querySelector(s),g=e=>e?getComputedStyle(e):null,rect=e=>e?.getBoundingClientRect();const row=q(".activity-virtual-row"),item=row?.querySelector(".activity-item"),title=q(".activity-item .item-title"),args=q(".activity-item .item-args"),time=q(".activity-item .activity-entry-time"),pill=q(".activity-item .activity-result-pill"),dur=q(".activity-item .activity-duration"),badge=q(".activity-direct-badge"),skill=q(".activity-skill-names");if(!row||!item||!title||!args||!time||!pill||!dur)return null;return {font:{title:parseFloat(g(title).fontSize),args:parseFloat(g(args).fontSize),time:parseFloat(g(time).fontSize),pill:parseFloat(g(pill).fontSize),duration:parseFloat(g(dur).fontSize),badge:badge?parseFloat(g(badge).fontSize):null,skill:skill?parseFloat(g(skill).fontSize):null},h:{virtual:rect(row).height,item:rect(item).height,title:rect(title).height,args:rect(args).height},timeFits:time.scrollWidth<=time.clientWidth+1,pillFits:pill.scrollWidth<=pill.clientWidth+1,statusText:pill.textContent.trim(),rowCount:document.querySelectorAll(".activity-virtual-row").length,feed:rect(q(".activity-glass-card")).toJSON(),overflow:document.documentElement.scrollWidth>innerWidth,itemBounds:rect(item).toJSON(),titleBounds:rect(title).toJSON(),argsBounds:rect(args).toJSON(),rightBounds:rect(q(".activity-item .item-right")).toJSON(),pillBounds:rect(pill).toJSON()};})()';
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const output = [];
  try {
    for (const [width, height] of sizes) {
      const win = new BrowserWindow({
        width,
        height,
        frame: false,
        show: true,
        useContentSize: true,
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
      let snapshot = null;
      for (let i = 0; i < 30; i++) {
        await sleep(90);
        snapshot = await run(inspect);
        if (snapshot?.rowCount >= 4) break;
      }
      assert.ok(
        snapshot,
        "No seeded activity displayed at " + width + "x" + height,
      );
      assert.ok(snapshot.rowCount >= 4, "Too few visible sample rows");
      assert.ok(snapshot.font.title >= 13, "Title too small");
      assert.ok(snapshot.font.args >= 11, "Arguments too small");
      assert.ok(snapshot.font.time >= 10, "Time too small");
      assert.ok(snapshot.font.pill >= 9, "Status pill too small");
      assert.ok(snapshot.font.duration >= 10, "Duration too small");
      assert.equal(
        snapshot.h.virtual,
        60,
        "Virtualized slot height should equal 64px minus 4px",
      );
      assert.equal(
        snapshot.h.item,
        59,
        "Activity button height must fit a 64px slot",
      );
      assert.equal(snapshot.overflow, false, "Root horizontally overflows");
      assert.ok(
        snapshot.timeFits,
        "Timestamp cropped at " + width + "x" + height,
      );
      assert.ok(
        snapshot.pillFits,
        "Status text clipped at " + width + "x" + height,
      );
      assert.ok(
        snapshot.titleBounds.right <= snapshot.rightBounds.left + 0.5,
        "Title column overlaps status",
      );
      assert.ok(
        snapshot.argsBounds.bottom < snapshot.itemBounds.bottom + 1,
        "Args outside row bounds",
      );
      assert.ok(
        snapshot.pillBounds.right <= snapshot.itemBounds.right + 1,
        "Pill outside row",
      );
      if (width === 435) {
        fs.writeFileSync(
          path.join(
            root,
            "apps",
            "desktop",
            "release",
            "activity-font-readable-offline-qc.png",
          ),
          (await win.webContents.capturePage()).toPNG(),
        );
      }
      await run('window.__qcFixture.setBridgeState("connected")');
      await sleep(1050);
      const connected = await run(inspect);
      assert.ok(
        connected.font.title >= 13 && !connected.overflow,
        "Connected list font/layout regressed",
      );
      if (width === 435) {
        fs.writeFileSync(
          path.join(
            root,
            "apps",
            "desktop",
            "release",
            "activity-font-readable-connected-qc.png",
          ),
          (await win.webContents.capturePage()).toPNG(),
        );
      }
      output.push({
        width,
        height,
        font: snapshot.font,
        rowCount: snapshot.rowCount,
        rowHeight: snapshot.h.virtual + 4,
        timeFits: snapshot.timeFits,
        pillFits: snapshot.pillFits,
        overflow: snapshot.overflow,
        feedHeightOffline: Math.round(snapshot.feed.height),
        feedHeightConnected: Math.round(connected.feed.height),
      });
      win.destroy();
    }
    console.log(JSON.stringify({ passed: true, results: output }, null, 2));
    app.quit();
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
