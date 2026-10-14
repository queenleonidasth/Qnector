import path from "node:path";

export interface ContentCacheKey {
  path: string;
  fingerprint: string;
  range?: string;
  schemaVersion: string;
}

/** Bounded read-only result cache. Callers supply a content fingerprint, never a timestamp. */
export class ContentCache {
  private readonly entries = new Map<string, { value: unknown; bytes: number }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly generations = new Map<string, number>();
  private bytes = 0;

  public constructor(
    private readonly maxEntries = 128,
    private readonly maxBytes = 32 * 1024 * 1024,
  ) {}

  public async getOrCompute<T>(key: ContentCacheKey, loader: () => Promise<T>): Promise<T> {
    const pathKey = canonicalPath(key.path);
    const id = JSON.stringify([pathKey, key.fingerprint, key.range ?? "*", key.schemaVersion]);
    const cached = this.entries.get(id);
    if (cached) {
      this.entries.delete(id);
      this.entries.set(id, cached);
      return structuredClone(cached.value) as T;
    }
    const active = this.pending.get(id);
    if (active) return active as Promise<T>;
    const generation = this.generations.get(pathKey) ?? 0;
    const work = loader().then((value) => {
      let bytes: number;
      try { bytes = Buffer.byteLength(JSON.stringify(value), "utf8"); }
      catch { return value; }
      if (bytes > this.maxBytes || (this.generations.get(pathKey) ?? 0) !== generation) return value;
      this.entries.set(id, { value: structuredClone(value), bytes });
      this.bytes += bytes;
      while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
        const oldest = this.entries.keys().next().value as string | undefined;
        if (!oldest) break;
        this.bytes -= this.entries.get(oldest)?.bytes ?? 0;
        this.entries.delete(oldest);
      }
      return value;
    }).finally(() => {
      if (this.pending.get(id) === work) this.pending.delete(id);
    });
    this.pending.set(id, work);
    return work;
  }

  public invalidate(filePath: string): void {
    const key = canonicalPath(filePath);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    for (const id of this.entries.keys()) {
      if ((JSON.parse(id) as string[])[0] === key) {
        this.bytes -= this.entries.get(id)?.bytes ?? 0;
        this.entries.delete(id);
      }
    }
    for (const id of this.pending.keys()) if ((JSON.parse(id) as string[])[0] === key) this.pending.delete(id);
  }

  public clear(): void {
    for (const key of this.generations.keys()) this.generations.set(key, this.generations.get(key)! + 1);
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }
}

function canonicalPath(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}
