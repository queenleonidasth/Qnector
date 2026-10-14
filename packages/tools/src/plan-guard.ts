import path from "node:path";
import type { ToolContext } from "./tool-result.js";

const READ_ONLY_ACTIONS: Record<string, ReadonlySet<string>> = {
  files: new Set(["read", "read_many", "preview", "inspect", "extract_text", "render", "document_query", "hash"]),
  workspace: new Set([
    "get", "list_recent", "tree", "list", "glob", "grep", "stat", "summary",
    "diagnostics", "document_symbols", "document_outline", "definition",
    "references", "hover", "rename_locations", "workspace_symbols", "semantic_search",
    "lsp_status", "lsp_document_symbols", "lsp_workspace_symbols", "lsp_definition",
    "lsp_references", "lsp_hover", "watch_events", "wait_for_file", "wait_for_change",
  ]),
  process: new Set([
    "list", "output", "wait_for_exit", "wait_for_output", "wait_for_port",
    "pty_read", "pty_list", "task_get", "task_list", "workflow_list",
    "workflow_get", "workflow_wait", "workflow_result", "workflow_status", "workflow_runs",
  ]),
  git: new Set(["status", "diff", "log", "show", "branch", "rev_parse"]),
  browser: new Set([
    "status", "targets", "tabs", "console", "network_errors", "find",
    "get_text", "get_value", "get_attributes", "wait", "screenshot", "dom_snapshot",
    "query", "inspect", "computed_style", "requests", "performance", "profile_status",
  ]),
  computer: new Set(["windows", "inspect", "find", "wait"]),
  system: new Set([
    "info", "status", "build_info", "release_status", "context_snapshot",
    "performance", "processes", "process_info", "find_process", "ports", "doctor",
    "mcp_servers", "mcp_tools", "skills_status", "skills_list", "skills_match",
    "skills_search_remote", "skill_get", "skill_validate", "everything_status",
    "which", "search_files", "env", "clipboard_read", "screen_capture", "window_list",
  ]),
  memory: new Set([
    "recall", "working_set", "health", "list", "get", "v2_snapshot", "v2_inventory",
    "task_start", "task_resume", "task_list", "task_get", "task_update",
    "task_complete", "task_bind_session", "save_checkpoint", "note", "set", "record_turn",
  ]),
  tasks: new Set(["get", "list", "wait", "output", "result", "inspect", "doctor", "overview", "lookup"]),
  mode: new Set(["get", "begin", "update", "back_to_plan", "step", "approve"]),
};

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
}

export function isPlanSafeAction(tool: string, input: unknown): boolean {
  const object = inputRecord(input);
  const action = object.action;
  if (typeof action !== "string" || !READ_ONLY_ACTIONS[tool]?.has(action))
    return false;
  // A Git branch listing is safe; creation or deletion is not.
  if (tool === "git" && action === "branch" && (object.create === true || object.delete === true))
    return false;
  return true;
}

/** Stronger filter for a readOnlyHint=true MCP alias. Plan Mode also allows
 * task metadata writes, but a read-only tool must not. */
export function isPureReadAction(tool: string, input: unknown): boolean {
  if (tool === "mode") return inputRecord(input).action === "get";
  if (!isPlanSafeAction(tool, input)) return false;
  if (tool === "memory") {
    return new Set(["recall", "working_set", "list", "get", "v2_snapshot",
      "v2_inventory", "task_list", "task_get"]).has(
      String(inputRecord(input).action ?? ""));
  }
  return true;
}

/** Caller scopes come from a verified MCP host context or the explicit task handle.
 * MCP task handles are context correlation, NOT identity/authentication tokens. */
export function planScopeForCall(context: ToolContext, input: unknown): string | undefined {
  const candidate = inputRecord(input).memoryTaskId;
  const taskId = typeof candidate === "string" && candidate.trim()
    ? candidate.trim() : context.memoryTaskId;
  if (taskId) return "task:" + taskId;
  if (context.modeSessionId) return "session:" + context.modeSessionId;
  return undefined;
}

export interface PlanGuardResult {
  allowed: boolean;
  code?: "PLAN_MODE_READ_ONLY" | "PLAN_SCOPE_REQUIRED";
  message?: string;
}

export async function checkPlanActGuard(
  context: ToolContext, tool: string, input: unknown,
): Promise<PlanGuardResult> {
  // Legacy runtimes or isolated tool tests without the feature preserve existing behavior.
  if (!context.planActStore || tool === "mode") return { allowed: true };
  if (isPlanSafeAction(tool, input)) return { allowed: true };
  const scope = planScopeForCall(context, input);
  const workspace = context.getConfig().activeWorkspace;
  if (!scope) {
    if (await context.planActStore.hasActivePlan(workspace))
      return {
        allowed: false, code: "PLAN_SCOPE_REQUIRED",
        message: "A Plan Mode task is active. Provide its memoryTaskId, or an MCP chat session, before any write/action call.",
      };
    return { allowed: true };
  }
  const state = await context.planActStore.get(scope, workspace);
  if (state.plan) {
    const planWorkspace = path.resolve(state.workspace);
    const activeWorkspace = path.resolve(workspace);
    const sameWorkspace = process.platform === "win32"
      ? planWorkspace.toLowerCase() === activeWorkspace.toLowerCase()
      : planWorkspace === activeWorkspace;
    if (!sameWorkspace)
      return {
        allowed: false, code: "PLAN_SCOPE_REQUIRED",
        message: "This task's Plan/Act approval belongs to a different workspace. Start and approve a new plan for the active workspace before making changes.",
      };
  }
  if (state.mode === "plan")
    return {
      allowed: false, code: "PLAN_MODE_READ_ONLY",
      message: tool + "." + String(inputRecord(input).action ?? "unknown") +
        " is not allowed in Plan Mode. Review the plan, then call mode_approve after explicit user approval.",
    };
  return { allowed: true };
}
