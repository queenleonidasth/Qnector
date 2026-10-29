import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const load = (name: string): Promise<string> =>
  readFile(new URL(name, import.meta.url), "utf8");

describe("Royal Liquid Glass V2.1 production trial", () => {
  it("replaces active Matrix text rain with native-VSync Silk/Aurora Canvas", async () => {
    const [app, silk, clock] = await Promise.all([
      load("./renderer.tsx"),
      load("./royal-silk-background.tsx"),
      load("./royal-motion-clock.ts"),
    ]);
    expect(app).toContain("<RoyalSilkBackground");
    expect(app).not.toContain("<GoldMatrixRain");
    expect(silk).toContain('className="liquid-silk-canvas"');
    expect(silk).not.toContain("CLASSIC_MATRIX_KANA");
    expect(silk).not.toContain("TARGET_FPS");
    expect(clock).toContain("MIN_ACTIVE_MOTION_TARGET_FPS = 60");
    expect(clock).toContain('RAF_CADENCE = "native-vsync"');
    expect(clock).toContain("frame = requestAnimationFrame(tick)");
    expect(clock).not.toContain("setInterval");
    expect(clock).toContain("window.qnector.onWindowVisible");
    expect(clock).toContain("document.addEventListener");
    expect(clock).toContain("prefers-reduced-motion: reduce");
    expect(clock).toContain("cancelAnimationFrame");
  });

  it("integrates the actual Queen portrait without a square icon frame", async () => {
    const [app, orb, css, vite] = await Promise.all([
      load("./renderer.tsx"),
      load("./queen-liquid-orb.tsx"),
      load("./liquid-motion.css"),
      readFile(new URL("../../vite.config.ts", import.meta.url), "utf8"),
    ]);
    expect(app).toContain('new URL("./assets/queen-portrait.png"');
    expect(app).toContain("<QueenLiquidOrb");
    expect(orb).toContain('className="queen-orb-portrait"');
    expect(orb).toContain('className="queen-orb-fluid"');
    expect(css).toContain(".queen-orb-portrait {");
    // Do not wash out opaque dark Queen details with screen blending.
    expect(css).toContain("mix-blend-mode: normal");
    expect(css).not.toContain("mix-blend-mode: screen");
    expect(css).toContain("filter: contrast(1.15) saturate(1.08)");
    expect(css).toContain("-webkit-mask-image: radial-gradient");
    expect(css).toContain("background: none;");
    expect(css).toContain("border: 0;");
    expect(css).toContain("box-shadow: none;");
    expect(css).toContain("animation: queenFloat");
    expect(vite).toContain('base: "./"');
  });

  it("moves one orb canvas with a compositor transform and removes long hold", async () => {
    const [app, css] = await Promise.all([
      load("./renderer.tsx"),
      load("./translucent-controls.css"),
    ]);
    expect(app).toContain("orbTravelRef");
    expect(app).toContain("const animation = stage.animate(");
    expect(app).toContain("const orbDocked = isConnected && !isDisconnecting;");
    expect(app).not.toContain("holdProgressRef");
    expect(app).not.toContain("ringMeterRef");
    expect(css).toContain(".orb-travel-stage.is-positioned");
    expect(css).toContain("transform 660ms");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("preserves the stable window-hidden and animations-off contracts", async () => {
    const [app, clock, css, oldCss] = await Promise.all([
      load("./renderer.tsx"),
      load("./royal-motion-clock.ts"),
      load("./liquid-motion.css"),
      load("./styles.css"),
    ]);
    expect(app).toContain("matrixFrozenAfterDisconnect");
    expect(app).toContain("animationsEnabled");
    expect(app).toContain("void disconnect()");
    expect(clock).toContain("!document.hidden");
    expect(clock).toContain("media?.matches");
    expect(css).toContain('html[data-motion="off"]');
    expect(oldCss).toContain("html.qnector-window-paused *");
    expect(oldCss).toContain('html[data-motion="off"] *');
  });
});
