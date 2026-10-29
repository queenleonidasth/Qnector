const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = process.cwd();
const motionOn = process.env.QNECTOR_QC_MOTION === "on";
const output = path.join(
  root,
  "apps",
  "desktop",
  "release",
  motionOn ? "qc-inline-motion" : "qc-native-renderer",
);
const preload = path.join(root, "scripts", "native-renderer-qc-preload.cjs");
fs.mkdirSync(output, { recursive: true });
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed", () => {});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function openNav(name) {
  const fromTabs = null;
  const fromDock = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim().endsWith(name) && !b.closest(".drawer-card"),
  );
  const b = fromTabs || fromDock;
  if (!b)
    return {
      ok: false,
      available: [...document.querySelectorAll("button")].map((b) =>
        b.textContent.trim().slice(0, 80),
      ),
    };
  b.click();
  return { ok: true };
}
function runtimeNav() {
  const b = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Runtime & Diagnostics"),
  );
  if (!b) return false;
  b.click();
  return true;
}
function snapshot() {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  const route = document.querySelector(".inline-route-view[role=region]");
  const content = document.querySelector(".drawer-content");
  const skillsList = document.querySelector(
    ".skills-modal,.skills-discover-results,.skills-content",
  );
  const runtimeScroll = document.querySelector("[data-testid=runtime-scroll]");
  const snapScroll = (el) =>
    el
      ? {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflow: getComputedStyle(el).overflowY,
        }
      : null;
  return {
    text: document.body.innerText.slice(-5000),
    modal: !!dialog,
    route: !!route,
    inline: !!route?.closest("main"),
    dashboardHidden:
      document.querySelector(".dashboard-page")?.getAttribute("aria-hidden") ===
      "true",
    routeHeight: route?.getBoundingClientRect().height || 0,
    label: route?.getAttribute("aria-label") || null,
    tabs: [...document.querySelectorAll(".floating-glass-dock button")].map(
      (b) => b.textContent.trim(),
    ),
    hasUpperTabs: !!document.querySelector(".drawer-menu-tabs"),
    workspaceInSettings: !!document.querySelector(
      ".workspace-settings-section",
    ),
    overflowX: document.documentElement.scrollWidth > innerWidth,
    content: snapScroll(content),
    skills: snapScroll(skillsList),
    runtime: snapScroll(runtimeScroll),
    lastFocus:
      document.activeElement?.getAttribute("aria-label") ||
      document.activeElement?.tagName,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    motion: document.documentElement.dataset.motion,
  };
}
function keyboard(key, shift = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  return {
    prevented: event.defaultPrevented,
    activeInside: !!dialog?.contains(document.activeElement),
    tag: document.activeElement?.tagName,
    aria: document.activeElement?.getAttribute("aria-label"),
  };
}
async function main() {
  const views = [];
  for (const [width, height] of [
    [420, 620],
    [435, 900],
    [451, 978],
    [700, 900],
  ]) {
    const errors = [];
    const win = new BrowserWindow({
      width,
      height,
      show: false,
      useContentSize: true,
      frame: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.session.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (_r, callback) => callback({ cancel: true }),
    );
    win.webContents.on("console-message", (event) => {
      const level = event.level;
      const message = String(event.message ?? "");
      if (
        (level === "error" ||
          level === "warning" ||
          level === 2 ||
          level === 3 ||
          message.includes("Uncaught")) &&
        !message.includes("Electron Security Warning")
      )
        errors.push(message.slice(0, 450));
    });
    try {
      await win.loadFile(path.join(root, "apps", "desktop", "index.html"));
      if (motionOn) win.showInactive();
      const evaluate = (f, ...args) =>
        win.webContents.executeJavaScript(
          "(" +
            f.toString() +
            ")(" +
            args.map((x) => JSON.stringify(x)).join(",") +
            ")",
          true,
        );
      let start;
      for (let attempt = 0; attempt < 30; attempt++) {
        await delay(75);
        start = await evaluate(snapshot);
        if (
          start.motion === (motionOn ? "on" : "off") &&
          start.text.includes("QNECTOR")
        )
          break;
      }
      assert.equal(
        start.motion,
        motionOn ? "on" : "off",
        "The synthetic animation setting did not apply before the UI QC deadline",
      );
      assert.equal(start.overflowX, false, "root overflow at " + width);
      if (width === 451) {
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand(
          "Emulation.setEmulatedMedia",
          {
            features: [{ name: "prefers-reduced-motion", value: "reduce" }],
          },
        );
        const reduced = await win.webContents.executeJavaScript(
          'matchMedia("(prefers-reduced-motion: reduce)").matches',
        );
        assert.equal(
          reduced,
          true,
          "Reduced motion emulation did not activate",
        );
        win.webContents.debugger.detach();
      }
      assert.ok(start.text.includes("QNECTOR"), "main renderer failed to load");
      assert.ok(
        start.tabs.includes("Home"),
        "Home missing from bottom navigation",
      );
      const data = {
        width,
        height,
        main: true,
        reducedMotion: start.motion === "off",
        screens: [],
      };
      for (const name of ["Memory", "Skills", "Settings"]) {
        const clicked = await evaluate(openNav, name);
        assert.equal(
          clicked.ok,
          true,
          "Could not open " + name + ": " + JSON.stringify(clicked.available),
        );
        if (motionOn && name === "Workspace" && width === 420) {
          const direction = await win.webContents.executeJavaScript(
            "document.documentElement.dataset.routeDirection",
          );
          assert.equal(direction, "left", "Route transition did not start");
          data.motionTransitionVerified = true;
        }
        await delay(motionOn ? 400 : 95);
        const current = await evaluate(snapshot);
        assert.equal(
          current.modal,
          false,
          "Unexpected modal overlay " + name + " at " + width,
        );
        assert.equal(
          current.route,
          true,
          "Missing inline route " + name + " at " + width,
        );
        assert.equal(
          current.inline,
          true,
          "Route is outside main " + name + " at " + width,
        );
        assert.equal(
          current.dashboardHidden,
          true,
          "Dashboard not inert " + name + " at " + width,
        );
        assert.ok(
          current.routeHeight > 120,
          "Route has no usable height " + name + " at " + width,
        );
        assert.equal(
          current.overflowX,
          false,
          "Horizontal page overflow " + name + " at " + width,
        );
        assert.equal(current.tabs.length, 4, "Wrong dock tab count " + name);
        assert.equal(
          current.hasUpperTabs,
          false,
          "Unexpected upper navigation tabs",
        );
        assert.equal(current.tabs[0], "Home", "Home missing from dock");
        if (name === "Memory")
          assert.ok(
            current.text.includes("Memory at a glance"),
            "Memory content missing",
          );
        if (name === "Skills")
          assert.ok(
            current.text.includes("SKILL MANAGER"),
            "Skills content missing",
          );
        if (name === "Settings") {
          assert.equal(
            current.workspaceInSettings,
            true,
            "Workspace card missing from Settings",
          );
          assert.ok(
            current.content?.scrollHeight >= current.content?.clientHeight,
            "Settings scroll data missing",
          );
          assert.ok(
            ["auto", "scroll"].includes(current.content?.overflow),
            "Settings scroll not enabled",
          );
        }
        if (width === 451 && (name === "Memory" || name === "Skills")) {
          win.showInactive();
          await delay(100);
          const png = await win.webContents.capturePage();
          fs.writeFileSync(
            path.join(
              output,
              "candidate-" + name.toLowerCase() + "-451x978.png",
            ),
            png.toPNG(),
          );
          win.hide();
        }
        data.screens.push({
          name,
          inlineRoute: current.route,
          hasLabel: !!current.label,
          innerScroll: current.content?.overflow,
          scrollExtent: current.content
            ? current.content.scrollHeight - current.content.clientHeight
            : 0,
          overflowX: current.overflowX,
        });
      }
      if (width === 451) {
        win.showInactive();
        await delay(150);
        const png = await win.webContents.capturePage();
        fs.writeFileSync(
          path.join(output, "candidate-settings-451x978.png"),
          png.toPNG(),
        );
        win.hide();
      }
      const settingsScroll = await win.webContents.executeJavaScript(
        '(()=>{const e=document.querySelector(".drawer-content");if(!e)return null;e.scrollTop=e.scrollHeight;return {top:e.scrollTop,extent:e.scrollHeight-e.clientHeight};})()',
      );
      if (settingsScroll?.extent > 0)
        assert.ok(settingsScroll.top > 0, "Settings page cannot scroll");
      data.settingsScroll = settingsScroll;
      const clickedRuntime = await evaluate(runtimeNav);
      assert.equal(clickedRuntime, true, "Runtime not reachable from Settings");
      await delay(135);
      const runtime = await evaluate(snapshot);
      assert.equal(runtime.modal, false, "Runtime opened a modal " + width);
      assert.equal(runtime.route, true, "Runtime route missing " + width);
      assert.ok(
        runtime.text.includes("Health") &&
          runtime.text.includes("Durable jobs"),
        "Runtime content missing at " + width,
      );
      assert.equal(runtime.overflowX, false, "Runtime overflow at " + width);
      data.screens.push({
        name: "Runtime",
        inlineRoute: runtime.route,
        hasLabel: !!runtime.label,
        runtimeScroll: runtime.runtime,
        overflowX: runtime.overflowX,
      });
      // Inline navigation does not trap keyboard focus; dock stays accessible.
      const dockAccessible = await win.webContents.executeJavaScript(
        '(()=>[...document.querySelectorAll(".floating-glass-dock button")].every(b=>!b.disabled && b.tabIndex>=0))()',
      );
      assert.equal(
        dockAccessible,
        true,
        "Dock inaccessible during inline route",
      );
      data.dockKeyboardAccessible = true;
      if (width === 451) {
        win.showInactive();
        await delay(120);
        const screenshot = await win.webContents.capturePage();
        fs.writeFileSync(
          path.join(output, "candidate-runtime-451x978.png"),
          screenshot.toPNG(),
        );
        if (!motionOn) win.hide();
        data.screenshot = "candidate-runtime-451x978.png";
      }
      const escape = await evaluate(keyboard, "Escape", false);
      assert.equal(escape.prevented, true, "Escape not consumed by route");
      await delay(120);
      const closed = await evaluate(snapshot);
      assert.equal(closed.route, false, "Escape did not return to dashboard");
      assert.equal(closed.dashboardHidden, false, "Dashboard not restored");
      data.escapeReturnsHome = true;
      data.errors = errors;
      assert.equal(
        data.reducedMotion,
        !motionOn,
        "Synthetic motion quality not applied",
      );
      assert.equal(
        errors.length,
        0,
        "Renderer console errors at " + width + ": " + errors.join("; "),
      );
      views.push(data);
    } finally {
      win.destroy();
    }
  }
  const result = {
    ok: true,
    source:
      "Compiled Qnector renderer running in isolated Electron with synthetic preload",
    preventsLiveMachineChanges: true,
    viewports: views,
    note: "No installed Qnector.exe, live tunnel, Windows user config or real ChatGPT iframe was touched.",
  };
  const report = path.join(output, "native-renderer-acceptance.json");
  fs.writeFileSync(report, JSON.stringify(result, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        views: views.map((v) => ({
          viewport: v.width + "x" + v.height,
          screenNames: v.screens.map((s) => s.name),
          overflow: v.screens.some((s) => s.overflowX),
          escape: v.escapeReturnsHome,
          dockAccessible: v.dockKeyboardAccessible,
          errors: v.errors,
        })),
        report,
      },
      null,
      2,
    ),
  );
}
app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((e) => {
    console.error(e.stack || String(e));
    app.exit(1);
  });
