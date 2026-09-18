import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityLogger } from "../../core/src/activity-log.js";
import { defaultConfig } from "../../core/src/config.js";
import { QnectorRuntime } from "./server.js";
import { TimelineLogger, type TimelineEvent } from "./timeline-logger.js";
import { runTimeoutProbe } from "./timeout-probe.js";

let runtime: QnectorRuntime | undefined;
let root: string | undefined;
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
  if (root) await rm(root, {recursive: true, force: true});
  root = undefined;
});

async function events(file: string): Promise<TimelineEvent[]> {
  return (await readFile(file, "utf8")).trim().split("\n")
    .map(line => JSON.parse(line) as TimelineEvent);
}

describe("MCP timeline diagnostics", () => {
  it("probe returns quickly for zero-duration, requires a real progress token and keeps progress monotonic", async () => {
    const sent: number[] = [];
    const notify = async (event: {params: {progress: number}}) => {sent.push(event.params.progress);};
    const plain = await runTimeoutProbe({durationSec: 0, mode: "silent", notify});
    expect(plain).toMatchObject({ok: true, progressSent: 0, mode: "silent"});
    await expect(runTimeoutProbe({durationSec: 0, mode: "progress", notify}))
      .rejects.toThrow("PROGRESS_TOKEN_MISSING");
    const withProgress = await runTimeoutProbe({durationSec: 0, mode: "both",
      progressToken: "probe-1", notify});
    expect(withProgress.progressSent).toBe(1);
    expect(sent).toEqual([1]);
  });

  it("writes metadata-only ordered NDJSON with a stable clock and async context", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-timeline-unit-"));
    const file = path.join(root, "logs", "test.ndjson");
    const logger = new TimelineLogger(file);
    const span = logger.start("rpc-123");
    await logger.run(span, async () => {
      expect(logger.current()).toBe(span);
      logger.record(logger.current(), "request_received", {method: "POST"});
      await Promise.resolve();
      logger.record(logger.current(), "tool_end", {ok: true}, "system");
    });
    await logger.flush();
    const lines = await events(file);
    expect(lines.map(line => line.phase)).toEqual(["request_received", "tool_end"]);
    expect(lines.every(line => line.requestId === "rpc-123" && line.tSinceRequestMs >= 0)).toBe(true);
    expect(lines[1]!.tSinceRequestMs).toBeGreaterThanOrEqual(lines[0]!.tSinceRequestMs);
    expect(lines[1]!.toolName).toBe("system");
    expect(JSON.stringify(lines)).not.toContain("stdout");
  });

  it("correlates HTTP receive, tool execution, write, flush and close without logging tool output", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-timeline-http-"));
    const file = path.join(root, "logs", "test.ndjson");
    runtime = new QnectorRuntime({
      config: {...defaultConfig(root), localPort: 0},
      configFile: path.join(root, "config.json"),
      timelineLogFile: file,
      enableTimeoutProbe: true,
      logger: new ActivityLogger(path.join(root, "activity.jsonl")),
    });
    await runtime.start({port: 0});
    const port = (runtime.app.server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/mcp`;
    const call = async (payload: unknown): Promise<Response> => {
      const response = await fetch(url, {method: "POST", headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
      }, body: JSON.stringify(payload)});
      expect(response.ok).toBe(true);
      await response.text();
      return response;
    };
    await call({jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: {name: "timeline-test", version: "1"},
    }});
    const response = await call({jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "system", arguments: {action: "status"},
    }});
    const id = response.headers.get("x-qnector-trace-id");
    expect(id).toBeTruthy();
    const probe = await call({jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: "system.timeout_probe", arguments: {durationSec: 0, mode: "silent"},
    }});
    expect(probe.headers.get("x-qnector-trace-id")).toBeTruthy();
    await runtime.stop();
    runtime = undefined;
    const related = (await events(file)).filter(event => event.requestId === id);
    for (const phase of ["request_received", "rpc_parsed", "tool_start", "tool_end",
      "response_written", "response_flushed", "stream_closed"] as const) {
      expect(related.map(event => event.phase), `missing ${phase}`).toContain(phase);
    }
    expect(related.find(event => event.phase === "tool_start")?.toolName).toBe("system");
    expect(related.find(event => event.phase === "rpc_parsed")?.detail?.rpcId).toBe("2");
    expect(JSON.stringify(related)).not.toContain("arguments");
    const probeEvents = (await events(file)).filter(event =>
      event.requestId === probe.headers.get("x-qnector-trace-id"));
    expect(probeEvents.some(event => event.phase === "tool_end" &&
      event.toolName === "system.timeout_probe")).toBe(true);
  });
});
