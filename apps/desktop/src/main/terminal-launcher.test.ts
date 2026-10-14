import { describe, expect, it } from "vitest";
import { buildWindowsShellLauncherArgs } from "./terminal-launcher.js";

function decodeScript(cwd: string, shell: string): string {
  const args = buildWindowsShellLauncherArgs(cwd, shell);
  expect(args.slice(0, 3)).toEqual([
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
  ]);
  return Buffer.from(args[3]!, "base64").toString("utf16le");
}

describe("Windows terminal launcher", () => {
  it("preserves workspace paths with spaces and shell paths with spaces", () => {
    const script = decodeScript(
      "D:\\CLI Sandbox\\skyrim-pool-workbench",
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    );
    expect(script).toContain(
      "$workingDirectory = 'D:\\CLI Sandbox\\skyrim-pool-workbench'",
    );
    expect(script).toContain(
      "$targetShell = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'",
    );
    expect(script).toContain("-ArgumentList @('-NoLogo', '-NoExit')");
    expect(script).toContain("$terminal.HasExited");
    expect(script).not.toContain("cmd.exe /c start");
  });

  it("escapes apostrophes without executing command syntax", () => {
    const script = decodeScript(
      "D:\\Queen's Work & 100%\\Project",
      "C:\\O'Brien\\powershell.exe",
    );
    expect(script).toContain(
      "$workingDirectory = 'D:\\Queen''s Work & 100%\\Project'",
    );
    expect(script).toContain("$targetShell = 'C:\\O''Brien\\powershell.exe'");
  });

  it("uses /K for cmd.exe and does not pass PowerShell-only options", () => {
    const script = decodeScript("C:\\Test Project", "cmd.exe");
    expect(script).toContain("-ArgumentList @('/K')");
    expect(script).not.toContain("'-NoExit'");
  });

  it("does not impose PowerShell flags on unknown shells", () => {
    const script = decodeScript("C:\\Test Project", "bash.exe");
    expect(script).toContain("-FilePath $targetShell -WorkingDirectory");
    expect(script).not.toContain("-ArgumentList");
  });
});
