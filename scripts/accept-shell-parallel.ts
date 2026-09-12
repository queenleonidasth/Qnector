import assert from "node:assert/strict";
import { ProcessManager } from "../packages/core/src/process-manager.js";
import { shutdownPowerShellWorkers } from "../packages/core/src/powershell-worker.js";

if (process.platform !== "win32")
  throw new Error("Windows PowerShell benchmark required");
const manager = new ProcessManager("powershell");
const run = (command: string) =>
  manager.run({
    command,
    cwd: process.cwd(),
    shell: "powershell",
    timeoutMs: 15_000,
    outputMode: "raw",
  });
try {
  // Warm both measurements; compare scheduling rather than interpreter startup.
  await Promise.all(Array.from({ length: 4 }, () => run("Write-Output $PID")));
  const command = "Start-Sleep -Milliseconds 1000; Write-Output $PID";
  const sequentialStart = performance.now();
  const sequential = [];
  for (let i = 0; i < 4; i += 1) sequential.push(await run(command));
  const sequentialMs = performance.now() - sequentialStart;
  const parallelStart = performance.now();
  const parallel = await Promise.all(
    Array.from({ length: 4 }, () => run(command)),
  );
  const parallelMs = performance.now() - parallelStart;
  assert([...sequential, ...parallel].every((result) => result.exitCode === 0));
  const workers = new Set(parallel.map((result) => result.stdout.trim()));
  assert.equal(
    workers.size,
    4,
    "independent jobs must run in separate PowerShell workers",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        jobs: 4,
        waitPerJobMs: 1000,
        workers: workers.size,
        sequentialMs: Math.round(sequentialMs),
        parallelMs: Math.round(parallelMs),
        speedup: Number((sequentialMs / parallelMs).toFixed(2)),
      },
      null,
      2,
    ),
  );
} finally {
  await shutdownPowerShellWorkers();
}
