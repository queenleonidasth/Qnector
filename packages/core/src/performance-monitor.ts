import { performance } from "node:perf_hooks";

export interface PerformanceMilestone {
  name: string;
  elapsedMs: number;
  timestamp: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface PerformanceOperationSample {
  category: string;
  name: string;
  durationMs: number;
  timestamp: string;
}

export interface PerformanceOperationAggregate {
  category: string;
  name: string;
  count: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

export interface PerformanceSnapshot {
  startedAt: string;
  uptimeMs: number;
  milestones: PerformanceMilestone[];
  recentOperations: PerformanceOperationSample[];
  aggregates: PerformanceOperationAggregate[];
  portableCache: {
    enabled: boolean;
    hit: boolean | null;
  };
}

export class PerformanceMonitor {
  private readonly origin = performance.now();
  private readonly startedEpoch = Date.now();
  private readonly milestones: PerformanceMilestone[] = [];
  private readonly operations: PerformanceOperationSample[] = [];

  public mark(
    name: string,
    details?: Record<string, string | number | boolean | null>,
  ): PerformanceMilestone {
    const elapsedMs = performance.now() - this.origin;
    const milestone: PerformanceMilestone = {
      name,
      elapsedMs: round(elapsedMs),
      timestamp: new Date(this.startedEpoch + elapsedMs).toISOString(),
      ...(details ? { details } : {}),
    };
    this.milestones.push(milestone);
    if (this.milestones.length > 100) this.milestones.shift();
    return milestone;
  }

  public operation(category: string, name: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.operations.push({
      category,
      name,
      durationMs: round(durationMs),
      timestamp: new Date().toISOString(),
    });
    if (this.operations.length > 300) this.operations.shift();
  }

  public snapshot(): PerformanceSnapshot {
    const grouped = new Map<
      string,
      {
        category: string;
        name: string;
        values: number[];
      }
    >();
    for (const sample of this.operations) {
      const key = `${sample.category}\u0000${sample.name}`;
      const entry = grouped.get(key) ?? {
        category: sample.category,
        name: sample.name,
        values: [],
      };
      entry.values.push(sample.durationMs);
      grouped.set(key, entry);
    }
    const aggregates = [...grouped.values()]
      .map((entry): PerformanceOperationAggregate => ({
        category: entry.category,
        name: entry.name,
        count: entry.values.length,
        averageMs: round(
          entry.values.reduce((sum, value) => sum + value, 0) /
            Math.max(1, entry.values.length),
        ),
        minMs: round(Math.min(...entry.values)),
        maxMs: round(Math.max(...entry.values)),
        lastMs: round(entry.values.at(-1) ?? 0),
      }))
      .sort((a, b) => b.averageMs - a.averageMs);
    const cacheFlag = process.env.QNECTOR_PORTABLE_CACHE_HIT;
    return {
      startedAt: new Date(this.startedEpoch).toISOString(),
      uptimeMs: round(performance.now() - this.origin),
      milestones: [...this.milestones],
      recentOperations: this.operations.slice(-50),
      aggregates,
      portableCache: {
        enabled: process.env.QNECTOR_PORTABLE_CACHE_ENABLED === "1",
        hit: cacheFlag === "1" ? true : cacheFlag === "0" ? false : null,
      },
    };
  }
}

export const qnectorPerformance = new PerformanceMonitor();

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
