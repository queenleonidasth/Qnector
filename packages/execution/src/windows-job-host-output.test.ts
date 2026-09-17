import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { DurableRunner } from "./durable-runner.js";

const jobHost = path.resolve(process.cwd(), "packages/execution/job-host/dist/qnector-job-host.exe");
const workerScript = path.resolve(process.cwd(), "packages/execution/dist/worker-main.js");
const cleanup: Array<() => void> = [];
afterEach(() => { for (const item of cleanup.splice(0).reverse()) item(); });

async function until(task: () => ReturnType<DurableRunner["get"]>) {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const result = task();
    if (result && ["succeeded", "failed", "interrupted"].includes(result.state)) return result;
    if (Date.now() > deadline) throw new Error(`JOB_HOST_RESULT_TIMEOUT: ${JSON.stringify(result)}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const windowsIt = process.platform === "win32" ? it : it.skip;
windowsIt("retains stdout and stderr, exit codes and completion manifests through suspended Windows Job Host", async () => {
  expect(existsSync(jobHost)).toBe(true);
  const root = mkdtempSync(path.join(tmpdir(), "qnector-job-host-output-"));
  cleanup.push(() => rmSync(root, {recursive: true, force: true}));
  const runner = new DurableRunner(root, {workerScript, jobHostPath: jobHost});
  cleanup.push(() => runner.close());
  const failed = runner.submit({workspace: root, idempotencyKey: "exit-7", timeoutMs: 8_000,
    command: {kind: "direct", file: process.execPath,
      args: ["-e", "process.stdout.write('HOST_OUT');process.stderr.write('HOST_ERR');process.exitCode=7"]}});
  const failedResult = await until(() => runner.get(failed.task.taskId));
  expect(failedResult.state).toBe("failed");
  expect(failedResult.resultManifest).toMatch(/completion\.json$/);
  expect(runner.output(failed.task.taskId, "stdout").text).toBe("HOST_OUT");
  expect(runner.output(failed.task.taskId, "stderr").text).toBe("HOST_ERR");
  const passed = runner.submit({workspace: root, idempotencyKey: "exit-0", timeoutMs: 8_000,
    command: {kind: "direct", file: process.execPath,
      args: ["-e", "process.stdout.write('HOST_OK')"]}});
  const passedResult = await until(() => runner.get(passed.task.taskId));
  expect(passedResult.state).toBe("succeeded");
  expect(runner.output(passed.task.taskId, "stdout").text).toBe("HOST_OK");
}, 25_000);
