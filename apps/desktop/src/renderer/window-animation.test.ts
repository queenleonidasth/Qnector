import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFile(new URL(relative, import.meta.url), "utf8");

describe("desktop animation visibility", () => {
  it("keeps visible but unfocused windows unthrottled and reports actual visibility", async () => {
    const main = await read("../main/main.ts");
    const preload = await read("../preload/preload.cts");
    expect(main).toContain("backgroundThrottling: false");
    expect(main).toContain('ipcMain.handle("window:animation-visible"');
    for (const event of ["show", "hide", "minimize", "restore"]) {
      expect(main).toContain(
        `mainWindow.on("${event}", publishAnimationVisibility)`,
      );
    }
    expect(preload).toContain('ipcRenderer.invoke("window:animation-visible")');
    expect(preload).toContain(
      'subscribe("window:animation-visible", listener)',
    );
  });

  it("pauses CSS animation without resetting its progress when hidden", async () => {
    const renderer = await read("./renderer.tsx");
    const css = await read("./styles.css");
    const html = await read("../../index.html");
    expect(html).toContain('class="qnector-window-paused"');
    expect(renderer).toContain("window.qnector.onWindowVisible");
    expect(renderer).toContain(".getWindowVisible()");
    expect(css).toContain("html.qnector-window-paused *,");
    expect(css).toContain("animation-play-state: paused !important;");
  });

  it("lets the user disable interface motion including the Matrix canvas", async () => {
    const renderer = await read("./renderer.tsx");
    const css = await read("./styles.css");
    const matrix = await read("./gold-matrix-rain.tsx");
    expect(renderer).toContain("Interface Animations");
    expect(renderer).toContain("config?.ui.animationsEnabled ?? true");
    expect(renderer).toContain(
      'root.dataset.motion = animationsEnabled ? "on" : "off"',
    );
    expect(renderer).toContain("motionEnabled={animationsEnabled}");
    expect(css).toContain('html[data-motion="off"] *,');
    expect(css).toContain("animation: none !important;");
    expect(css).toContain("transition: none !important;");
    expect(matrix).toContain("motionEnabled = true");
    expect(matrix).toContain("motionQuery.matches || !motionEnabled");
  });
});
