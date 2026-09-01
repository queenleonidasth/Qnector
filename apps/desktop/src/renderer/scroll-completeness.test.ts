import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderer = readFileSync(
  new URL("./renderer.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("v0.4.3 scroll and completeness UX", () => {
  it("keeps the v0.4.1 menu structure without the v0.4.2 navigation additions", () => {
    expect(renderer).not.toContain("drawer-menu-tabs");
    expect(renderer).not.toContain("settings-jump-nav");
    expect(renderer).not.toContain("settings-quick-actions");
    expect(renderer).not.toContain("memory-quick-stats");
  });

  it("places the update action before long status and progress content", () => {
    const actionIndex = renderer.indexOf("update-card-actions-prominent");
    const statusIndex = renderer.indexOf('className="update-status-panel"');
    const progressIndex = renderer.indexOf('className="update-progress-wrap"');
    expect(actionIndex).toBeGreaterThan(0);
    expect(actionIndex).toBeLessThan(statusIndex);
    expect(actionIndex).toBeLessThan(progressIndex);
  });

  it("keeps all memory sections rendered without slicing facts or task steps", () => {
    expect(renderer).toContain("memory?.state.active?.completedSteps?.map");
    expect(renderer).toContain("memory?.state.active?.pendingSteps?.map");
    expect(renderer).toContain("memory?.state.facts.map");
    expect(renderer).not.toMatch(/memory\?\.state\.facts[^\n]*\.slice\(/);
  });

  it("uses one reachable scroll surface for long memory content", () => {
    expect(styles).toContain("v0.4.3 scroll/completeness pass");
    expect(styles).toMatch(
      /\.memory-summary-container\s*\{[\s\S]*?max-height:\s*none !important;[\s\S]*?overflow:\s*visible !important;/,
    );
    expect(styles).toMatch(
      /\.drawer-card\s*\{[\s\S]*?max-height:\s*min\(90vh, calc\(100vh - 12px\)\);/,
    );
  });

  it("provides visible scrollbars for drawer and runtime content", () => {
    expect(styles).toContain(".drawer-content::-webkit-scrollbar");
    expect(styles).toContain(".runtime-scroll::-webkit-scrollbar");
    expect(styles).toContain("scroll-padding-bottom: 18px");
  });
});
