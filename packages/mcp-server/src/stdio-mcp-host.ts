import type { McpServer } from "@modelcontextprotocol/server";
import {
  serveStdio,
  type ServeStdioOptions,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";

/** Stdio-only MCP transport. Never emits diagnostics on protocol stdout. */
export function startStdioMcpHost(
  createServer: () => Promise<McpServer>,
  options: ServeStdioOptions = {},
): StdioServerHandle {
  return serveStdio(createServer, {
    ...options,
    onerror: (error) => {
      options.onerror?.(error);
      if (!options.onerror) console.error("Qnector stdio transport:", error);
    },
  });
}
