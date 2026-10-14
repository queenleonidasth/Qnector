const MAX_ENTRIES = 24;
const MAX_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, { value: unknown; bytes: number }>();
const inFlight = new Map<string, Promise<unknown>>();
let cacheBytes = 0;

/** Cache immutable parse results by canonical path plus a content fingerprint and options. */
export async function withDocumentSession<T>(
  path: string,
  revision: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${path}\0${revision}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return structuredClone(cached.value) as T;
  }
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fn().then((value) => {
    let bytes = 0;
    try { bytes = Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return value; }
    if (bytes > MAX_BYTES) return value;
    cache.set(key, { value: structuredClone(value), bytes });
    cacheBytes += bytes;
    while (cache.size > MAX_ENTRIES || cacheBytes > MAX_BYTES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) break;
      cacheBytes -= cache.get(oldest)?.bytes ?? 0;
      cache.delete(oldest);
    }
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export function clearDocumentSessions(): void {
  cache.clear();
  inFlight.clear();
  cacheBytes = 0;
}
