import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableDaemon } from "../../../daemon/src/server.js";
import { ensurePreviewDaemon, watchPreviewDaemon } from "./durable-daemon.js";

const temporary: string[] = [];
const daemons: DurableDaemon[] = [];
const supervisors: Array<() => void> = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(): {root: string; bundle: string} {
  const root = mkdtempSync(path.join(tmpdir(), "qnector-desktop-preview-"));
  temporary.push(root);
  const bundle = path.join(root, "bundle");
  mkdirSync(bundle);
  return {root: path.join(root, "store"), bundle};
}
function completeBundle(bundle: string): string {
  for (const name of ["daemon.mjs", "worker-main.js", "qnector-job-host.exe"])
    writeFileSync(path.join(bundle, name), "fixture");
  return path.join(bundle, "qnector-job-host.exe");
}
afterEach(async () => {
  for (const stop of supervisors.splice(0)) stop();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe("opt-in Desktop durable daemon lifecycle", () => {
  it("fails closed for an incomplete package without starting any daemon", async () => {
    const {root, bundle} = fixture();
    await expect(ensurePreviewDaemon(root, bundle, process.execPath))
      .rejects.toThrow("DURABLE_PREVIEW_PACKAGE_INCOMPLETE");
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;
  windowsIt("reuses an independently running job-host daemon without launching a second one", async () => {
    const {root, bundle} = fixture();
    const host = completeBundle(bundle);
    const daemon = new DurableDaemon(root, {jobHostPath: host});
    daemons.push(daemon);
    await daemon.start();
    // This executable cannot launch. Reuse must happen before a spawn attempt.
    expect(await ensurePreviewDaemon(root, bundle, path.join(bundle, "nonexistent.exe"))).toBe(root);
    expect(await ensurePreviewDaemon(root, bundle, path.join(bundle, "nonexistent.exe"))).toBe(root);
  });

  it("does not attach a preview Desktop to a daemon without Job Object containment", async () => {
    const {root, bundle} = fixture();
    completeBundle(bundle);
    const daemon = new DurableDaemon(root);
    daemons.push(daemon);
    await daemon.start();
    await expect(ensurePreviewDaemon(root, bundle, process.execPath))
      .rejects.toThrow("DURABLE_DAEMON_JOB_HOST_REQUIRED");
  });

  it("supervises sequentially, deduplicates repeated errors and stops without killing work", async () => {
    const {root, bundle} = fixture();
    let calls = 0;
    let inFlight = 0;
    let maximum = 0;
    let errors = 0;
    const stop = watchPreviewDaemon(root, bundle, process.execPath, {
      intervalMs: 50,
      ensure: async () => {
        calls++;
        inFlight++;
        maximum = Math.max(maximum, inFlight);
        await delay(105);
        inFlight--;
        if (calls <= 2) throw new Error("OFFLINE");
        return root;
      },
      onError: () => {errors++;},
    });
    supervisors.push(stop);
    await delay(380);
    stop();
    const stoppedAt = calls;
    await delay(180);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBe(stoppedAt);
    expect(maximum).toBe(1);
    expect(errors).toBe(1);
  });

  it("catches asynchronous invalid-executable errors instead of crashing Desktop", async () => {
    const {root, bundle} = fixture();
    completeBundle(bundle);
    await expect(ensurePreviewDaemon(root, bundle, path.join(bundle, "nonexistent.exe")))
      .rejects.toThrow();
  });
});
