import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonRequest } from "./client.js";
import { daemonSocketPath, DurableDaemon } from "./server.js";

const roots: string[] = [];
const daemons: DurableDaemon[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "qnector-daemon-"));
  roots.push(root);
  const daemon = new DurableDaemon(root);
  daemons.push(daemon);
  return {root, daemon};
}
async function until<T>(action: () => Promise<T>, predicate: (value: T) => boolean, ms = 12_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const result = await action();
    if (predicate(result)) return result;
    if (Date.now() > deadline) throw new Error(`TIMED_OUT: ${JSON.stringify(result)}`);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}
afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe("P2 named-pipe daemon", () => {
  it("arbitrates a single owner and rejects requests without its token", async () => {
    const {root, daemon} = fixture();
    await daemon.start();
    expect(await daemonRequest(root, {action: "ping"})).toMatchObject({ok: true, data: {state: "ready"}});
    const second = new DurableDaemon(root);
    await expect(second.start()).rejects.toThrow();
    const denied = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(daemonSocketPath(root));
      let data = "";
      socket.on("connect", () => socket.write(JSON.stringify({action: "ping", token: "forged"}) + "\n"));
      socket.setEncoding("utf8");
      socket.on("data", (part: string) => { data += part; });
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    expect(JSON.parse(denied)).toMatchObject({ok: false, error: "IPC_UNAUTHORIZED"});
    expect(await daemonRequest(root, {action: "ping"})).toMatchObject({ok: true});
  });

  it("reconnects after daemon closes, keeps the worker and retrieves exactly one result", async () => {
    const {root, daemon} = fixture();
    await daemon.start();
    const marker = path.join(root, "marker.txt");
    const input = {
      action: "submit", workspace: root, idempotencyKey: "same-request", timeoutMs: 8_000,
      command: {kind: "direct", file: process.execPath, args: ["-e",
        "const fs=require('fs');setTimeout(()=>{fs.appendFileSync(process.argv[1],'once\\n');console.log('DONE')},1000)", marker]},
    };
    const accepted = await daemonRequest(root, input);
    expect(accepted.ok).toBe(true);
    const taskId = (accepted.data as {taskId: string}).taskId;
    expect((await daemonRequest(root, input)).data).toMatchObject({taskId, reused: true});
    await until(() => daemonRequest(root, {action: "get", taskId}), result =>
      (result.data as {state?: string} | undefined)?.state === "running");
    await daemon.close(); // explicit coordinator shutdown, never task.cancel
    const resumed = new DurableDaemon(root);
    daemons.push(resumed);
    await resumed.start();
    const finished = await until(() => daemonRequest(root, {action: "get", taskId}), result =>
      (result.data as {state?: string} | undefined)?.state === "succeeded");
    expect(finished.data).toMatchObject({taskId, state: "succeeded", outcome: "known"});
    const output = await daemonRequest(root, {action: "output", taskId, stream: "stdout"});
    expect((output.data as {text: string}).text).toContain("DONE");
    expect(readFileSync(marker, "utf8")).toBe("once\n");
    expect((await daemonRequest(root, input)).data).toMatchObject({taskId, reused: true});
  });
});
