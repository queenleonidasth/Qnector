import { daemonRequest } from "@qnector/daemon/client";
import path from "node:path";

/** Explicit opt-in MCP facade. Never constructs a daemon or owns a worker. */
export const durableTaskSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {type: "string", enum: ["start", "get", "list", "wait", "output", "result", "cancel", "inspect", "doctor"]},
    taskId: {type: "string", description: "Durable task ID returned by start."},
    idempotencyKey: {type: "string", description: "Caller-generated stable key: reuse for a retry after lost response."},
    command: {
      type: "object", additionalProperties: false,
      properties: {
        kind: {type: "string", enum: ["direct", "shell"]},
        file: {type: "string"}, args: {type: "array", items: {type: "string"}},
        shell: {type: "string", enum: ["powershell", "cmd"]}, command: {type: "string"},
      },
      required: ["kind"],
    },
    timeoutMs: {type: "integer", minimum: 1, maximum: 3600000, description: "Execution timeout; not MCP wait timeout."},
    waitTimeoutMs: {type: "integer", minimum: 0, maximum: 20000},
    limit: {type: "integer", minimum: 1, maximum: 100},
    stream: {type: "string", enum: ["stdout", "stderr"]},
    cursor: {type: "integer", minimum: 0},
    maxBytes: {type: "integer", minimum: 1, maximum: 32768},
  },
  required: ["action"],
} as const;

export interface DurableTaskToolResult {
  ok: boolean;
  tool: "tasks";
  action: string;
  summary: string;
  data?: unknown;
  error?: {code: string; message: string};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256)
    throw new Error(`INVALID_INPUT: ${name} required (max 256 characters)`);
  return value;
}

function bounded(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`INVALID_INPUT: ${name} must be ${min}..${max}`);
  return value;
}

/** The active workspace is pinned per call; a client cannot select an arbitrary root. */
export async function executeDurableTask(
  root: string,
  workspace: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DurableTaskToolResult> {
  const action = typeof input.action === "string" ? input.action : "unknown";
  try {
    const allowed = ["start", "get", "list", "wait", "output", "result", "cancel", "inspect", "doctor"];
    if (!allowed.includes(action)) throw new Error("INVALID_INPUT: action unsupported");
    let request: Record<string, unknown>;
    let timeout = 5_000;
    if (action === "start") {
      const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
      if (!input.command || typeof input.command !== "object" || Array.isArray(input.command))
        throw new Error("INVALID_INPUT: command required");
      const command = input.command as Record<string, unknown>;
      if (command.kind === "direct") {
        if (typeof command.file !== "string" || !command.file ||
            !Array.isArray(command.args) || command.args.some(arg => typeof arg !== "string"))
          throw new Error("INVALID_INPUT: direct file and args required");
        request = {action: "submit", workspace, idempotencyKey,
          command: {kind: "direct", file: command.file, args: command.args}};
      } else if (command.kind === "shell") {
        if (!["powershell", "cmd"].includes(String(command.shell)) ||
            typeof command.command !== "string" || !command.command)
          throw new Error("INVALID_INPUT: shell command required");
        request = {action: "submit", workspace, idempotencyKey,
          command: {kind: "shell", shell: command.shell, command: command.command}};
      } else throw new Error("INVALID_INPUT: command kind unsupported");
      // Default to an immediate durable acknowledgement. Waiting is opt-in:
      // an MCP response must not remain blocked behind the command itself.
      const waitMs = bounded(input.waitTimeoutMs, 0, 0, 5_000, "waitTimeoutMs");
      request.timeoutMs = bounded(input.timeoutMs, 120_000, 1, 3_600_000, "timeoutMs");
      // Never pass the request's AbortSignal to submission: acceptance is durable
      // even when the browser disappears after the DB transaction commits.
      const accepted = await daemonRequest(root, request, timeout);
      if (!accepted.ok) throw new Error(accepted.error ?? "DAEMON_REJECTED");
      const handle = accepted.data as {taskId: string; reused: boolean; state: string};
      let state = handle.state;
      let nextAction = "wait";
      if (waitMs > 0 && !signal?.aborted) {
        try {
          const waited = await daemonRequest(root, {action: "wait", taskId: handle.taskId,
            waitTimeoutMs: waitMs}, waitMs + 1_500, signal);
          if (waited.ok) {
            const data = waited.data as {state: string; nextAction: string};
            state = data.state;
            nextAction = data.nextAction;
          }
        } catch {
          // Accepted is already committed. A lost waiter must not mark the job
          // failed or cancel it; return the original durable handle instead.
        }
      }
      return {ok: true, tool: "tasks", action, summary: `Durable task ${handle.taskId}: ${state}`,
        data: {taskId: handle.taskId, reused: handle.reused, state, nextAction}};
    }
    if (action === "doctor") request = {action};
    else if (action === "list") request = {action, workspace,
      limit: bounded(input.limit, 20, 1, 100, "limit")};
    else {
      const taskId = requiredString(input.taskId, "taskId");
      // A task handle from another workspace must not read, wait for, or cancel
      // work outside the active workspace pinned by this MCP connection.
      const owner = await daemonRequest(root, {action: "get", taskId}, timeout);
      if (!owner.ok) throw new Error(owner.error ?? "DAEMON_REJECTED");
      const task = owner.data as {workspace?: string} | null;
      const canonical = (value: string): string => {
        const resolved = path.resolve(value);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
      };
      if (!task?.workspace || canonical(task.workspace) !== canonical(workspace))
        throw new Error("TASK_NOT_FOUND");
      request = {action, taskId};
      if (action === "wait") {
        const waitMs = bounded(input.waitTimeoutMs, 10_000, 0, 20_000, "waitTimeoutMs");
        request.waitTimeoutMs = waitMs;
        timeout = waitMs + 1_500;
      }
      if (action === "output") {
        if (input.stream !== "stdout" && input.stream !== "stderr")
          throw new Error("INVALID_INPUT: stream required");
        request.stream = input.stream;
        request.cursor = bounded(input.cursor, 0, 0, Number.MAX_SAFE_INTEGER, "cursor");
        request.maxBytes = bounded(input.maxBytes, 32_768, 1, 32_768, "maxBytes");
      }
    }
    const result = await daemonRequest(root, request, timeout,
      action === "wait" ? signal : undefined);
    if (!result.ok) throw new Error(result.error ?? "DAEMON_REJECTED");
    return {ok: true, tool: "tasks", action, summary: `Durable tasks.${action} completed`, data: result.data};
  } catch (error) {
    const message = error instanceof Error ? error.message : "TASK_API_ERROR";
    const code = message.startsWith("INVALID_INPUT") ? "INVALID_INPUT" :
      message.startsWith("IPC_") ? "IPC_UNAVAILABLE" : message === "TASK_NOT_FOUND" ?
      "TASK_NOT_FOUND" : message === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "TASK_API_ERROR";
    return {ok: false, tool: "tasks", action,
      summary: `Durable tasks.${action} failed`, error: {code, message}};
  }
}
