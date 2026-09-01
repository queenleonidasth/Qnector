import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderer = readFileSync(
  new URL("./renderer.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(
  new URL("../main/main.ts", import.meta.url),
  "utf8",
);

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

  it("keeps one persistent drawer shell and animates only the replaced page", () => {
    expect(renderer).toContain("const switchDrawer = (drawer: DrawerName)");
    expect(renderer).toContain('nextIndex > currentIndex ? "left" : "right"');
    expect(renderer).toContain("setActiveDrawer(drawer);");
    expect(renderer).toContain("setDrawerTransition(direction);");
    expect(renderer.match(/className=\{`drawer-backdrop/g)?.length).toBe(1);
    expect(
      renderer.match(/className=\{`drawer-card unified-drawer-card/g)?.length,
    ).toBe(1);
    expect(renderer).toContain(
      'className={`drawer-page ${drawerTransition ? `drawer-page-${drawerTransition}` : ""}`}',
    );
    expect(styles).toContain(".unified-drawer-card");
    expect(styles).toContain(".drawer-page-left");
    expect(styles).toContain(".drawer-page-right");
    expect(styles).toContain("@keyframes drawerPageFromRight");
    expect(styles).toContain("@keyframes drawerPageFromLeft");
    expect(styles).toContain(
      "animation: drawerPageFromRight 130ms ease-out both !important;",
    );
    expect(styles).toContain(
      "animation: drawerPageFromLeft 130ms ease-out both !important;",
    );
    expect(styles).not.toContain(".drawer-card.drawer-switching");
    expect(styles).not.toContain("drawerContentFromRight");
    expect(styles).not.toContain("drawerContentFromLeft");
  });

  it("keeps drawer typography readable without inflating the shell layout", () => {
    expect(styles).toContain(".unified-drawer-card .drawer-title");
    expect(styles).toContain("font-size: 14.5px;");
    expect(styles).toContain("font: 650 11px/1.15 var(--font-sans);");
    expect(styles).toContain(".unified-drawer-card .memory-box-text");
    expect(styles).toContain("font-size: 13px;");
    expect(styles).toContain(".unified-drawer-card .runtime-section > summary");
    expect(styles).toContain("font-size: 11.5px;");
    expect(styles).toContain(".unified-drawer-card .update-status-panel p");
    expect(styles).toContain(".unified-drawer-card .btn-update-primary");
  });

  it("prevents the desktop window from shrinking below a usable menu height", () => {
    expect(mainSource).toContain("width: 451,");
    expect(mainSource).toContain("height: 978,");
    expect(mainSource).toContain("minWidth: 451,");
    expect(mainSource).toContain("minHeight: 978,");
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

  it("keeps the unified shell at one fixed height while page content scrolls inside", () => {
    expect(styles).toMatch(
      /\.unified-drawer-card\s*\{[\s\S]*?height:\s*min\(90vh, calc\(100vh - 12px\)\);[\s\S]*?max-height:\s*min\(90vh, calc\(100vh - 12px\)\);/,
    );
    expect(styles).toMatch(
      /\.drawer-page\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(styles).toMatch(
      /\.memory-summary-container\s*\{[\s\S]*?max-height:\s*none !important;[\s\S]*?overflow:\s*visible !important;/,
    );
    expect(styles).toContain(".drawer-content::-webkit-scrollbar");
    expect(styles).toContain(".runtime-scroll::-webkit-scrollbar");
  });
});
