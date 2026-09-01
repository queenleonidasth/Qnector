import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderer = readFileSync(
  new URL("./renderer.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("drawer navigation and content completeness UX", () => {
  it("uses one simple top navigation without the extra settings jump menu", () => {
    expect(renderer).toContain('className="drawer-menu-tabs"');
    expect(renderer).toContain('{ key: "workspace", label: "Workspace" }');
    expect(renderer).toContain('{ key: "memory", label: "Memory" }');
    expect(renderer).toContain('{ key: "runtime", label: "Runtime" }');
    expect(renderer).toContain('{ key: "settings", label: "Settings" }');
    expect(renderer).not.toContain("settings-jump-nav");
    expect(renderer).not.toContain("settings-quick-actions");
    expect(renderer).not.toContain("memory-quick-stats");
  });

  it("switches open drawer pages horizontally instead of closing and reopening", () => {
    expect(renderer).toContain("const switchDrawer = (drawer: DrawerName)");
    expect(renderer).toContain(
      'direction === "left" ? "out-left" : "out-right"',
    );
    expect(renderer).toContain('direction === "left" ? "in-left" : "in-right"');
    expect(styles).toContain("@keyframes drawerPageOutLeft");
    expect(styles).toContain("@keyframes drawerPageOutRight");
    expect(styles).toContain("@keyframes drawerPageInRight");
    expect(styles).toContain("@keyframes drawerPageInLeft");
    expect(styles).toContain(".drawer-backdrop.drawer-switching::before");
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
    expect(styles).toMatch(
      /\.memory-summary-container\s*\{[\s\S]*?max-height:\s*none !important;[\s\S]*?overflow:\s*visible !important;/,
    );
    expect(styles).toMatch(
      /\.drawer-card\s*\{[\s\S]*?max-height:\s*min\(90vh, calc\(100vh - 12px\)\);/,
    );
    expect(styles).toContain(".drawer-content::-webkit-scrollbar");
    expect(styles).toContain(".runtime-scroll::-webkit-scrollbar");
  });
});
