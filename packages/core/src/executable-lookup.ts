import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Checks PATH without launching the executable itself. */
export function executableAvailable(command: string): boolean {
  try {
    if (path.isAbsolute(command)) return existsSync(command);
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    return (
      spawnSync(lookup, [command], { windowsHide: true, stdio: "ignore" })
        .status === 0
    );
  } catch {
    return false;
  }
}
