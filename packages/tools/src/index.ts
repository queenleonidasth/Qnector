import type {
  ToolAttachment,
  ToolDefinition,
  ToolResult,
} from "@qnector/shared";
import {
  objectInput,
  runWithActivity,
  ToolExecutionError,
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
    // A stateless MCP call may omit the route handle. Recover deterministically
    // from a supplied task intent or an unambiguous tool/file signature.
    const autoQuery =
      !skillRouteId && !isSkillsRouteRequest(name, input) && context.agentSkills
        ? automaticSkillQuery(name, input)
        : undefined;
    if (autoQuery) {
      const existing =
        skillTraceForScope(
          context.skillTraceStore,
          memoryTaskId,
          context.skillTraceSessionId,
          undefined,
        ) ?? context.skillTrace;
      if (!existing?.routeId || !existing.skills.length) {
        const routed = await this.call("system", context, {
          action: "skills_route",
          query: autoQuery,
          ...(memoryTaskId ? { memoryTaskId } : {}),
        });
        const routeData = (
          routed.data as
            { data?: { routeId?: string; skills?: unknown[] } } | undefined
        )?.data;
        if (routed.ok && routeData?.routeId && routeData.skills?.length) {
          return this.call(name, context, {
            ...(input as Record<string, unknown>),
            skillRouteId: routeData.routeId,
          });
        }
      }
    }
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
    if (name === "system" && isParallelRequest(input)) {
      return this.callParallel(scopedContext, input);
    }
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

  private async callParallel(
    context: ToolContext,
    input: unknown,
  ): Promise<ToolResult> {
    return runWithActivity(context, "system", "parallel", input, async () => {
      const object = objectInput(input);
      if (!Array.isArray(object.calls))
        throw new Error("INVALID_INPUT: calls must be an array");
      if (object.calls.length < 2 || object.calls.length > 12)
        throw new Error("INVALID_INPUT: calls must contain 2-12 operations");
      const policy = object.policy ?? "all-success";
      if (policy !== "all-success" && policy !== "best-effort")
        throw new Error(
          "INVALID_INPUT: policy must be all-success or best-effort",
        );
      const requestedConcurrency = object.maxConcurrency ?? 6;
      if (
        typeof requestedConcurrency !== "number" ||
        !Number.isInteger(requestedConcurrency) ||
        requestedConcurrency < 1 ||
        requestedConcurrency > 8
      )
        throw new Error(
          "INVALID_INPUT: maxConcurrency must be an integer from 1 to 8",
        );

      const calls = object.calls.map((raw, index): ParallelCall => {
        const call = objectInput(raw);
        const tool = call.tool;
        if (typeof tool !== "string" || !this.handlers.has(tool))
          throw new Error(
            `INVALID_INPUT: calls[${index}].tool must name a registered Qnector tool`,
          );
        const nestedInput = objectInput(call.input);
        if (tool === "system" && nestedInput.action === "parallel")
          throw new Error(
            `INVALID_INPUT: calls[${index}] cannot recursively call system.parallel`,
          );
        if (call.id !== undefined && typeof call.id !== "string")
          throw new Error(`INVALID_INPUT: calls[${index}].id must be a string`);
        return {
          ...(typeof call.id === "string" ? { id: call.id.slice(0, 100) } : {}),
          tool,
          input: nestedInput,
        };
      });

      const results: ParallelResult[] = new Array(calls.length);
      const resultAttachments: Array<ToolAttachment[] | undefined> = new Array(
        calls.length,
      );
      let nextIndex = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= calls.length) return;
          const call = calls[index]!;
          try {
            const result = await this.call(call.tool, context, call.input);
            const { attachments, ...serializableResult } = result;
            resultAttachments[index] = attachments;
            results[index] = {
              index,
              ...(call.id ? { id: call.id } : {}),
              tool: call.tool,
              result: serializableResult,
              ...(attachments?.length
                ? {
                    attachments: attachments.map((attachment) => ({
                      type: attachment.type,
                      mimeType: attachment.mimeType,
                      width: attachment.width,
                      height: attachment.height,
                    })),
                  }
                : {}),
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const codeMatch = message.match(/^([A-Z][A-Z0-9_]+):/);
            results[index] = {
              index,
              ...(call.id ? { id: call.id } : {}),
              tool: call.tool,
              result: {
                ok: false,
                tool: call.tool,
                action:
                  typeof call.input.action === "string"
                    ? call.input.action
                    : "unknown",
                summary: `Parallel subcall failed: ${message}`,
                error: {
                  code: codeMatch?.[1] ?? "TOOL_CALL_FAILED",
                  message,
                },
                meta: { durationMs: 0, truncated: false, nextCursor: null },
              },
            };
          }
        }
      };
      const concurrency = Math.min(requestedConcurrency, calls.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      const succeeded = results.filter((entry) => entry.result.ok).length;
      const failed = results.length - succeeded;
      const outcome =
        failed === 0 ? "succeeded" : succeeded === 0 ? "failed" : "partial";
      const attachments = resultAttachments.flatMap((entry) => entry ?? []);
      const batch = {
        outcome,
        results,
        succeeded,
        failed,
        maxConcurrency: concurrency,
      };
      if (failed > 0 && policy === "all-success")
        throw new ToolExecutionError(
          "PARALLEL_SUBCALL_FAILED",
          `Parallel batch completed ${succeeded}/${results.length} operation(s); ${failed} failed`,
          batch,
        );
      return {
        summary: `Parallel batch completed ${succeeded}/${results.length} operation(s)${failed ? `; ${failed} failed` : ""}`,
        data: batch,
        ...(attachments.length > 0 ? { attachments } : {}),
      };
    });
  }
}

type ParallelCall = {
  id?: string;
  tool: string;
  input: Record<string, unknown>;
};

type ParallelResult = {
  index: number;
  id?: string;
  tool: string;
  result: Omit<ToolResult, "attachments">;
  attachments?: Array<{
    type: "image";
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    width?: number;
    height?: number;
  }>;
};

function isParallelRequest(input: unknown): boolean {
  return Boolean(
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { action?: unknown }).action === "parallel",
  );
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

function automaticSkillQuery(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const object = input as Record<string, unknown>;
  const action = typeof object.action === "string" ? object.action : "";
  const intent =
    typeof object.skillIntent === "string" ? object.skillIntent.trim() : "";
  if (intent && intent.length <= 2_000) return intent;
  if (
    name === "files" &&
    [
      "write",
      "append",
      "replace",
      "multi_edit",
      "apply_patch",
      "document_replace_text",
    ].includes(action)
  ) {
    const filename = typeof object.path === "string" ? object.path : "";
    const extension = /\.(tsx?|jsx?|css|html|xlsx?|csv|docx|pdf|zip)$/i
      .exec(filename)?.[1]
      ?.toLowerCase();
    const topics: Record<string, string> = {
      ts: "TypeScript coding edit typescript best practices",
      tsx: "React TypeScript frontend UI coding edit",
      js: "JavaScript coding edit",
      jsx: "React frontend UI coding edit",
      css: "frontend UI CSS design edit",
      html: "frontend UI HTML design edit",
      xls: "spreadsheet Excel workbook edit",
      xlsx: "spreadsheet Excel workbook edit",
      csv: "spreadsheet CSV edit",
      docx: "document DOCX edit",
      pdf: "document PDF edit",
      zip: "archive ZIP edit",
    };
    return extension ? topics[extension] : undefined;
  }
  if (
    name === "browser" &&
    ["navigate", "click"].includes(action) &&
    typeof object.url === "string" &&
    /^https?:\/\/(?:www\.)?nexusmods\.com(?:\/|$)/i.test(object.url)
  ) {
    return "Nexus Mods download installation workflow nexusmods.com";
  }
  return undefined;
}

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
        description:
          "Qnector Memory v2 task handle. Start/resume a task with the memory tool, then pass the returned taskId here as memoryTaskId on every related Qnector tool call so concurrent chat sessions do not mix progress.",
      },
      skillRouteId: {
        type: "string",
        description:
          "Exact routeId returned by system.skills_route. Pass it on subsequent related Qnector tool calls so Skill Context stays attached to the correct stateless chat/request stream.",
      },
      skillIntent: {
        type: "string",
        description:
          "Optional natural-language task description for automatic Skill selection when skillRouteId is absent. Do not include credentials or private file contents. Prefer system.skills_route first for multi-step work.",
      },
    },
  };
}
