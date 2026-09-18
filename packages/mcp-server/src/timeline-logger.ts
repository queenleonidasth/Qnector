import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

export type TimelinePhase =
  | "request_received" | "rpc_parsed" | "tool_start" | "tool_progress"
  | "keepalive_sent" | "tool_end" | "response_written"
  | "response_flushed" | "stream_closed" | "client_aborted" | "error";

export interface TimelineContext {
  readonly requestId: string;
  readonly startedAt: number;
}

export interface TimelineEvent {
  requestId: string;
  toolName?: string;
  phase: TimelinePhase;
  tSinceRequestMs: number;
  wallClock: string;
  detail?: Record<string, string | number | boolean>;
}

export function timelineLogPath(configFile?: string, date = new Date()): string {
  const root = configFile
    ? path.dirname(configFile)
    : path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "Qnector");
  return path.join(root, "logs", `timeline-${date.toISOString().slice(0, 10).replaceAll("-", "")}.ndjson`);
}

/** Metadata-only, best-effort diagnostics. No command arguments, file contents,
 * stdout, tool payload, credentials or URLs are recorded. */
export class TimelineLogger {
  private readonly storage = new AsyncLocalStorage<TimelineContext>();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly file: string | (() => string)) {}

  start(requestId = randomUUID()): TimelineContext {
    return {requestId, startedAt: performance.now()};
  }

  current(): TimelineContext | undefined {
    return this.storage.getStore();
  }

  run<T>(context: TimelineContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  record(context: TimelineContext | undefined, phase: TimelinePhase,
    detail?: Record<string, string | number | boolean>, toolName?: string): void {
    if (!context) return;
    const event: TimelineEvent = {
      requestId: context.requestId,
      phase,
      tSinceRequestMs: Math.max(0, Math.round(performance.now() - context.startedAt)),
      wallClock: new Date().toISOString(),
      ...(toolName ? {toolName} : {}),
      ...(detail ? {detail} : {}),
    };
    const line = `${JSON.stringify(event)}\n`;
    const file = typeof this.file === "string" ? this.file : this.file();
    this.pending = this.pending.then(async () => {
      await mkdir(path.dirname(file), {recursive: true});
      await appendFile(file, line, "utf8");
    }).catch(() => {
      // A full/unavailable log volume must never fail a tool or its response.
    });
  }

  async flush(): Promise<void> {
    await this.pending;
  }
}
