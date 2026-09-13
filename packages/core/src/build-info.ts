import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { QNECTOR_VERSION } from "./config.js";

export interface BuildIdentity {
  version: string;
  buildId: string;
  builtAt: string | null;
  channel: "portable" | "packaged" | "development";
  executablePath: string;
  executableSha256: string | null;
  sourceRevision: string | null;
  dirtyTree: boolean | null;
  lockfileSha256: string | null;
  provenanceSha256: string | null;
}

interface BuildProvenanceManifest {
  version: 1;
  generatedAt: string;
  sourceRevision: string;
  dirtyTree: boolean;
  lockfileSha256: string;
}

let cachedBuildIdentity: Promise<BuildIdentity> | undefined;

export function getBuildIdentity(): Promise<BuildIdentity> {
  cachedBuildIdentity ??= loadBuildIdentity();
  return cachedBuildIdentity;
}

async function loadBuildIdentity(): Promise<BuildIdentity> {
  const channel: BuildIdentity["channel"] =
    process.env.PORTABLE_EXECUTABLE_FILE?.trim()
      ? "portable"
      : !process.versions.electron ||
          (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp
        ? "development"
        : "packaged";
  const executablePath = resolveExecutablePath();
  // A Node/Electron development host is not the Qnector build payload.
  const info =
    channel === "development"
      ? null
      : await stat(executablePath).catch(() => null);
  const builtAt =
    process.env.QNECTOR_BUILD_TIME ?? info?.mtime.toISOString() ?? null;
  const executableSha256 =
    channel !== "development" && existsSync(executablePath)
      ? await hashFile(executablePath).catch(() => null)
      : null;
  const provenance = await loadBuildProvenance(channel);
  const buildId =
    process.env.QNECTOR_BUILD_ID ??
    [formatBuildTime(builtAt), executableSha256?.slice(0, 10)]
      .filter(Boolean)
      .join("-");
  return {
    version: QNECTOR_VERSION,
    buildId,
    builtAt,
    channel,
    executablePath,
    executableSha256,
    sourceRevision:
      process.env.QNECTOR_SOURCE_REVISION ??
      provenance?.manifest.sourceRevision ??
      null,
    dirtyTree: provenance?.manifest.dirtyTree ?? null,
    lockfileSha256: provenance?.manifest.lockfileSha256 ?? null,
    provenanceSha256: provenance?.sha256 ?? null,
  };
}

async function loadBuildProvenance(
  channel: BuildIdentity["channel"],
): Promise<{ manifest: BuildProvenanceManifest; sha256: string } | null> {
  const explicit = process.env.QNECTOR_BUILD_PROVENANCE_FILE?.trim();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = [
    ...(explicit ? [path.resolve(explicit)] : []),
    ...(channel !== "development" && resourcesPath
      ? [path.join(resourcesPath, "build-provenance.json")]
      : []),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate);
      const parsed = JSON.parse(
        raw.toString("utf8"),
      ) as Partial<BuildProvenanceManifest>;
      if (
        parsed.version !== 1 ||
        typeof parsed.generatedAt !== "string" ||
        typeof parsed.sourceRevision !== "string" ||
        !/^[0-9a-f]{40}$/i.test(parsed.sourceRevision) ||
        typeof parsed.dirtyTree !== "boolean" ||
        typeof parsed.lockfileSha256 !== "string" ||
        !/^[0-9a-f]{64}$/i.test(parsed.lockfileSha256)
      )
        continue;
      return {
        manifest: parsed as BuildProvenanceManifest,
        sha256: createHash("sha256").update(raw).digest("hex").toUpperCase(),
      };
    } catch {
      // Provenance is additive. A missing/invalid manifest must not prevent startup.
    }
  }
  return null;
}

function resolveExecutablePath(): string {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE?.trim();
  if (portable) return path.resolve(portable);
  return path.resolve(process.execPath);
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolve());
    stream.once("error", reject);
  });
  return hash.digest("hex").toUpperCase();
}

function formatBuildTime(value: string | null): string {
  if (!value) return "dev";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "dev";
  const part = (number: number): string => String(number).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}
