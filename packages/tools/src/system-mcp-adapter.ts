import { objectInput, stringInput } from "./tool-result.js";
import {
  callExternalMcpTool,
  listExternalMcpServers,
  listExternalMcpTools,
} from "./external-mcp.js";

/** External MCP adapter. No transport, network or schema changes at the public system tool. */
export async function executeSystemMcp(
  action: string,
  object: Record<string, unknown>,
) {
  if (action === "mcp_servers") {
    const result = await listExternalMcpServers();
    return {
      summary: `Configured ${result.servers.length} external MCP server(s)`,
      data: result,
    };
  }
  if (action === "mcp_tools") {
    const server = stringInput(object, "server", true)!;
    const query = stringInput(object, "query");
    const maxResults =
      typeof object.maxResults === "number" ? object.maxResults : 40;
    const result = await listExternalMcpTools(server, query, maxResults);
    return {
      summary: `Listed ${result.returned} of ${result.matched} matching tool(s) from external MCP server ${server}`,
      data: result,
    };
  }
  if (action === "mcp_call") {
    const server = stringInput(object, "server", true)!;
    const toolName = stringInput(object, "toolName", true)!;
    const args =
      object.arguments === undefined ? {} : objectInput(object.arguments);
    const maxChars =
      typeof object.maxChars === "number" ? object.maxChars : undefined;
    const result = await callExternalMcpTool(server, toolName, args, maxChars);
    return {
      summary: `${result.isError ? "External MCP tool returned an error" : "Called external MCP tool"} ${server}.${toolName}`,
      data: result,
    };
  }
  throw new Error(`INVALID_ACTION: Unknown external MCP action '${action}'`);
}
