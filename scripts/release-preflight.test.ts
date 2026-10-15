import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectReleaseInputs, publishOutcomeAction, verifyCachedArtifact } from "./release-preflight.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("release preflight safety helpers", () => {
  it("uses the supplied independent repository root for all Git and hash checks", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "qnector-scoped-preflight-"));
    roots.push(directory);
    execFileSync("git", ["init", "--quiet", directory]);
    writeFileSync(path.join(directory, "pnpm-lock.yaml"), "lockfile fixture v1\n");
    execFileSync("git", ["add", "pnpm-lock.yaml"], { cwd: directory });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost.invalid",
      "commit", "--quiet", "-m", "fixture"], { cwd: directory });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
    const observed = await collectReleaseInputs({ root: directory, minimumFreeBytes: 0 });
    expect(observed.inputs.revision).toBe(revision);
    expect(observed.inputs.dirtyState).toBe("clean");
    expect(observed.inputs.lockfileSha256).toBe(
      createHash("sha256").update(readFileSync(path.join(directory, "pnpm-lock.yaml"))).digest("hex"),
    );
    writeFileSync(path.join(directory, "untracked.txt"), "untracked");
    const dirty = await collectReleaseInputs({ root: directory, minimumFreeBytes: 0 });
    expect(dirty.inputs.dirtyState).not.toBe("clean");
  });

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
