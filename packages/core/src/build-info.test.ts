import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("identifies the headless Node runtime without reporting Node's hash or build date as Qnector's", async () => {
  vi.stubEnv("PORTABLE_EXECUTABLE_FILE", " ");
  vi.stubEnv("QNECTOR_BUILD_TIME", undefined);
  vi.stubEnv("QNECTOR_BUILD_ID", undefined);
  vi.stubEnv("QNECTOR_BUILD_PROVENANCE_FILE", undefined);
  const { getBuildIdentity } = await import("./build-info.js");
  const identity = await getBuildIdentity();
  expect(identity.channel).toBe("development");
  expect(identity.builtAt).toBeNull();
  expect(identity.executableSha256).toBeNull();
  expect(identity.buildId).toBe("dev");
  expect(identity.sourceRevision).toBeNull();
  expect(identity.dirtyTree).toBeNull();
  expect(identity.lockfileSha256).toBeNull();
  expect(identity.provenanceSha256).toBeNull();
});

it("preserves portable build hashing and explicit build metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qnector-build-qc-"));
  try {
    const executable = path.join(root, "Qnector.exe");
    await writeFile(executable, "portable fixture");
    vi.stubEnv("PORTABLE_EXECUTABLE_FILE", executable);
    vi.stubEnv("QNECTOR_BUILD_TIME", "2026-09-12T00:00:00Z");
    vi.stubEnv("QNECTOR_BUILD_ID", "qc-build");
    const { getBuildIdentity } = await import("./build-info.js");
    const identity = await getBuildIdentity();
    expect(identity.channel).toBe("portable");
    expect(identity.buildId).toBe("qc-build");
    expect(identity.builtAt).toBe("2026-09-12T00:00:00Z");
    expect(identity.executableSha256).toBe(
      createHash("sha256")
        .update("portable fixture")
        .digest("hex")
        .toUpperCase(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("loads packaged source revision, dirty marker, and lockfile digest from provenance manifest", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "qnector-build-provenance-"),
  );
  try {
    const executable = path.join(root, "Qnector.exe");
    const provenance = path.join(root, "build-provenance.json");
    const manifest = {
      version: 1,
      generatedAt: "2026-09-13T12:00:00.000Z",
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      dirtyTree: true,
      lockfileSha256:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    };
    const raw = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(executable, "portable fixture");
    await writeFile(provenance, raw);
    vi.stubEnv("PORTABLE_EXECUTABLE_FILE", executable);
    vi.stubEnv("QNECTOR_BUILD_PROVENANCE_FILE", provenance);
    const { getBuildIdentity } = await import("./build-info.js");
    const identity = await getBuildIdentity();
    expect(identity.sourceRevision).toBe(manifest.sourceRevision);
    expect(identity.dirtyTree).toBe(true);
    expect(identity.lockfileSha256).toBe(manifest.lockfileSha256);
    expect(identity.provenanceSha256).toBe(
      createHash("sha256").update(raw).digest("hex").toUpperCase(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
