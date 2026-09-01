import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopUpdateMode,
  DesktopUpdateState,
} from "../updater-types.js";
import {
  compareVersions,
  normalizeVersion,
  parseSha256Digest,
  selectWindowsAsset,
  type GitHubReleaseAsset,
  type GitHubReleaseInfo,
} from "./updater-core.js";
import { buildWindowsUpdateScript } from "./updater-script.js";

const RELEASE_API =
  "https://api.github.com/repos/queenleonidasth/Qnector/releases/latest";
const RELEASES_URL = "https://github.com/queenleonidasth/Qnector/releases";
const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

export class DesktopUpdater {
  private state: DesktopUpdateState;
  private release?: GitHubReleaseInfo;
  private asset?: GitHubReleaseAsset;
  private downloadedPath?: string;
  private checkPromise?: Promise<DesktopUpdateState>;
  private downloadPromise?: Promise<DesktopUpdateState>;

  public constructor(
    private readonly publish: (state: DesktopUpdateState) => void,
  ) {
    const mode = detectUpdateMode();
    this.state = {
      phase: "idle",
      mode,
      currentVersion: app.getVersion(),
      canDownload: false,
      canInstall: false,
      message:
        mode === "development"
          ? "Development build: update checks are available, but self-install is disabled."
          : "Qnector can check GitHub Releases for a newer version.",
    };
  }

  public getState(): DesktopUpdateState {
    return { ...this.state };
  }

  public async check(): Promise<DesktopUpdateState> {
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.performCheck().finally(() => {
      this.checkPromise = undefined;
    });
    return this.checkPromise;
  }

  public async download(): Promise<DesktopUpdateState> {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = this.performDownload().finally(() => {
      this.downloadPromise = undefined;
    });
    return this.downloadPromise;
  }

  public async install(): Promise<DesktopUpdateState> {
    if (process.platform !== "win32")
      return this.fail("Self-update is currently supported on Windows only.");
    if (this.state.mode === "development")
      return this.fail("Development builds cannot self-update.");
    if (!this.downloadedPath || this.state.phase !== "downloaded")
      return this.fail("Download the update before installing it.");

    const targetExecutable = updateTargetExecutable(this.state.mode);
    if (this.state.mode === "portable") {
      try {
        await assertPortableTargetWritable(targetExecutable);
      } catch (error) {
        return this.fail(
          `Portable update cannot replace ${targetExecutable}: ${errorMessage(error)}`,
        );
      }
    }

    try {
      const scriptPath = await createUpdateScript({
        mode: this.state.mode,
        processId: process.pid,
        launcherProcessId:
          this.state.mode === "portable" ? process.ppid : undefined,
        sourcePath: this.downloadedPath,
        targetExecutable,
      });
      const powershell = await resolveWindowsPowerShell();
      const child = spawn(
        powershell,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
        ],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      await waitForSpawn(child);
      child.unref();
      this.setState({
        ...this.state,
        phase: "installing",
        canDownload: false,
        canInstall: false,
        message:
          this.state.mode === "portable"
            ? "Restarting Qnector and replacing the portable executable…"
            : "Restarting Qnector and installing the new version…",
      });
      // Quit only after Windows confirms the detached apply-update helper was
      // actually created. spawn() reports ENOENT asynchronously.
      setTimeout(() => app.quit(), 200);
      return this.getState();
    } catch (error) {
      return this.fail(`Could not start updater: ${errorMessage(error)}`);
    }
  }

  public getReleaseUrl(): string {
    return this.state.releaseUrl || RELEASES_URL;
  }

  private async performCheck(): Promise<DesktopUpdateState> {
    this.setState({
      ...this.state,
      phase: "checking",
      canDownload: false,
      canInstall: false,
      message: "Checking GitHub Releases for updates…",
    });

    try {
      const response = await fetch(RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Qnector/${app.getVersion()}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`GitHub returned HTTP ${response.status}`);
      const release = (await response.json()) as GitHubReleaseInfo;
      if (!release?.tag_name || !Array.isArray(release.assets))
        throw new Error("GitHub returned an invalid release payload");

      const latestVersion = normalizeVersion(release.tag_name);
      const currentVersion = normalizeVersion(app.getVersion());
      this.release = release;
      this.asset = selectWindowsAsset(release.assets, this.state.mode);
      this.downloadedPath = undefined;

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        this.setState({
          phase: "up-to-date",
          mode: this.state.mode,
          currentVersion: app.getVersion(),
          latestVersion,
          releaseName: release.name || release.tag_name,
          releaseUrl: release.html_url,
          publishedAt: release.published_at || undefined,
          notes: release.body || undefined,
          canDownload: false,
          canInstall: false,
          message: `Qnector ${app.getVersion()} is up to date.`,
        });
        return this.getState();
      }

      const asset = this.asset;
      const installable =
        process.platform === "win32" &&
        this.state.mode !== "development" &&
        Boolean(asset);
      this.setState({
        phase: "available",
        mode: this.state.mode,
        currentVersion: app.getVersion(),
        latestVersion,
        releaseName: release.name || release.tag_name,
        releaseUrl: release.html_url,
        publishedAt: release.published_at || undefined,
        notes: release.body || undefined,
        assetName: asset?.name,
        totalBytes: asset?.size,
        progress: 0,
        canDownload: installable,
        canInstall: false,
        message: asset
          ? `Qnector ${latestVersion} is available.`
          : `Qnector ${latestVersion} is available, but its ${this.state.mode === "installed" ? "Setup" : "Portable"} asset is missing from the release.`,
      });
      return this.getState();
    } catch (error) {
      return this.fail(`Update check failed: ${errorMessage(error)}`);
    }
  }

  private async performDownload(): Promise<DesktopUpdateState> {
    if (this.state.phase !== "available" || !this.asset || !this.release)
      return this.fail("Check for updates before downloading.");
    if (!this.state.canDownload)
      return this.fail("This build cannot download a self-update package.");

    const asset = this.asset;
    const updateDir = path.join(
      app.getPath("temp"),
      "Qnector",
      "updates",
      this.state.latestVersion || "latest",
    );
    const destination = path.join(updateDir, asset.name);
    await mkdir(updateDir, { recursive: true });
    await rm(destination, { force: true }).catch(() => undefined);

    this.setState({
      ...this.state,
      phase: "downloading",
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: asset.size,
      canDownload: false,
      canInstall: false,
      message: `Downloading ${asset.name}…`,
    });

    try {
      const response = await fetch(asset.browser_download_url, {
        headers: { "User-Agent": `Qnector/${app.getVersion()}` },
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || !response.body)
        throw new Error(`Download returned HTTP ${response.status}`);

      const file = await open(destination, "w");
      const hash = createHash("sha256");
      let downloaded = 0;
      let lastPublish = 0;
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          await file.write(value);
          hash.update(value);
          downloaded += value.byteLength;
          const now = Date.now();
          if (now - lastPublish >= 150 || downloaded >= asset.size) {
            lastPublish = now;
            this.setState({
              ...this.state,
              phase: "downloading",
              progress:
                asset.size > 0 ? Math.min(downloaded / asset.size, 1) : 0,
              bytesDownloaded: downloaded,
              totalBytes: asset.size,
              canDownload: false,
              canInstall: false,
              message: `Downloading ${asset.name}…`,
            });
          }
        }
      } finally {
        await file.close();
      }

      if (asset.size > 0 && downloaded !== asset.size)
        throw new Error(
          `Downloaded ${downloaded} bytes, expected ${asset.size} bytes`,
        );
      const actualSha256 = hash.digest("hex").toLowerCase();
      const expectedSha256 = parseSha256Digest(asset.digest);
      if (expectedSha256 && actualSha256 !== expectedSha256)
        throw new Error(
          "SHA-256 digest from GitHub does not match the download",
        );

      this.downloadedPath = destination;
      this.setState({
        ...this.state,
        phase: "downloaded",
        progress: 1,
        bytesDownloaded: downloaded,
        totalBytes: asset.size,
        canDownload: false,
        canInstall: true,
        message: expectedSha256
          ? "Update downloaded and SHA-256 verified. Ready to restart."
          : "Update downloaded from GitHub. Ready to restart.",
      });
      return this.getState();
    } catch (error) {
      await rm(destination, { force: true }).catch(() => undefined);
      this.downloadedPath = undefined;
      return this.fail(`Update download failed: ${errorMessage(error)}`);
    }
  }

  private fail(message: string): DesktopUpdateState {
    this.setState({
      ...this.state,
      phase: "error",
      canDownload: Boolean(this.asset) && this.state.mode !== "development",
      canInstall: false,
      message,
    });
    return this.getState();
  }

  private setState(next: DesktopUpdateState): void {
    this.state = next;
    this.publish(this.getState());
  }
}

export function detectUpdateMode(): DesktopUpdateMode {
  if (!app.isPackaged) return "development";
  if (process.env.PORTABLE_EXECUTABLE_FILE) return "portable";
  return "installed";
}

function updateTargetExecutable(mode: DesktopUpdateMode): string {
  if (mode === "portable" && process.env.PORTABLE_EXECUTABLE_FILE)
    return path.resolve(process.env.PORTABLE_EXECUTABLE_FILE);
  return path.resolve(process.execPath);
}

async function assertPortableTargetWritable(target: string): Promise<void> {
  const directory = path.dirname(target);
  await access(directory, constants.W_OK);
  const probe = path.join(directory, `.qnector-update-${randomUUID()}.tmp`);
  await writeFile(probe, "update-write-test", "utf8");
  await unlink(probe);
}

async function createUpdateScript(input: {
  mode: DesktopUpdateMode;
  processId: number;
  launcherProcessId?: number;
  sourcePath: string;
  targetExecutable: string;
}): Promise<string> {
  const scriptPath = path.join(
    app.getPath("temp"),
    `qnector-apply-update-${randomUUID()}.ps1`,
  );
  const logPath = path.join(path.dirname(input.sourcePath), "apply-update.log");
  await rm(logPath, { force: true }).catch(() => undefined);
  const script = buildWindowsUpdateScript({
    ...input,
    logPath,
  });
  // Windows PowerShell 5 treats UTF-8 without a BOM as the legacy code page.
  // Add one so update paths containing non-ASCII names remain safe.
  await writeFile(scriptPath, `\uFEFF${script}`, "utf8");
  return scriptPath;
}

async function resolveWindowsPowerShell(): Promise<string> {
  const roots = Array.from(
    new Set(
      [process.env.SystemRoot, process.env.WINDIR, "C:\\Windows"].filter(
        (value): value is string => Boolean(value?.trim()),
      ),
    ),
  );
  for (const root of roots) {
    const candidate = path.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next canonical Windows root.
    }
  }
  throw new Error(
    "Windows PowerShell was not found under SystemRoot/WINDIR; cannot start the update helper.",
  );
}

function waitForSpawn(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
