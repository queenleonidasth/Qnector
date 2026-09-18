import { afterEach, describe, expect, it } from "vitest";
import { ProcessManager } from "./process-manager.js";

describe("ProcessManager request-bound waits", () => {
  let manager: ProcessManager | undefined;

  afterEach(async () => {
    await manager?.stopAll();
    manager = undefined;
  });

  it("cancels a wait without canceling the background process", async () => {
    manager = new ProcessManager("direct");
    const snapshot = manager.start({
      command: `"${process.execPath}" -e "setTimeout(() => {}, 5000)"`,
      cwd: process.cwd(), shell: "direct", timeoutMs: 10_000,
    });
    const controller = new AbortController();
    const waiting = manager.waitForExit(snapshot.id, 5_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("PROCESS_CANCELED");
    expect(manager.snapshot(snapshot.id).state).toBe("running");
  });

  it("returns short command output and preserves stderr and hash", async () => {
    manager = new ProcessManager("direct");
    const outcome = await manager.runOrBackground({
      command: `"${process.execPath}" -e "console.log('ready'); console.error('WARNING')"`,
      cwd: process.cwd(), shell: "direct", timeoutMs: 5_000,
    }, 2_000);
    expect(outcome.background).toBe(false);
    if (outcome.background) return;
    expect(outcome.result.exitCode).toBe(0);
    expect(outcome.result.stdout).toContain("ready");
    expect(outcome.result.stderr).toContain("WARNING");
    expect(outcome.result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("escalates once and exposes the completed output through its process ID", async () => {
    manager = new ProcessManager("direct");
    const outcome = await manager.runOrBackground({
      command: `"${process.execPath}" -e "setTimeout(() => console.log('FINISHED_ONCE'), 400)"`,
      cwd: process.cwd(), shell: "direct", timeoutMs: 5_000,
    }, 100);
    expect(outcome.background).toBe(true);
    if (!outcome.background) return;
    const finished = await manager.waitForExit(outcome.snapshot.id, 3_000);
    expect(finished.state).toBe("exited");
    expect(finished.exitCode).toBe(0);
    expect(manager.output(outcome.snapshot.id, 0).text).toContain("FINISHED_ONCE");
  });

  it("does not kill explicit start tasks when their request timeout elapses", async () => {
    manager = new ProcessManager("direct");
    const snapshot = manager.start({
      command: `"${process.execPath}" -e "setTimeout(() => console.log('SERVER_DONE'), 800)"`,
      cwd: process.cwd(), shell: "direct", timeoutMs: 100,
    });
    await new Promise<void>(resolve => setTimeout(resolve, 250));
    expect(manager.snapshot(snapshot.id).state).toBe("running");
    expect((await manager.waitForExit(snapshot.id, 3_000)).state).toBe("exited");
  });

  it("kills an expired background child and never calls it successful", async () => {
    manager = new ProcessManager("direct");
    const outcome = await manager.runOrBackground({
      command: `"${process.execPath}" -e "setTimeout(() => {}, 5000)"`,
      cwd: process.cwd(), shell: "direct", timeoutMs: 300,
    }, 100);
    expect(outcome.background).toBe(true);
    if (!outcome.background) return;
    const finished = await manager.waitForExit(outcome.snapshot.id, 3_000);
    expect(finished.state).toBe("failed");
    expect(manager.output(outcome.snapshot.id, 0).text).toContain("COMMAND_TIMEOUT");
  });
});
