import { afterEach, describe, expect, it } from "vitest";
import { ProcessManager } from "./process-manager.js";
import { shutdownPowerShellWorkers } from "./powershell-worker.js";

afterEach(async () => {
  await shutdownPowerShellWorkers();
});

describe.skipIf(process.platform !== "win32")(
  "persistent PowerShell execution",
  () => {
    it("reuses a warm PowerShell host without changing command output", async () => {
      const manager = new ProcessManager("powershell");
      const first = await manager.run({
        command: "Write-Output qnector-cold",
        cwd: process.cwd(),
        shell: "powershell",
        timeoutMs: 10_000,
        outputMode: "raw",
      });
      const second = await manager.run({
        command: "Write-Output qnector-warm",
        cwd: process.cwd(),
        shell: "powershell",
        timeoutMs: 10_000,
        outputMode: "raw",
      });
      expect(first.exitCode).toBe(0);
      expect(first.stdout.trim()).toBe("qnector-cold");
      expect(second.exitCode).toBe(0);
      expect(second.stdout.trim()).toBe("qnector-warm");
      expect(second.durationMs).toBeLessThan(1_000);
    }, 15_000);

    it("resets a timed-out worker and accepts the next command", async () => {
      const manager = new ProcessManager("powershell");
      const timedOut = await manager.run({
        command: "Start-Sleep -Seconds 5",
        cwd: process.cwd(),
        shell: "powershell",
        timeoutMs: 250,
        outputMode: "raw",
      });
      expect(timedOut.exitCode).toBeNull();
      const recovered = await manager.run({
        command: "Write-Output recovered",
        cwd: process.cwd(),
        shell: "powershell",
        timeoutMs: 10_000,
        outputMode: "raw",
      });
      expect(recovered.exitCode).toBe(0);
      expect(recovered.stdout.trim()).toBe("recovered");
    }, 20_000);

    it("routes common command shims through cmd instead of PowerShell", async () => {
      const manager = new ProcessManager("powershell");
      const result = await manager.run({
        command: "corepack --version",
        cwd: process.cwd(),
        shell: "powershell",
        timeoutMs: 5_000,
        outputMode: "raw",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+/);
      expect(result.durationMs).toBeLessThan(1_500);
    });
  },
);
