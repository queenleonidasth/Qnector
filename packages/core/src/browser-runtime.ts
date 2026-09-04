import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ManagedBrowserName = "auto" | "chrome" | "edge";

export interface ManagedBrowserSnapshot {
  running: boolean;
  browser: "chrome" | "edge" | null;
  executablePath: string | null;
  host: "127.0.0.1";
  port: number | null;
  profileDir: string | null;
  profileName: string | null;
  persistentProfile: boolean;
  headless: boolean;
  pid: number | null;
  startedAt: string | null;
  devtoolsUrl: string | null;
}

export interface ManagedBrowserLaunchOptions {
  browser?: ManagedBrowserName;
  executablePath?: string;
  port?: number;
  url?: string;
  profile?: string;
  persistentProfile?: boolean;
  headless?: boolean;
}

export class ManagedBrowserRuntime {
  private child?: ChildProcess;
  private snapshot: ManagedBrowserSnapshot = emptySnapshot();

  public status(): ManagedBrowserSnapshot {
    return { ...this.snapshot, running: this.isRunning() };
  }

  public async launch(
    input: ManagedBrowserLaunchOptions = {},
  ): Promise<ManagedBrowserSnapshot> {
    if (this.isRunning()) return this.status();
    if (input.url) assertWebUrl(input.url);
    const port = clamp(input.port ?? 9222, 1, 65_535);
    if (await canConnectToPort(port))
      throw new Error(
        `BROWSER_RUNTIME_PORT_IN_USE: 127.0.0.1:${port} is already accepting connections; choose another DevTools port`,
      );
    const resolved = resolveBrowser(
      input.browser ?? "auto",
      input.executablePath,
    );
    const persistentProfile = input.persistentProfile === true;
    const headless = input.headless !== false;
    const profileName = normalizeProfileName(input.profile ?? "default");
    const profileDir = persistentProfile
      ? persistentProfileDirectory(profileName)
      : path.join(
          os.tmpdir(),
          `qnector-browser-${process.pid}-${randomUUID()}`,
        );
    await mkdir(profileDir, { recursive: true });
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-component-update",
      "--disable-background-networking",
      ...(headless ? ["--headless=new", "--disable-gpu"] : []),
      input.url ?? "about:blank",
    ];
    const child = spawn(resolved.executablePath, args, {
      windowsHide: headless,
      stdio: "ignore",
    });
    this.child = child;
    this.snapshot = {
      running: true,
      browser: resolved.browser,
      executablePath: resolved.executablePath,
      host: "127.0.0.1",
      port,
      profileDir,
      profileName,
      persistentProfile,
      headless,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      devtoolsUrl: `http://127.0.0.1:${port}`,
    };
    child.once("exit", () => {
      this.child = undefined;
      this.snapshot = { ...this.snapshot, running: false, pid: null };
    });
    child.once("error", () => {
      this.child = undefined;
      this.snapshot = { ...this.snapshot, running: false, pid: null };
    });
    try {
      await waitForDevTools(port, 12_000);
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
    return this.status();
  }

  public async restart(
    input: ManagedBrowserLaunchOptions = {},
  ): Promise<ManagedBrowserSnapshot> {
    const previous = this.status();
    await this.close();
    return this.launch({
      browser: input.browser ?? previous.browser ?? "auto",
      executablePath:
        input.executablePath ?? previous.executablePath ?? undefined,
      port: input.port ?? previous.port ?? 9222,
      url: input.url,
      profile: input.profile ?? previous.profileName ?? "default",
      persistentProfile:
        input.persistentProfile ?? previous.persistentProfile ?? false,
      headless: input.headless ?? previous.headless ?? true,
    });
  }

  public async openUrl(url: string): Promise<Record<string, unknown>> {
    assertWebUrl(url);
    const port = this.snapshot.port;
    if (!this.isRunning() || !port)
      throw new Error(
        "BROWSER_RUNTIME_NOT_RUNNING: launch the managed browser before opening a URL",
      );
    const response = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT", signal: AbortSignal.timeout(5_000) },
    ).catch((error: unknown) => {
      throw new Error(
        `BROWSER_RUNTIME_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!response.ok)
      throw new Error(
        `BROWSER_RUNTIME_FAILED: DevTools returned HTTP ${response.status}`,
      );
    return (await response.json()) as Record<string, unknown>;
  }

  public async openLocal(url: string): Promise<Record<string, unknown>> {
    return this.openUrl(url);
  }

  public async resetProfile(profile = "default"): Promise<{
    profile: string;
    profileDir: string;
    removed: boolean;
  }> {
    const profileName = normalizeProfileName(profile);
    const profileDir = persistentProfileDirectory(profileName);
    const current = this.status();
    if (
      current.running &&
      current.persistentProfile &&
      current.profileName === profileName
    )
      await this.close();
    const existed = existsSync(profileDir);
    await removeDirectoryWithRetry(profileDir);
    return { profile: profileName, profileDir, removed: existed };
  }

  public async close(): Promise<ManagedBrowserSnapshot> {
    const previous = this.status();
    const pid = this.child?.pid ?? previous.pid;
    if (pid && process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(pid), "/T", "/F"],
          {
            windowsHide: true,
            stdio: "ignore",
          },
        );
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      });
    } else if (this.child && this.child.exitCode === null) {
      this.child.kill("SIGTERM");
    }
    this.child = undefined;
    if (previous.profileDir && !previous.persistentProfile)
      await removeDirectoryWithRetry(previous.profileDir).catch(
        () => undefined,
      );
    this.snapshot = emptySnapshot();
    return { ...previous, running: false, pid: null };
  }

  private isRunning(): boolean {
    return Boolean(
      this.child && this.child.exitCode === null && !this.child.killed,
    );
  }
}

function resolveBrowser(
  requested: ManagedBrowserName,
  explicit?: string,
): { browser: "chrome" | "edge"; executablePath: string } {
  if (explicit?.trim()) {
    const executablePath = path.resolve(explicit.trim());
    if (!existsSync(executablePath))
      throw new Error(`BROWSER_EXECUTABLE_NOT_FOUND: ${executablePath}`);
    const browser = /edge/i.test(path.basename(executablePath))
      ? "edge"
      : "chrome";
    return { browser, executablePath };
  }
  if (process.platform !== "win32")
    throw new Error(
      "BROWSER_EXECUTABLE_NOT_FOUND: managed browser auto-detection is currently Windows-first; pass executablePath explicitly",
    );
  const chrome = [
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    ...playwrightChromiumExecutables(),
  ];
  const edge = [
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
  ];
  const candidates =
    requested === "chrome"
      ? chrome.map((executablePath) => ({
          browser: "chrome" as const,
          executablePath,
        }))
      : requested === "edge"
        ? edge.map((executablePath) => ({
            browser: "edge" as const,
            executablePath,
          }))
        : [
            ...chrome.map((executablePath) => ({
              browser: "chrome" as const,
              executablePath,
            })),
            ...edge.map((executablePath) => ({
              browser: "edge" as const,
              executablePath,
            })),
          ];
  const found = candidates.find(
    (candidate) =>
      candidate.executablePath && existsSync(candidate.executablePath),
  );
  if (!found)
    throw new Error(
      `BROWSER_EXECUTABLE_NOT_FOUND: could not locate ${requested === "auto" ? "Chrome or Edge" : requested}`,
    );
  return found;
}

function playwrightChromiumExecutables(): string[] {
  if (process.platform !== "win32") return [];
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "ms-playwright")
      : undefined,
  ].filter((value): value is string => Boolean(value?.trim()));
  const candidates: string[] = [];
  for (const root of roots) {
    try {
      const versions = readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && /^chromium-\d+$/i.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, { numeric: true }),
        );
      for (const version of versions) {
        candidates.push(
          path.join(root, version, "chrome-win64", "chrome.exe"),
          path.join(root, version, "chrome-win", "chrome.exe"),
        );
      }
    } catch {
      // Playwright is optional. Standard Chrome/Edge candidates remain available.
    }
  }
  return [...new Set(candidates)];
}

async function waitForDevTools(port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `BROWSER_RUNTIME_TIMEOUT: DevTools did not become ready on port ${port} within ${timeoutMs} ms`,
  );
}

function assertWebUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`INVALID_INPUT: invalid browser URL '${value}'`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(
      "BROWSER_TARGET_DENIED: managed browser navigation supports http:// and https:// URLs",
    );
}

function normalizeProfileName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(name))
    throw new Error(
      "INVALID_INPUT: browser profile must be 1-64 characters using letters, numbers, dot, underscore, or hyphen",
    );
  return name;
}

function persistentProfileDirectory(profile: string): string {
  const root = process.env.QNECTOR_BROWSER_PROFILE_ROOT?.trim()
    ? path.resolve(process.env.QNECTOR_BROWSER_PROFILE_ROOT.trim())
    : process.env.APPDATA
      ? path.join(process.env.APPDATA, "Qnector", "browser-profiles")
      : path.join(os.homedir(), ".qnector", "browser-profiles");
  return path.join(root, profile);
}

async function removeDirectoryWithRetry(target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 + attempt * 25));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`BROWSER_PROFILE_BUSY: could not remove ${target}`);
}

function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function emptySnapshot(): ManagedBrowserSnapshot {
  return {
    running: false,
    browser: null,
    executablePath: null,
    host: "127.0.0.1",
    port: null,
    profileDir: null,
    profileName: null,
    persistentProfile: false,
    headless: true,
    pid: null,
    startedAt: null,
    devtoolsUrl: null,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
