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
      cwd: process.cwd(),
      shell: "direct",
      timeoutMs: 10_000,
    });
    const controller = new AbortController();
    const waiting = manager.waitForExit(snapshot.id, 5_000, controller.signal);
    controller.abort();

    await expect(waiting).rejects.toThrow("PROCESS_CANCELED");
    expect(manager.snapshot(snapshot.id).state).toBe("running");
  });
});
