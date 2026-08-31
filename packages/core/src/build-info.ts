import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
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
}

export async function getBuildIdentity(): Promise<BuildIdentity> {
  const executablePath = resolveExecutablePath();
  const info = await stat(executablePath).catch(() => null);
  const builtAt =
    process.env.QNECTOR_BUILD_TIME ?? info?.mtime.toISOString() ?? null;
  const executableSha256 = existsSync(executablePath)
    ? await hashFile(executablePath).catch(() => null)
    : null;
  const buildId =
    process.env.QNECTOR_BUILD_ID ??
    [formatBuildTime(builtAt), executableSha256?.slice(0, 10) ?? "dev"]
      .filter(Boolean)
      .join("-");
  return {
    version: QNECTOR_VERSION,
    buildId,
    builtAt,
    channel: process.env.PORTABLE_EXECUTABLE_FILE
      ? "portable"
      : (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp
        ? "development"
        : "packaged",
    executablePath,
    executableSha256,
    sourceRevision: process.env.QNECTOR_SOURCE_REVISION ?? null,
  };
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
