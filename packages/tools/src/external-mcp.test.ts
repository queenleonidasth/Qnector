import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callExternalMcpTool,
  listExternalMcpServers,
  listExternalMcpTools,
} from "./external-mcp.js";

// Real stdio peer: verifies SDK handshake, request dispatch and child cleanup
// without contacting configured user servers or requiring credentials.
const peer = `
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') {
    result = { protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'test-peer', version: '1' } };
  } else if (request.method === 'tools/list') {
    result = { tools: [
      { name: 'echo', description: 'Echo arguments', inputSchema: { type: 'object' } },
      { name: 'fail', description: 'Return a tool failure', inputSchema: { type: 'object' } }
    ] };
  } else if (request.method === 'tools/call') {
    result = { isError: request.params.name === 'fail', content: [{ type: 'text',
      text: JSON.stringify({ args: request.params.arguments, pid: process.pid,
        env: process.env.QNECTOR_TEST_VALUE, cwd: process.cwd() }) }] };
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
      error: { code: -32601, message: 'Unknown method' } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`;

describe("external MCP stdio client", () => {
  let root: string;
  let configFile: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-external-mcp-"));
    vi.stubEnv("APPDATA", root);
    await mkdir(path.join(root, "Qnector"));
    configFile = path.join(root, "Qnector", "external-mcp.json");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function configure() {
    await writeFile(
      configFile,
      JSON.stringify({
        version: 1,
        servers: {
          peer: {
            command: process.execPath,
            args: ["-e", peer],
            cwd: root,
            env: { QNECTOR_TEST_VALUE: "private-test-value" },
            dpapiEnv: { UNUSED_SECRET: path.join(root, "missing-secret") },
          },
          disabled: { command: process.execPath, enabled: false },
        },
      }),
    );
  }

  it("handles an absent config and rejects malformed JSON", async () => {
    expect((await listExternalMcpServers()).servers).toEqual([]);
    await writeFile(configFile, "{");
    await expect(listExternalMcpServers()).rejects.toThrow("MCP_CONFIG_ERROR");
  });

  it("reports configured environment keys without revealing values", async () => {
    await configure();
    const result = await listExternalMcpServers();
    expect(result.servers.map((server) => server.name)).toEqual([
      "disabled",
      "peer",
    ]);
    expect(result.servers[1]).toMatchObject({
      envKeys: ["QNECTOR_TEST_VALUE"],
      secretEnvKeys: ["UNUSED_SECRET"],
    });
    expect(JSON.stringify(result)).not.toContain("private-test-value");
  });

  it("rejects disabled and unknown servers before spawning", async () => {
    await configure();
    await expect(listExternalMcpTools("disabled")).rejects.toThrow(
      "MCP_SERVER_DISABLED",
    );
    await expect(listExternalMcpTools("unknown")).rejects.toThrow(
      "MCP_SERVER_NOT_FOUND",
    );
  });

  it("handshakes with an upstream and filters its tool schemas", async () => {
    await configure();
    const result = await listExternalMcpTools("peer", "ECHO", 1);
    expect(result).toMatchObject({ total: 2, matched: 1, returned: 1 });
    expect(result.tools[0]).toMatchObject({
      name: "echo",
      inputSchema: { type: "object" },
    });
  });

  it("forwards arguments, cwd and environment and closes the child", async () => {
    await configure();
    const result = await callExternalMcpTool("peer", "echo", { text: "hello" });
    expect(result).toMatchObject({ isError: false, truncated: false });
    const response = result.result as { content: Array<{ text: string }> };
    const output = JSON.parse(response.content[0]!.text);
    expect(output).toMatchObject({
      args: { text: "hello" },
      cwd: root,
      env: "private-test-value",
    });
    expect(() => process.kill(output.pid, 0)).toThrow();
  });

  it("preserves upstream failure status even when the result is truncated", async () => {
    await configure();
    const result = await callExternalMcpTool(
      "peer",
      "fail",
      { text: "x".repeat(5_000) },
      1_000,
    );
    expect(result).toMatchObject({ isError: true, truncated: true });
    expect(result.originalChars).toBeGreaterThan(5_000);
    expect(String(result.result)).toHaveLength(1_000);
  });
});
