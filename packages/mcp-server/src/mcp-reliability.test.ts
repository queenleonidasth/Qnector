import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolResult } from "@qnector/shared";
import { attachSseHeartbeat, boundMcpToolResult, MCP_RESULT_BUDGET_BYTES } from "./mcp-reliability.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});
const result = (data: unknown, attachments?: ToolResult["attachments"]): ToolResult => ({
  ok: true, tool: "files", action: "read", summary: "File was read", data,
  meta: {durationMs: 4, truncated: false, nextCursor: "next-page"},
  ...(attachments ? {attachments} : {}),
});

describe("MCP output bounds and transport hygiene", () => {
  it("preserves ordinary JSON and its original continuation metadata", () => {
    const input = result({text: "small"});
    expect(boundMcpToolResult(input)).toBe(input);
  });

  it("omits oversized JSON without changing execution truth or losing a safe task handle", () => {
    const bounded = boundMcpToolResult(result({taskId: "task_abc", text: "📄".repeat(MCP_RESULT_BUDGET_BYTES)}));
    expect(bounded).toMatchObject({ok: true, summary: "File was read",
      data: {taskId: "task_abc", payloadOmitted: true, reason: "structured-data"},
      meta: {truncated: true, nextCursor: "next-page"}});
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThan(MCP_RESULT_BUDGET_BYTES);
    expect(JSON.stringify(bounded)).not.toContain("📄");
  });

  it("omits an oversized image rather than corrupting the MCP frame", () => {
    const bounded = boundMcpToolResult(result({state: "succeeded"}, [{type: "image", mimeType: "image/png",
      dataBase64: "x".repeat(2 * 1024 * 1024 + 1)}]));
    expect(bounded.ok).toBe(true);
    expect(bounded.attachments).toBeUndefined();
    expect(bounded.meta.truncated).toBe(true);
  });

  it("emits SSE comments only after SSE headers and never inserts bytes into JSON", async () => {
    server = createServer((req, res) => {
      const stop = attachSseHeartbeat(res, 20);
      if (req.url === "/stream") {
        res.writeHead(200, {"content-type": "text/event-stream; charset=utf-8"});
        res.flushHeaders();
        setTimeout(() => {stop(); res.end("event: complete\ndata: {}\n\n");}, 85);
      } else {
        res.writeHead(200, {"content-type": "application/json"});
        res.flushHeaders();
        setTimeout(() => res.end('{"ok":true}'), 85);
      }
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [stream, json] = await Promise.all([
      fetch(`${url}/stream`).then(response => response.text()),
      fetch(`${url}/json`).then(response => response.text()),
    ]);
    expect(stream).toContain(": qnector-keepalive\n\n");
    expect(stream).toContain("event: complete\ndata: {}\n\n");
    expect(json).toBe('{"ok":true}');
  });

  it("never inserts a heartbeat into an unfinished SSE data frame", async () => {
    server = createServer((_req, res) => {
      const stop = attachSseHeartbeat(res, 15);
      res.writeHead(200, {"content-type": "text/event-stream"});
      res.write('data: {"value":');
      setTimeout(() => res.write('1}\n\n'), 60);
      setTimeout(() => {stop(); res.end('event: done\ndata: {}\n\n');}, 110);
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const stream = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      .then(response => response.text());
    expect(stream).toContain('data: {"value":1}\n\n');
    expect(stream.indexOf(": qnector-keepalive")).toBeGreaterThan(stream.indexOf('data: {"value":1}\n\n'));
    expect(stream).toContain('event: done\ndata: {}\n\n');
  });
});
