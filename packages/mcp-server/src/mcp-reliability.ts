import type { ServerResponse } from "node:http";
import type { ToolResult } from "@qnector/shared";

export const MCP_RESULT_BUDGET_BYTES = 256 * 1024;
export const MCP_IMAGE_BUDGET_BASE64_BYTES = 2 * 1024 * 1024;
export const MCP_SSE_HEARTBEAT_MS = 15_000;

/** A comment is legal in SSE, but would corrupt a JSON response or stdio.
 * Write only after the transport has committed SSE headers, and stop at close.
 * This cannot keep ChatGPT's model stream alive or change a platform deadline. */
export function attachSseHeartbeat(
  response: ServerResponse,
  intervalMs = MCP_SSE_HEARTBEAT_MS,
  onHeartbeat?: () => void,
): () => void {
  let stopped = false;
  let writtenContentType: string | undefined;
  let trailing = "";
  // A heartbeat inside a partially written `data:` line corrupts JSON-RPC.
  // Track the last bytes written and emit comments only between SSE frames.
  const originalWrite = response.write;
  const trackedWrite = ((...args: Parameters<ServerResponse["write"]>) => {
    const chunk: unknown = args[0];
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : null;
    if (text === null) trailing = "incomplete";
    else if (text.length > 0) trailing = (trailing + text.slice(-4)).slice(-4);
    return Reflect.apply(originalWrite, response, args) as boolean;
  }) as typeof response.write;
  response.write = trackedWrite;
  // ServerResponse.getHeader does not include headers passed exclusively to
  // writeHead(status, headers). The fetch-to-Node MCP bridge uses that form.
  const originalWriteHead = response.writeHead;
  const trackedWriteHead = ((...args: Parameters<ServerResponse["writeHead"]>) => {
    const candidate: unknown = args[args.length - 1];
    if (candidate && typeof candidate === "object") {
      const contentType = Array.isArray(candidate)
        ? candidate.find((entry, index) => index > 0 && String(candidate[index - 1]).toLowerCase() === "content-type")
        : Object.entries(candidate as Record<string, unknown>).find(([key]) => key.toLowerCase() === "content-type")?.[1];
      if (typeof contentType === "string") writtenContentType = contentType;
    }
    return Reflect.apply(originalWriteHead, response, args) as ServerResponse;
  }) as typeof response.writeHead;
  response.writeHead = trackedWriteHead;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    response.off("close", stop);
    response.off("finish", stop);
    if (response.writeHead === trackedWriteHead) response.writeHead = originalWriteHead;
    if (response.write === trackedWrite) response.write = originalWrite;
  };
  const timer = setInterval(() => {
    if (response.destroyed || response.writableEnded) { stop(); return; }
    if (!response.headersSent || response.writableNeedDrain ||
        (trailing !== "" && !/\r?\n\r?\n$/.test(trailing))) return;
    const contentType = response.getHeader("content-type") ?? writtenContentType;
    if (typeof contentType !== "string" || !/^text\/event-stream(?:\s*;|\s*$)/i.test(contentType)) return;
    try {
      response.write(": qnector-keepalive\n\n");
      onHeartbeat?.();
    } catch { stop(); }
  }, Math.max(10, intervalMs));
  timer.unref();
  response.once("close", stop);
  response.once("finish", stop);
  return stop;
}

/** MCP progress is a separate channel from SSE comments. Only a client-supplied
 * progressToken allows sending it; it cannot bypass the platform's hard limit. */
export async function withToolProgressHeartbeat<T>(options: {
  progressToken?: string | number;
  notify: (notification: {method: "notifications/progress";
    params: {progressToken: string | number; progress: number}}) => Promise<void>;
  signal?: AbortSignal;
  intervalMs?: number;
  onSent?: (count: number) => void;
  onError?: (error: unknown) => void;
}, work: () => Promise<T>): Promise<T> {
  if (options.progressToken === undefined) return work();
  const token = options.progressToken;
  let count = 0;
  let stopped = false;
  let reportedError = false;
  const reportError = (error: unknown): void => {
    if (reportedError) return;
    reportedError = true;
    try { options.onError?.(error); } catch { /* diagnostics are non-fatal */ }
  };
  const tick = (): void => {
    if (stopped || options.signal?.aborted) return;
    const progress = ++count;
    try {
      void options.notify({method: "notifications/progress", params: {
        progressToken: token, progress,
      }}).then(() => options.onSent?.(progress)).catch(reportError);
    } catch (error) {
      reportError(error); // A failed heartbeat must never fail the tool.
    }
  };
  const stop = (): void => { stopped = true; clearInterval(timer); };
  const timer = setInterval(tick, Math.max(10, options.intervalMs ?? 10_000));
  timer.unref();
  options.signal?.addEventListener("abort", stop, {once: true});
  try {
    return await work();
  } finally {
    stop();
    options.signal?.removeEventListener("abort", stop);
  }
}

/** Preserve execution truth and continuation metadata, never cut JSON midway.
 * Oversized opaque data/images are omitted explicitly; the caller must page or
 * narrow the query, not assume the operation failed or retry side effects. */
export function boundMcpToolResult(result: ToolResult): ToolResult {
  const {attachments, ...json} = result;
  const jsonBytes = Buffer.byteLength(JSON.stringify(json), "utf8");
  const imageBytes = attachments?.reduce((sum, image) => sum + Buffer.byteLength(image.dataBase64, "utf8"), 0) ?? 0;
  if (jsonBytes <= MCP_RESULT_BUDGET_BYTES && imageBytes <= MCP_IMAGE_BUDGET_BASE64_BYTES) return result;
  const oversizedData = jsonBytes > MCP_RESULT_BUDGET_BYTES;
  const oversizedImage = imageBytes > MCP_IMAGE_BUDGET_BASE64_BYTES;
  const safeFields: Record<string, unknown> = {};
  if (json.data && typeof json.data === "object" && !Array.isArray(json.data)) {
    const source = json.data as Record<string, unknown>;
    for (const key of ["taskId", "processId", "runId", "sessionId", "cursor", "nextCursor", "state", "status", "path", "sha256"] as const) {
      const value = source[key];
      if ((typeof value === "string" && value.length <= 256) ||
          (typeof value === "number" && Number.isSafeInteger(value))) safeFields[key] = value;
    }
  }
  return {
    ok: json.ok,
    tool: json.tool,
    action: json.action,
    summary: json.summary.slice(0, 2_000),
    ...(json.error ? {error: {code: json.error.code.slice(0, 128),
      message: json.error.message.slice(0, 2_000),
      ...(json.error.hint ? {hint: json.error.hint.slice(0, 500)} : {})}} : {}),
    data: oversizedData
      ? {...safeFields, payloadOmitted: true, reason: "structured-data", originalBytes: jsonBytes,
        hint: "Operation already ran. Request smaller maxBytes/limit, follow nextCursor, or inspect the task ID; do not replay a mutation.",
        ...(oversizedImage ? {imageOmitted: true} : {})}
      : oversizedImage && json.data && typeof json.data === "object" && !Array.isArray(json.data)
        ? {...json.data, imageOmitted: true, imageBytes,
          imageHint: "Reduce screenshot maxWidth or fullPage and request again only if the capture is read-only."}
        : json.data,
    meta: {...json.meta, truncated: true},
    ...(oversizedImage ? {} : attachments ? {attachments} : {}),
  };
}
