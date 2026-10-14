import { spawn } from "node:child_process";
import path from "node:path";

export interface TerminalLaunchResult {
  launcher: "classic-console" | "system";
  executable: string;
}

/**
 * Open a visible interactive shell. On Windows, do not use `cmd /c start`:
 * its quoting rules can interpret a workspace with spaces as an executable.
 * The short-lived PowerShell helper reports errors and checks the child while
 * the actual terminal remains independent of the Electron process.
 */
export async function openTerminalWindow(
  target: string,
  shellExecutable = process.platform === "win32" ? "powershell.exe" : undefined,
): Promise<TerminalLaunchResult> {
  const cwd = path.resolve(target);

  if (process.platform === "win32") {
    const shell = shellExecutable?.trim() || "powershell.exe";
    try {
      await launchWindowsClassicConsole(cwd, shell);
      return { launcher: "classic-console", executable: shell };
    } catch (primaryError) {
      // A user-configured shell may have been removed or renamed. Recover with
      // the built-in PowerShell, rather than reporting success for a dead shell.
      if (shell.toLowerCase() !== "powershell.exe") {
        try {
          await launchWindowsClassicConsole(cwd, "powershell.exe");
          return { launcher: "classic-console", executable: "powershell.exe" };
        } catch {
          // Prefer the configured-shell failure as the actionable error.
        }
      }
      const reason =
        primaryError instanceof Error
          ? primaryError.message
          : String(primaryError);
      throw new Error(`TERMINAL_LAUNCH_FAILED: ${reason}`);
    }
  }

  const executable = process.platform === "darwin" ? "open" : "xdg-open";
  await spawnDetached(executable, [cwd], cwd);
  return { launcher: "system", executable };
}

/** Exposed for cross-platform tests of Windows command construction. */
export function buildWindowsShellLauncherArgs(
  cwd: string,
  shell: string,
): string[] {
  const binaryName = path.win32.basename(shell).toLowerCase();
  const startupArgs =
    binaryName === "powershell.exe" || binaryName === "pwsh.exe"
      ? ["-NoLogo", "-NoExit"]
      : binaryName === "cmd.exe"
        ? ["/K"]
        : [];

  // PowerShell single-quoted literals escape apostrophes by doubling them.
  // Encoding the full script as UTF-16LE avoids cmd.exe interpretation of
  // spaces, quotes, ampersands, percent signs and Unicode in workspace paths.
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const argumentsOption = startupArgs.length
    ? ` -ArgumentList @(${startupArgs.map(quote).join(", ")})`
    : "";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$targetShell = ${quote(shell)}`,
    `$workingDirectory = ${quote(cwd)}`,
    `$terminal = Start-Process -FilePath $targetShell -WorkingDirectory $workingDirectory${argumentsOption} -PassThru -ErrorAction Stop`,
    "Start-Sleep -Milliseconds 450",
    "if ($terminal.HasExited) { throw 'TERMINAL_CLOSED_EARLY: shell exited immediately' }",
  ].join("; ");
  return [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

function launchWindowsClassicConsole(
  cwd: string,
  shell: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const child = spawn(
      "powershell.exe",
      buildWindowsShellLauncherArgs(cwd, shell),
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk
        .toString("utf8")
        .slice(0, Math.max(0, 8192 - stderr.length));
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            stderr.trim() ||
              `PowerShell terminal launcher exited with code ${code}`,
          ),
        );
      }
    });
  });
}

function spawnDetached(
  executable: string,
  args: string[],
  cwd?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(executable, args, {
      ...(cwd ? { cwd } : {}),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else {
        child.unref();
        resolve();
      }
    };
    child.once("error", finish);
    child.once("spawn", () => {
      const timer = setTimeout(() => finish(), 250);
      timer.unref?.();
      child.once("exit", (code) => {
        if (code && code !== 0)
          finish(
            new Error(`${path.basename(executable)} exited with code ${code}`),
          );
      });
    });
  });
}
