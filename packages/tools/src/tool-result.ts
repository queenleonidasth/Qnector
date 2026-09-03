import { qnectorPerformance, sanitizeText, sanitizeValue } from "@qnector/core";
import type {
  ActivityLogger,
  CodeIntelligenceService,
  FileSearchService,
  MemoryStore,
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
} from "@qnector/core";
import type {
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
  memory?: MemoryStore;
  platform?: PlatformServices;
  activity: ActivityLogger;
  getConfig(): QnectorConfig;
  setConfig(config: QnectorConfig): Promise<void>;
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
  if (context.activity.nonBlockingWrites)
    context.activity.recordBuffered({
      tool,
      action,
      argsSummary: argsSummary(input),
      status: "running",
    });
  else
    await context.activity.record({
      tool,
      action,
      argsSummary: argsSummary(input),
      status: "running",
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
    if (context.activity.nonBlockingWrites)
      context.activity.recordBuffered({
        tool,
        action,
        argsSummary: argsSummary(input),
        status: "success",
        durationMs: Date.now() - startedAt,
        outputSize: JSON.stringify(result).length,
        summary,
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
      });
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
    if (context.activity.nonBlockingWrites)
      context.activity.errorBuffered(
        tool,
        action,
        argsSummary(input),
        parsed,
        Date.now() - startedAt,
      );
    else
      await context.activity.error(
        tool,
        action,
        argsSummary(input),
        parsed,
        Date.now() - startedAt,
      );
    return failure(tool, action, parsed, startedAt);
  }
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
