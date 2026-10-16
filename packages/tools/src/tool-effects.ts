/** Read-only classification for action metadata, not an authorization gate. */
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
    "list", "output", "waitAndCollect", "evidence_read", "wait_for_exit", "wait_for_output", "wait_for_port",
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
  tasks: new Set(["get", "list", "wait", "output", "result", "inspect", "doctor", "overview", "lookup"]),};

export function isReadOnlyAction(tool: string, input: unknown): boolean {
  const fields = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const action = fields.action;
  if (typeof action !== "string" || !READ_ONLY_ACTIONS[tool]?.has(action)) return false;
  if (tool === "git" && action === "branch" && (fields.create === true || fields.delete === true)) return false;
  if (tool === "memory") return new Set(["recall", "working_set", "list", "get", "v2_snapshot",
    "v2_inventory", "task_list", "task_get"]).has(action);
  return true;
}
