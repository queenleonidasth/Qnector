import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishOutcomeAction, verifyCachedArtifact } from "./release-preflight.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("release preflight safety helpers", () => {
  it("accepts a cache only for matching fingerprint and complete byte hash", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "qnector-release-cache-")); roots.push(root);
    const artifact = path.join(root, "asset.bin"); writeFileSync(artifact, "complete release asset");
    const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
    expect(verifyCachedArtifact({ fingerprint: "abc", expectedFingerprint: "abc", artifact, expectedSha256: digest })).toBe(true);
    expect(verifyCachedArtifact({ fingerprint: "stale", expectedFingerprint: "abc", artifact, expectedSha256: digest })).toBe(false);
    writeFileSync(artifact, "partial");
    expect(verifyCachedArtifact({ fingerprint: "abc", expectedFingerprint: "abc", artifact, expectedSha256: digest })).toBe(false);
  });
  it("never blindly retries an uncertain remote publish response", () => {
    expect(publishOutcomeAction("success")).toBe("complete");
    expect(publishOutcomeAction("definite-failure")).toMatch(/retry/);
    expect(publishOutcomeAction("lost-response")).toBe("stop-and-inspect-remote-state");
  });
  it("requires provenance fingerprint equality before any resume", () => {
    expect(verifyCachedArtifact({ fingerprint: "build-a", expectedFingerprint: "build-b", artifact: "missing", expectedSha256: "x" })).toBe(false);
    expect(publishOutcomeAction("partial-asset")).toBe("stop-and-inspect-remote-state");
  });
});
