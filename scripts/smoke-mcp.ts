import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { defaultConfig } from "../packages/core/src/config.js";
import { QnectorRuntime } from "../packages/mcp-server/src/server.js";

const workspace = await mkdtemp(path.join(tmpdir(), "qnector-smoke-"));
const port = await freePort();
const config = defaultConfig(workspace);
const runtime = new QnectorRuntime({
  config: { ...config, localPort: port },
  configFile: path.join(workspace, "config.json"),
});
await runtime.start({ port });
const endpoint = runtime.status().localUrl;
let sessionId: string | undefined;
let requestId = 0;

try {
  const initialize = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "qnector-smoke", version: "0.1.0" },
  });
  assert(initialize.result, "initialize did not return a result");
  const listed = await call("tools/list", {});
  const tools =
    (listed.result as { tools?: Array<{ name: string }> }).tools ?? [];
  assert(
    tools.length === 8,
    `expected 8 grouped tools, received ${tools.length}`,
  );
  const info = await call("tools/call", {
    name: "system",
    arguments: { action: "info" },
  });
  assert(info.result, "system.info failed");
  const write = await call("tools/call", {
    name: "files",
    arguments: {
      action: "write",
      path: "smoke.txt",
      content: "Qnector smoke passed\n",
    },
  });
  assert(write.result, "files.write failed");
  const read = await call("tools/call", {
    name: "files",
    arguments: { action: "read", path: "smoke.txt" },
  });
  assert(read.result, "files.read failed");
  const checkpoint = await call("tools/call", {
    name: "memory",
    arguments: {
      action: "save_checkpoint",
      label: "smoke",
      currentTask: "Validate Qnector MCP runtime",
      completedSteps: [],
      pendingSteps: [],
      criticalContext:
        "Exercise the MCP memory write/read path during smoke validation.",
    },
  });
  assert(checkpoint.result, "memory.save_checkpoint failed");
  const memory = await call("tools/call", {
    name: "memory",
    arguments: { action: "recall" },
  });
  assert(memory.result, "memory.recall failed");
  const process = await call("tools/call", {
    name: "process",
    arguments: {
      action: "run",
      command: "node --version",
      shell: "direct",
      timeoutMs: 30_000,
    },
  });
  assert(process.result, "process.run failed");
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        tools: tools.map((tool) => tool.name),
        workspace,
        checks: [
          "initialize",
          "tools/list",
          "system.info",
          "files.write/read",
          "memory.save_checkpoint/recall",
          "process.run",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await runtime.stop();
  await rm(workspace, { recursive: true, force: true });
}

async function call(
  method: string,
  params: unknown,
): Promise<{ result?: unknown; error?: unknown }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  const nextSession = response.headers.get("mcp-session-id");
  if (nextSession) sessionId = nextSession;
  const raw = await response.text();
  const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith("data:"));
  const parsed = dataLine
    ? (JSON.parse(dataLine.slice(5).trim()) as {
        result?: unknown;
        error?: unknown;
      })
    : (JSON.parse(raw) as { result?: unknown; error?: unknown });
  if (!response.ok || parsed.error)
    throw new Error(`${method} failed: ${JSON.stringify(parsed.error ?? raw)}`);
  if (
    method === "tools/call" &&
    parsed.result &&
    typeof parsed.result === "object" &&
    (parsed.result as { isError?: boolean }).isError === true
  )
    throw new Error(
      `${method} returned a tool error: ${JSON.stringify(parsed.result)}`,
    );
  return parsed;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
