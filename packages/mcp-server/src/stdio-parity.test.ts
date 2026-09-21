import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { DurableDaemon } from "../../../apps/daemon/src/server.js";
import { ActivityLogger } from "../../core/src/activity-log.js";
import { defaultConfig } from "../../core/src/config.js";
import { QnectorRuntime } from "./server.js";

let runtime: QnectorRuntime | undefined;
let daemon: DurableDaemon | undefined;
let root: string | undefined;
let stdio: StdioRpc | undefined;

type RpcResponse = {
  id: number;
  result?: {
    tools?: Array<{ name: string; inputSchema: unknown }>;
    structuredContent?: { ok: boolean; data?: Record<string, unknown> };
  };
  error?: unknown;
};
class StdioRpc {
  private readonly input = new PassThrough();
  private readonly output = new PassThrough();
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private nextId = 1;
  public readonly transport = new StdioServerTransport(this.input, this.output);
  public readonly errors: Error[] = [];
  private readonly lines = createInterface({ input: this.output });
  public constructor() {
    this.lines.on("line", (line) => {
      try {
        const result = JSON.parse(line) as RpcResponse;
        if (typeof result.id !== "number") return;
        this.pending.get(result.id)?.(result);
        this.pending.delete(result.id);
      } catch (error) {
        this.errors.push(error as Error);
      }
    });
  }
  public request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`STDIO_TIMEOUT_${method}`));
      }, 9_000);
      this.pending.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      this.input.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }
  public notify(method: string): void {
    this.input.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }
  public async initialize(): Promise<void> {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stdio-parity", version: "1" },
    });
    if (result.error)
      throw new Error(`STDIO_INIT_FAILED: ${JSON.stringify(result.error)}`);
    this.notify("notifications/initialized");
  }
  public close(): void {
    this.lines.close();
    this.input.destroy();
    this.output.destroy();
  }
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function http(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcResponse> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method, params }),
  });
  const raw = await response.text();
  const data = raw.split(/\r?\n/).find((line) => line.startsWith("data:"));
  return JSON.parse(data ? data.slice(5).trim() : raw) as RpcResponse;
}
const task = (action: string, additional: Record<string, unknown> = {}) => ({
  name: "tasks",
  arguments: { action, ...additional },
});

afterEach(async () => {
  await runtime?.stop();
  stdio?.close();
  await daemon?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  runtime = undefined;
  stdio = undefined;
  daemon = undefined;
  root = undefined;
});

describe("P4 HTTP and stdio share one durable execution backend", () => {
  it("advertises identical tools and retrieves HTTP-submitted work after stdio disconnect without replay", async () => {
    root = mkdtempSync(path.join(tmpdir(), "qnector-stdio-parity-"));
    const daemonRoot = path.join(root, "daemon");
    daemon = new DurableDaemon(daemonRoot);
    await daemon.start();
    const port = await freePort();
    runtime = new QnectorRuntime({
      config: { ...defaultConfig(root), localPort: port },
      configFile: path.join(root, "config.json"),
      logger: new ActivityLogger(path.join(root, "activity.jsonl")),
      durableDaemonRoot: daemonRoot,
    });
    await runtime.start({ port });
    stdio = new StdioRpc();
    await runtime.startStdio({
      transport: stdio.transport,
      onerror: (error) => stdio?.errors.push(error),
    });
    await stdio.initialize();
    const httpTools = (await http(port, "tools/list")).result?.tools;
    const stdioTools = (await stdio.request("tools/list")).result?.tools;
    expect(stdioTools?.map((tool) => tool.name)).toEqual(
      httpTools?.map((tool) => tool.name),
    );
    expect(
      stdioTools?.find((tool) => tool.name === "tasks")?.inputSchema,
    ).toEqual(httpTools?.find((tool) => tool.name === "tasks")?.inputSchema);
    expect(stdioTools?.some((tool) => tool.name === "social")).toBe(true);
    const socialCall = { name: "social", arguments: { action: "health" } };
    const socialHttp = (await http(port, "tools/call", socialCall)).result
      ?.structuredContent;
    const socialStdio = (await stdio.request("tools/call", socialCall)).result
      ?.structuredContent;
    expect(socialHttp?.ok).toBe(true);
    expect(socialStdio?.data).toMatchObject({
      status: "disabled",
      operation: "health",
    });
    expect(
      (
        await http(port, "tools/call", {
          name: "social",
          arguments: { action: "search", platform: "facebook", query: "test" },
        })
      ).result?.structuredContent,
    ).toMatchObject({ ok: false, error: { code: "CHANNEL_DISABLED" } });
    const marker = path.join(root, "effect.txt");
    const request = task("start", {
      idempotencyKey: "shared-across-transports",
      waitTimeoutMs: 0,
      command: {
        kind: "direct",
        file: process.execPath,
        args: [
          "-e",
          "setTimeout(()=>{require('fs').appendFileSync(process.argv[1],'ONE\\n');console.log('PARITY_OK')},750)",
          marker,
        ],
      },
    });
    const accepted = (await http(port, "tools/call", request)).result
      ?.structuredContent;
    expect(accepted?.ok).toBe(true);
    const taskId = String(accepted?.data?.taskId);
    expect(taskId).toMatch(/^task_/);
    const reused = (await stdio.request("tools/call", request)).result
      ?.structuredContent;
    expect(reused?.data).toMatchObject({ taskId, reused: true });
    // Close stdio while the job is still active. Its broken transport is only
    // a subscriber; the HTTP frontend must recover the original task unchanged.
    stdio.close();
    const waited = (
      await http(
        port,
        "tools/call",
        task("wait", { taskId, waitTimeoutMs: 6_000 }),
      )
    ).result?.structuredContent;
    expect(waited?.data).toMatchObject({ taskId, state: "succeeded" });
    const result = (await http(port, "tools/call", task("result", { taskId })))
      .result?.structuredContent;
    expect(result?.data).toMatchObject({ state: "succeeded" });
    const output = (
      await http(
        port,
        "tools/call",
        task("output", { taskId, stream: "stdout" }),
      )
    ).result?.structuredContent;
    expect(output?.data).toMatchObject({ text: "PARITY_OK\n", complete: true });
    expect(readFileSync(marker, "utf8")).toBe("ONE\n");
    expect(stdio.errors).toHaveLength(0);
  }, 20_000);
});
