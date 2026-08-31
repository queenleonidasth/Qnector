import { describe, expect, it } from "vitest";
import {
  compareVersions,
  normalizeVersion,
  parseSha256Digest,
  selectWindowsAsset,
  type GitHubReleaseAsset,
} from "./updater-core.js";

const assets: GitHubReleaseAsset[] = [
  {
    name: "Qnector-0.3.0-win-x64-setup.exe",
    browser_download_url: "https://example.test/setup.exe",
    size: 100,
  },
  {
    name: "Qnector-0.3.0-win-x64-portable.exe",
    browser_download_url: "https://example.test/portable.exe",
    size: 90,
  },
];

describe("desktop updater release selection", () => {
  it("normalizes v-prefixed versions and compares semantic versions", () => {
    expect(normalizeVersion("v0.3.0+build.1")).toBe("0.3.0");
    expect(compareVersions("0.3.0", "0.2.1")).toBe(1);
    expect(compareVersions("v0.2.1", "0.2.1")).toBe(0);
    expect(compareVersions("0.3.0-beta.2", "0.3.0")).toBe(-1);
    expect(compareVersions("0.3.0-beta.2", "0.3.0-beta.1")).toBe(1);
  });

  it("selects the matching Windows artifact for installed and portable builds", () => {
    expect(selectWindowsAsset(assets, "installed")?.name).toContain(
      "setup.exe",
    );
    expect(selectWindowsAsset(assets, "portable")?.name).toContain(
      "portable.exe",
    );
    expect(selectWindowsAsset(assets, "development")?.name).toContain(
      "portable.exe",
    );
  });

  it("accepts only GitHub-style sha256 digests", () => {
    const digest = "a".repeat(64);
    expect(parseSha256Digest(`sha256:${digest}`)).toBe(digest);
    expect(parseSha256Digest(digest)).toBeUndefined();
    expect(parseSha256Digest("sha512:abc")).toBeUndefined();
  });
});
