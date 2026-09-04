import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  mkdir,
  open,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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
import {
  buildWindowsUpdateScript,
  buildWindowsUpdaterBootstrapScript,
  WINDOWS_UPDATER_BOOTSTRAP_DETACHED,
} from "./updater-script.js";

const RELEASE_API =
  "https://api.github.com/repos/queenleonidasth/Qnector/releases/latest";
const RELEASES_URL = "https://github.com/queenleonidasth/Qnector/releases";
const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

export interface DesktopUpdaterOptions {
  releaseApi?: string;
  releasesUrl?: string;
  currentVersion?: string;
  mode?: DesktopUpdateMode;
  userDataPath?: string;
  fetchImpl?: typeof fetch;
}

export class DesktopUpdater {
  private state: DesktopUpdateState;
  private release?: GitHubReleaseInfo;
  private asset?: GitHubReleaseAsset;
  private downloadedPath?: string;
  private checkPromise?: Promise<DesktopUpdateState>;
  private downloadPromise?: Promise<DesktopUpdateState>;

  private readonly releaseApi: string;
  private readonly releasesUrl: string;
  private readonly currentVersion: string;
  private readonly userDataPath: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(
    private readonly publish: (state: DesktopUpdateState) => void,
    options: DesktopUpdaterOptions = {},
  ) {
    const mode = options.mode ?? detectUpdateMode();
    this.releaseApi = options.releaseApi ?? RELEASE_API;
    this.releasesUrl = options.releasesUrl ?? RELEASES_URL;
    this.currentVersion = options.currentVersion ?? app.getVersion();
    this.userDataPath = options.userDataPath ?? app.getPath("userData");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.state = {
      phase: "idle",
      mode,
      currentVersion: this.currentVersion,
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

    let updateArtifacts:
      | {
          scriptPath: string;
          bootstrapPath?: string;
          readyPath: string;
          logPath: string;
        }
      | undefined;
    try {
      updateArtifacts = await createUpdateScript({
        mode: this.state.mode,
        processId: process.pid,
        sourcePath: this.downloadedPath,
        targetExecutable,
        expectedVersion: this.state.latestVersion,
      });
      const powershell = await resolveWindowsPowerShell();
      updateArtifacts.bootstrapPath = await createUpdaterBootstrap({
        powershellPath: powershell,
        applyScriptPath: updateArtifacts.scriptPath,
      });
      const child = spawn(
        powershell,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          updateArtifacts.bootstrapPath,
        ],
        {
          // On this Windows/Electron portable runtime, Node's detached process
          // flag creates powershell.exe but it exits without executing -File.
          // The bootstrap itself uses Windows Start-Process to launch the real
          // independent apply helper instead.
          detached: WINDOWS_UPDATER_BOOTSTRAP_DETACHED,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      await waitForSpawn(child);
      await waitForHelperReady(updateArtifacts.readyPath, 5_000);
      await rm(updateArtifacts.bootstrapPath, { force: true }).catch(
        () => undefined,
      );
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
      // Quit only after the helper has executed the script far enough to write
      // its handshake file. This catches PowerShell startup/script failures.
      setTimeout(() => app.quit(), 200);
      return this.getState();
    } catch (error) {
      return this.fail(
        `Could not start updater: ${errorMessage(error)}${
          updateArtifacts?.logPath
            ? ` Update log: ${updateArtifacts.logPath}`
            : ""
        }`,
      );
    }
  }

  public getReleaseUrl(): string {
    return this.state.releaseUrl || this.releasesUrl;
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
      const response = await this.fetchImpl(this.releaseApi, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Qnector/${this.currentVersion}`,
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
      const currentVersion = normalizeVersion(this.currentVersion);
      this.release = release;
      this.asset = selectWindowsAsset(release.assets, this.state.mode);
      this.downloadedPath = undefined;

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        this.setState({
          phase: "up-to-date",
          mode: this.state.mode,
          currentVersion: this.currentVersion,
          latestVersion,
          releaseName: release.name || release.tag_name,
          releaseUrl: release.html_url,
          publishedAt: release.published_at || undefined,
          notes: release.body || undefined,
          canDownload: false,
          canInstall: false,
          message: `Qnector ${this.currentVersion} is up to date.`,
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
        currentVersion: this.currentVersion,
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
    const expectedSha256 = parseSha256Digest(asset.digest);
    const updateDir = path.join(
      this.userDataPath,
      "updates",
      this.state.latestVersion || "latest",
    );
    const destination = path.join(updateDir, asset.name);
    const partial = `${destination}.part`;
    await mkdir(updateDir, { recursive: true });

    try {
      if (
        expectedSha256 &&
        (await verifiedCachedAsset(destination, asset.size, expectedSha256))
      ) {
        this.downloadedPath = destination;
        this.setState({
          ...this.state,
          phase: "downloaded",
          progress: 1,
          bytesDownloaded: asset.size,
          totalBytes: asset.size,
          canDownload: false,
          canInstall: true,
          message: "Verified update reused from local cache. Ready to restart.",
        });
        return this.getState();
      }
      await rm(destination, { force: true }).catch(() => undefined);

      let resumeBytes = await stat(partial)
        .then((info) => info.size)
        .catch(() => 0);
      if (resumeBytes < 0 || (asset.size > 0 && resumeBytes >= asset.size)) {
        await rm(partial, { force: true }).catch(() => undefined);
        resumeBytes = 0;
      }

      this.setState({
        ...this.state,
        phase: "downloading",
        progress: asset.size > 0 ? Math.min(resumeBytes / asset.size, 1) : 0,
        bytesDownloaded: resumeBytes,
        totalBytes: asset.size,
        canDownload: false,
        canInstall: false,
        message:
          resumeBytes > 0
            ? `Resuming ${asset.name}…`
            : `Downloading ${asset.name}…`,
      });

      const headers: Record<string, string> = {
        "User-Agent": `Qnector/${this.currentVersion}`,
      };
      if (resumeBytes > 0) headers.Range = `bytes=${resumeBytes}-`;
      const response = await this.fetchImpl(asset.browser_download_url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || !response.body)
        throw new Error(`Download returned HTTP ${response.status}`);

      // GitHub/CDN should answer a Range request with 206. If a proxy ignores
      // Range and sends 200, restart safely from byte zero rather than appending
      // a duplicate full payload to the partial file.
      const resumed = resumeBytes > 0 && response.status === 206;
      if (resumeBytes > 0 && !resumed) {
        resumeBytes = 0;
        await rm(partial, { force: true }).catch(() => undefined);
      }
      const file = await open(partial, resumed ? "a" : "w");
      let downloaded = resumeBytes;
      let lastPublish = 0;
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          await file.write(value);
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
              message: resumed
                ? `Resuming ${asset.name}…`
                : `Downloading ${asset.name}…`,
            });
          }
        }
      } finally {
        await file.close();
      }

      if (asset.size > 0 && downloaded !== asset.size) {
        if (downloaded > asset.size)
          await rm(partial, { force: true }).catch(() => undefined);
        throw new Error(
          `Downloaded ${downloaded} bytes, expected ${asset.size} bytes`,
        );
      }
      const actualSha256 = await hashFile(partial);
      if (expectedSha256 && actualSha256 !== expectedSha256) {
        await rm(partial, { force: true }).catch(() => undefined);
        throw new Error(
          "SHA-256 digest from GitHub does not match the download",
        );
      }

      await rm(destination, { force: true }).catch(() => undefined);
      await rename(partial, destination);
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
          ? resumed
            ? "Update resumed and SHA-256 verified. Ready to restart."
            : "Update downloaded and SHA-256 verified. Ready to restart."
          : "Update downloaded from GitHub. Ready to restart.",
      });
      return this.getState();
    } catch (error) {
      // Keep a valid-sized partial download so a network interruption can resume
      // next time. Corrupt/oversized data is explicitly removed above.
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

async function verifiedCachedAsset(
  file: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  if (expectedSize > 0 && info.size !== expectedSize) return false;
  return (await hashFile(file).catch(() => "")) === expectedSha256;
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex").toLowerCase();
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
  sourcePath: string;
  targetExecutable: string;
  expectedVersion?: string;
}): Promise<{ scriptPath: string; readyPath: string; logPath: string }> {
  const scriptPath = path.join(
    app.getPath("temp"),
    `qnector-apply-update-${randomUUID()}.ps1`,
  );
  const updateDir = path.dirname(input.sourcePath);
  const logPath = path.join(updateDir, "apply-update.log");
  const readyPath = path.join(updateDir, "apply-update.ready");
  await rm(logPath, { force: true }).catch(() => undefined);
  await rm(readyPath, { force: true }).catch(() => undefined);
  const script = buildWindowsUpdateScript({
    ...input,
    logPath,
    readyPath,
  });
  // Windows PowerShell 5 treats UTF-8 without a BOM as the legacy code page.
  // Add one so update paths containing non-ASCII names remain safe.
  await writeFile(scriptPath, `\uFEFF${script}`, "utf8");
  return { scriptPath, readyPath, logPath };
}

async function createUpdaterBootstrap(input: {
  powershellPath: string;
  applyScriptPath: string;
}): Promise<string> {
  const bootstrapPath = path.join(
    app.getPath("temp"),
    `qnector-update-bootstrap-${randomUUID()}.ps1`,
  );
  const script = buildWindowsUpdaterBootstrapScript(input);
  await writeFile(bootstrapPath, `\uFEFF${script}`, "utf8");
  return bootstrapPath;
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

async function waitForHelperReady(
  readyPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(readyPath, constants.F_OK);
      return;
    } catch {
      // The bootstrap is expected to exit before the independent helper does,
      // so readiness is the authoritative signal rather than bootstrap exit.
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }
  throw new Error("Update helper did not confirm readiness within 5 seconds.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
