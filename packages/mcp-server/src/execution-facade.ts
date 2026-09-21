import path from "node:path";
import type { ProcessManager } from "@qnector/core";
import {
  executeDurableTask,
  type DurableTaskToolResult,
} from "./durable-task-tool.js";

/** A read-model facade, not a worker owner. Persistent jobs remain daemon-owned. */
export class ExecutionFacade {
  public constructor(
    private readonly daemonRoot: string,
    private readonly processManager: ProcessManager,
  ) {}

  public async execute(
    workspace: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<DurableTaskToolResult> {
    const action = input.action;
    if (action === "overview") return this.overview(workspace, input);
    if (action === "lookup") return this.lookup(workspace, input);
    return executeDurableTask(this.daemonRoot, workspace, input, signal);
  }

  private sessionTasks(workspace: string) {
    return this.processManager
      .list()
      .filter((task) => sameWorkspaceOrChild(workspace, task.cwd));
  }

  private async overview(
    workspace: string,
    input: Record<string, unknown>,
  ): Promise<DurableTaskToolResult> {
    const action = "overview";
    const limit = input.limit === undefined ? 20 : input.limit;
    if (
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      return invalidInput(action, "limit must be 1..100");
    // Always read daemon truth. An unavailable daemon is an error, not an empty list.
    const durable = await executeDurableTask(this.daemonRoot, workspace, {
      action: "list",
      limit,
    });
    if (!durable.ok)
      return {
        ...durable,
        action,
        summary: "Task overview unavailable: daemon list failed",
      };
    if (!Array.isArray(durable.data))
      return invalidInput(action, "daemon returned an invalid task list");
    const persistent = durable.data.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        taskId: row.taskId,
        kind: "durable" as const,
        taskLifetime: "persistent" as const,
        taskProtocol: "qnector-durable-v1" as const,
        state: row.state,
        outcome: row.outcome,
        createdAt: row.createdAt,
      };
    });
    const session = this.sessionTasks(workspace)
      .slice(0, limit)
      .map((task) => ({
        taskId: task.id,
        kind: "session" as const,
        taskLifetime: "session" as const,
        taskProtocol: "qnector-process-v1" as const,
        state: task.state,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        commandPreview: task.command.slice(0, 160),
      }));
    return {
      ok: true,
      tool: "tasks",
      action,
      summary: `Listed ${persistent.length} daemon task(s) and ${session.length} session task(s)`,
      data: {
        tasks: [...persistent, ...session],
        durableCount: persistent.length,
        sessionCount: session.length,
        perKindLimit: limit,
        // Each source may have further entries; never claim a global total.
        moreMayExist: persistent.length === limit || session.length === limit,
      },
    };
  }

  private async lookup(
    workspace: string,
    input: Record<string, unknown>,
  ): Promise<DurableTaskToolResult> {
    const action = "lookup";
    const taskId = input.taskId;
    if (typeof taskId !== "string" || taskId.length > 256 || !taskId.trim())
      return invalidInput(action, "taskId required (max 256 characters)");
    if (taskId.startsWith("task_")) {
      const result = await executeDurableTask(this.daemonRoot, workspace, {
        action: "get",
        taskId,
      });
      if (!result.ok)
        return { ...result, action, summary: "Task lookup failed" };
      return {
        ok: true,
        tool: "tasks",
        action,
        summary: `Read daemon task ${taskId}`,
        data: {
          ...(result.data as Record<string, unknown>),
          kind: "durable",
          taskLifetime: "persistent",
          taskProtocol: "qnector-durable-v1",
        },
      };
    }
    if (!taskId.startsWith("proc_"))
      return invalidInput(action, "taskId must be a task_ or proc_ handle");
    // ProcessManager is session-only; never suggest an unavailable process survived a restart.
    let task;
    try {
      task = this.processManager.snapshot(taskId);
    } catch {
      return taskNotFound(action);
    }
    if (!sameWorkspaceOrChild(workspace, task.cwd)) return taskNotFound(action);
    return {
      ok: true,
      tool: "tasks",
      action,
      summary: `Read session task ${taskId}`,
      data: {
        ...task,
        taskId,
        kind: "session",
        taskLifetime: "session",
        taskProtocol: "qnector-process-v1",
      },
    };
  }
}

function sameWorkspaceOrChild(workspace: string, cwd: string): boolean {
  const relative = path.relative(path.resolve(workspace), path.resolve(cwd));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}
function invalidInput(action: string, message: string): DurableTaskToolResult {
  return {
    ok: false,
    tool: "tasks",
    action,
    summary: `tasks.${action} failed`,
    error: { code: "INVALID_INPUT", message: `INVALID_INPUT: ${message}` },
  };
}
function taskNotFound(action: string): DurableTaskToolResult {
  return {
    ok: false,
    tool: "tasks",
    action,
    summary: `tasks.${action} failed`,
    error: { code: "TASK_NOT_FOUND", message: "TASK_NOT_FOUND" },
  };
}
