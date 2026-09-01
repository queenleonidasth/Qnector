import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface TerminalLaunchResult {
  launcher:
    | "windows-terminal"
    | "windows-terminal-alias"
    | "classic-console"
    | "system";
  executable: string;
}

export async function openTerminalWindow(
  target: string,
  shellExecutable = process.platform === "win32" ? "powershell.exe" : undefined,
): Promise<TerminalLaunchResult> {
  const cwd = path.resolve(target);

  if (process.platform === "win32") {
    const shell = shellExecutable?.trim() || "powershell.exe";
    const windowsTerminal = resolveWindowsTerminalExecutable();
    if (windowsTerminal) {
      try {
        await spawnDetached(
          windowsTerminal,
          ["-d", cwd, shell, "-NoLogo", "-NoExit"],
          cwd,
        );
        return {
          launcher: "windows-terminal",
          executable: windowsTerminal,
        };
      } catch {
        // Continue with the shell-mediated app execution alias below.
      }
    }

    try {
      await spawnDetached(
        "cmd.exe",
        ["/d", "/s", "/c", buildWindowsTerminalAliasCommand(cwd, shell)],
        cwd,
      );
      return { launcher: "windows-terminal-alias", executable: "wt.exe" };
    } catch {
      // Fall through to a classic console window.
    }

    try {
      await spawnDetached(
        "cmd.exe",
        ["/d", "/s", "/c", buildClassicConsoleCommand(cwd, shell)],
        cwd,
      );
      return { launcher: "classic-console", executable: shell };
    } catch (primaryError) {
      if (shell.toLowerCase() !== "powershell.exe") {
        try {
          await spawnDetached(
            "cmd.exe",
            [
              "/d",
              "/s",
              "/c",
              buildClassicConsoleCommand(cwd, "powershell.exe"),
            ],
            cwd,
          );
          return { launcher: "classic-console", executable: "powershell.exe" };
        } catch {
          // Use the original error below because it is closer to the configured shell.
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

export function resolveWindowsTerminalExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (process.platform !== "win32") return undefined;
  const roots = [
    env.ProgramFiles ? path.join(env.ProgramFiles, "WindowsApps") : undefined,
    env["ProgramW6432"]
      ? path.join(env["ProgramW6432"], "WindowsApps")
      : undefined,
  ].filter((value): value is string => Boolean(value));

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const root of roots) {
    const normalizedRoot = root.toLowerCase();
    if (seen.has(normalizedRoot)) continue;
    seen.add(normalizedRoot);
    try {
      const packageDirectories = readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith("Microsoft.WindowsTerminal_") &&
            !entry.name.includes("_neutral_"),
        )
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
      for (const directory of packageDirectories) {
        const executable = path.join(root, directory, "WindowsTerminal.exe");
        try {
          if (existsSync(executable) && statSync(executable).size > 0)
            candidates.push(executable);
        } catch {
          // Ignore inaccessible/stale package directories.
        }
      }
    } catch {
      // WindowsApps may be inaccessible on some installations; fall back below.
    }
  }
  return candidates[0];
}

function buildWindowsTerminalAliasCommand(
  target: string,
  shell: string,
): string {
  return `start "" wt.exe -d "${escapeCmdQuoted(target)}" "${escapeCmdQuoted(shell)}" -NoLogo -NoExit`;
}

function buildClassicConsoleCommand(target: string, shell: string): string {
  return `start "" /D "${escapeCmdQuoted(target)}" "${escapeCmdQuoted(shell)}" -NoLogo -NoExit`;
}

function escapeCmdQuoted(value: string): string {
  return value.replace(/"/g, '""');
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
