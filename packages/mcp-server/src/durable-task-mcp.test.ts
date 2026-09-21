import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableDaemon } from "../../../apps/daemon/src/server.js";
import { defaultConfig } from "../../core/src/config.js";
import { QnectorRuntime } from "./server.js";
import { executeDurableTask } from "./durable-task-tool.js";

const roots: string[] = [];
const daemons: DurableDaemon[] = [];
const runtimes: QnectorRuntime[] = [];
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
  return (data ? JSON.parse(data.slice(5).trim()) : JSON.parse(text)) as {
    result?: {
      tools?: Array<{ name: string }>;
      structuredContent?: {
        ok: boolean;
        data?: Record<string, unknown>;
        error?: { code: string };
      };
    };
  };
}
async function call(
  port: number,
  action: string,
  input: Record<string, unknown> = {},
) {
  const response = await rpc(port, "tools/call", {
    name: "tasks",
    arguments: { action, ...input },
  });
  return response.result?.structuredContent;
}
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("opt-in durable MCP task facade", () => {
  it("leaves the legacy eight-tool contract unchanged without opt-in", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qnector-mcp-default-"));
    roots.push(workspace);
    const port = await freePort();
    const runtime = new QnectorRuntime({
      config: { ...defaultConfig(workspace), localPort: port },
    });
    runtimes.push(runtime);
    await runtime.start({ port });
    const listed = await rpc(port, "tools/list");
    expect(listed.result?.tools?.map((tool) => tool.name)).toHaveLength(9);
    expect(listed.result?.tools?.map((tool) => tool.name)).not.toContain(
      "tasks",
    );
  });

  it("accepts once, auto-yields a handle, reconnects for result and exposes explicit cancel", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "qnector-mcp-optin-"));
    roots.push(workspace);
    const daemonRoot = path.join(workspace, "isolated-daemon");
    const daemon = new DurableDaemon(daemonRoot);
    daemons.push(daemon);
    await daemon.start();
    const port = await freePort();
    const runtime = new QnectorRuntime({
      config: { ...defaultConfig(workspace), localPort: port },
      durableDaemonRoot: daemonRoot,
    });
    runtimes.push(runtime);
    await runtime.start({ port });
    expect(
      (await rpc(port, "tools/list")).result?.tools?.map((tool) => tool.name),
    ).toContain("tasks");
    const doctor = await call(port, "doctor");
    expect(doctor?.ok).toBe(true);
    expect(doctor?.data).toMatchObject({
      state: "ready",
      protocol: 1,
      storage: {
        schemaVersion: 1,
        journalMode: "wal",
        synchronous: 2,
        integrity: "ok",
      },
    });
    expect(JSON.stringify(doctor)).not.toContain("daemon-token");
    const marker = path.join(workspace, "once.txt");
    // Omitting waitTimeoutMs must acknowledge immediately and return a handle.
    const input = {
      idempotencyKey: "retry-the-same",
      timeoutMs: 8_000,
      command: {
        kind: "direct",
        file: process.execPath,
        args: [
          "-e",
          "const fs=require('fs');setTimeout(()=>{fs.appendFileSync(process.argv[1],'ONE\\n');console.log('DONE')},650)",
          marker,
        ],
      },
    };
    const accepted = await call(port, "start", input);
    expect(accepted?.ok).toBe(true);
    const taskId = String(accepted?.data?.taskId);
    expect(taskId).toMatch(/^task_/);
    const foreignWorkspace = path.join(workspace, "another-workspace");
    for (const action of [
      "get",
      "wait",
      "output",
      "result",
      "inspect",
      "cancel",
    ]) {
      const denied = await executeDurableTask(daemonRoot, foreignWorkspace, {
        action,
        taskId,
        stream: "stdout",
        waitTimeoutMs: 0,
      });
      expect(denied).toMatchObject({
        ok: false,
        error: { code: "TASK_NOT_FOUND" },
      });
    }
    const duplicate = await call(port, "start", input);
    expect(duplicate?.data).toMatchObject({ taskId, reused: true });
    expect((await call(port, "inspect", { taskId }))?.ok).toBe(true);
    const waited = await call(port, "wait", { taskId, waitTimeoutMs: 7_000 });
    expect(waited?.data).toMatchObject({
      taskId,
      state: "succeeded",
      nextAction: "result",
    });
    expect((await call(port, "result", { taskId }))?.data).toMatchObject({
      state: "succeeded",
    });
    expect(
      (await call(port, "output", { taskId, stream: "stdout" }))?.data,
    ).toMatchObject({ text: "DONE\n", complete: true });
    expect(readFileSync(marker, "utf8")).toBe("ONE\n");
    const canceled = await call(port, "start", {
      idempotencyKey: "cancel-this",
      waitTimeoutMs: 0,
      command: {
        kind: "direct",
        file: process.execPath,
        args: ["-e", "setTimeout(()=>console.log('SHOULD_NOT_FINISH'),10000)"],
      },
    });
    expect(canceled).toMatchObject({ ok: true });
    const cancelId = String(canceled?.data?.taskId);
    const cancelResponse = await call(port, "cancel", { taskId: cancelId });
    if (!cancelResponse?.ok)
      throw new Error(`CANCEL_RESPONSE: ${JSON.stringify(cancelResponse)}`);
    expect(cancelResponse?.data?.state).toMatch(/canceled|canceling/);
    expect(
      (await call(port, "wait", { taskId: cancelId, waitTimeoutMs: 8_000 }))
        ?.data,
    ).toMatchObject({ state: "canceled" });
  }, 25_000);
});
