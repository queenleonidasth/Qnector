import path from "node:path";
import { runtimeResourceBudget } from "./resource-budget.js";

const MAX_ENTRIES = 24;
const MAX_BYTES = 16 * 1024 * 1024;
const PREFIX = "document:";
const inFlight = new Map<string, Promise<unknown>>();

function documentPrefix(filePath: string): string {
  const resolved = path.normalize(path.resolve(filePath));
  const canonical = process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  return PREFIX + canonical + "\0";
}

/** Share only immutable extraction results with a matching content revision. */
export async function withDocumentSession<T>(
  filePath: string,
  revision: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const key = documentPrefix(filePath) + revision;
  const cached = runtimeResourceBudget.get<T>(key);
  if (cached !== undefined) return structuredClone(cached);
  const current = inFlight.get(key);
  if (current) return current as Promise<T>;
  const pending = fn().then((value) => {
    // The source may have been invalidated/cleared while the loader ran.
    // A detached in-flight parse must never resurrect stale cached output.
    if (signal?.aborted || inFlight.get(key) !== pending) return value;
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      return value;
    }
    if (bytes <= MAX_BYTES) {
      runtimeResourceBudget.put({ key, bytes, value: structuredClone(value), priority: "interactive" });
      while (
        runtimeResourceBudget.snapshot().entries > MAX_ENTRIES ||
        runtimeResourceBudget.totalCacheBytes > MAX_BYTES
      ) {
        if (!runtimeResourceBudget.evictOldest((entry) => entry.key.startsWith(PREFIX))) break;
      }
    }
    return value;
  }).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

/** Drop cached results when the source file changes or its watcher invalidates. */
export function invalidateDocumentSession(filePath: string): void {
  const prefix = documentPrefix(filePath);
  runtimeResourceBudget.evict((entry) => entry.key.startsWith(prefix));
  for (const key of inFlight.keys()) if (key.startsWith(prefix)) inFlight.delete(key);
}

export function clearDocumentSessions(): void {
  runtimeResourceBudget.evict((entry) => entry.key.startsWith(PREFIX));
  inFlight.clear();
}
