import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { DurableRunner } from "./durable-runner.js";
import { inspectWorker } from "./worker-identity.js";

/** Simulate a worker losing its manifest after OS-confirmed termination. */
describe("P2 verified worker disappearance recovery", () => {
  it("marks unknown outcome without replaying a previously claimed mutation", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-dead-worker-"));
    let child: ChildProcess | undefined;
    let runner: DurableRunner | undefined;
    try {
      runner = new DurableRunner(root);
      const input = {owner: "local", workspace: root, operation: "command.run",
        idempotencyKey: "do-not-replay", inputDigest: "test-digest",
        definitionSnapshot: {command: "external-side-effect"}};
      const task = runner.store.accept(input).task;
      const attempt = runner.store.claim(task.taskId)!;
      expect(runner.store.markStarted(attempt)).toBe(true);
      mkdirSync(path.join(root, "output", attempt.attemptId), {recursive: true});
      const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "packages/execution/dist/worker-identity.js")).href;
      const script = "const {writeWorkerIdentity}=await import(process.argv[1]);" +
        "writeWorkerIdentity(process.argv[2],JSON.parse(process.argv[3]));" +
        "process.stdout.write('READY\\n');setInterval(()=>{},1000)";
      child = spawn(process.execPath, ["--input-type=module", "-e", script, moduleUrl,
        path.join(root, "output"), JSON.stringify(attempt)], {
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const worker = child;
      await new Promise<void>((resolve, reject) => {
        let stderr = "";
        const timer = setTimeout(() => reject(new Error(`IDENTITY_TIMEOUT: ${stderr}`)), 9_000);
        worker.stdout?.once("data", () => {clearTimeout(timer); resolve();});
        worker.stderr?.on("data", (part: Buffer) => {stderr += part.toString();});
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error(`WORKER_EARLY_EXIT: ${code}: ${stderr}`)));
      });
      expect(inspectWorker(path.join(root, "output"), attempt).status).toBe("alive");
      expect(runner.inspect(task.taskId)).toMatchObject({state: "running", worker: {status: "alive"}});
      const exited = new Promise<void>(resolve => worker.once("exit", () => resolve()));
      expect(worker.kill()).toBe(true);
      await exited;
      expect(runner.inspect(task.taskId)).toMatchObject({state: "interrupted", worker: {status: "exited"}});
      expect(runner.store.get(task.taskId)).toMatchObject({state: "interrupted", outcome: "unknown"});
      expect(runner.store.pending()).toEqual([]);
      expect(runner.store.accept(input)).toMatchObject({reused: true, task: {taskId: task.taskId, state: "interrupted"}});
      expect(runner.store.claim(task.taskId)).toBeNull();
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
        child.kill();
        await exited;
      }
      runner?.close();
      rmSync(root, {recursive: true, force: true});
    }
  }, 30_000);
});
