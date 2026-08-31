import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createServer as createHttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../../packages/core/src/config.js";
import { QnectorRuntime } from "../../../packages/mcp-server/src/server.js";
import { RelayClient } from "../../../packages/transports/src/relay-client.js";
import { QnectorRelayServer } from "./server.js";

describe("Qnector relay", () => {
  let runtime: QnectorRuntime | undefined;
  let relay: QnectorRelayServer | undefined;
  let client: RelayClient | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await client?.stop();
    await relay?.stop();
    await runtime?.stop();
    if (root) await rm(root, { recursive: true, force: true });
    client = undefined;
    relay = undefined;
    runtime = undefined;
    root = undefined;
  });

  it("forwards an MCP request over the agent WebSocket", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-relay-"));
    const localPort = await freePort();
    runtime = new QnectorRuntime({
      config: { ...defaultConfig(root), localPort },
      configFile: path.join(root, "config.json"),
    });
    await runtime.start({ port: localPort });
    const relayPort = await freePort();
    relay = new QnectorRelayServer({ requestTimeoutMs: 10_000 });
    await relay.start({ host: "127.0.0.1", port: relayPort });
    client = new RelayClient("127.0.0.1", localPort, {
      relayUrl: `ws://127.0.0.1:${relayPort}/agent/test-device`,
      deviceId: "test-device",
      version: "test",
      reconnect: false,
    });
    await client.start();
    const response = await fetch(
      `http://127.0.0.1:${relayPort}/mcp/test-device`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "relay-test", version: "1" },
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("serverInfo");
  });

  it("fails an in-flight relay request promptly when the desktop disconnects", async () => {
    const localPort = await freePort();
    const hanging = createHttpServer(() => {
      // Intentionally leave the response open until the relay client disconnects.
    });
    await new Promise<void>((resolve) =>
      hanging.listen(localPort, "127.0.0.1", () => resolve()),
    );
    const relayPort = await freePort();
    relay = new QnectorRelayServer({ requestTimeoutMs: 10_000 });
    await relay.start({ host: "127.0.0.1", port: relayPort });
    client = new RelayClient("127.0.0.1", localPort, {
      relayUrl: `ws://127.0.0.1:${relayPort}/agent/disconnect-device`,
      deviceId: "disconnect-device",
      version: "test",
      reconnect: false,
    });
    await client.start();
    try {
      const responsePromise = fetch(
        `http://127.0.0.1:${relayPort}/mcp/disconnect-device`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await client.stop();
      const response = await Promise.race([
        responsePromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("relay disconnect response timed out")),
            2_000,
          ),
        ),
      ]);
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("DEVICE_DISCONNECTED");
    } finally {
      await new Promise<void>((resolve) => hanging.close(() => resolve()));
    }
  });
});

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
