import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Locate an existing Git installation without requiring a global PATH change. */
export async function locateGitExecutable(): Promise<string | null> {
  const configured = process.env.QNECTOR_GIT_PATH?.trim();
  if (configured && path.isAbsolute(configured) && (await isFile(configured)))
    return configured;

  try {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(lookup, ["git"], {
      windowsHide: true,
      timeout: 3_000,
    });
    for (const candidate of stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())) {
      if (candidate && path.isAbsolute(candidate) && (await isFile(candidate)))
        return candidate;
    }
  } catch {
    // Git may be installed without its directory on PATH.
  }

  if (process.platform !== "win32") return null;
  const home = os.homedir();
  const candidates = [
    path.join(home, "Tools", "MinGit", "cmd", "git.exe"),
    path.join(home, "AppData", "Local", "Programs", "Git", "cmd", "git.exe"),
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "Git", "cmd", "git.exe")
      : undefined,
    process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"]!, "Git", "cmd", "git.exe")
      : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate && (await isFile(candidate))) return candidate;
  }
  return null;
}
