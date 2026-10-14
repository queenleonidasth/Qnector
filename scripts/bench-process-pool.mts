import { execFileSync } from "node:child_process";
import { ProcessManager } from "../packages/core/src/process-manager.js";

if (process.platform !== "win32")
  throw new Error("This benchmark requires Windows PowerShell.");

const manager = new ProcessManager("powershell");
const previous = process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
const command = "Write-Output 'qnector-pool-benchmark-fixture'";
const run = async (pooled: boolean, warmWorker = true): Promise<number> => {
  if (pooled) process.env.QNECTOR_PROCESS_RUN_WORKER_POOL = "1";
  else delete process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
  // Prime outside the measured interval for warm samples. Cold candidate
  // samples intentionally skip this and exercise the safe one-shot fallback.
  if (pooled && warmWorker)
    await manager.run({ command, cwd: process.cwd(), shell: "powershell", timeoutMs: 10_000 });
  const outcome = await manager.runOrBackground(
    { command, cwd: process.cwd(), shell: "powershell", timeoutMs: 4_500 },
    5_000,
  );
  if (outcome.background || outcome.result.exitCode !== 0 ||
      !outcome.result.stdout.includes("qnector-pool-benchmark-fixture"))
    throw new Error("Benchmark correctness oracle failed");
  return outcome.result.durationMs;
};
const percentile = (values: number[], fraction: number): number =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
const summary = (values: number[]) => ({
  n: values.length,
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
});

try {
  const warm = { baseline: [] as number[], candidate: [] as number[] };
  for (let i = 0; i < 5; i++) {
    await run(false); await run(true);
  }
  for (let i = 0; i < 30; i++) {
    const order = i % 2 === 0 ? [false, true] : [true, false];
    for (const pooled of order) warm[pooled ? "candidate" : "baseline"].push(await run(pooled));
  }
  const cold = { baseline: [] as number[], candidate: [] as number[] };
  for (let i = 0; i < 10; i++) {
    const order = i % 2 === 0 ? [false, true] : [true, false];
    for (const pooled of order) {
      await manager.stopAll();
      cold[pooled ? "candidate" : "baseline"].push(await run(pooled, false));
    }
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  process.stdout.write(`${JSON.stringify({
    commit, node: process.version, platform: process.platform,
    featureFlag: "QNECTOR_PROCESS_RUN_WORKER_POOL=1",
    correctnessOracle: "exact fixture marker, exitCode 0, complete stdout",
    warm: { baseline: summary(warm.baseline), candidate: summary(warm.candidate) },
    cold: { baseline: summary(cold.baseline), candidate: summary(cold.candidate) },
  }, null, 2)}\n`);
} finally {
  await manager.stopAll();
  if (previous === undefined) delete process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
  else process.env.QNECTOR_PROCESS_RUN_WORKER_POOL = previous;
}
