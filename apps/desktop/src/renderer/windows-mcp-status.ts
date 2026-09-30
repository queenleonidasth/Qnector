import type { QnectorApi, ToolResult } from "../preload/api.js";

export interface WindowsMcpRuntimeStatus {
  state: "not-configured" | "disabled" | "connected" | "error";
  configured: boolean;
  enabled: boolean;
  endpoint?: string;
  toolCount?: number;
  displayInventoryAvailable?: boolean;
  detail: string;
}

interface ExternalMcpServerSummary {
  name: string;
  enabled: boolean;
  command: string;
  url?: string;
  args: string[];
}

interface ExternalMcpServersPayload {
  configPath: string;
  servers: ExternalMcpServerSummary[];
}

interface ExternalMcpToolsPayload {
  total: number;
  matched: number;
  returned: number;
  tools: Array<{ name: string }>;
}

type CallTool = QnectorApi["callTool"];

function unwrap<T>(result: ToolResult): T | undefined {
  if (!result.ok) return undefined;
  const outer = result.data as { data?: unknown } | undefined;
  return (outer?.data ?? outer) as T | undefined;
}

export async function inspectWindowsMcp(
  callTool: CallTool,
): Promise<WindowsMcpRuntimeStatus> {
  const serversResult = await callTool("system", { action: "mcp_servers" });
  const servers = unwrap<ExternalMcpServersPayload>(serversResult);
  if (!servers) {
    return {
      state: "error",
      configured: false,
      enabled: false,
      detail: "Could not read the external MCP configuration.",
    };
  }

  const server = servers.servers.find((entry) => entry.name === "windows-mcp");
  if (!server) {
    return {
      state: "not-configured",
      configured: false,
      enabled: false,
      detail: "Windows-MCP is not configured as an external MCP upstream.",
    };
  }
  const endpoint = server.url || (server.command ? "stdio" : undefined);
  if (!server.enabled) {
    return {
      state: "disabled",
      configured: true,
      enabled: false,
      ...(endpoint ? { endpoint } : {}),
      detail: "Windows-MCP is configured but disabled.",
    };
  }

  try {
    const toolsResult = await callTool("system", {
      action: "mcp_tools",
      server: "windows-mcp",
      query: "DisplayInventory",
      maxResults: 10,
    });
    const tools = unwrap<ExternalMcpToolsPayload>(toolsResult);
    if (!tools) throw new Error("The Windows-MCP tools handshake failed.");
    const displayInventoryAvailable = tools.tools.some(
      (tool) => tool.name === "DisplayInventory",
    );
    return {
      state: "connected",
      configured: true,
      enabled: true,
      ...(endpoint ? { endpoint } : {}),
      toolCount: tools.total,
      displayInventoryAvailable,
      detail: displayInventoryAvailable
        ? `Handshake passed; ${tools.total} tool(s) available.`
        : `Handshake passed with ${tools.total} tool(s), but DisplayInventory was not advertised.`,
    };
  } catch (reason) {
    return {
      state: "error",
      configured: true,
      enabled: true,
      ...(endpoint ? { endpoint } : {}),
      detail: reason instanceof Error ? reason.message : String(reason),
    };
  }
}
