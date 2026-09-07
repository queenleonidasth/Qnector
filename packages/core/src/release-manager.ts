import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getBuildIdentity, type BuildIdentity } from "./build-info.js";

export interface PackagedBuildInfo {
  path: string;
  fileName: string;
  modifiedAt: string;
  sizeBytes: number;
  sha256?: string;
  payloadPath?: string;
  payloadSha256?: string;
}

export interface ReleaseStatus {
  running: BuildIdentity;
  releaseRoot: string;
  latestPackaged: PackagedBuildInfo | null;
  packagedBuildCount: number;
  runningMatchesLatest: boolean | null;
  sourceLatestModifiedAt: string | null;
  sourceChangedSinceLatestPackage: boolean | null;
  status: "latest" | "outdated" | "source-newer" | "development" | "unknown";
  recommendation: string;
}

export interface ReleaseManagerOptions {
  buildIdentity?: () => Promise<BuildIdentity>;
  resourcesPath?: string;
}

export class ReleaseManager {
  public constructor(private readonly options: ReleaseManagerOptions = {}) {}

  public async status(workspaceRoot: string): Promise<ReleaseStatus> {
    const running = await (this.options.buildIdentity?.() ??
      getBuildIdentity());
    const projectRoot = await findProjectRoot(workspaceRoot);
    const releaseRoot = path.join(projectRoot, "apps", "desktop", "release");
    const builds = await collectPortableBuilds(releaseRoot);
    const latestPackaged = builds[0] ?? null;
    const sourceLatestModifiedAt = await newestSourceMtime(projectRoot);
    const sourceChangedSinceLatestPackage =
      latestPackaged && sourceLatestModifiedAt
        ? Date.parse(sourceLatestModifiedAt) >
          Date.parse(latestPackaged.modifiedAt) + 1000
        : latestPackaged
          ? false
          : null;

    let runningMatchesLatest: boolean | null = null;
    if (latestPackaged && running.channel !== "development") {
      if (running.channel === "packaged") {
        const latestPayloadPath = path.join(
          releaseRoot,
          "win-unpacked",
          "resources",
          "app.asar",
        );
        const runningPayloadPath = resolveRunningPayloadPath(
          running.executablePath,
          this.options.resourcesPath,
        );
        if (
          runningPayloadPath &&
          (await exists(runningPayloadPath)) &&
          (await exists(latestPayloadPath))
        ) {
          const [runningPayloadHash, latestPayloadHash] = await Promise.all([
            hashFile(runningPayloadPath).catch(() => null),
            hashFile(latestPayloadPath).catch(() => null),
          ]);
          if (runningPayloadHash && latestPayloadHash) {
            latestPackaged.payloadPath = latestPayloadPath;
            latestPackaged.payloadSha256 = latestPayloadHash;
            runningMatchesLatest = runningPayloadHash === latestPayloadHash;
          }
        }
      } else {
        runningMatchesLatest = samePath(
          running.executablePath,
          latestPackaged.path,
        );
        if (!runningMatchesLatest && running.executableSha256) {
          const latestHash = await hashFile(latestPackaged.path).catch(
            () => null,
          );
          if (latestHash) {
            latestPackaged.sha256 = latestHash;
            runningMatchesLatest = latestHash === running.executableSha256;
          }
        }
      }
    }

    let status: ReleaseStatus["status"] = "unknown";
    let recommendation =
      "No packaged Qnector build was found under the project release directory.";
    if (running.channel === "development") {
      status = sourceChangedSinceLatestPackage ? "source-newer" : "development";
      recommendation = sourceChangedSinceLatestPackage
        ? "Source files are newer than the latest packaged build; package a new Windows build before release testing."
        : "Development runtime is active; use the latest packaged build when validating release identity.";
    } else if (latestPackaged) {
      if (sourceChangedSinceLatestPackage) {
        status = "source-newer";
        recommendation =
          "Source files changed after the latest package; rebuild/package Qnector and restart it before final validation.";
      } else if (runningMatchesLatest === true) {
        status = "latest";
        recommendation =
          running.channel === "packaged"
            ? "The running installed payload matches the newest local packaged build."
            : "The running portable executable matches the newest local portable build.";
      } else if (runningMatchesLatest === false) {
        status = "outdated";
        recommendation = `A newer local packaged build exists at ${latestPackaged.path}; restart Qnector from that build.`;
      } else {
        status = "unknown";
        recommendation =
          "A local packaged build exists, but Qnector could not compare it to the running payload reliably.";
      }
    }

    return {
      running,
      releaseRoot,
      latestPackaged,
      packagedBuildCount: builds.length,
      runningMatchesLatest,
      sourceLatestModifiedAt,
      sourceChangedSinceLatestPackage,
      status,
      recommendation,
    };
  }
}

async function findProjectRoot(input: string): Promise<string> {
  let current = path.resolve(input);
  for (let depth = 0; depth < 8; depth += 1) {
    if (await exists(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(input);
}

async function collectPortableBuilds(
  releaseRoot: string,
): Promise<PackagedBuildInfo[]> {
  const result: PackagedBuildInfo[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 2) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/^Qnector-.*-portable\.exe$/i.test(entry.name))
        continue;
      const info = await stat(absolute);
      result.push({
        path: absolute,
        fileName: entry.name,
        modifiedAt: info.mtime.toISOString(),
        sizeBytes: info.size,
      });
    }
  }
  await visit(releaseRoot, 0);
  return result.sort(
    (a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt),
  );
}

async function newestSourceMtime(projectRoot: string): Promise<string | null> {
  let newest = 0;
  let visited = 0;
  const maxEntries = 20_000;
  async function visit(directory: string): Promise<void> {
    if (visited >= maxEntries) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= maxEntries) break;
      visited += 1;
      if (
        [
          "node_modules",
          "dist",
          "release",
          ".git",
          ".pnpm-store",
          "coverage",
          "bin",
          "obj",
        ].includes(entry.name)
      )
        continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        !/\.(?:ts|tsx|js|mjs|cjs|json|yml|yaml|md|css|html|ps1|cs|csproj)$/i.test(
          entry.name,
        )
      )
        continue;
      const info = await stat(absolute).catch(() => null);
      if (info) newest = Math.max(newest, info.mtimeMs);
    }
  }
  await visit(projectRoot);
  return newest ? new Date(newest).toISOString() : null;
}

function resolveRunningPayloadPath(
  executablePath: string,
  configuredResourcesPath?: string,
): string | null {
  const runtimeResourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const candidates = [
    configuredResourcesPath,
    runtimeResourcesPath,
    path.join(path.dirname(executablePath), "resources"),
  ].filter((value): value is string => Boolean(value?.trim()));
  const unique = Array.from(
    new Set(candidates.map((value) => path.resolve(value))),
  );
  return unique.length > 0 ? path.join(unique[0]!, "app.asar") : null;
}

function samePath(a: string, b: string): boolean {
  const left = path.normalize(path.resolve(a));
  const right = path.normalize(path.resolve(b));
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex").toUpperCase();
}
