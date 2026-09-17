import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableRunner } from "./durable-runner.js";

const roots: string[] = [];
const runners: DurableRunner[] = [];
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});
async function until<T>(read: () => T, done: (value: T) => boolean, ms = 12_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`TIMED_OUT: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}

describe("Durable cancellation races", () => {
  it("cancels a queued job without dispatching it or replaying its side effects", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-queue-cancel-"));
    roots.push(root);
    const runner = new DurableRunner(root, {
      workerScript: path.resolve(process.cwd(), "packages/execution/dist/worker-main.js"), concurrency: 1,
    });
    runners.push(runner);
    const first = runner.submit({workspace: root, idempotencyKey: "first", timeoutMs: 6_000,
      command: {kind: "direct", file: process.execPath,
        args: ["-e", "setTimeout(()=>process.stdout.write('DONE'),550)"]}}).task;
    const marker = path.join(root, "must-not-run.txt");
    const second = runner.submit({workspace: root, idempotencyKey: "second", timeoutMs: 6_000,
      command: {kind: "direct", file: process.execPath,
        args: ["-e", "require('fs').writeFileSync(process.argv[1],'wrong')", marker]}}).task;
    expect(second.state).toBe("queued");
    expect(runner.cancel(second.taskId).state).toBe("canceled");
    expect(runner.cancel(second.taskId).state).toBe("canceled");
    await until(() => runner.get(first.taskId), task => task?.state === "succeeded");
    expect(existsSync(marker)).toBe(false);
    expect(runner.store.pending()).not.toContain(second.taskId);
    expect(runner.store.events(second.taskId).map(event => event.name)).toEqual(["accepted", "canceled"]);
  });
});
