import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderer = readFileSync(new URL("./renderer.tsx", import.meta.url), "utf8");
const skillManager = readFileSync(
  new URL("./skill-manager.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../main/main.ts", import.meta.url), "utf8");

describe("2026-09-11 QC regression guards", () => {
  it("keeps MEMORY.md view and export as separate cancel-safe flows", () => {
    expect(renderer).toContain('const memoryMdPath = `${status.activeWorkspace}/.qnector/MEMORY.md`;');
    expect(renderer).toContain("const exportMemoryFile = async");
    expect(renderer).toContain("if (!exportedPath) return;");
    expect(renderer).toContain("await window.qnector.openPath(exportedPath);");
    expect(mainSource).toContain("const openError = await shell.openPath(resolved);");
    expect(mainSource).toContain("OPEN_PATH_FAILED");
  });

  it("provides a keyboard-native disconnect action", () => {
    expect(renderer).toContain('className="btn-liquid-action disconnect"');
    expect(renderer).toContain("aria-busy={isDisconnecting}");
    expect(renderer).toContain("onClick={() => void disconnect()}");
  });

  it("prevents nested settings scroll rows and disables decorative reduced motion", () => {
    expect(styles).toMatch(/\.setting-toggle-card \{[\s\S]*?flex:\s*0 0 auto;/);
    expect(styles).toContain("overflow: visible;");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.plasma-aura,[\s\S]*?animation: none !important;/,
    );
  });

  it("keeps skill overlays focusable and import Cancel side-effect free", () => {
    expect(skillManager).toContain("const triggerModal = triggerOpen");
    expect(skillManager).toContain("ref={triggerDialogRef}");
    expect(skillManager).toContain("const importModal = pendingImport");
    expect(skillManager).toContain("onClick={() => setPendingImport(undefined)}");
    expect(skillManager).toContain("const confirmImport = async");
    expect(skillManager).not.toContain("Cancel = User");
  });

  it("snapshots the current config before handing control to the updater", () => {
    expect(mainSource).toContain('ipcMain.handle("updater:install", async () => {');
    expect(mainSource).toContain("if (config) await saveConfig(config, configPath());");
    expect(mainSource).toContain("return updater?.install();");
  });
});
