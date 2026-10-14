/** Bounded in-process resource accounting for optional speculative work. */
export const RESOURCE_LIMITS = Object.freeze({
  cacheBytes: 128 * 1024 * 1024,
  workers: Object.freeze({ critical: 4, interactive: 2, background: 1, speculative: 1 }),
});

export type ResourcePriority = "critical" | "interactive" | "background" | "speculative";
export interface CacheEntry { key: string; bytes: number; value: unknown; priority: ResourcePriority }
export interface ResourceSnapshot { cacheBytes: number; entries: number; workers: Record<ResourcePriority, number> }

const rank: Record<ResourcePriority, number> = { critical: 0, interactive: 1, background: 2, speculative: 3 };

export class ResourceBudget {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #workers: Record<ResourcePriority, number> = { critical: 0, interactive: 0, background: 0, speculative: 0 };
  #pressure = false;

  constructor(readonly cacheLimitBytes = RESOURCE_LIMITS.cacheBytes) {
    if (!Number.isSafeInteger(cacheLimitBytes) || cacheLimitBytes < 0) throw new RangeError("Invalid cache budget");
  }
  get speculativeEnabled(): boolean { return process.env.QNECTOR_SPECULATIVE_PREWARM === "1"; }
  get totalCacheBytes(): number { return [...this.#entries.values()].reduce((sum, item) => sum + item.bytes, 0); }

  setMemoryPressure(pressured: boolean): void {
    this.#pressure = pressured;
    if (pressured) this.evict((entry) => entry.priority === "speculative" || entry.priority === "background");
  }

  put(entry: CacheEntry): boolean {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > this.cacheLimitBytes) return false;
    if (this.#pressure && (entry.priority === "speculative" || entry.priority === "background")) return false;
    this.#entries.delete(entry.key);
    while (this.totalCacheBytes + entry.bytes > this.cacheLimitBytes) {
      const victim = [...this.#entries.values()].sort((a, b) => rank[b.priority] - rank[a.priority])[0];
      if (!victim || rank[victim.priority] < rank[entry.priority]) return false;
      this.#entries.delete(victim.key);
    }
    this.#entries.set(entry.key, entry);
    return true;
  }
  get<T>(key: string): T | undefined { return this.#entries.get(key)?.value as T | undefined; }
  evict(predicate: (entry: CacheEntry) => boolean = () => true): number {
    let removed = 0;
    for (const [key, value] of this.#entries) if (predicate(value)) { this.#entries.delete(key); removed++; }
    return removed;
  }
  acquireWorker(priority: ResourcePriority): (() => void) | undefined {
    const limit = RESOURCE_LIMITS.workers[priority];
    if (this.#workers[priority] >= limit) return undefined;
    this.#workers[priority]++;
    let released = false;
    return () => { if (!released) { released = true; this.#workers[priority]--; } };
  }
  async prewarm<T>(key: string, bytes: number, loader: (signal: AbortSignal) => Promise<T>, options: { foregroundGame: () => boolean; signal?: AbortSignal }): Promise<boolean> {
    if (!this.speculativeEnabled || this.#pressure || options.foregroundGame() || options.signal?.aborted) return false;
    const release = this.acquireWorker("speculative");
    if (!release) return false;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (options.foregroundGame()) return false;
      const value = await loader(controller.signal);
      if (controller.signal.aborted || options.foregroundGame() || this.#pressure) return false;
      return this.put({ key, bytes, value, priority: "speculative" });
    } finally { options.signal?.removeEventListener("abort", abort); release(); }
  }
  snapshot(): ResourceSnapshot { return { cacheBytes: this.totalCacheBytes, entries: this.#entries.size, workers: { ...this.#workers } }; }
}

/** Startup measurements are metadata only; callers decide when heavy services initialize. */
export function startupSample(startedAt = performance.timeOrigin): { elapsedMs: number; rssBytes: number; cpu: NodeJS.CpuUsage } {
  return { elapsedMs: Math.max(0, performance.timeOrigin + performance.now() - startedAt), rssBytes: process.memoryUsage().rss, cpu: process.cpuUsage() };
}
