import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const projectRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "qnector-startup-"));
const probeFile = path.join(tempRoot, "startup.json");

try {
  await execFileAsync(
    electronPath,
    [path.join(projectRoot, "apps", "desktop", "dist", "main", "main.js")],
    {
      cwd: projectRoot,
      timeout: 12_000,
      windowsHide: true,
      env: {
        ...process.env,
        QNECTOR_STARTUP_PROBE: "1",
        QNECTOR_STARTUP_PROBE_FILE: probeFile,
      },
    },
  );
  const snapshot = JSON.parse(await readFile(probeFile, "utf8")) as {
    uptimeMs: number;
    milestones: Array<{ name: string; elapsedMs: number }>;
  };
  const milestone = (name: string): number => {
    const value = snapshot.milestones.find(
      (entry) => entry.name === name,
    )?.elapsedMs;
    if (value === undefined)
      throw new Error(`startup milestone missing: ${name}`);
    return value;
  };
  const windowCreatedMs = milestone("window-created");
  const rendererLoadedMs = milestone("renderer-loaded");
  const rendererReadyMs = milestone("renderer-ready-to-show");
  if (rendererReadyMs > 3_000)
    throw new Error(
      `renderer first-ready regressed to ${rendererReadyMs.toFixed(1)} ms`,
    );
  if (rendererLoadedMs < windowCreatedMs)
    throw new Error(
      "renderer-loaded occurred before the BrowserWindow was created",
    );
  console.log(
    JSON.stringify(
      {
        ok: true,
        startup: {
          windowCreatedMs,
          rendererLoadedMs,
          rendererReadyMs,
          budgetMs: 3_000,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
