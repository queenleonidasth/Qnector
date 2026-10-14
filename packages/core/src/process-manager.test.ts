import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProcessManager } from "./process-manager.js";
import { canUsePersistentPowerShell } from "./powershell-worker.js";

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

  it("routes eligible process.run PowerShell commands through the gated pool", async () => {
    if (process.platform !== "win32") return;
    const previous = process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
    process.env.QNECTOR_PROCESS_RUN_WORKER_POOL = "1";
    manager = new ProcessManager("powershell");
    try {
      // Prime the optional worker outside the process.run wait contract. A
      // cold worker is never selected for the optimized short-command path.
      await manager.run({
        command: "Write-Output 'pool-prime'",
        cwd: process.cwd(), shell: "powershell", timeoutMs: 10_000,
      });
      const first = await manager.runOrBackground({
        command: "$env:QNECTOR_POOL_LEAK='secret'; Set-Location $env:TEMP; Write-Output 'pool-one'; Write-Output 'ภาษาไทย 😀'; Write-Error 'pool-warning'",
        cwd: process.cwd(), shell: "powershell", timeoutMs: 4_000,
      }, 5_000);
      const second = await manager.runOrBackground({
        command: "Write-Output 'pool-two'; Write-Output $env:QNECTOR_POOL_LEAK; Write-Output (Get-Location).Path",
        cwd: process.cwd(), shell: "powershell", timeoutMs: 4_000,
      }, 5_000);
      expect(first.background).toBe(false);
      expect(second.background).toBe(false);
      if (first.background || second.background) return;
      expect(first.result.stdout).toContain("pool-one");
      expect(first.result.stdout).toContain("ภาษาไทย 😀");
      expect(first.result.stderr).toContain("pool-warning");
      expect(first.result.exitCode).toBe(0);
      expect(first.result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(second.result.stdout).toContain("pool-two");
      expect(second.result.stdout).not.toContain("secret");
      expect(second.result.stdout).toContain(process.cwd());
      const overflow = await manager.runOrBackground({
        command: "Write-Output ('x' * 5000)",
        cwd: process.cwd(), shell: "powershell", timeoutMs: 4_000, maxChars: 100,
      }, 5_000);
      expect(overflow.background).toBe(false);
      if (!overflow.background) {
        expect(overflow.result.truncated).toBe(true);
        expect(overflow.result.originalSize.stdout).toBeGreaterThan(4_000);
        expect(overflow.result.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    } finally {
      if (previous === undefined) delete process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
      else process.env.QNECTOR_PROCESS_RUN_WORKER_POOL = previous;
    }
  }, 30_000);

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

  it("keeps commands that can leak global state out of the reusable worker", () => {
    expect(canUsePersistentPowerShell("$global:QNECTOR_POOL_LEAK = 'secret'")).toBe(false);
    expect(canUsePersistentPowerShell("Set-Variable -Scope Global QNECTOR_POOL_LEAK secret")).toBe(false);
    expect(canUsePersistentPowerShell("exit 17")).toBe(false);
    expect(canUsePersistentPowerShell("Read-Host 'continue?' ")).toBe(false);
  });

  it("cancels a process.run escalation through its returned process handle", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "qnector-cancel-run-"));
    manager = new ProcessManager("direct");
    const marker = path.join(directory, "must-not-exist.txt");
    try {
      const outcome = await manager.runOrBackground({
        command: `"${process.execPath}" -e "setTimeout(() => require('fs').writeFileSync('${marker.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}','ran'), 5000)"`,
        cwd: directory, shell: "direct", timeoutMs: 10_000,
      }, 50);
      expect(outcome.background).toBe(true);
      if (!outcome.background) return;
      const stopped = await manager.stop(outcome.snapshot.id);
      expect(stopped.state).toBe("stopped");
      await expect(rm(marker)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("handles spaces, quotes, and Unicode in pooled PowerShell paths", async () => {
    if (process.platform !== "win32") return;
    const directory = await mkdtemp(path.join(os.tmpdir(), "qnector path "));
    const previous = process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
    process.env.QNECTOR_PROCESS_RUN_WORKER_POOL = "1";
    manager = new ProcessManager("powershell");
    const file = path.join(directory, "a 'quoted' ภาษา.txt");
    await writeFile(file, "path-ok", "utf8");
    const literalPath = file.replace(/'/g, "''");
    try {
      const outcome = await manager.runOrBackground({
        command: `Get-Content -LiteralPath '${literalPath}'`,
        cwd: directory, shell: "powershell", timeoutMs: 4_000,
      }, 5_000);
      expect(outcome.background).toBe(false);
      if (!outcome.background) expect(outcome.result.stdout).toContain("path-ok");
    } finally {
      await manager.stopAll();
      if (previous === undefined) delete process.env.QNECTOR_PROCESS_RUN_WORKER_POOL;
      else process.env.QNECTOR_PROCESS_RUN_WORKER_POOL = previous;
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

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
