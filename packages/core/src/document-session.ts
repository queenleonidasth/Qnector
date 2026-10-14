import { runtimeResourceBudget } from "./resource-budget.js";

const MAX_ENTRIES = 24;
const MAX_BYTES = 16 * 1024 * 1024;
const inFlight = new Map<string, Promise<unknown>>();

/** Cache immutable parse results by canonical path plus a content fingerprint and options. */
export async function withDocumentSession<T>(
  path: string,
  revision: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const key = `${path}\0${revision}`;
  const cached = runtimeResourceBudget.get<T>(key);
  if (cached) {
    return structuredClone(cached) as T;
  }
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fn().then((value) => {
    let bytes = 0;
    try { bytes = Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return value; }
    if (bytes > MAX_BYTES) return value;
    if (!signal?.aborted) runtimeResourceBudget.put({ key, bytes, value: structuredClone(value), priority: "interactive" });
    while (runtimeResourceBudget.snapshot().entries > MAX_ENTRIES || runtimeResourceBudget.totalCacheBytes > MAX_BYTES) {
      // Document sessions are low-cost and disposable; evict their oldest LRU entries first.
      const removed = runtimeResourceBudget.evictOldest((entry) => entry.key.includes("\0"));
      if (!removed) break;
    }
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export function clearDocumentSessions(): void {
  runtimeResourceBudget.evict((entry) => entry.key.includes("\0"));
  inFlight.clear();
}
