import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { defaultConfig } from "../../core/src/config.js";
import { Phase0Server } from "./phase0.js";
import { QnectorRuntime } from "./server.js";
import { toolDefinitions } from "../../tools/src/index.js";

describe("Qnector MCP runtime", () => {
  let runtime: QnectorRuntime | undefined;
  let root: string | undefined;
  afterEach(async () => {
    await runtime?.stop();
    if (root) await rm(root, { recursive: true, force: true });
    runtime = undefined;
    root = undefined;
  });

  it("serves legacy stateless and modern 2026-07-28 MCP traffic", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-mcp-"));
    const port = await freePort();
    runtime = new QnectorRuntime({
      config: { ...defaultConfig(root), localPort: port },
      configFile: path.join(root, "config.json"),
    });
    await runtime.memory.saveCheckpoint({
      currentTask: "Continue the saved Qnector task",
      completedSteps: ["Implemented the previous milestone"],
      pendingSteps: ["Run the next acceptance check"],
      criticalContext: "Do not rebuild completed roadmap features.",
      label: "automatic-bootstrap-test",
    });
    await runtime.memory.upsertNote({
      key: "release-rule",
      value:
        "Always verify the packaged build before declaring release complete.",
      category: "rule",
    });
    await runtime.start({ port });
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);

    const initialized = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(initialized.response.ok).toBe(true);
    expect(initialized.response.headers.get("mcp-session-id")).toBeNull();
    const instructions = (
      initialized.body as { result?: { instructions?: string } }
    ).result?.instructions;
    expect(instructions).toContain("QNECTOR SESSION BOOTSTRAP");
    expect(instructions).toContain(root);
    expect(instructions).toContain("Continue the saved Qnector task");
    expect(instructions).toContain("Run the next acceptance check");
    expect(instructions).toContain(
      "Do not rebuild completed roadmap features.",
    );
    expect(instructions).toContain("release-rule");
    expect(Buffer.byteLength(instructions!, "utf8")).toBeLessThanOrEqual(4_000);

    const listed = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const listedText = JSON.stringify(listed.body);
    expect(listedText).not.toContain("Continue the saved Qnector task");
    for (const expected of [
      "workspace",
      "expectedSha256",
      "processId",
      "screen_capture",
      "search_files",
      "computer",
      "set_value",
      "screenshot",
      "dom_snapshot",
      "computed_style",
      "evaluate",
      "requests",
      "performance",
      "build_info",
      "parallel",
      "context_snapshot",
      "release_status",
      "doctor",
      "workspace_symbols",
      "semantic_search",
      "read_many",
      "wait_for_port",
      "pty_start",
      "task_start",
      "workflow_save",
      "launch",
      "navigate",
      "upload_file",
      "range_value",
    ]) {
      expect(listedText).toContain(expected);
    }
    expect(listedText).toContain("capture the current display");

    const advertisedTools =
      (
        listed.body as {
          result?: {
            tools?: Array<{
              name: string;
              inputSchema?: {
                properties?: { action?: { enum?: string[] } };
              };
            }>;
          };
        }
      ).result?.tools ?? [];
    for (const definition of toolDefinitions) {
      const expectedActions = (
        definition.inputSchema as {
          properties?: { action?: { enum?: string[] } };
        }
      ).properties?.action?.enum;
      const advertised = advertisedTools.find(
        (tool) => tool.name === definition.name,
      );
      expect(
        advertised,
        `${definition.name} should be advertised`,
      ).toBeTruthy();
      expect(advertised?.inputSchema?.properties?.action?.enum).toEqual(
        expectedActions,
      );
    }

    const compactCall = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "system", arguments: { action: "status" } },
    });
    const compactResult = (
      compactCall.body as {
        result?: {
          content?: Array<{ type?: string; text?: string }>;
          structuredContent?: Record<string, unknown>;
        };
      }
    ).result;
    expect(compactResult?.content?.[0]?.text).toBe("Qnector local status");
    expect(compactResult?.structuredContent).toMatchObject({
      ok: true,
      tool: "system",
      action: "status",
    });
    expect(JSON.stringify(compactResult?.content)).not.toContain(
      "activeWorkspace",
    );

    const parallelCall = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "system",
        arguments: {
          action: "parallel",
          maxConcurrency: 2,
          calls: [
            { id: "status", tool: "system", input: { action: "status" } },
            {
              id: "env",
              tool: "system",
              input: { action: "env", keys: ["PATH"] },
            },
          ],
        },
      },
    });
    expect(parallelCall.response.ok).toBe(true);
    const parallelText = JSON.stringify(parallelCall.body);
    expect(parallelText).toContain("Parallel batch completed 2/2 operation(s)");
    expect(parallelText).toContain('"action":"parallel"');
    expect(parallelText).toContain('"id":"status"');
    expect(parallelText).toContain('"id":"env"');

    const resources = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/list",
      params: {},
    });
    expect(JSON.stringify(resources.body)).toContain("qnector://memory/latest");
    expect(JSON.stringify(resources.body)).toContain(
      "qnector://workspace/status",
    );
    const workspaceStatus = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "qnector://workspace/status" },
    });
    expect(JSON.stringify(workspaceStatus.body)).toContain("gitStatus");
    const memory = await request(`http://127.0.0.1:${port}/mcp`, {
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "qnector://memory/latest" },
    });
    const memoryText = (
      memory.body as { result?: { contents?: Array<{ text?: string }> } }
    ).result?.contents?.[0]?.text;
    expect(memoryText).toBeTruthy();
    expect(
      (JSON.parse(memoryText!) as { workspacePath: string }).workspacePath,
    ).toBe(root);

    const client = new Client(
      { name: "qnector-modern-test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    try {
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getInstructions()).toContain("QNECTOR SESSION BOOTSTRAP");
      expect(client.getInstructions()).toContain(
        "Continue the saved Qnector task",
      );
      const modernTools = await client.listTools();
      expect(modernTools.tools).toHaveLength(8);
      expect(modernTools.tools.map((tool) => tool.name)).toContain("browser");
    } finally {
      await client.close();
    }
  });

  it("supports the Phase 0 ping/read/write gate locally", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-phase0-"));
    const port = await freePort();
    const phase0 = new Phase0Server({
      testFile: path.join(root, "qnector-write-test.txt"),
    });
    await phase0.start({ host: "127.0.0.1", port });
    try {
      const initialized = await request(`http://127.0.0.1:${port}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      });
      expect(initialized.response.headers.get("mcp-session-id")).toBeNull();
      const written = await request(`http://127.0.0.1:${port}/mcp`, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "write_test", arguments: { message: "ok" } },
      });
      expect(JSON.stringify(written.body)).toContain('"ok":true');
    } finally {
      await phase0.stop();
    }
  });
});

async function request(
  url: string,
  payload: unknown,
  session?: string,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  const line = raw.split(/\r?\n/).find((entry) => entry.startsWith("data:"));
  return {
    response,
    body: line ? JSON.parse(line.slice(5).trim()) : JSON.parse(raw),
  };
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
