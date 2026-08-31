import type { ToolDefinition, ToolResult } from "@qnector/shared";
import { type ToolContext } from "./tool-result.js";
import { executeSystem, systemDefinition } from "./system-tool.js";
import { executeWorkspace, workspaceDefinition } from "./workspace-tool.js";
import { executeFiles, filesDefinition } from "./files-tool.js";
import { executeProcess, processDefinition } from "./process-tool.js";
import { executeGit, gitDefinition } from "./git-tool.js";
import { executeMemory, memoryDefinition } from "./memory-tool.js";
import { browserDefinition, executeBrowser } from "./browser-tool.js";
import { computerDefinition, executeComputer } from "./computer-tool.js";

export const toolDefinitions: ToolDefinition[] = [
  systemDefinition,
  workspaceDefinition,
  filesDefinition,
  processDefinition,
  gitDefinition,
  memoryDefinition,
  browserDefinition,
  computerDefinition,
];

export class ToolRegistry {
  private readonly handlers = new Map<
    string,
    (context: ToolContext, input: unknown) => Promise<ToolResult>
  >([
    ["system", executeSystem],
    ["workspace", executeWorkspace],
    ["files", executeFiles],
    ["process", executeProcess],
    ["git", executeGit],
    ["memory", executeMemory],
    ["browser", executeBrowser],
    ["computer", executeComputer],
  ]);

  public list(): ToolDefinition[] {
    return toolDefinitions.map((definition) => ({
      ...definition,
      inputSchema: { ...definition.inputSchema },
      annotations: { ...definition.annotations },
    }));
  }

  public async call(
    name: string,
    context: ToolContext,
    input: unknown,
  ): Promise<ToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        ok: false,
        tool: name,
        action: "unknown",
        summary: `Unknown tool '${name}'`,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool '${name}'`,
          hint: `Use tools/list to see available tools.`,
        },
        meta: { durationMs: 0, truncated: false, nextCursor: null },
      };
    }
    return handler(context, input);
  }
}

export * from "./tool-result.js";
export * from "./system-tool.js";
export * from "./workspace-tool.js";
export * from "./files-tool.js";
export * from "./process-tool.js";
export * from "./git-tool.js";
export * from "./memory-tool.js";
export * from "./browser-tool.js";
export * from "./computer-tool.js";
