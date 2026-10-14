import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  #prewarmControllers = new Set<AbortController>();
  readonly #prewarmFlights = new Map<string, Promise<boolean>>();

  constructor(readonly cacheLimitBytes = RESOURCE_LIMITS.cacheBytes) {
    if (!Number.isSafeInteger(cacheLimitBytes) || cacheLimitBytes < 0) throw new RangeError("Invalid cache budget");
  }
  get speculativeEnabled(): boolean { return process.env.QNECTOR_SPECULATIVE_PREWARM === "1"; }
  get totalCacheBytes(): number { return [...this.#entries.values()].reduce((sum, item) => sum + item.bytes, 0); }

  setMemoryPressure(pressured: boolean): void {
    this.#pressure = pressured;
    if (pressured) {
      this.evict((entry) => entry.priority === "speculative" || entry.priority === "background");
      for (const controller of this.#prewarmControllers) controller.abort("memory pressure");
    }
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
  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }
  evict(predicate: (entry: CacheEntry) => boolean = () => true): number {
    let removed = 0;
    for (const [key, value] of this.#entries) if (predicate(value)) { this.#entries.delete(key); removed++; }
    return removed;
  }
  evictOldest(predicate: (entry: CacheEntry) => boolean = () => true): boolean {
    for (const [key, entry] of this.#entries) {
      if (predicate(entry)) { this.#entries.delete(key); return true; }
    }
    return false;
  }
  acquireWorker(priority: ResourcePriority): (() => void) | undefined {
    const limit = RESOURCE_LIMITS.workers[priority];
    if (this.#workers[priority] >= limit) return undefined;
    this.#workers[priority]++;
    let released = false;
    return () => { if (!released) { released = true; this.#workers[priority]--; } };
  }
  async prewarm<T>(key: string, bytes: number, loader: (signal: AbortSignal) => Promise<T>, options: { foregroundGame: () => boolean | Promise<boolean>; signal?: AbortSignal; pollIntervalMs?: number }): Promise<boolean> {
    const active = this.#prewarmFlights.get(key);
    if (active) return active;
    const flight = this.#prewarmInner(key, bytes, loader, options);
    this.#prewarmFlights.set(key, flight);
    try { return await flight; } finally { if (this.#prewarmFlights.get(key) === flight) this.#prewarmFlights.delete(key); }
  }
  async #prewarmInner<T>(key: string, bytes: number, loader: (signal: AbortSignal) => Promise<T>, options: { foregroundGame: () => boolean | Promise<boolean>; signal?: AbortSignal; pollIntervalMs?: number }): Promise<boolean> {
    const gameIsActive = async (): Promise<boolean> => {
      try { return await options.foregroundGame(); } catch { return true; }
    };
    if (!this.speculativeEnabled || this.#pressure || await gameIsActive() || options.signal?.aborted) return false;
    const release = this.acquireWorker("speculative");
    if (!release) return false;
    const controller = new AbortController();
    this.#prewarmControllers.add(controller);
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    let checking = false;
    const poll = setInterval(() => {
      if (checking) return;
      checking = true;
      void gameIsActive().then((active) => { if (active) controller.abort("game process detected"); }).finally(() => { checking = false; });
      if (this.#pressure) controller.abort("memory pressure");
    }, Math.max(3_000, options.pollIntervalMs ?? 3_000));
    poll.unref?.();
    try {
      if (await gameIsActive()) return false;
      const value = await loader(controller.signal);
      if (controller.signal.aborted || await gameIsActive() || this.#pressure) return false;
      return this.put({ key, bytes, value, priority: "speculative" });
    } finally { clearInterval(poll); this.#prewarmControllers.delete(controller); options.signal?.removeEventListener("abort", abort); release(); }
  }
  snapshot(): ResourceSnapshot { return { cacheBytes: this.totalCacheBytes, entries: this.#entries.size, workers: { ...this.#workers } }; }
}

/** Conservative Windows process-presence check; failures mean speculative work stays paused. */
export class GameActivitySensor {
  #checkedAt = 0;
  #active = true;
  #pending: Promise<boolean> | undefined;
  constructor(private readonly query: () => Promise<string> = async () => {
    if (process.platform !== "win32") throw new Error("Windows process sensor unavailable");
    const result = await execFileAsync("tasklist.exe", ["/FI", "IMAGENAME eq DeltaForceClient-Win64-Shipping.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 1_200, windowsHide: true, maxBuffer: 16_384 });
    return String(result.stdout);
  }) {}
  async isGameRunning(): Promise<boolean> {
    if (Date.now() - this.#checkedAt < 10_000) return this.#active;
    if (this.#pending) return this.#pending;
    this.#pending = this.query().then((output) => {
      this.#active = output.split(/\r?\n/).some((line) => /^\s*"DeltaForceClient-Win64-Shipping\.exe"\s*,/i.test(line));
      this.#checkedAt = Date.now();
      return this.#active;
    }).catch(() => { this.#active = true; this.#checkedAt = Date.now(); return true; }).finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
}

/** Shared bounded cache budget for the lifetime of the Node runtime. */
export const runtimeResourceBudget = new ResourceBudget();
export const runtimeGameActivitySensor = new GameActivitySensor();

/** Startup measurements are metadata only; callers decide when heavy services initialize. */
export function startupSample(startedAt = performance.timeOrigin): { elapsedMs: number; rssBytes: number; cpu: NodeJS.CpuUsage } {
  return { elapsedMs: Math.max(0, performance.timeOrigin + performance.now() - startedAt), rssBytes: process.memoryUsage().rss, cpu: process.cpuUsage() };
}
