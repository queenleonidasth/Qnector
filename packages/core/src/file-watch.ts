import { randomUUID } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface FileWatchEvent {
  cursor: number;
  timestamp: string;
  eventType: "rename" | "change";
  path: string;
}

export interface FileWatchSnapshot {
  watchId: string;
  root: string;
  pattern?: string;
  recursive: boolean;
  startedAt: string;
  cursor: number;
  eventCount: number;
}

interface ManagedWatch {
  snapshot: FileWatchSnapshot;
  watcher: FSWatcher;
  events: FileWatchEvent[];
}

export class FileWatchService {
  private readonly watches = new Map<string, ManagedWatch>();
  private readonly maxBufferedEvents = 2_000;

  public start(input: {
    root: string;
    pattern?: string;
    recursive?: boolean;
  }): FileWatchSnapshot {
    const root = path.resolve(input.root);
    if (!existsSync(root)) throw new Error(`ENOENT: ${root}`);
    const recursive = input.recursive !== false;
    const watchId = `watch_${randomUUID()}`;
    const snapshot: FileWatchSnapshot = {
      watchId,
      root,
      ...(input.pattern?.trim() ? { pattern: input.pattern.trim() } : {}),
      recursive,
      startedAt: new Date().toISOString(),
      cursor: 0,
      eventCount: 0,
    };
    const managed: ManagedWatch = {
      snapshot,
      events: [],
      watcher: watch(
        root,
        {
          recursive:
            recursive &&
            (process.platform === "win32" || process.platform === "darwin"),
        },
        (eventType, filename) => {
          const relative = filename ? String(filename) : "";
          const absolute = path.resolve(root, relative || ".");
          if (
            snapshot.pattern &&
            !wildcardMatch(relative.replaceAll("\\", "/"), snapshot.pattern)
          )
            return;
          const event: FileWatchEvent = {
            cursor: snapshot.cursor + 1,
            timestamp: new Date().toISOString(),
            eventType: eventType === "rename" ? "rename" : "change",
            path: absolute,
          };
          snapshot.cursor = event.cursor;
          snapshot.eventCount += 1;
          managed.events.push(event);
          if (managed.events.length > this.maxBufferedEvents)
            managed.events.splice(
              0,
              managed.events.length - this.maxBufferedEvents,
            );
        },
      ),
    };
    managed.watcher.once("error", () => this.stop(watchId));
    this.watches.set(watchId, managed);
    return { ...snapshot };
  }

  public list(): FileWatchSnapshot[] {
    return [...this.watches.values()].map((entry) => ({ ...entry.snapshot }));
  }

  public events(
    watchId: string,
    cursor = 0,
    maxResults = 200,
  ): {
    watchId: string;
    events: FileWatchEvent[];
    cursor: number;
    nextCursor: number;
    truncated: boolean;
  } {
    const managed = this.watches.get(watchId);
    if (!managed) throw new Error(`WATCH_NOT_FOUND: ${watchId}`);
    const limit = Math.max(1, Math.min(Math.floor(maxResults), 1_000));
    const available = managed.events.filter((event) => event.cursor > cursor);
    const selected = available.slice(0, limit);
    return {
      watchId,
      events: selected,
      cursor,
      nextCursor: selected.at(-1)?.cursor ?? cursor,
      truncated: available.length > selected.length,
    };
  }

  public stop(watchId: string): FileWatchSnapshot {
    const managed = this.watches.get(watchId);
    if (!managed) throw new Error(`WATCH_NOT_FOUND: ${watchId}`);
    managed.watcher.close();
    this.watches.delete(watchId);
    return { ...managed.snapshot };
  }

  public stopAll(): void {
    for (const managed of this.watches.values()) managed.watcher.close();
    this.watches.clear();
  }

  public async waitForFile(input: {
    root: string;
    pattern: string;
    timeoutMs?: number;
    intervalMs?: number;
    maxResults?: number;
  }): Promise<{ matches: string[]; elapsedMs: number }> {
    const startedAt = Date.now();
    const timeoutMs = clamp(input.timeoutMs ?? 30_000, 100, 120_000);
    const intervalMs = clamp(input.intervalMs ?? 250, 50, 5_000);
    const maxResults = clamp(input.maxResults ?? 20, 1, 200);
    const root = path.resolve(input.root);
    while (Date.now() - startedAt <= timeoutMs) {
      const matches = await scanMatches(
        root,
        input.pattern,
        maxResults,
        20_000,
      );
      if (matches.length > 0)
        return { matches, elapsedMs: Date.now() - startedAt };
      await delay(intervalMs);
    }
    throw new Error(
      `FILE_WAIT_TIMEOUT: no file matching '${input.pattern}' appeared within ${timeoutMs} ms`,
    );
  }

  public async waitForChange(input: {
    path: string;
    timeoutMs?: number;
    intervalMs?: number;
  }): Promise<{
    path: string;
    before: string;
    after: string;
    elapsedMs: number;
  }> {
    const target = path.resolve(input.path);
    const timeoutMs = clamp(input.timeoutMs ?? 30_000, 100, 120_000);
    const intervalMs = clamp(input.intervalMs ?? 250, 50, 5_000);
    const before = await fingerprint(target);
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      await delay(intervalMs);
      const after = await fingerprint(target);
      if (after !== before)
        return {
          path: target,
          before,
          after,
          elapsedMs: Date.now() - startedAt,
        };
    }
    throw new Error(
      `FILE_WAIT_TIMEOUT: '${target}' did not change within ${timeoutMs} ms`,
    );
  }
}

async function scanMatches(
  root: string,
  pattern: string,
  maxResults: number,
  budget: number,
): Promise<string[]> {
  const info = await stat(root).catch(() => null);
  if (!info) return [];
  if (info.isFile())
    return wildcardMatch(path.basename(root), pattern) ? [root] : [];
  const queue = [root];
  const matches: string[] = [];
  let visited = 0;
  while (queue.length > 0 && visited < budget && matches.length < maxResults) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      visited += 1;
      if (visited > budget) break;
      if (["node_modules", ".git", "dist", "release"].includes(entry.name))
        continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).replaceAll("\\", "/");
        if (
          wildcardMatch(relative, pattern) ||
          wildcardMatch(entry.name, pattern)
        )
          matches.push(absolute);
      }
      if (matches.length >= maxResults) break;
    }
  }
  return matches;
}

async function fingerprint(target: string): Promise<string> {
  const info = await stat(target).catch(() => null);
  if (!info) return "missing";
  return `${info.isDirectory() ? "dir" : "file"}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

function wildcardMatch(value: string, pattern: string): boolean {
  const source = pattern
    .replaceAll("\\", "/")
    .split("")
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`, "i").test(value.replaceAll("\\", "/"));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
