import { describe, expect, it, vi } from "vitest";
import type { QnectorApi, ToolResult } from "../preload/api.js";
import { inspectWindowsMcp } from "./windows-mcp-status.js";

function result(data: unknown): ToolResult {
  return {
    ok: true,
    tool: "system",
    action: "test",
    summary: "test",
    data: { data },
    meta: { durationMs: 0, truncated: false, nextCursor: null },
  };
}

describe("Windows-MCP runtime status", () => {
  it("reports not configured without probing tools", async () => {
    const callTool = vi.fn(async () =>
      result({ configPath: "external-mcp.json", servers: [] }),
    ) as unknown as QnectorApi["callTool"];

    await expect(inspectWindowsMcp(callTool)).resolves.toMatchObject({
      state: "not-configured",
      configured: false,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("reports disabled without trying to connect", async () => {
    const callTool = vi.fn(async () =>
      result({
        configPath: "external-mcp.json",
        servers: [
          {
            name: "windows-mcp",
            enabled: false,
            command: "",
            url: "http://127.0.0.1:8000/mcp",
            args: [],
          },
        ],
      }),
    ) as unknown as QnectorApi["callTool"];

    await expect(inspectWindowsMcp(callTool)).resolves.toMatchObject({
      state: "disabled",
      configured: true,
      endpoint: "http://127.0.0.1:8000/mcp",
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("requires a real tools handshake before reporting connected", async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        result({
          configPath: "external-mcp.json",
          servers: [
            {
              name: "windows-mcp",
              enabled: true,
              command: "",
              url: "http://127.0.0.1:8000/mcp",
              args: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        result({
          total: 18,
          matched: 1,
          returned: 1,
          tools: [{ name: "DisplayInventory" }],
        }),
      ) as unknown as QnectorApi["callTool"];

    await expect(inspectWindowsMcp(callTool)).resolves.toMatchObject({
      state: "connected",
      configured: true,
      enabled: true,
      toolCount: 18,
      displayInventoryAvailable: true,
    });
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("reports an upstream handshake error without claiming connected", async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        result({
          configPath: "external-mcp.json",
          servers: [
            {
              name: "windows-mcp",
              enabled: true,
              command: "",
              url: "http://127.0.0.1:8000/mcp",
              args: [],
            },
          ],
        }),
      )
      .mockRejectedValueOnce(
        new Error("fetch failed"),
      ) as unknown as QnectorApi["callTool"];

    await expect(inspectWindowsMcp(callTool)).resolves.toMatchObject({
      state: "error",
      configured: true,
      detail: "fetch failed",
    });
  });
});
