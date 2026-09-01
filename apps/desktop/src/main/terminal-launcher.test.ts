import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveWindowsTerminalExecutable } from "./terminal-launcher.js";

describe("terminal launcher", () => {
  it.runIf(process.platform === "win32")(
    "resolves a real non-empty WindowsTerminal.exe instead of the zero-byte wt alias",
    () => {
      const executable = resolveWindowsTerminalExecutable();
      expect(executable).toBeTruthy();
      expect(executable?.toLowerCase()).toContain("windowsterminal.exe");
      expect(executable?.toLowerCase()).not.toContain("\\windowsapps\\wt.exe");
      expect(statSync(executable!).size).toBeGreaterThan(0);
    },
  );
});
