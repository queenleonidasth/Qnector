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
  '(()=>{const $=s=>document.querySelector(s),R=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}};const page=$(".dashboard-page"),hero=$(".hero-glass-section"),feed=$(".activity-glass-card"),image=$(".queen-orb-portrait"),sphere=$(".glass-sphere-enclosure");if(!page||!hero||!feed||!image||!sphere)return null;const hs=getComputedStyle(hero),im=getComputedStyle(image);window.__qnActivityFeedQC ??=feed;return {hero:R(hero),scrollHeight:hero.scrollHeight,feed:R(feed),feedStable:window.__qnActivityFeedQC===feed,docked:page.classList.contains("orb-docked"),transition:hs.transitionProperty,property:page.style.getPropertyValue("--qn-hero-expanded-height"),imageWidth:R(image).w,sphereWidth:R(sphere).w,imageFilter:im.filter,overflow:document.documentElement.scrollWidth>innerWidth};})()';
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const out = [];
  try {
    for (const [width, height] of sizes) {
      const win = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        show: true,
        frame: false,
        webPreferences: {
          preload: path.join(root, "scripts", "native-renderer-qc-preload.cjs"),
          sandbox: false,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      });
      await win.loadFile(path.join(root, "apps", "desktop", "index.html"));
      win.showInactive();
      const run = (expression) =>
        win.webContents.executeJavaScript(expression, true);
      const sample = async () => {
        const x = await run(probe);
        assert.ok(x, "Renderer components missing");
        return x;
      };
      await sleep(420);
      const idle = await sample();
      const samples = [];
      await run('window.__qcFixture.setBridgeState("connected")');
      for (let i = 0; i < 12; i++) {
        await sleep(90);
        const x = await sample();
        samples.push({
          t: (i + 1) * 90,
          feedY: x.feed.y,
          heroH: x.hero.h,
          docked: x.docked,
        });
        if (width === 435 && i === 4)
          fs.writeFileSync(
            path.join(
              root,
              "apps",
              "desktop",
              "release",
              "activity-feed-slide-mid-qc.png",
            ),
            (await win.webContents.capturePage()).toPNG(),
          );
      }
      const connected = await sample();
      await run('window.__qcFixture.setBridgeState("disconnected")');
      const reverse = [];
      for (let i = 0; i < 12; i++) {
        await sleep(90);
        const x = await sample();
        reverse.push({
          t: (i + 1) * 90,
          feedY: x.feed.y,
          heroH: x.hero.h,
          docked: x.docked,
        });
      }
      const returned = await sample();
      if (width === 435)
        fs.writeFileSync(
          path.join(
            root,
            "apps",
            "desktop",
            "release",
            "activity-feed-slide-offline-qc.png",
          ),
          (await win.webContents.capturePage()).toPNG(),
        );
      const ascending = samples.filter(
        (x) => x.feedY < idle.feed.y - 9 && x.feedY > connected.feed.y + 9,
      );
      const descending = reverse.filter(
        (x) => x.feedY > connected.feed.y + 9 && x.feedY < returned.feed.y - 9,
      );
      assert.ok(
        idle.property.endsWith("px"),
        "Hero natural height not measured",
      );
      assert.ok(
        ascending.length >= 3,
        "Feed snapped upward; no intermediate slide frames",
      );
      assert.ok(
        descending.length >= 3,
        "Feed snapped downward; no reverse frames",
      );
      assert.ok(
        idle.feed.y - connected.feed.y > 120,
        "Feed did not expand into vacated Hero area",
      );
      assert.ok(
        Math.abs(returned.feed.y - idle.feed.y) <= 4,
        "Feed missed offline layout on return",
      );
      assert.ok(
        connected.hero.h < 1 && Math.abs(returned.hero.h - idle.hero.h) <= 4,
        "Hero collapse/return failed",
      );
      assert.ok(
        connected.feedStable && returned.feedStable,
        "Activity Feed was remounted during the animation",
      );
      assert.ok(
        returned.imageFilter === "none" &&
          returned.imageWidth / returned.sphereWidth >= 0.82,
        "Logo remains filtered or too small",
      );
      assert.equal(
        returned.overflow,
        false,
        "Horizontal overflow after Feed animation",
      );
      out.push({
        width,
        height,
        idle: {
          feedY: idle.feed.y,
          heroH: idle.hero.h,
          property: idle.property,
        },
        connected: {
          feedY: connected.feed.y,
          heroH: connected.hero.h,
          property: connected.property,
        },
        returned: { feedY: returned.feed.y, heroH: returned.hero.h },
        samples,
        reverse,
        feedStable: connected.feedStable && returned.feedStable,
        imageRatio: returned.imageWidth / returned.sphereWidth,
        filter: returned.imageFilter,
        overflow: returned.overflow,
      });
      win.destroy();
    }
    console.log(JSON.stringify(out, null, 2));
    app.quit();
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
