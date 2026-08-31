import type { DesktopUpdateMode } from "../updater-types.js";

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

export interface GitHubReleaseInfo {
  tag_name: string;
  name?: string | null;
  html_url: string;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: GitHubReleaseAsset[];
}

export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "").split("+")[0] ?? "";
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.parts[index] ?? 0) - (b.parts[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function selectWindowsAsset(
  assets: GitHubReleaseAsset[],
  mode: DesktopUpdateMode,
): GitHubReleaseAsset | undefined {
  const pattern =
    mode === "installed"
      ? /^Qnector-.*-win-x64-setup\.exe$/i
      : /^Qnector-.*-win-x64-portable\.exe$/i;
  return assets.find((asset) => pattern.test(asset.name));
}

export function parseSha256Digest(digest?: string | null): string | undefined {
  if (!digest) return undefined;
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest.trim());
  return match?.[1]?.toLowerCase();
}

function parseVersion(value: string): {
  parts: [number, number, number];
  prerelease: string;
} {
  const normalized = normalizeVersion(value);
  const [core = "0", prerelease = ""] = normalized.split("-", 2);
  const values = core.split(".").map((part) => Number.parseInt(part, 10));
  return {
    parts: [values[0] || 0, values[1] || 0, values[2] || 0],
    prerelease,
  };
}

function comparePrerelease(left: string, right: string): number {
  const a = left.split(".");
  const b = right.split(".");
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index];
    const rightPart = b[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined)
      return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart) > 0 ? 1 : -1;
  }
  return 0;
}
