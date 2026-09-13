import { qnectorPerformance, sanitizeText, sanitizeValue } from "@qnector/core";
import type {
  ActivityLogger,
  CodeIntelligenceService,
  FileSearchService,
  MemoryStore,
  MemoryV2Store,
  PlatformServices,
  UiAutomationService,
  FileWatchService,
  ManagedBrowserRuntime,
  GenericLspService,
  LocalSemanticSearchService,
  NativeProcessService,
  ReleaseManager,
  DocumentIntelligenceService,
  WorkflowManager,
  PtyManager,
  AgentSkillService,
} from "@qnector/core";
import type {
  ActivitySkillTrace,
  QnectorConfig,
  ToolError,
  ToolMeta,
  ToolResult,
  ToolAttachment,
} from "@qnector/shared";
import type { ProcessManager } from "@qnector/core";
import type { WorkspaceState } from "@qnector/core";
import { QNECTOR_VERSION } from "@qnector/core";

export interface ToolContext {
  workspace: WorkspaceState;
  processManager: ProcessManager;
  codeIntelligence?: CodeIntelligenceService;
  fileSearch?: FileSearchService;
  uiAutomation?: UiAutomationService;
  fileWatch?: FileWatchService;
  browserRuntime?: ManagedBrowserRuntime;
  genericLsp?: GenericLspService;
  semanticSearch?: LocalSemanticSearchService;
  nativeProcess?: NativeProcessService;
  releaseManager?: ReleaseManager;
  documentIntelligence?: DocumentIntelligenceService;
  workflowManager?: WorkflowManager;
  ptyManager?: PtyManager;
  agentSkills?: AgentSkillService;
  memory?: MemoryStore;
  memoryV2?: MemoryV2Store;
  memoryTaskId?: string;
  platform?: PlatformServices;
  activity: ActivityLogger;
  skillTrace?: SkillTraceState;
  skillTraceStore?: SkillTraceStore;
  getConfig(): QnectorConfig;
  setConfig(config: QnectorConfig): Promise<void>;
}

export interface SkillTraceState {
  routeId?: string;
  query?: string;
  activatedAt?: string;
  skills: Array<{
    name: string;
    allowedTools?: string[];
  }>;
  routingDecisions?: ActivitySkillTrace["routingDecisions"];
}

export interface SkillTraceStore {
  default: SkillTraceState;
  byTaskId: Map<string, SkillTraceState>;
}

function activitySkillTrace(
  context: ToolContext,
  tool: string,
  action: string,
): ActivitySkillTrace | undefined {
  const trace = context.skillTrace;
  if (!trace?.routeId || !trace.query || !trace.activatedAt) return undefined;

  const activatingRoute = tool === "system" && action === "skills_route";
  const skills = trace.skills
    .filter(
      (skill) =>
        activatingRoute ||
        !skill.allowedTools?.length ||
        skill.allowedTools.includes(tool),
    )
    .map((skill) => skill.name);
  if (skills.length === 0) return undefined;

  return {
    routeId: trace.routeId,
    query: trace.query,
    activatedAt: trace.activatedAt,
    skills,
    evidence: activatingRoute ? "activated" : "in_context",
    ...(activatingRoute && trace.routingDecisions?.length
      ? { routingDecisions: trace.routingDecisions }
      : {}),
  };
}

export function argsSummary(input: unknown): string {
  const safe = sanitizeValue(input).value;
  const serialized =
    typeof safe === "string"
      ? sanitizeText(safe).value
      : (JSON.stringify(safe) ?? String(safe ?? ""));
  return serialized.length > 4_000
    ? `${serialized.slice(0, 4_000)}…`
    : serialized;
}

export function errorFromUnknown(
  error: unknown,
  fallbackCode = "TOOL_ERROR",
): ToolError {
  const message = sanitizeText(
    error instanceof Error ? error.message : String(error),
  ).value;
  const match = message.match(/^([A-Z][A-Z0-9_]+):\s*(.*)$/s);
  if (match)
    return {
      code: match[1]!,
      message: match[2] || match[1]!,
      hint: hintForCode(match[1]!),
    };
  return { code: fallbackCode, message, hint: hintForCode(fallbackCode) };
}

function hintForCode(code: string): string | undefined {
  if (code === "PROCESS_NOT_RUNNING")
    return "Use process.list or process.output to inspect the process state.";
  if (code === "PROCESS_NOT_FOUND")
    return "Use process.list to find the current Qnector process ID.";
  if (code === "PTY_NOT_RUNNING")
    return "Use process.pty_list or process.pty_read to inspect the interactive terminal state.";
  if (code === "PTY_NOT_FOUND")
    return "Use process.pty_list to find the current interactive terminal ID.";
  if (code === "PTY_UNAVAILABLE")
    return "Restart or update Qnector and verify the packaged node-pty native runtime is available.";
  if (code === "COMMAND_TIMEOUT")
    return "Use process.start for long-running commands, then poll process.output.";
  if (code === "REVISION_MISMATCH")
    return "Read the file again and retry with the latest expectedSha256, or omit it intentionally.";
  if (code === "ENOENT")
    return "Check the path and active workspace before retrying.";
  if (code === "TSCONFIG_NOT_FOUND")
    return "Point path at a TypeScript project, or pass the tsconfig path explicitly.";
  if (code === "UNSUPPORTED_CAPABILITY")
    return "Update/restart Qnector so the requested capability is available in the active runtime.";
  if (code === "INVALID_POSITION")
    return "Use the 1-based line and column shown by files.read, then retry the Code Intelligence action.";
  if (code === "PROJECT_FILE_NOT_INCLUDED")
    return "Use a file included by the selected tsconfig, or pass the correct tsconfig explicitly.";
  if (code === "ELEMENT_STALE")
    return "Call computer.find or computer.inspect again to obtain a current elementId.";
  if (code === "UIA_WINDOW_NOT_FOUND")
    return "Call computer.windows again and retry with a current windowId.";
  if (code === "UIA_ACTION_UNSUPPORTED")
    return "Inspect the control and use an action supported by its Windows UI Automation pattern.";
  if (code === "UIA_TIMEOUT")
    return "Inspect the current UI state or increase timeoutMs within the bounded limit.";
  if (code === "UIA_OUTCOME_UNKNOWN")
    return "Inspect the current UI state before retrying; the mutation may already have completed and Qnector intentionally did not replay it automatically.";
  if (code === "BROWSER_NODE_NOT_FOUND")
    return "Run browser.query again because DOM node identities can change after reload or navigation.";
  if (code === "BROWSER_TARGET_GONE")
    return "Call browser.tabs or browser.targets again and retry with a current targetId.";
  if (code === "BROWSER_TARGET_NOT_FOUND")
    return "Call browser.tabs to obtain a current targetId, or omit targetId to use the first page.";
  if (code === "BROWSER_AUTOMATION_UNAVAILABLE")
    return "Launch the Qnector managed Chrome/Edge runtime or verify its local DevTools port, then retry.";
  if (code === "BROWSER_WAIT_TIMEOUT")
    return "Inspect the current page with browser.find/get_text/screenshot, or increase timeoutMs and retry.";
  if (code === "BROWSER_EVALUATE_DENIED")
    return "Use browser.query/inspect/computed_style or a read-only expression that does not access cookies, credentials, or browser storage.";
  if (code === "BROWSER_EVALUATE_TOO_LARGE")
    return "Narrow the expression result or increase maxChars within the bounded limit.";
  if (code === "BROWSER_SCREENSHOT_TOO_LARGE")
    return "Lower maxWidth or set fullPage to false and retry the screenshot.";
  if (code === "AGENT_PROVIDER_UNAVAILABLE")
    return "Install or restore the configured agent CLI, then check process.agent_status before retrying.";
  if (code === "AGENT_WORKER_FAILED")
    return "Inspect the agent result/stdout/stderr and retry only after correcting the worker failure.";
  if (code === "WORKFLOW_OWNERSHIP_CONFLICT")
    return "Give coding workers disjoint ownedPaths; parent/child path ownership cannot overlap.";
  if (code === "WORKFLOW_OWNERSHIP_VIOLATION")
    return "Inspect the isolated worktree diff. The worker changed a path outside its declared ownership.";
  return undefined;
}

export function meta(
  startedAt: number,
  truncated = false,
  nextCursor: string | number | null = null,
): ToolMeta {
  return { durationMs: Date.now() - startedAt, truncated, nextCursor };
}

export function success<T>(
  tool: string,
  action: string,
  summary: string,
  data: T,
  startedAt: number,
  truncated = false,
  nextCursor: string | number | null = null,
): ToolResult<T> {
  return {
    ok: true,
    tool,
    action,
    summary,
    data,
    meta: meta(startedAt, truncated, nextCursor),
  };
}

export function failure(
  tool: string,
  action: string,
  error: ToolError,
  startedAt: number,
): ToolResult<never> {
  return {
    ok: false,
    tool,
    action,
    summary: `${error.code}: ${error.message}`,
    error,
    meta: meta(startedAt),
  };
}

export async function runWithActivity<T>(
  context: ToolContext,
  tool: string,
  action: string,
  input: unknown,
  work: () => Promise<T>,
): Promise<ToolResult<T>> {
  const startedAt = Date.now();
  const runningSkillTrace =
    action === "skills_route"
      ? undefined
      : activitySkillTrace(context, tool, action);
  if (context.activity.nonBlockingWrites)
    context.activity.recordBuffered({
      tool,
      action,
      argsSummary: argsSummary(input),
      status: "running",
      ...(runningSkillTrace ? { skillTrace: runningSkillTrace } : {}),
    });
  else
    await context.activity.record({
      tool,
      action,
      argsSummary: argsSummary(input),
      status: "running",
      ...(runningSkillTrace ? { skillTrace: runningSkillTrace } : {}),
    });
  try {
    const result = await work();
    qnectorPerformance.operation(
      "tool",
      `${tool}.${action}`,
      Date.now() - startedAt,
    );
    const output = result as {
      summary?: string;
      truncated?: boolean;
      nextCursor?: string | number | null;
      attachments?: ToolAttachment[];
    };
    const rawSummary =
      output && typeof output === "object" && typeof output.summary === "string"
        ? output.summary
        : `${tool}.${action} completed`;
    const summary = sanitizeText(rawSummary).value;
    const completedSkillTrace = activitySkillTrace(context, tool, action);
    if (context.activity.nonBlockingWrites)
      context.activity.recordBuffered({
        tool,
        action,
        argsSummary: argsSummary(input),
        status: "success",
        durationMs: Date.now() - startedAt,
        outputSize: JSON.stringify(result).length,
        summary,
        ...(completedSkillTrace ? { skillTrace: completedSkillTrace } : {}),
      });
    else
      await context.activity.record({
        tool,
        action,
        argsSummary: argsSummary(input),
        status: "success",
        durationMs: Date.now() - startedAt,
        outputSize: JSON.stringify(result).length,
        summary,
        ...(completedSkillTrace ? { skillTrace: completedSkillTrace } : {}),
      });
    recordMemoryV2Event(context, tool, action, input, "success", summary);
    const response = success(
      tool,
      action,
      summary,
      result,
      startedAt,
      output?.truncated === true,
      output?.nextCursor ?? null,
    );
    if (output?.attachments && isRecord(result)) {
      const data = { ...result } as Record<string, unknown>;
      delete data.attachments;
      return {
        ...response,
        data: data as T,
        attachments: output.attachments,
      };
    }
    return response;
  } catch (error) {
    qnectorPerformance.operation(
      "tool",
      `${tool}.${action}`,
      Date.now() - startedAt,
    );
    const parsed = errorFromUnknown(error);
    const failedSkillTrace =
      action === "skills_route"
        ? undefined
        : activitySkillTrace(context, tool, action);
    if (context.activity.nonBlockingWrites)
      context.activity.recordBuffered({
        tool,
        action,
        argsSummary: argsSummary(input),
        status: "error",
        error: parsed,
        durationMs: Date.now() - startedAt,
        ...(failedSkillTrace ? { skillTrace: failedSkillTrace } : {}),
      });
    else
      await context.activity.record({
        tool,
        action,
        argsSummary: argsSummary(input),
        status: "error",
        error: parsed,
        durationMs: Date.now() - startedAt,
        ...(failedSkillTrace ? { skillTrace: failedSkillTrace } : {}),
      });
    recordMemoryV2Event(
      context,
      tool,
      action,
      input,
      "error",
      `${parsed.code}: ${parsed.message}`,
    );
    return failure(tool, action, parsed, startedAt);
  }
}

function recordMemoryV2Event(
  context: ToolContext,
  tool: string,
  action: string,
  input: unknown,
  status: "success" | "error",
  summary: string,
): void {
  if (!context.memoryV2 || tool === "memory") return;
  const object = isRecord(input) ? input : {};
  if (!isMeaningfulMemoryEvent(tool, action, object, context.memoryTaskId))
    return;
  const paths = collectMemoryPaths(object);
  const workspaceEvidence = collectWorkspaceEvidence(
    context,
    tool,
    object,
    paths,
  );
  try {
    context.memoryV2.recordToolEvent({
      ...(context.memoryTaskId ? { taskId: context.memoryTaskId } : {}),
      source: tool,
      action,
      status,
      summary,
      paths,
      workspaceEvidence,
    });
  } catch {
    // Memory v2 continuity metadata must never change a tool result.
  }
}

function collectMemoryPaths(input: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const key of ["path", "destination", "file", "target", "cwd"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) result.push(value);
  }
  if (Array.isArray(input.paths)) {
    for (const value of input.paths)
      if (typeof value === "string" && value.trim()) result.push(value);
  }
  return [...new Set(result)].slice(0, 50);
}

function collectWorkspaceEvidence(
  context: ToolContext,
  tool: string,
  input: Record<string, unknown>,
  paths: string[],
): string[] {
  if (paths.length > 0) return paths;
  const cwd = input.cwd;
  if (typeof cwd === "string" && cwd.trim()) return [cwd];
  if (tool === "git" || tool === "process")
    return [context.getConfig().activeWorkspace];
  return [];
}

function isMeaningfulMemoryEvent(
  tool: string,
  action: string,
  input: Record<string, unknown>,
  memoryTaskId?: string,
): boolean {
  if (tool === "files")
    return [
      "write",
      "append",
      "replace",
      "multi_edit",
      "apply_patch",
      "mkdir",
      "move",
      "copy",
      "delete",
    ].includes(action);

  if (tool === "git") {
    if (["status", "diff", "log", "show", "rev_parse"].includes(action))
      return false;
    if (action === "branch")
      return input.create === true || input.delete === true;
    return true;
  }

  if (tool === "process")
    return [
      "run",
      "start",
      "stop",
      "kill_tree",
      "pty_start",
      "pty_write",
      "pty_close",
      "task_start",
      "task_cancel",
      "workflow_save",
      "workflow_start",
      "workflow_cancel",
      "workflow_resume",
    ].includes(action);

  if (tool === "browser" || tool === "computer") return Boolean(memoryTaskId);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("INVALID_INPUT: tool input must be a JSON object");
  return input as Record<string, unknown>;
}

export function stringInput(
  input: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`INVALID_INPUT: ${key} is required`);
    return undefined;
  }
  if (typeof value !== "string")
    throw new Error(`INVALID_INPUT: ${key} must be a string`);
  return value;
}

export function numberInput(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`INVALID_INPUT: ${key} must be a number`);
  return value;
}

export function booleanInput(
  input: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`INVALID_INPUT: ${key} must be a boolean`);
  return value;
}

export function version(): string {
  return QNECTOR_VERSION;
}
