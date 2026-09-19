import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OutputSpool } from "./output-spool.js";
const roots: string[] = [];
function fixture(cap = 1024) {
  const root = mkdtempSync(path.join(tmpdir(), "qnector-spool-"));
  roots.push(root);
  const id = `attempt_${randomUUID()}`;
  return { root, id, spool: new OutputSpool(root, id, cap) };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Durable output spool (P1)", () => {
  it("reads independent byte cursors and does not split UTF-8 across pages", () => {
    const { spool } = fixture();
    spool.append("stdout", Buffer.from("A😀B"));
    spool.append("stderr", Buffer.from("warning"));
    expect(spool.page("stdout", 0, 4)).toMatchObject({
      text: "A",
      nextCursor: 1,
      complete: false,
    });
    expect(spool.page("stdout", 1, 4)).toMatchObject({
      text: "😀",
      nextCursor: 5,
    });
    expect(spool.page("stdout", 5, 4)).toMatchObject({
      text: "B",
      nextCursor: 6,
    });
    expect(spool.page("stderr", 0, 10).text).toBe("warning");
    const { manifest } = spool.finalize(0, null);
    expect(manifest).toMatchObject({
      exitCode: 0,
      stdoutBytes: 6,
      stderrBytes: 7,
      outputState: "complete",
    });
    expect(spool.page("stdout", 6, 4).complete).toBe(true);
    expect(() => spool.append("stdout", Buffer.from("again"))).toThrow(
      "OUTPUT_FINALIZED",
    );
  });

  it("bounds spool bytes, records partial output and survives recreation", () => {
    const { root, id, spool } = fixture(5);
    spool.append("stdout", Buffer.from("1234"));
    spool.append("stderr", Buffer.from("ABCDEFG"));
    const result = spool.finalize(1, null);
    expect(result.manifest).toMatchObject({
      stdoutBytes: 4,
      stderrBytes: 1,
      droppedBytes: 6,
      outputState: "partial",
    });
    expect(readFileSync(result.path, "utf8")).toContain(
      '"outputState":"partial"',
    );
    const reopen = new OutputSpool(root, id, 5);
    expect(reopen.manifest()).toEqual(result.manifest);
    expect(reopen.page("stdout", 0, 4).truncated).toBe(true);
    expect(reopen.page("stderr", 0, 4)).toMatchObject({
      text: "A",
      complete: true,
    });
    expect(() => reopen.page("stdout", 99)).toThrow("OUTPUT_CURSOR_INVALID");
  });

  it("rejects traversal IDs and duplicate completion", () => {
    const { root, spool } = fixture();
    expect(() => new OutputSpool(root, "../../etc")).toThrow("INVALID_INPUT");
    spool.finalize(null, "SIGTERM");
    expect(() => spool.finalize(null, null)).toThrow("OUTPUT_FINALIZED");
  });

  (process.platform === "win32" ? it : it.skip)(
    "finalizes after a temporary Windows exclusive spool-file lock",
    async () => {
      const { root, id, spool } = fixture();
      spool.append("stdout", Buffer.from("READY_TO_CANCEL\n"));
      const file = path.join(root, id, "stdout.spool");
      const script =
        "$s=[System.IO.File]::Open($env:QNECTOR_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); [Console]::WriteLine('LOCKED'); Start-Sleep -Milliseconds 450; $s.Dispose()";
      const locker = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          windowsHide: true,
          env: { ...process.env, QNECTOR_LOCK_FILE: file },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("LOCKER_NOT_READY")),
            8000,
          );
          locker.stdout?.on("data", (chunk: Buffer) => {
            if (chunk.toString().includes("LOCKED")) {
              clearTimeout(timeout);
              resolve();
            }
          });
          locker.once("error", reject);
          locker.once("exit", (code) => {
            if (code !== 0) reject(new Error(`LOCKER_EXIT_${code}`));
          });
        });
        expect(spool.finalize(null, "SIGTERM", true).manifest).toMatchObject({
          canceled: true,
          stdoutBytes: 16,
        });
      } finally {
        await new Promise<void>((resolve) => {
          if (locker.exitCode !== null) resolve();
          else locker.once("close", () => resolve());
        });
      }
    },
    15000,
  );
});
