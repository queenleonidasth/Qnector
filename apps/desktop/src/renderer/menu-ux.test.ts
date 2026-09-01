import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererUrl = new URL("./renderer.tsx", import.meta.url);
const stylesUrl = new URL("./styles.css", import.meta.url);

async function renderer(): Promise<string> {
  return readFile(rendererUrl, "utf8");
}

async function styles(): Promise<string> {
  return readFile(stylesUrl, "utf8");
}

describe("menu usability", () => {
  it("lets users switch directly between all four drawer sections", async () => {
    const source = await renderer();
    expect(source).toContain('className="drawer-menu-tabs"');
    expect(source).toContain(
      '{ key: "workspace", icon: "📁", label: "Workspace" }',
    );
    expect(source).toContain('{ key: "memory", icon: "🧠", label: "Memory" }');
    expect(source).toContain('{ key: "runtime", icon: "◈", label: "Runtime" }');
    expect(source).toContain(
      '{ key: "settings", icon: "⚙", label: "Settings" }',
    );
    expect(source).toContain('if (event.key === "Escape") closeDrawer();');
  });

  it("keeps update checking visible at the top of settings", async () => {
    const source = await renderer();
    expect(source).toContain('className="update-check-quick-action"');
    expect(source).toContain("onClick={() => void checkForUpdates()}");
    expect(source).toContain('"↻ Check for Updates"');
    expect(source).toContain('id="settings-updates"');
  });

  it("supports settings jump navigation instead of requiring blind scrolling", async () => {
    const source = await renderer();
    for (const id of [
      "settings-updates",
      "settings-connection",
      "settings-app",
      "settings-memory",
    ]) {
      expect(source).toContain(id);
    }
    expect(source).toContain('className="settings-jump-nav"');
  });

  it("uses one reachable scroll flow for long project memory", async () => {
    const source = await renderer();
    const css = await styles();
    expect(source).toContain("memory-drawer-card");
    expect(source).toContain("memory-collapsible");
    expect(source).toContain("memory-context-details");
    expect(source).toContain("memory-danger-zone");
    expect(source).toContain("memory-quick-stats");
    expect(css).toMatch(
      /\.memory-summary-container\s*\{[\s\S]*?max-height:\s*none\s*!important;[\s\S]*?overflow:\s*visible\s*!important;/,
    );
    expect(css).toMatch(/\.memory-drawer-card\s*\{[\s\S]*?max-height:\s*90%;/);
  });

  it("makes choosing a workspace the clear primary action", async () => {
    const source = await renderer();
    expect(source).toContain('className="btn-drawer-action primary"');
    expect(source).toContain('"Change Folder" : "Choose Folder"');
    expect(source).toContain(
      "Files, terminal commands, project memory and workspace tools use this folder.",
    );
  });
});
