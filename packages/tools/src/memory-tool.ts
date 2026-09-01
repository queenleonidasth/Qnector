import type {
  MemoryActiveState,
  MemoryCategory,
  ToolDefinition,
  ToolResult,
} from "@qnector/shared";
import type { MemoryStore } from "@qnector/core";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";

const categories: MemoryCategory[] = ["fact", "decision", "rule", "note"];

export const memoryDefinition: ToolDefinition = {
  name: "memory",
  description:
    "Persist and recall local Qnector workspace context across chat sessions. recall can rank facts by an optional query; working_set combines the active task, relevant facts, latest checkpoint, recent files/commands/errors and a resume hint. Save checkpoints, project facts, decisions and rules; compact or clear only the active workspace memory. Memory is local-only and secrets are best-effort redacted before persistence.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "recall",
          "working_set",
          "save_checkpoint",
          "note",
          "list",
          "get",
          "set",
          "delete",
          "compact",
          "clear",
          "export",
        ],
      },
      currentTask: { type: "string" },
      completedSteps: { type: "array", items: { type: "string" } },
      pendingSteps: { type: "array", items: { type: "string" } },
      criticalContext: { type: "string" },
      label: { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      category: { type: "string", enum: categories },
      tags: { type: "array", items: { type: "string" } },
      id: { type: "string" },
      query: { type: "string" },
      limit: { type: "integer", minimum: 1 },
      cursor: { type: "integer", minimum: 0 },
      checkpointLimit: { type: "integer", minimum: 1 },
      factLimit: { type: "integer", minimum: 1 },
      changeLimit: { type: "integer", minimum: 1 },
      keepCheckpoints: { type: "integer", minimum: 1 },
      replacementSummary: { type: "string" },
      scope: {
        type: "string",
        enum: ["active", "checkpoints", "facts", "all"],
      },
      format: { type: "string", enum: ["json", "markdown"] },
      path: { type: "string" },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export async function executeMemory(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "memory", action, input, async () => {
    const memory = context.memory;
    if (!memory)
      throw new Error(
        "MEMORY_UNAVAILABLE: memory store is not configured for this runtime",
      );

    if (action === "recall") {
      const result = await memory.recall({
        checkpointLimit: numberInput(object, "checkpointLimit", 10),
        factLimit: numberInput(object, "factLimit", 100),
        changeLimit: numberInput(object, "changeLimit", 100),
        ...(stringInput(object, "query")
          ? { query: stringInput(object, "query") }
          : {}),
      });
      return {
        summary: result.available
          ? `Recalled memory for ${result.workspacePath}`
          : "No saved memory for the active workspace",
        data: result,
        truncated: result.truncated,
      };
    }

    if (action === "working_set")
      return workingSetAction(context, memory, stringInput(object, "query"));

    if (action === "save_checkpoint") {
      const result = await memory.saveCheckpoint({
        currentTask: stringInput(object, "currentTask", true)!,
        completedSteps: stringArray(object, "completedSteps"),
        pendingSteps: stringArray(object, "pendingSteps"),
        criticalContext: stringInput(object, "criticalContext", true)!,
        ...(stringInput(object, "label")
          ? { label: stringInput(object, "label") }
          : {}),
      });
      return {
        summary: "Saved the active Qnector checkpoint",
        data: result,
      };
    }

    if (action === "note" || action === "set") {
      const category = stringInput(object, "category");
      if (category && !categories.includes(category as MemoryCategory))
        throw new Error(`INVALID_INPUT: unknown memory category '${category}'`);
      const fact = await memory.upsertNote({
        key: stringInput(object, "key", true)!,
        value: stringInput(object, "value", true)!,
        ...(category ? { category: category as MemoryCategory } : {}),
        ...(object.tags === undefined
          ? {}
          : { tags: stringArray(object, "tags") }),
      });
      const snapshot = await memoryMetadata(memory);
      return {
        summary: `Saved memory fact '${fact.key}'`,
        data: memoryEnvelope(snapshot, { fact }),
      };
    }

    if (action === "list") {
      const category = stringInput(object, "category");
      if (category && !categories.includes(category as MemoryCategory))
        throw new Error(`INVALID_INPUT: unknown memory category '${category}'`);
      const result = await memory.listFacts({
        ...(category ? { category: category as MemoryCategory } : {}),
        ...(stringInput(object, "query")
          ? { query: stringInput(object, "query") }
          : {}),
        limit: numberInput(object, "limit", 100),
        cursor: numberInput(object, "cursor", 0),
      });
      const snapshot = await memoryMetadata(memory);
      return {
        summary: `Listed ${result.facts.length} memory fact(s)`,
        data: memoryEnvelope(snapshot, result),
        truncated: result.truncated,
        nextCursor: result.nextCursor,
      };
    }

    if (action === "get") {
      const id = stringInput(object, "id");
      const key = stringInput(object, "key");
      if (!id && !key) throw new Error("INVALID_INPUT: id or key is required");
      const fact = await memory.getFact({ ...(id ? { id } : { key }) });
      const snapshot = await memoryMetadata(memory);
      return {
        summary: fact
          ? `Read memory fact '${fact.key}'`
          : "Memory fact not found",
        data: memoryEnvelope(snapshot, { found: Boolean(fact), fact }),
      };
    }

    if (action === "delete") {
      const id = stringInput(object, "id");
      const key = stringInput(object, "key");
      if (!id && !key) throw new Error("INVALID_INPUT: id or key is required");
      const deleted = await memory.deleteFact({ ...(id ? { id } : { key }) });
      const snapshot = await memoryMetadata(memory);
      return {
        summary: deleted ? "Deleted memory fact" : "Memory fact not found",
        data: memoryEnvelope(snapshot, { deleted }),
      };
    }

    if (action === "compact") {
      const result = await memory.compact({
        keepCheckpoints: numberInput(object, "keepCheckpoints", 10),
        ...(stringInput(object, "replacementSummary")
          ? { replacementSummary: stringInput(object, "replacementSummary") }
          : {}),
      });
      return {
        summary: "Compacted active workspace memory deterministically",
        data: result,
      };
    }

    if (action === "clear") {
      const scope = stringInput(object, "scope", true)!;
      if (!["active", "checkpoints", "facts", "all"].includes(scope))
        throw new Error(`INVALID_INPUT: unknown memory clear scope '${scope}'`);
      const result = await memory.clear(
        scope as "active" | "checkpoints" | "facts" | "all",
      );
      return {
        summary: `Cleared ${scope} memory for the active workspace`,
        data: result,
      };
    }

    if (action === "export") {
      const format = (stringInput(object, "format") ?? "json") as
        "json" | "markdown";
      if (format !== "json" && format !== "markdown")
        throw new Error(
          `INVALID_INPUT: unsupported memory export format '${format}'`,
        );
      const target = stringInput(object, "path");
      const resolvedTarget = target
        ? context.workspace.resolve(target)
        : undefined;
      const result = resolvedTarget
        ? await memory.writeExport(format, resolvedTarget)
        : await memory.export(format);
      const snapshot = await memoryMetadata(memory);
      return {
        summary: resolvedTarget
          ? `Exported memory to ${resolvedTarget}`
          : `Prepared ${format} memory export`,
        data: memoryEnvelope(snapshot, {
          format: result.format,
          ...(resolvedTarget
            ? { path: resolvedTarget }
            : { content: result.content }),
          bytes: Buffer.byteLength(result.content, "utf8"),
        }),
        truncated: false,
      };
    }

    throw new Error(`INVALID_ACTION: Unknown memory action '${action}'`);
  });
}

async function workingSetAction(
  context: ToolContext,
  memory: MemoryStore,
  explicitQuery?: string,
) {
  const baseRecall = await memory.recall({
    checkpointLimit: 1,
    factLimit: 12,
    changeLimit: 20,
  });
  const activity = context.activity
    .list()
    .filter((entry) => entry.status !== "running")
    .slice(-100)
    .reverse();
  const fileReads: string[] = [];
  const fileWrites: string[] = [];
  const commands: Array<{
    timestamp: string;
    action: string;
    command: string;
    status: string;
  }> = [];
  for (const entry of activity) {
    const args = parseActivityArgs(entry.argsSummary);
    if (entry.tool === "files") {
      const paths = activityPaths(args);
      const readActions = [
        "read",
        "read_many",
        "preview",
        "inspect",
        "extract_text",
        "render",
        "document_query",
      ];
      const writeActions = [
        "write",
        "append",
        "replace",
        "multi_edit",
        "apply_patch",
        "move",
        "copy",
        "delete",
        "mkdir",
      ];
      const target = readActions.includes(entry.action)
        ? fileReads
        : writeActions.includes(entry.action)
          ? fileWrites
          : undefined;
      if (target)
        for (const value of paths)
          if (!target.includes(value)) target.push(value);
    }
    if (entry.tool === "process" && typeof args.command === "string") {
      commands.push({
        timestamp: entry.timestamp,
        action: entry.action,
        command: args.command.slice(0, 2_000),
        status: entry.status,
      });
    }
  }
  const workflowRuns = context.workflowManager
    ? await context.workflowManager
        .listRuns(context.getConfig().activeWorkspace, 10)
        .catch(() => [])
    : [];
  const recentActions = activity.slice(0, 30).map((entry) => ({
    timestamp: entry.timestamp,
    tool: entry.tool,
    action: entry.action,
    status: entry.status,
    summary: entry.summary ?? entry.error?.message ?? "",
  }));
  const contextQuery = buildWorkingSetQuery(
    baseRecall.state.active,
    recentActions,
    explicitQuery,
  );
  const recall = contextQuery
    ? await memory.recall({
        checkpointLimit: 1,
        factLimit: 12,
        changeLimit: 20,
        query: contextQuery,
      })
    : baseRecall;
  const recentErrors = activity
    .filter((entry) => entry.status === "error")
    .slice(0, 10)
    .map((entry) => ({
      timestamp: entry.timestamp,
      tool: entry.tool,
      action: entry.action,
      error: entry.error?.message ?? entry.summary ?? "",
    }));
  return {
    summary: `Prepared automatic working set from ${recentActions.length} recent action(s)`,
    data: {
      workspace: context.getConfig().activeWorkspace,
      generatedAt: new Date().toISOString(),
      active: recall.state.active,
      latestCheckpoint: recall.checkpoints[0] ?? null,
      relevantFacts: recall.state.facts,
      recentChanges: recall.state.recentChanges,
      recentActions,
      resumeHint: buildResumeHint(recall.state.active, recentErrors),
      lastFilesRead: fileReads.slice(0, 20),
      lastFilesModified: fileWrites.slice(0, 20),
      lastCommands: commands.slice(0, 20),
      recentErrors,
      managedProcesses: context.processManager.list().slice(-30),
      workflowRuns,
    },
  };
}

function buildWorkingSetQuery(
  active: MemoryActiveState | null,
  recentActions: Array<{
    timestamp: string;
    tool: string;
    action: string;
    status: string;
    summary: string;
  }>,
  explicitQuery?: string,
): string {
  return [
    explicitQuery,
    active?.currentTask,
    ...(active?.pendingSteps.slice(0, 6) ?? []),
    active?.criticalContext.slice(0, 1_200),
    ...recentActions.slice(0, 10).map((entry) => entry.summary),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .slice(0, 6_000);
}

function buildResumeHint(
  active: MemoryActiveState | null,
  recentErrors: Array<{ error: string }>,
): string {
  const pending = active?.pendingSteps.find((entry) => entry.trim());
  if (pending) return `Resume next pending step: ${pending}`;
  const error = recentErrors.find((entry) => entry.error.trim())?.error;
  if (error)
    return `No pending step is saved; review the latest error: ${error}`;
  if (active?.currentTask.trim())
    return `Current task has no pending steps; verify its latest state before starting new work: ${active.currentTask}`;
  return "No active task is saved; inspect the workspace and recent activity before starting new work.";
}

function parseActivityArgs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function activityPaths(args: Record<string, unknown>): string[] {
  return [
    typeof args.path === "string" ? args.path : undefined,
    ...(Array.isArray(args.paths)
      ? args.paths.filter((value): value is string => typeof value === "string")
      : []),
  ].filter((value): value is string => Boolean(value));
}

function stringArray(object: Record<string, unknown>, key: string): string[] {
  const value = object[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`INVALID_INPUT: ${key} must be an array of strings`);
  return value.slice(0, 100) as string[];
}

async function memoryMetadata(memory: MemoryStore) {
  return memory.recall({ checkpointLimit: 1, factLimit: 1, changeLimit: 1 });
}

function memoryEnvelope(
  snapshot: Awaited<ReturnType<MemoryStore["recall"]>>,
  data: object,
): Record<string, unknown> {
  const record = data as Record<string, unknown>;
  return {
    ...record,
    workspaceId: snapshot.workspaceId,
    updatedAt: snapshot.updatedAt,
    counts: snapshot.counts,
    truncated: record.truncated === true,
    nextCursor:
      typeof record.nextCursor === "number" ||
      typeof record.nextCursor === "string"
        ? record.nextCursor
        : null,
    sanitized: snapshot.sanitized,
  };
}
