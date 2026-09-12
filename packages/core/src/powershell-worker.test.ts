import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProcessManager } from "./process-manager.js";
import { shutdownPowerShellWorkers } from "./powershell-worker.js";

afterEach(async () => {
  await shutdownPowerShellWorkers();
});

describe.skipIf(process.platform !== "win32")(
  "persistent PowerShell execution",
  () => {
    it("runs independent PowerShell jobs concurrently instead of serializing them in one host", async () => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "qnector-shell-parallel-"),
      );
      const manager = new ProcessManager("powershell");
      const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
      try {
        const results = await Promise.all(
          ["a", "b"].map((name) => {
            const own = literal(path.join(root, `${name}.ready`));
            const peer = literal(
              path.join(root, `${name === "a" ? "b" : "a"}.ready`),
            );
            return manager.run({
              command: `[IO.File]::WriteAllText(${own}, 'ready'); $watch = [Diagnostics.Stopwatch]::StartNew(); while (!(Test-Path -LiteralPath ${peer}) -and $watch.ElapsedMilliseconds -lt 5000) { Start-Sleep -Milliseconds 20 }; if (!(Test-Path -LiteralPath ${peer})) { throw 'parallel peer never started' }; Write-Output $PID`,
              cwd: root,
              shell: "powershell",
              timeoutMs: 12_000,
              outputMode: "raw",
            });
          }),
        );
        expect(results.every((result) => result.exitCode === 0)).toBe(true);
        expect(
          new Set(results.map((result) => result.stdout.trim())).size,
        ).toBe(2);
      } finally {
        await shutdownPowerShellWorkers();
        await rm(root, { recursive: true, force: true });
      }
    }, 20_000);

    it("bounds a burst to four workers and keeps each command's output separate", async () => {
      const manager = new ProcessManager("powershell");
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          manager.run({
            command: `Start-Sleep -Milliseconds 80; Write-Output \"job-${i}:$PID\"`,
            cwd: process.cwd(),
            shell: "powershell",
            timeoutMs: 10_000,
            outputMode: "raw",
          }),
        ),
      );
      expect(results.every((result) => result.exitCode === 0)).toBe(true);
      results.forEach((result, i) =>
        expect(result.stdout.trim()).toMatch(new RegExp(`^job-${i}:\\d+$`)),
      );
      expect(
        new Set(results.map((result) => result.stdout.trim().split(":")[1]))
          .size,
      ).toBe(4);
    }, 20_000);

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

    it("settles active and queued commands when the pool shuts down", async () => {
      const manager = new ProcessManager("powershell");
      const settled = Promise.allSettled(
        Array.from({ length: 8 }, () =>
          manager.run({
            command: "Start-Sleep -Seconds 30",
            cwd: process.cwd(),
            shell: "powershell",
            timeoutMs: 40_000,
          }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await shutdownPowerShellWorkers();
      const results = await settled;
      expect(results.every((result) => result.status === "rejected")).toBe(
        true,
      );
    }, 10_000);

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
