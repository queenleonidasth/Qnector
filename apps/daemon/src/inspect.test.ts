import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonRequest } from "./client.js";
import { DurableDaemon } from "./server.js";

const roots: string[] = [];
const daemons: DurableDaemon[] = [];
afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

async function until<T>(action: () => Promise<T>, predicate: (result: T) => boolean, ms = 12_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const result = await action();
    if (predicate(result)) return result;
    if (Date.now() > deadline) throw new Error(`TIMED_OUT: ${JSON.stringify(result)}`);
    await new Promise(resolve => setTimeout(resolve, 90));
  }
}

describe("P2 diagnostic identity inspection over authenticated IPC", () => {
  it("verifies live OS identity, fails closed on tampering and preserves an original completed task", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-inspect-"));
    roots.push(root);
    const daemon = new DurableDaemon(root);
    daemons.push(daemon);
    await daemon.start();
    const input = {action: "submit", workspace: root, idempotencyKey: "inspect-once", timeoutMs: 8_000,
      command: {kind: "direct", file: process.execPath,
        args: ["-e", "setTimeout(()=>process.stdout.write('FINISHED'),3000)"]}};
    const accepted = await daemonRequest(root, input);
    expect(accepted.ok).toBe(true);
    const taskId = (accepted.data as {taskId: string}).taskId;
    const live = await until(() => daemonRequest(root, {action: "inspect", taskId}), value =>
      (value.data as {worker?: {status?: string}} | undefined)?.worker?.status === "alive");
    expect(live.data).toMatchObject({taskId, state: "running", worker: {status: "alive"}});
    const attemptId = (await daemonRequest(root, {action: "get", taskId})).data as {attemptId: string};
    const identityFile = path.join(root, "output", attemptId.attemptId, "worker-identity.json");
    const original = readFileSync(identityFile, "utf8");
    try {
      writeFileSync(identityFile, JSON.stringify({...JSON.parse(original) as object, started: "win:1"}));
      const unsafe = await daemonRequest(root, {action: "inspect", taskId});
      expect(unsafe.data).toMatchObject({state: "running", worker: {status: "unverified"}});
    } finally {writeFileSync(identityFile, original);}
    const finished = await until(() => daemonRequest(root, {action: "get", taskId}), value =>
      (value.data as {state?: string} | undefined)?.state === "succeeded");
    expect(finished.data).toMatchObject({taskId, state: "succeeded"});
    expect((await daemonRequest(root, input)).data).toMatchObject({taskId, reused: true});
    expect((await daemonRequest(root, {action: "inspect", taskId})).data)
      .toMatchObject({taskId, state: "succeeded", worker: null});
  }, 30_000);
});
