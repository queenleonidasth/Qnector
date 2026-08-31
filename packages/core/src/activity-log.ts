import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActivityEntry, ToolError } from "@qnector/shared";
import type { ActivityExportOptions } from "@qnector/shared";
import { sanitizeText, sanitizeValue } from "./secret-sanitizer.js";

export interface ActivityEvent {
  type: "activity:new";
  entry: ActivityEntry;
}

interface PendingActivityWrite {
  line: string;
  bytes: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class ActivityLogger {
  private readonly entries: ActivityEntry[] = [];
  private readonly listeners = new Set<(event: ActivityEvent) => void>();
  private persistedBytes = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly pendingWrites: PendingActivityWrite[] = [];
  private drainScheduled = false;

  public constructor(
    private readonly file: string,
    private readonly maxEntries = 500,
    private readonly maxFileBytes = 10_000_000,
  ) {}

  public async load(): Promise<ActivityEntry[]> {
    this.entries.length = 0;
    try {
      const raw = await readFile(this.file, "utf8");
      this.persistedBytes = Buffer.byteLength(raw, "utf8");
      for (const line of raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-this.maxEntries)) {
        try {
          const parsed = JSON.parse(line) as ActivityEntry;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            continue;
          const safe = sanitizeValue(parsed).value as ActivityEntry;
          this.entries.push({
            ...safe,
            argsSummary: sanitizeArgsSummary(safe.argsSummary ?? ""),
          });
        } catch {
          // Ignore malformed historical lines so the app can still start.
        }
      }
      if (this.persistedBytes > this.maxFileBytes)
        await this.queuePersist(() => this.compactFile());
    } catch {
      // No log on first run.
      this.persistedBytes = 0;
    }
    return this.list();
  }

  public list(): ActivityEntry[] {
    return [...this.entries];
  }

  public filter(options: ActivityExportOptions = {}): ActivityEntry[] {
    const from = options.from
      ? Date.parse(options.from)
      : Number.NEGATIVE_INFINITY;
    const to = options.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;
    return this.entries.filter((entry) => {
      const timestamp = Date.parse(entry.timestamp);
      return (
        (!options.tool || entry.tool === options.tool) &&
        (!options.status || entry.status === options.status) &&
        timestamp >= from &&
        timestamp <= to
      );
    });
  }

  public export(
    format: "json" | "markdown",
    options: ActivityExportOptions = {},
  ): string {
    const entries = sanitizeValue(this.filter(options))
      .value as ActivityEntry[];
    if (format === "json") return `${JSON.stringify(entries, null, 2)}\n`;
    const lines = [
      "# Qnector Activity Export",
      "",
      `- Entries: ${entries.length}`,
      `- Exported: ${new Date().toISOString()}`,
      "",
      "| Timestamp | Tool | Action | Status | Duration | Summary |",
      "| --- | --- | --- | --- | ---: | --- |",
      ...entries.map(
        (entry) =>
          `| ${entry.timestamp} | ${escapeMarkdown(entry.tool)} | ${escapeMarkdown(entry.action)} | ${entry.status} | ${entry.durationMs ?? ""} | ${escapeMarkdown(entry.summary ?? "")} |`,
      ),
      "",
    ];
    return `${lines.join("\n")}\n`;
  }

  public subscribe(listener: (event: ActivityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async record(
    input: Omit<ActivityEntry, "id" | "timestamp"> & {
      id?: string;
      timestamp?: string;
    },
  ): Promise<ActivityEntry> {
    const entry: ActivityEntry = {
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      tool: input.tool,
      action: input.action,
      argsSummary: sanitizeArgsSummary(input.argsSummary),
      status: input.status,
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: input.durationMs }),
      ...(input.outputSize === undefined
        ? {}
        : { outputSize: input.outputSize }),
      ...(input.summary === undefined
        ? {}
        : { summary: sanitizeText(input.summary).value }),
      ...(input.error === undefined
        ? {}
        : { error: sanitizeValue(input.error).value as ToolError }),
    };
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) this.entries.shift();
    const line = `${JSON.stringify(entry)}\n`;
    await this.enqueuePersist(line, Buffer.byteLength(line, "utf8"));
    const event = { type: "activity:new" as const, entry };
    for (const listener of this.listeners) listener(event);
    return entry;
  }

  private async compactFile(
    entries: readonly ActivityEntry[] = this.entries,
  ): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const content = entries.length
      ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
      : "";
    await writeFile(this.file, content, "utf8");
    this.persistedBytes = Buffer.byteLength(content, "utf8");
  }

  private enqueuePersist(line: string, bytes: number): Promise<void> {
    const pending = new Promise<void>((resolve, reject) => {
      this.pendingWrites.push({ line, bytes, resolve, reject });
    });
    this.scheduleDrain();
    return pending;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      void this.drainPendingWrites();
    });
  }

  private async drainPendingWrites(): Promise<void> {
    if (this.pendingWrites.length === 0) return;
    const batch = this.pendingWrites.splice(0);
    const entriesSnapshot = [...this.entries];
    const content = batch.map((entry) => entry.line).join("");
    const bytes = batch.reduce((total, entry) => total + entry.bytes, 0);
    try {
      await this.queuePersist(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        if (this.persistedBytes + bytes > this.maxFileBytes)
          await this.compactFile(entriesSnapshot);
        else {
          await appendFile(this.file, content, "utf8");
          this.persistedBytes += bytes;
        }
      });
      for (const entry of batch) entry.resolve();
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    } finally {
      if (this.pendingWrites.length > 0) this.scheduleDrain();
    }
  }

  private async queuePersist(work: () => Promise<void>): Promise<void> {
    const current = this.writeQueue.then(work);
    this.writeQueue = current.catch(() => undefined);
    await current;
  }

  public async flush(): Promise<void> {
    do {
      await this.drainPendingWrites();
      await this.writeQueue;
    } while (this.pendingWrites.length > 0);
  }

  public async error(
    tool: string,
    action: string,
    argsSummary: string,
    error: ToolError,
    durationMs: number,
  ): Promise<ActivityEntry> {
    return this.record({
      tool,
      action,
      argsSummary,
      status: "error",
      error,
      durationMs,
    });
  }
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function sanitizeArgsSummary(value: string): string {
  try {
    return JSON.stringify(sanitizeValue(JSON.parse(value)).value);
  } catch {
    return sanitizeText(value).value;
  }
}
