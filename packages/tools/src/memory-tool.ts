import { createHash } from "node:crypto";
import type {
  MemoryActiveState,
  MemoryCategory,
  ToolDefinition,
  ToolResult,
} from "@qnector/shared";
import type { MemoryStore } from "@qnector/core";
import {
  booleanInput,
  getMemoryJournalHealth,
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
    "Local Qnector task memory, separate from ChatGPT Memory. working_set is a compact task brief by default; details=true returns extended diagnostics. record_turn explicitly stores a user-authorized conversation excerpt, not a passive ChatGPT transcript. Data is local and best-effort redacted.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "recall",
          "working_set",
          "health",
          "record_turn",
          "save_checkpoint",
          "note",
          "list",
          "get",
          "set",
          "delete",
          "compact",
          "clear",
          "export",
          "task_start",
          "task_resume",
          "task_list",
          "task_get",
          "task_update",
          "task_complete",
          "task_bind_session",
          "v2_snapshot",
          "v2_inventory",
        ],
      },
      taskId: { type: "string" },
      title: { type: "string" },
      currentTask: { type: "string" },
      taskStatus: {
        type: "string",
        enum: ["active", "idle", "completed", "blocked"],
      },
      sessionId: { type: "string" },
      memoryScope: { type: "string", enum: ["workspace", "task"] },
      importance: { type: "integer", minimum: 0, maximum: 100 },
      eventLimit: { type: "integer", minimum: 1, maximum: 200 },
      taskLimit: { type: "integer", minimum: 1, maximum: 100 },
      inventoryType: { type: "string", enum: ["memories", "tasks"] },
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
      details: { type: "boolean", description: "Opt in to verbose working set with process and command history." },
      sinceRevision: { type: "string", description: "Last working_set revision. Returns a minimal unchanged response if context has not changed." },
      turnId: { type: "string", description: "Caller-stable ID for explicit conversation turn deduplication." },
      role: { type: "string", enum: ["user", "assistant"] },
      consent: { type: "boolean", description: "Must be true: caller explicitly authorizes storing this excerpt locally." },
      text: { type: "string", description: "User-authorized message excerpt; Qnector cannot passively capture ChatGPT messages." },
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
        checkpointLimit: numberInput(object, "checkpointLimit", 3),
        factLimit: numberInput(object, "factLimit", 12),
        changeLimit: numberInput(object, "changeLimit", 12),
        ...(stringInput(object, "query")
          ? { query: stringInput(object, "query") }
          : {}),
      });
      const v2 = context.memoryV2?.snapshot({
        ...(context.memoryTaskId ? { taskId: context.memoryTaskId } : {}),
        eventLimit: numberInput(object, "eventLimit", 12),
        taskLimit: numberInput(object, "taskLimit", 8),
        memoryLimit: numberInput(object, "factLimit", 12),
      });
      return {
        summary: result.available
          ? `Recalled memory for ${result.workspacePath}`
          : "No saved memory for the active workspace",
        data: { ...result, ...(v2 ? { v2 } : {}) },
        truncated: result.truncated,
      };
    }

    if (action === "task_start") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const title = stringInput(object, "title", true)!;
      const task = context.memoryV2.createTask({
        title,
        ...(stringInput(object, "currentTask")
          ? { currentTask: stringInput(object, "currentTask") }
          : {}),
        ...(stringInput(object, "criticalContext")
          ? { criticalContext: stringInput(object, "criticalContext") }
          : {}),
        ...(context.memoryTaskId || stringInput(object, "taskId")
          ? { taskId: context.memoryTaskId ?? stringInput(object, "taskId") }
          : {}),
      });
      const sessionId = context.hostChatSessionId ?? stringInput(object, "sessionId");
      if (sessionId) context.memoryV2.bindSession(sessionId, task.id);
      return {
        summary: `Started Memory v2 task '${task.title}'`,
        data: {
          task,
          taskId: task.id,
          instruction:
            "Pass this taskId as memoryTaskId on every related Qnector tool call in this chat/session so progress stays isolated from other concurrent tasks.",
        },
      };
    }

    if (action === "task_resume") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const resumed = context.memoryV2.resumeTask(stringInput(object, "query"));
      if (resumed.task && (context.hostChatSessionId || stringInput(object, "sessionId")))
        context.memoryV2.bindSession(
          context.hostChatSessionId ?? stringInput(object, "sessionId")!,
          resumed.task.id,
        );
      return {
        summary: resumed.task
          ? `Resumed Memory v2 task '${resumed.task.title}'`
          : "No unambiguous Memory v2 task was found; inspect the task list",
        data: {
          ...resumed,
          ...(resumed.task
            ? { recovery: context.memoryV2.recoveryContext(resumed.task.id) }
            : {}),
          instruction: resumed.task
            ? "Pass the taskId as memoryTaskId on related calls. Read recovery.recentEvents and verify live state before replaying an interrupted operation; successful tool calls are not verified completed steps."
            : "Call memory.task_list and choose a matching task explicitly; start a new task only if none matches. Never guess across concurrent chats.",
        },
      };
    }

    if (action === "task_list") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const tasks = context.memoryV2.listTasks(
        numberInput(object, "taskLimit", 24),
      );
      return {
        summary: `Listed ${tasks.length} Memory v2 task(s)`,
        data: { tasks, workspaceId: context.memoryV2.currentWorkspaceId },
      };
    }

    if (action === "task_get") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const taskId =
        context.memoryTaskId ?? stringInput(object, "taskId", true)!;
      const task = context.memoryV2.getTask(taskId);
      return {
        summary: task
          ? `Read Memory v2 task '${task.title}'`
          : "Memory v2 task not found",
        data: {
          found: Boolean(task),
          task,
          taskId,
          ...(task
            ? { recovery: context.memoryV2.recoveryContext(taskId) }
            : {}),
        },
      };
    }

    if (action === "task_update") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const taskId =
        context.memoryTaskId ?? stringInput(object, "taskId", true)!;
      const status = stringInput(object, "taskStatus");
      if (
        status &&
        !["active", "idle", "completed", "blocked"].includes(status)
      )
        throw new Error(`INVALID_INPUT: unknown task status '${status}'`);
      const task = context.memoryV2.updateTask({
        taskId,
        ...(stringInput(object, "title")
          ? { title: stringInput(object, "title") }
          : {}),
        ...(status
          ? { status: status as "active" | "idle" | "completed" | "blocked" }
          : {}),
        ...(stringInput(object, "currentTask")
          ? { currentTask: stringInput(object, "currentTask") }
          : {}),
        ...(object.completedSteps === undefined
          ? {}
          : { completedSteps: stringArray(object, "completedSteps") }),
        ...(object.pendingSteps === undefined
          ? {}
          : { pendingSteps: stringArray(object, "pendingSteps") }),
        ...(stringInput(object, "criticalContext") !== undefined
          ? { criticalContext: stringInput(object, "criticalContext") }
          : {}),
      });
      return {
        summary: `Updated Memory v2 task '${task.title}'`,
        data: { task, taskId },
      };
    }

    if (action === "task_complete") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const taskId =
        context.memoryTaskId ?? stringInput(object, "taskId", true)!;
      const task = context.memoryV2.completeTask(taskId);
      return {
        summary: `Completed Memory v2 task '${task.title}'`,
        data: { task, taskId },
      };
    }

    if (action === "task_bind_session") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const taskId =
        context.memoryTaskId ?? stringInput(object, "taskId", true)!;
      const sessionId = stringInput(object, "sessionId", true)!;
      context.memoryV2.bindSession(sessionId, taskId);
      return {
        summary: `Bound session to Memory v2 task '${taskId}'`,
        data: { sessionId, taskId },
      };
    }

    if (action === "v2_inventory") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const inventoryType = stringInput(object, "inventoryType", true)!;
      if (inventoryType !== "memories" && inventoryType !== "tasks")
        throw new Error(
          "INVALID_INPUT: inventoryType must be memories or tasks",
        );
      const cursor = numberInput(object, "cursor", 0);
      const limit = numberInput(object, "limit", 100);
      const result =
        inventoryType === "memories"
          ? context.memoryV2.listMemoryPage(cursor, limit)
          : context.memoryV2.listTaskPage(cursor, limit);
      return {
        summary: `Listed ${result.items.length} ${inventoryType} from local workspace`,
        data: {
          ...result,
          inventoryType,
          workspaceId: context.memoryV2.currentWorkspaceId,
        },
        truncated: result.nextCursor !== null,
        nextCursor: result.nextCursor,
      };
    }

    if (action === "v2_snapshot") {
      if (!context.memoryV2)
        throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      const snapshot = context.memoryV2.snapshot({
        ...(context.memoryTaskId ? { taskId: context.memoryTaskId } : {}),
        eventLimit: numberInput(object, "eventLimit", 12),
        taskLimit: numberInput(object, "taskLimit", 8),
      });
      return {
        summary: `Prepared Memory v2 snapshot with ${snapshot.counts.tasks} task(s)`,
        data: snapshot,
      };
    }

    if (action === "health") {
      const snapshot = context.memoryV2?.snapshot({eventLimit: 1, taskLimit: 1, memoryLimit: 1});
      return {
        summary: "Qnector local Memory capture diagnostics",
        data: { journal: getMemoryJournalHealth(), freshness: snapshot?.freshness ?? null,
          counts: snapshot?.counts ?? null, capture: "tool-driven; not passive ChatGPT transcript" },
      };
    }

    if (action === "working_set")
      return workingSetAction(context, memory, stringInput(object, "query"), booleanInput(object, "details", false), stringInput(object, "sinceRevision"));

    if (action === "record_turn") {
      if (!context.memoryV2) throw new Error("MEMORY_V2_UNAVAILABLE: task memory is not configured");
      if (!booleanInput(object, "consent", false))
        throw new Error("MEMORY_TURN_CONSENT_REQUIRED: explicitly opt in to saving this excerpt");
      const role = stringInput(object, "role", true)!;
      if (role !== "user" && role !== "assistant")
        throw new Error("INVALID_INPUT: role must be user or assistant");
      const turnId = stringInput(object, "turnId", true)!;
      const turnText = stringInput(object, "text", true)!;
      if (!turnText.trim() || turnId.length > 200 || turnText.length > 2_000)
        throw new Error("INVALID_INPUT: turnId must be <=200 chars and text 1..2000 chars");
      const event = context.memoryV2.recordToolEvent({
        ...(context.memoryTaskId ? { taskId: context.memoryTaskId } : {}),
        source: "conversation", action: "explicit-turn", status: "success",
        summary: role + ": " + turnText,
        metadata: { role, capture: "explicit-opt-in" },
        dedupeKey: "turn:" + role + ":" + turnId,
      });
      if (!event) throw new Error("MEMORY_TURN_NOT_PERSISTED: conversation event was not saved");
      return {
        summary: "Saved user-authorized Qnector conversation excerpt locally",
        data: { eventId: event.id, taskId: event.taskId, persisted: true,
          timestamp: event.timestamp, capture: "explicit-opt-in-only" },
      };
    }

    if (action === "save_checkpoint") {
      const active = {
        currentTask: stringInput(object, "currentTask", true)!,
        completedSteps: stringArray(object, "completedSteps"),
        pendingSteps: stringArray(object, "pendingSteps"),
        criticalContext: stringInput(object, "criticalContext", true)!,
      };
      const result = await memory.saveCheckpoint({
        ...active,
        ...(stringInput(object, "label")
          ? { label: stringInput(object, "label") }
          : {}),
      });
      if (context.memoryV2) {
        const taskId = context.memoryTaskId ?? context.memoryV2.defaultTaskId;
        if (context.memoryV2.getTask(taskId))
          context.memoryV2.saveTaskCheckpoint(
            taskId,
            active,
            stringInput(object, "label"),
          );
      }
      return {
        summary: "Saved the active Qnector checkpoint",
        data: result,
      };
    }

    if (action === "note" || action === "set") {
      const category = stringInput(object, "category");
      if (category && !categories.includes(category as MemoryCategory))
        throw new Error(`INVALID_INPUT: unknown memory category '${category}'`);
      const key = stringInput(object, "key", true)!;
      const value = stringInput(object, "value", true)!;
      const tags = object.tags === undefined ? [] : stringArray(object, "tags");
      const fact = await memory.upsertNote({
        key,
        value,
        ...(category ? { category: category as MemoryCategory } : {}),
        ...(object.tags === undefined ? {} : { tags }),
      });
      if (context.memoryV2) {
        const memoryScope = stringInput(object, "memoryScope") ?? "workspace";
        context.memoryV2.upsertMemory({
          ...(memoryScope === "task" && context.memoryTaskId
            ? { taskId: context.memoryTaskId, scope: "task" as const }
            : { scope: "workspace" as const }),
          category: (category as MemoryCategory | undefined) ?? "note",
          key,
          value,
          tags,
          importance: numberInput(object, "importance", 50),
        });
      }
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
      if (scope === "all") context.memoryV2?.clearWorkspace();
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

/** Fast task-scoped context. Verbose diagnostic data stays local unless requested. */
async function compactWorkingSetAction(
  context: ToolContext,
  memory: MemoryStore,
  query?: string,
  sinceRevision?: string,
) {
  const recall = await memory.recall({
    checkpointLimit: 1, factLimit: 6, changeLimit: 2,
    ...(query ? { query } : {}),
  });
  const task = context.memoryTaskId
    ? context.memoryV2?.getTask(context.memoryTaskId) : null;
  const v2 = context.memoryV2?.snapshot({
    ...(task ? { taskId: task.id } : {}),
    eventLimit: 3, taskLimit: 1, memoryLimit: 6,
  });
  const source = task ?? recall.state.active;
  const active = source ? {
    currentTask: briefText(source.currentTask, 230),
    pendingSteps: source.pendingSteps.slice(0, 3).map(x => briefText(x, 150)),
    completedSteps: source.completedSteps.slice(-2).map(x => briefText(x, 140)),
    criticalContext: briefText(source.criticalContext, 330),
  } : null;
  const activity = context.activity.list()
    .filter(e => e.status !== "running" && (!task || e.taskId === task.id))
    .slice(-30).reverse();
  const recentErrors = activity.filter(e => e.status === "error").slice(0, 2)
    .map(e => ({ action: e.tool + "." + e.action,
      error: briefText(e.error?.message ?? e.summary ?? "", 150) }));
  const relevantFacts = (v2?.memories.length ? v2.memories : recall.state.facts)
    .slice(0, 5).map(fact => ({
      key: briefText(fact.key, 90),
      category: fact.category,
      value: briefText(fact.value, 180),
    }));
  const recentEvents = (v2?.events ?? []).map(event => ({
    timestamp: event.timestamp,
    action: briefText(event.source + "." + event.action, 70),
    status: event.status,
    summary: briefText(event.summary, 150),
  }));
  const data = {
    mode: "compact",
    workspace: briefText(context.getConfig().activeWorkspace, 180),
    generatedAt: new Date().toISOString(),
    ...(task ? { taskId: task.id } : {}),
    active,
    relevantFacts,
    latestCheckpoint: recall.checkpoints[0] ?
      { id: recall.checkpoints[0].id, createdAt: recall.checkpoints[0].createdAt } : null,
    recentEvents,
    recentErrors,
    resumeHint: briefText(buildResumeHint(active, recentErrors), 185),
    memoryStatus: {
      eventUpdatedAt: task?.lastEventAt ?? null,
      semanticFacts: v2?.counts.memories ?? recall.state.facts.length,
      capture: "explicit-tool-events-only",
    },
    hint: "Use working_set details=true or memory.task_get / memory.recall for deeper history.",
  };
  const revision = createHash("sha256").update(JSON.stringify({
    active: data.active, facts: data.relevantFacts, events: data.recentEvents,
    errors: data.recentErrors, checkpoint: data.latestCheckpoint,
  })).digest("hex").slice(0, 16);
  if (sinceRevision && sinceRevision === revision)
    return { summary: "Qnector task context unchanged", data: {
      mode: "delta", revision, unchanged: true, taskId: task?.id ?? null,
      hint: "Reuse previously received task context; no change to hydrate.",
    } };
  return { summary: "Prepared compact Qnector task working set", data: { ...data, revision } };
}

function briefText(value: string, limit: number): string {
  const safe = value.replace(/\s+/g, " ").trim();
  return safe.length <= limit ? safe : safe.slice(0, limit - 1) + "…";
}

async function workingSetAction(
  context: ToolContext,
  memory: MemoryStore,
  explicitQuery?: string,
  details = false,
  sinceRevision?: string,
) {
  if (!details) return compactWorkingSetAction(context, memory, explicitQuery, sinceRevision);
  const baseRecall = await memory.recall({
    checkpointLimit: 1,
    factLimit: 8,
    changeLimit: 10,
  });
  const activity = context.activity
    .list()
    .filter((entry) => entry.status !== "running")
    .slice(-40)
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
        .listRuns(context.getConfig().activeWorkspace, 5)
        .catch(() => [])
    : [];
  const recentActions = activity.slice(0, 12).map((entry) => ({
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
        factLimit: 8,
        changeLimit: 10,
        query: contextQuery,
      })
    : baseRecall;
  const recentErrors = activity
    .filter((entry) => entry.status === "error")
    .slice(0, 5)
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
      lastFilesRead: fileReads.slice(0, 8),
      lastFilesModified: fileWrites.slice(0, 8),
      lastCommands: commands.slice(0, 8),
      recentErrors,
      managedProcesses: context.processManager.list().slice(-10),
      workflowRuns,
      memoryV2: context.memoryV2?.snapshot({
        ...(context.memoryTaskId ? { taskId: context.memoryTaskId } : {}),
        eventLimit: 8,
        taskLimit: 6,
        memoryLimit: 8,
      }),
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
