import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonRequest } from "./client.js";
import { DurableDaemon } from "./server.js";

const daemons: DurableDaemon[] = [];
const roots: string[] = [];
async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "qnector-cancel-"));
  roots.push(root);
  const daemon = new DurableDaemon(root);
  daemons.push(daemon);
  await daemon.start();
  return { root, daemon };
}
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 12_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= deadline)
      throw new Error(`TIMED_OUT: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
}
afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("P2 explicit cancellation", () => {
  it("cancels a running command and grandchild without reporting canceled before the kill manifest", async () => {
    const { root, daemon } = await fixture();
    const marker = path.join(root, "delayed-grandchild.txt");
    const grandchild =
      "setTimeout(()=>require('fs').appendFileSync(process.argv[1],'late'),1800)";
    const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)},process.argv[1]],{windowsHide:true,stdio:'ignore'});console.log('SPAWNED');setInterval(()=>{},100)`;
    const accepted = await daemonRequest(root, {
      action: "submit",
      workspace: root,
      idempotencyKey: "cancel-tree",
      timeoutMs: 8_000,
      command: {
        kind: "direct",
        file: process.execPath,
        args: ["-e", parent, marker],
      },
    });
    expect(accepted.ok).toBe(true);
    const taskId = (accepted.data as { taskId: string }).taskId;
    await until(
      () => daemonRequest(root, { action: "output", taskId, stream: "stdout" }),
      (result) =>
        (result.data as { text?: string } | undefined)?.text?.includes(
          "SPAWNED",
        ) === true,
    );
    const requested = await daemonRequest(root, { action: "cancel", taskId });
    expect(requested).toMatchObject({
      ok: true,
      data: { taskId, state: "canceling" },
    });
    const completed = await until(
      () => daemonRequest(root, { action: "get", taskId }),
      (result) =>
        (result.data as { state?: string } | undefined)?.state === "canceled",
    );
    expect(completed.data).toMatchObject({
      state: "canceled",
      outcome: "known",
    });
    // A detached worker writes a completion manifest; the daemon can import it after closure.
    expect(
      (await daemonRequest(root, { action: "result", taskId })).data,
    ).toMatchObject({
      state: "canceled",
      manifest: { canceled: true, signal: "SIGTERM" },
    });
    await daemon.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it("persists a cancel request across coordinator shutdown and imports the worker's cancel evidence", async () => {
    const { root, daemon } = await fixture();
    const accepted = await daemonRequest(root, {
      action: "submit",
      workspace: root,
      idempotencyKey: "recover-cancel",
      timeoutMs: 8_000,
      command: {
        kind: "direct",
        file: process.execPath,
        args: ["-e", "console.log('READY_TO_CANCEL');setInterval(()=>{},100)"],
      },
    });
    const taskId = (accepted.data as { taskId: string }).taskId;
    await until(
      () => daemonRequest(root, { action: "output", taskId, stream: "stdout" }),
      (result) =>
        (result.data as { text?: string } | undefined)?.text?.includes(
          "READY_TO_CANCEL",
        ) === true,
    );
    expect(
      (await daemonRequest(root, { action: "cancel", taskId })).data,
    ).toMatchObject({ state: "canceling" });
    await daemon.close();
    const resumed = new DurableDaemon(root);
    daemons.push(resumed);
    await resumed.start();
    const final = await until(
      () => daemonRequest(root, { action: "result", taskId }),
      (result) =>
        (result.data as { state?: string } | undefined)?.state === "canceled",
      20_000,
    );
    expect(final.data).toMatchObject({
      state: "canceled",
      manifest: { canceled: true },
    });
  }, 35_000);

  it("marks an orphaned worker without a manifest as unknown after daemon restart", async () => {
    const { root, daemon } = await fixture();
    const command = {
      kind: "direct" as const,
      file: process.execPath,
      args: ["-e", "console.log('WORKER_TO_KILL');setTimeout(()=>{},8000)"],
    };
    const accepted = await daemonRequest(root, {
      action: "submit",
      workspace: root,
      idempotencyKey: "dead-without-manifest",
      timeoutMs: 8000,
      command,
    });
    const taskId = (accepted.data as { taskId: string }).taskId;
    await until(
      () => daemonRequest(root, { action: "output", taskId, stream: "stdout" }),
      (value) =>
        (value.data as { text?: string } | undefined)?.text?.includes(
          "WORKER_TO_KILL",
        ) === true,
    );
    const inspected = await daemonRequest(root, { action: "inspect", taskId });
    const worker = (
      inspected.data as { worker?: { pid: number; status: string } }
    ).worker!;
    expect(worker.status).toBe("alive");
    expect(worker.pid).not.toBe(process.pid);
    await daemon.close();
    if (process.platform === "win32") {
      expect(
        spawnSync("taskkill.exe", ["/PID", String(worker.pid), "/T", "/F"], {
          windowsHide: true,
        }).status,
      ).toBe(0);
    } else {
      expect(process.kill(worker.pid)).toBe(true);
    }
    const resumed = new DurableDaemon(root);
    daemons.push(resumed);
    await resumed.start();
    const final = await until(
      () => daemonRequest(root, { action: "result", taskId }),
      (value) =>
        (value.data as { state?: string } | undefined)?.state === "interrupted",
      10_000,
    );
    expect(final.data).toMatchObject({
      state: "interrupted",
      outcome: "unknown",
      manifest: null,
    });
    expect(
      (
        await daemonRequest(root, {
          action: "submit",
          workspace: root,
          idempotencyKey: "dead-without-manifest",
          timeoutMs: 8000,
          command,
        })
      ).data,
    ).toMatchObject({ taskId, reused: true, state: "interrupted" });
  }, 25_000);
});
