import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererUrl = new URL("./renderer.tsx", import.meta.url);
const stylesUrl = new URL("./styles.css", import.meta.url);

describe("desktop update action feedback", () => {
  it("keeps checking feedback visible for at least one second", async () => {
    const source = await readFile(rendererUrl, "utf8");
    expect(source).toContain('setUpdateUxPhase("checking")');
    expect(source).toContain("waitForMinimumUiTime(startedAt, 1000)");
    expect(source).toContain('updateUxPhase === "checking"');
    expect(source).toContain("↻ Checking…");
  });

  it("shows preparing and restarting states before invoking updater install", async () => {
    const source = await readFile(rendererUrl, "utf8");
    const preparing = source.indexOf('setUpdateUxPhase("preparing-restart")');
    const restarting = source.indexOf('setUpdateUxPhase("restarting")');
    const install = source.indexOf("window.qnector.installUpdate()");
    expect(preparing).toBeGreaterThan(-1);
    expect(restarting).toBeGreaterThan(preparing);
    expect(install).toBeGreaterThan(restarting);
    expect(source).toContain('className="update-restart-overlay"');
    expect(source).toContain("Restarting Qnector now");
  });

  it("animates update work and the restart transition", async () => {
    const css = await readFile(stylesUrl, "utf8");
    expect(css).toContain(".update-settings-card.ux-busy");
    expect(css).toContain("@keyframes updateUxSpin");
    expect(css).toContain(".update-restart-overlay");
    expect(css).toContain("@keyframes updateRestartSweep");
  });
});
