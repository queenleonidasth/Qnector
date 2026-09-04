import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  ActivityLogger,
  MemoryStore,
  ProcessManager,
  shutdownPowerShellWorkers,
  WindowsUiAutomationService,
} from "../packages/core/src/index.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "qnector-performance-"));
const checks: Record<string, unknown> = {};

try {
  const previousSmartDirect = process.env.QNECTOR_SMART_DIRECT;
  try {
    process.env.QNECTOR_SMART_DIRECT = "0";
    const shellManager = new ProcessManager("powershell");
    const shellResult = await shellManager.run({
      command: "git status --short",
      cwd: projectRoot,
      timeoutMs: 10_000,
      outputMode: "raw",
    });

    process.env.QNECTOR_SMART_DIRECT = "1";
    const smartManager = new ProcessManager("powershell");
    const smartResult = await smartManager.run({
      command: "git status --short",
      cwd: projectRoot,
      timeoutMs: 10_000,
      outputMode: "raw",
    });
    if (shellResult.exitCode !== 0 || smartResult.exitCode !== 0)
      throw new Error("process benchmark command failed");
    const normalizeNewlines = (value: string) =>
      value.replace(/\r\n/g, "\n").trimEnd();
    if (
      normalizeNewlines(shellResult.stdout) !==
      normalizeNewlines(smartResult.stdout)
    )
      throw new Error("smart direct changed git command output");

    const fallbackResult = await smartManager.run({
      command: "$value = 'shell-fallback-ok'; Write-Output $value",
      cwd: projectRoot,
      timeoutMs: 10_000,
      outputMode: "raw",
    });
    if (!fallbackResult.stdout.includes("shell-fallback-ok"))
      throw new Error("PowerShell syntax did not fall back to PowerShell");
    if (process.platform === "win32" && fallbackResult.durationMs >= 1_000)
      throw new Error(
        `persistent PowerShell warm command regressed to ${fallbackResult.durationMs} ms`,
      );

    checks.process = {
      powershellColdMs: shellResult.durationMs,
      powershellWarmMs: fallbackResult.durationMs,
      smartDirectMs: smartResult.durationMs,
      sameOutput: true,
      shellFallback: true,
      persistentPowerShell: process.platform === "win32",
    };
  } finally {
    if (previousSmartDirect === undefined)
      delete process.env.QNECTOR_SMART_DIRECT;
    else process.env.QNECTOR_SMART_DIRECT = previousSmartDirect;
  }

  const memoryRoot = path.join(tempRoot, "memory");
  const firstMemory = new MemoryStore(tempRoot, { rootDirectory: memoryRoot });
  const secondMemory = new MemoryStore(tempRoot, { rootDirectory: memoryRoot });
  await firstMemory.upsertNote({ key: "performance-cache", value: "before" });
  const warmDurations: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    const started = performance.now();
    await firstMemory.recall({
      factLimit: 10,
      checkpointLimit: 1,
      changeLimit: 1,
    });
    warmDurations.push(performance.now() - started);
  }
  await secondMemory.upsertNote({ key: "performance-cache", value: "after" });
  const externallyUpdated = await firstMemory.getFact({
    key: "performance-cache",
  });
  if (externallyUpdated?.value !== "after")
    throw new Error(
      "memory mtime invalidation did not observe external update",
    );
  checks.memory = {
    warmAverageMs:
      Math.round(
        (warmDurations.reduce((sum, value) => sum + value, 0) /
          warmDurations.length) *
          100,
      ) / 100,
    externalInvalidation: true,
  };

  const activityPath = path.join(tempRoot, "large-activity.jsonl");
  const activityLines = Array.from({ length: 15_000 }, (_, index) =>
    JSON.stringify({
      id: `perf-${index}`,
      timestamp: new Date(1_700_000_000_000 + index).toISOString(),
      tool: "process",
      action: "run",
      argsSummary: JSON.stringify({ index }),
      status: "success",
      durationMs: index % 20,
      summary: `entry-${index}`,
    }),
  ).join("\n");
  await writeFile(activityPath, `${activityLines}\n`, "utf8");
  const activity = new ActivityLogger(activityPath, 500, 20_000_000);
  const activityStarted = performance.now();
  const loadedActivity = await activity.load();
  const activityMs = performance.now() - activityStarted;
  if (
    loadedActivity.length !== 500 ||
    loadedActivity.at(-1)?.id !== "perf-14999"
  )
    throw new Error("activity tail load returned the wrong history window");
  checks.activity = {
    sourceEntries: 15_000,
    loadedEntries: loadedActivity.length,
    tailLoadMs: Math.round(activityMs * 100) / 100,
  };

  if (process.platform === "win32") {
    const helperPath = path.join(
      projectRoot,
      "tools",
      "uia-helper",
      "publish",
      "qnector-uia.exe",
    );
    const beforePids = await uiHelperPids();
    const service = new WindowsUiAutomationService({ helperPath });
    const coldStarted = performance.now();
    const firstWindows = await service.windows(5);
    const coldMs = performance.now() - coldStarted;
    await delay(80);
    const afterFirst = await uiHelperPids();
    const workerPids = afterFirst.filter((pid) => !beforePids.includes(pid));
    if (workerPids.length !== 1)
      throw new Error(
        `expected one persistent UIA worker, found ${workerPids.length}`,
      );

    const warmStarted = performance.now();
    const secondWindows = await service.windows(5);
    const warmMs = performance.now() - warmStarted;
    const afterSecond = await uiHelperPids();
    if (!afterSecond.includes(workerPids[0]!))
      throw new Error("UIA worker was restarted between consecutive calls");
    await service.close?.();
    await delay(250);
    const afterClose = await uiHelperPids();
    if (afterClose.includes(workerPids[0]!))
      throw new Error("UIA worker remained alive after close");
    checks.uia = {
      workerPid: workerPids[0],
      reusedWorker: true,
      coldMs: Math.round(coldMs * 100) / 100,
      warmMs: Math.round(warmMs * 100) / 100,
      firstWindows: firstWindows.length,
      secondWindows: secondWindows.length,
      closedCleanly: true,
    };
  }

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await shutdownPowerShellWorkers();
  await rm(tempRoot, { recursive: true, force: true });
}

async function uiHelperPids(): Promise<number[]> {
  const script =
    "@(Get-CimInstance Win32_Process -Filter \"Name='qnector-uia.exe'\" | Select-Object -ExpandProperty ProcessId) -join ','";
  const result = await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  return result.stdout
    .trim()
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
