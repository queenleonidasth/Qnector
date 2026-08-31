import type {
  ToolAttachment,
  ToolDefinition,
  ToolResult,
} from "@qnector/shared";
import {
  objectInput,
  runWithActivity,
  type ToolContext,
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
      inputSchema: { ...definition.inputSchema },
      annotations: { ...definition.annotations },
    }));
  }

  public async call(
    name: string,
    context: ToolContext,
    input: unknown,
  ): Promise<ToolResult> {
    if (name === "system" && isParallelRequest(input)) {
      return this.callParallel(context, input);
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
    return handler(context, input);
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
        }
      };
      const concurrency = Math.min(requestedConcurrency, calls.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      const succeeded = results.filter((entry) => entry.result.ok).length;
      const failed = results.length - succeeded;
      const attachments = resultAttachments.flatMap((entry) => entry ?? []);
      return {
        summary: `Parallel batch completed ${succeeded}/${results.length} operation(s)${failed ? `; ${failed} failed` : ""}`,
        data: {
          results,
          succeeded,
          failed,
          maxConcurrency: concurrency,
        },
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
