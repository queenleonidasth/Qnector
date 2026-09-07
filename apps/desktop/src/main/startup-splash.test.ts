import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mainPath = path.resolve(import.meta.dirname, "main.ts");
const splashPath = path.resolve(import.meta.dirname, "splash-window.ts");

describe("desktop startup splash", () => {
  it("keeps the main window hidden until Electron reports it ready", async () => {
    const source = await readFile(mainPath, "utf8");
    expect(source).toContain("show: false");
    expect(source).toContain('mainWindow.once("ready-to-show"');
    expect(source).toContain("startRuntime();");
    expect(source).toContain("closeSplashWindow(splash);");
    expect(source).toContain(
      'qnectorPerformance.mark("renderer-ready-to-show")',
    );
  });

  it("ships a self-contained accessible splash that is immediately visible", async () => {
    const source = await readFile(splashPath, "utf8");
    expect(source).toContain("MIN_SPLASH_VISIBLE_MS = 360");
    expect(source).toContain("show: true");
    expect(source).toContain("focusable: false");
    expect(source).toContain("alwaysOnTop: true");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-label="Qnector is starting"');
    expect(source).toContain("prefers-reduced-motion:reduce");
    expect(source).toContain("Preparing workspace");
    expect(source).not.toContain("http://");
    expect(source).not.toContain("https://");
  });
});
