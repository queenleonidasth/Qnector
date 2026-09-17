import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonRequest } from "./client.js";

const rootPaths: string[] = [];
const children: ChildProcess[] = [];
const cli = path.resolve(process.cwd(), "apps/daemon/dist/cli.js");

async function launch(root: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [cli], {
    cwd: process.cwd(), windowsHide: true,
    env: {...process.env, QNECTOR_DURABLE_ROOT: root},
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let diagnostics = "";
    const timer = setTimeout(() => reject(new Error(`DAEMON_START_TIMEOUT: ${diagnostics}`)), 8_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("QNECTOR_DURABLE_READY")) {clearTimeout(timer); resolve();}
    });
    child.stderr?.on("data", (chunk: Buffer) => { diagnostics += chunk.toString(); });
    child.once("error", error => {clearTimeout(timer); reject(error);});
    child.once("exit", code => {clearTimeout(timer); reject(new Error(`DAEMON_EXITED_EARLY: ${code}, ${diagnostics}`));});
  });
  return child;
}

async function until<T>(action: () => Promise<T>, predicate: (value: T) => boolean, ms = 12_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const result = await action();
    if (predicate(result)) return result;
    if (Date.now() > deadline) throw new Error(`TIMED_OUT: ${JSON.stringify(result)}`);
    await new Promise(resolve => setTimeout(resolve, 70));
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
  }
  for (const root of rootPaths.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe("P2 real daemon process termination", () => {
  it("survives coordinator termination and imports original worker completion on a new daemon", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-crash-"));
    rootPaths.push(root);
    const daemon = await launch(root);
    const marker = path.join(root, "only-once.txt");
    const input = {
      action: "submit", idempotencyKey: "crash-survival", workspace: root, timeoutMs: 8_000,
      command: {kind: "direct", file: process.execPath, args: ["-e",
        "const fs=require('fs');setTimeout(()=>{fs.appendFileSync(process.argv[1],'1\\n');process.stdout.write('DONE')},1600)", marker]},
    };
    const accepted = await daemonRequest(root, input);
    expect(accepted.ok).toBe(true);
    const taskId = (accepted.data as {taskId: string}).taskId;
    await until(() => daemonRequest(root, {action: "get", taskId}), result =>
      (result.data as {state?: string} | undefined)?.state === "running");
    const exited = new Promise<void>(resolve => daemon.once("exit", () => resolve()));
    expect(daemon.kill()).toBe(true); // Kill actual daemon PID, not the worker.
    await exited;
    const restarted = await launch(root);
    const result = await until(() => daemonRequest(root, {action: "get", taskId}), value =>
      (value.data as {state?: string} | undefined)?.state === "succeeded");
    expect(result.data).toMatchObject({taskId, state: "succeeded", outcome: "known"});
    expect(readFileSync(marker, "utf8")).toBe("1\n");
    expect((await daemonRequest(root, input)).data).toMatchObject({taskId, reused: true});
    expect((await daemonRequest(root, {action: "output", taskId, stream: "stdout"})).data)
      .toMatchObject({text: "DONE", complete: true});
    restarted.kill();
  }, 25_000);
});
