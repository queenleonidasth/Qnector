import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderer = readFileSync(
  new URL("./renderer.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const inlineStyles = readFileSync(
  new URL("./inline-route.css", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../main/main.ts", import.meta.url),
  "utf8",
);
const terminalSource = readFileSync(
  new URL("../main/terminal-launcher.ts", import.meta.url),
  "utf8",
);

describe("drawer navigation and content completeness UX", () => {
  it("uses only bottom navigation and moves Workspace into Settings", () => {
    expect(renderer).not.toContain('className="drawer-menu-tabs"');
    expect(renderer).toContain("<span>Home</span>");
    expect(renderer).toContain("<span>Memory</span>");
    expect(renderer).toContain("<span>Skills</span>");
    expect(renderer).toContain("<span>Settings</span>");
    expect(renderer).toContain('activeDrawer === null ? "page" : undefined');
    expect(renderer).toContain("onClick={closeDrawer}");
    expect(renderer).toContain('id="workspace-settings-title"');
    expect(renderer).toContain("onClick={() => void chooseWorkspace()}");
    expect(renderer).toContain("Runtime & Diagnostics");
    expect(renderer).not.toContain("settings-jump-nav");
    expect(renderer).not.toContain("settings-quick-actions");
    expect(renderer).not.toContain("memory-quick-stats");
  });

  it("slides entire routes inline and never opens a modal drawer", () => {
    expect(renderer).toContain("const switchDrawer = (drawer: DrawerName)");
    expect(renderer).toContain("document.startViewTransition");
    expect(renderer).toContain("flushSync(() => setActiveDrawer(next))");
    expect(renderer).toContain(
      "currentRouteTransition.current.skipTransition()",
    );
    expect(renderer).toContain(
      "if (routeTransitionId.current !== transitionId) return;",
    );
    expect(renderer).toContain('className="inline-route-view"');
    expect(renderer).toContain('className="inline-route-shell"');
    expect(renderer).toContain('className="drawer-page"');
    expect(renderer).toContain('role="region"');
    expect(renderer).not.toContain("className={`drawer-backdrop");
    expect(renderer).not.toContain(
      "className={`drawer-card unified-drawer-card",
    );
    expect(inlineStyles).toContain("view-transition-name: qnector-route;");
    expect(inlineStyles).toContain("::view-transition-old(qnector-route)");
    expect(inlineStyles).toContain("@keyframes qnRouteEnterRight");
    expect(inlineStyles).toContain("@keyframes qnRouteExitLeft");
    expect(inlineStyles).toContain(".inline-route-shell");
    expect(inlineStyles).toContain("animation: none !important;");
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

  it("clamps desktop size to the display work area and keeps a compact usable minimum", () => {
    expect(mainSource).toContain("screen.getPrimaryDisplay().workAreaSize");
    expect(mainSource).toContain(
      "const width = Math.min(451, workArea.width);",
    );
    expect(mainSource).toContain(
      "const height = Math.min(978, workArea.height);",
    );
    expect(mainSource).toContain(
      "const minWidth = Math.min(420, workArea.width);",
    );
    expect(mainSource).toContain(
      "const minHeight = Math.min(620, workArea.height);",
    );
    expect(mainSource).not.toContain("minHeight: 978");
  });

  it("launches an interactive Workspace shell and surfaces actual launcher failures", () => {
    expect(mainSource).toContain('ipcMain.handle("system:open-terminal"');
    expect(mainSource).toContain("openTerminalWindow(");
    expect(terminalSource).toContain("buildWindowsShellLauncherArgs");
    expect(terminalSource).toContain('"-EncodedCommand"');
    expect(terminalSource).toContain("Start-Process -FilePath $targetShell");
    expect(terminalSource).toContain("$terminal.HasExited");
    expect(terminalSource).toContain('child.once("close"');
    expect(terminalSource).toContain("windowsHide: true");
    expect(terminalSource).not.toContain("buildWindowsTerminalAliasCommand");
    expect(terminalSource).toContain("TERMINAL_LAUNCH_FAILED");
    expect(renderer).toContain(".openTerminal(status.activeWorkspace)");
    expect(renderer).toContain(".catch((reason: unknown) =>");
  });

  it("keeps download progress inside the existing update status panel", () => {
    const actionIndex = renderer.indexOf("update-card-actions-prominent");
    const statusIndex = renderer.indexOf("className={`update-status-panel");
    const progressIndex = renderer.indexOf(
      'className="update-progress-inline"',
    );
    expect(actionIndex).toBeGreaterThan(0);
    expect(statusIndex).toBeGreaterThan(actionIndex);
    expect(progressIndex).toBeGreaterThan(statusIndex);
    expect(renderer).not.toContain('className="update-progress-wrap"');
    expect(styles).toContain(".update-status-panel.downloading");
    expect(styles).toContain(".update-progress-inline");
    expect(styles).toContain(".update-progress-inline-meta");
  });

  it("keeps memory details accessible in the extracted Memory Center", async () => {
    const center = readFileSync(
      new URL("./memory-center.tsx", import.meta.url),
      "utf8",
    );
    expect(renderer).toMatch(
      /<MemoryCenter\s+key=\{status\?\.activeWorkspace\}\s+memory=\{memory\}/,
    );
    expect(center).toContain("memory?.v2?.memories");
    expect(center).toContain("setVisibleMemories");
    expect(center).toContain("currentTask.pendingSteps.slice(1).map");
    expect(center).toContain("currentTask.completedSteps.map");
    // Memory freshness fix shows newest activity first and only labels linked
    // sessions as historical; the obsolete last-session heading was removed.
    expect(center).toContain('id="memory-latest-activity"');
    expect(center).toContain('data-testid="memory-linked-session"');
    expect(center).toContain('data-testid="memory-freshness"');
    expect(center).toContain('id="memory-current-task"');
    expect(center).toContain('id="memory-activity-log"');
    expect(center).toContain("summary>Saved context");
    expect(center).toContain("summary>Data tools");
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
