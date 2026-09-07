import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildIdentity } from "./build-info.js";
import { ReleaseManager } from "./release-manager.js";

describe("ReleaseManager", () => {
  it("compares installed builds by app.asar payload instead of portable executable hash", async () => {
    const fixture = await createFixture("same-payload");
    try {
      const manager = new ReleaseManager({
        buildIdentity: async () => packagedIdentity(fixture.installedExe),
        resourcesPath: fixture.installedResources,
      });
      const result = await manager.status(fixture.root);

      expect(result.status).toBe("latest");
      expect(result.runningMatchesLatest).toBe(true);
      expect(result.packagedBuildCount).toBe(1);
      expect(result.latestPackaged?.fileName).toMatch(/-portable\.exe$/i);
      expect(result.latestPackaged?.payloadPath).toBe(fixture.packagedPayload);
      expect(result.latestPackaged?.payloadSha256).toMatch(/^[A-F0-9]{64}$/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports an installed build as outdated when the comparable payload differs", async () => {
    const fixture = await createFixture("different-installed-payload");
    try {
      await writeFile(
        path.join(fixture.installedResources, "app.asar"),
        "older-installed-payload",
        "utf8",
      );
      const manager = new ReleaseManager({
        buildIdentity: async () => packagedIdentity(fixture.installedExe),
        resourcesPath: fixture.installedResources,
      });
      const result = await manager.status(fixture.root);

      expect(result.status).toBe("outdated");
      expect(result.runningMatchesLatest).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("returns unknown rather than a false outdated result when no comparable installed payload exists", async () => {
    const fixture = await createFixture("missing-installed-payload");
    try {
      const missingResources = path.join(fixture.root, "missing-resources");
      const manager = new ReleaseManager({
        buildIdentity: async () => packagedIdentity(fixture.installedExe),
        resourcesPath: missingResources,
      });
      const result = await manager.status(fixture.root);

      expect(result.status).toBe("unknown");
      expect(result.runningMatchesLatest).toBeNull();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function createFixture(name: string): Promise<{
  root: string;
  installedExe: string;
  installedResources: string;
  packagedPayload: string;
}> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), `qnector-release-${name}-`),
  );
  await writeFile(
    path.join(root, "pnpm-workspace.yaml"),
    "packages: []\n",
    "utf8",
  );

  const sourceFile = path.join(root, "packages", "core", "src", "fixture.ts");
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, "export const fixture = true;\n", "utf8");

  const releaseRoot = path.join(root, "apps", "desktop", "release");
  await mkdir(releaseRoot, { recursive: true });
  const portable = path.join(releaseRoot, "Qnector-0.4.9-win-x64-portable.exe");
  const setup = path.join(releaseRoot, "Qnector-0.4.9-win-x64-setup.exe");
  await writeFile(portable, "portable-container", "utf8");
  await writeFile(setup, "setup-container", "utf8");

  const packagedPayload = path.join(
    releaseRoot,
    "win-unpacked",
    "resources",
    "app.asar",
  );
  await mkdir(path.dirname(packagedPayload), { recursive: true });
  await writeFile(packagedPayload, "same-payload", "utf8");

  const installedRoot = path.join(root, "installed", "Qnector");
  const installedExe = path.join(installedRoot, "Qnector.exe");
  const installedResources = path.join(installedRoot, "resources");
  await mkdir(installedResources, { recursive: true });
  await writeFile(installedExe, "installed-electron-exe", "utf8");
  await writeFile(
    path.join(installedResources, "app.asar"),
    "same-payload",
    "utf8",
  );

  const now = new Date();
  const old = new Date(now.getTime() - 30_000);
  await utimes(sourceFile, old, old);
  await utimes(path.join(root, "pnpm-workspace.yaml"), old, old);
  await utimes(portable, now, now);
  await utimes(setup, now, now);

  return { root, installedExe, installedResources, packagedPayload };
}

function packagedIdentity(executablePath: string): BuildIdentity {
  return {
    version: "0.4.9",
    buildId: "test-installed-build",
    builtAt: new Date().toISOString(),
    channel: "packaged",
    executablePath,
    executableSha256:
      "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    sourceRevision: null,
  };
}
