import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  type ToolContext,
  type SkillTraceState,
  type SkillTraceStore,
} from "./tool-result.js";
import { executeSystem, systemDefinition } from "./system-tool.js";
import { executeWorkspace, workspaceDefinition } from "./workspace-tool.js";
import { executeFiles, filesDefinition } from "./files-tool.js";
import { executeProcess, processDefinition } from "./process-tool.js";
import { executeGit, gitDefinition } from "./git-tool.js";
import { executeMemory, memoryDefinition } from "./memory-tool.js";
import { browserDefinition, executeBrowser } from "./browser-tool.js";
import { computerDefinition, executeComputer } from "./computer-tool.js";
import { socialDefinition, executeSocial } from "./social-tool.js";

export const toolDefinitions: ToolDefinition[] = [
  systemDefinition,
  workspaceDefinition,
  filesDefinition,
  processDefinition,
  gitDefinition,
  memoryDefinition,
  browserDefinition,
  computerDefinition,
  socialDefinition,
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
    ["social", executeSocial],
  ]);

  public list(): ToolDefinition[] {
    return toolDefinitions.map((definition) => ({
      ...definition,
      inputSchema: withTaskIdSchema(definition.inputSchema),
      annotations: { ...definition.annotations },
    }));
  }

  public async call(
    name: string,
    context: ToolContext,
    input: unknown,
  ): Promise<ToolResult> {
    const memoryTaskId = memoryTaskIdFromInput(input) ?? context.memoryTaskId;
    const skillRouteId = skillRouteIdFromInput(input);
    // Skill routing is explicit only: never insert hidden tool calls in a
    // stateless MCP request. Existing task/session/route handles still inherit
    // the activated Skill trace without another route operation.
    const inheritedTrace =
      skillTraceForScope(
        context.skillTraceStore,
        memoryTaskId,
        context.skillTraceSessionId,
        skillRouteId,
      ) ?? context.skillTrace;
    const skillTrace =
      inheritedTrace ??
      (isSkillsRouteRequest(name, input) ? { skills: [] } : undefined);
    const scopedContext =
      memoryTaskId || skillTrace
        ? {
            ...context,
            ...(memoryTaskId ? { memoryTaskId } : {}),
            ...(skillTrace ? { skillTrace } : {}),
          }
        : context;
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
    return handler(scopedContext, input);
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

function memoryTaskIdFromInput(input: unknown): string | undefined {
  return scopedStringFromInput(input, "memoryTaskId");
}

function skillRouteIdFromInput(input: unknown): string | undefined {
  return scopedStringFromInput(input, "skillRouteId");
}

function scopedStringFromInput(
  input: unknown,
  key: "memoryTaskId" | "skillRouteId",
): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSkillsRouteRequest(name: string, input: unknown): boolean {
  return (
    name === "system" &&
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { action?: unknown }).action === "skills_route"
  );
}

function skillTraceForScope(
  store: SkillTraceStore | undefined,
  memoryTaskId: string | undefined,
  sessionId: string | undefined,
  skillRouteId: string | undefined,
): SkillTraceState | undefined {
  if (!store) return undefined;
  if (skillRouteId) return store.byRouteId?.get(skillRouteId);
  if (memoryTaskId) return traceForKey(store.byTaskId, memoryTaskId);
  if (sessionId) {
    store.bySessionId ??= new Map();
    return traceForKey(store.bySessionId, sessionId);
  }
  return undefined;
}

function traceForKey(
  traces: Map<string, SkillTraceState>,
  key: string,
): SkillTraceState {
  let trace = traces.get(key);
  if (!trace) {
    trace = { skills: [] };
    traces.set(key, trace);
    while (traces.size > 100) {
      const oldest = traces.keys().next().value as string | undefined;
      if (!oldest) break;
      traces.delete(oldest);
    }
  }
  return trace;
}

function withTaskIdSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const properties =
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};
  return {
    ...schema,
    properties: {
      ...properties,
      memoryTaskId: {
        type: "string",
        description: "Memory task scope from memory.task_start/resume.",
      },
      skillRouteId: {
        type: "string",
        description:
          "Route handle from system.skills_route for related stateless calls.",
      },
    },
  };
}

export * from "./social-tool.js";
