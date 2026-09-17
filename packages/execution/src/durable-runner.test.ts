import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableRunner } from "./durable-runner.js";

const roots: string[] = [];
const runners: DurableRunner[] = [];
const workerScript = path.resolve(process.cwd(), "packages/execution/dist/worker-main.js");

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "qnector-runner-"));
  roots.push(root);
  const runner = new DurableRunner(root, {workerScript});
  runners.push(runner);
  return {root, runner};
}

async function until<T>(action: () => T, predicate: (value: T) => boolean, ms = 12_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const result = action();
    if (predicate(result)) return result;
    if (Date.now() > deadline) throw new Error(`TIMED_OUT: ${JSON.stringify(result)}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe("P2 detached worker and manifest recovery", () => {
  it("runs a real child, persists output, and deduplicates submission while active", async () => {
    const {root, runner} = fixture();
    const input = {
      workspace: root, idempotencyKey: "run-once", timeoutMs: 8_000,
      command: {kind: "direct" as const, file: process.execPath,
        args: ["-e", "setTimeout(() => { process.stdout.write('HELLO'); process.stderr.write('WARN') }, 200)"]},
    };
    const accepted = runner.submit(input);
    expect(runner.submit(input)).toMatchObject({reused: true, task: {taskId: accepted.task.taskId}});
    const completed = await until(() => runner.get(accepted.task.taskId), task => task?.state === "succeeded");
    expect(completed?.resultManifest).toMatch(/completion\.json$/);
    expect(runner.output(accepted.task.taskId, "stdout").text).toBe("HELLO");
    expect(runner.output(accepted.task.taskId, "stderr").text).toBe("WARN");
    expect(runner.store.events(accepted.task.taskId).map(event => event.name))
      .toEqual(["accepted", "claimed", "started", "succeeded"]);
    expect(runner.store.activeAttempts()).toHaveLength(0);
  });

  it("reads completion from original worker after coordinator closes and reopens without replay", async () => {
    const {root, runner} = fixture();
    const marker = path.join(root, "counter.txt");
    const script = "const fs=require('fs');setTimeout(()=>{fs.appendFileSync(process.argv[1],'ONE\\n');process.stdout.write('RECOVERED')},1200)";
    const accepted = runner.submit({
      workspace: root, idempotencyKey: "survival", timeoutMs: 8_000,
      command: {kind: "direct", file: process.execPath, args: ["-e", script, marker]},
    });
    await until(() => runner.get(accepted.task.taskId), task => task?.state === "running");
    runner.close(); // Does not kill or stop the worker.
    const recovered = new DurableRunner(root, {workerScript});
    runners.push(recovered);
    recovered.recover();
    const finished = await until(() => recovered.get(accepted.task.taskId), task => task?.state === "succeeded");
    expect(finished?.attemptId).toBe(accepted.task.attemptId ?? recovered.store.get(accepted.task.taskId)?.attemptId);
    expect(recovered.output(accepted.task.taskId, "stdout").text).toBe("RECOVERED");
    const fs = await import("node:fs");
    expect(fs.readFileSync(marker, "utf8")).toBe("ONE\n");
    expect(recovered.store.pending()).toHaveLength(0);
  });
});
