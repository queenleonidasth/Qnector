import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonRequest } from "./client.js";
import { daemonAuthToken, daemonSocketPath, DurableDaemon } from "./server.js";

const roots: string[] = [];
const daemons: DurableDaemon[] = [];
afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe("P3 bounded waiting over durable IPC", () => {
  it("returns a task handle when wait times out and does not kill work on subscription disconnect", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-wait-"));
    roots.push(root);
    const daemon = new DurableDaemon(root);
    daemons.push(daemon);
    await daemon.start();
    const accepted = await daemonRequest(root, {
      action: "submit", workspace: root, idempotencyKey: "wait-demo", timeoutMs: 5_000,
      command: {kind: "direct", file: process.execPath,
        args: ["-e", "setTimeout(()=>process.stdout.write('WAIT_OK'),750)"]},
    });
    const taskId = (accepted.data as {taskId: string}).taskId;
    const bounded = await daemonRequest(root, {action: "wait", taskId, waitTimeoutMs: 50});
    expect(bounded).toMatchObject({ok: true, data: {taskId, nextAction: "wait"}});
    const socket = net.createConnection(daemonSocketPath(root));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(JSON.stringify({action: "wait", token: daemonAuthToken(root), taskId, waitTimeoutMs: 20_000}) + "\n", () => {
          socket.destroy();
          resolve();
        });
      });
      socket.once("error", reject);
    });
    const completed = await daemonRequest(root, {action: "wait", taskId, waitTimeoutMs: 5_000}, 7_000);
    expect(completed).toMatchObject({ok: true, data: {taskId, state: "succeeded", nextAction: "result"}});
    const result = await daemonRequest(root, {action: "result", taskId});
    expect(result).toMatchObject({ok: true, data: {state: "succeeded", manifest: {exitCode: 0}}});
    expect((await daemonRequest(root, {action: "output", taskId, stream: "stdout"})).data)
      .toMatchObject({text: "WAIT_OK", complete: true});
    expect(await daemonRequest(root, {action: "wait", taskId, waitTimeoutMs: 20_001}))
      .toMatchObject({ok: false, error: "INVALID_INPUT: waitTimeoutMs must be 0..20000"});
  }, 15_000); // Windows Job Host startup can exceed Vitest's 5-second default.
});
