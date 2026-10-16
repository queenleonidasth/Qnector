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
  stageAggregates: StageAggregate[];
  portableCache: {
    enabled: boolean;
    hit: boolean | null;
  };
}

export type PerformanceStage = "validate" | "queue" | "worker_start" | "execute" | "verify" | "serialize";
export interface StageSample {
  traceId: string; taskId?: string; action: string; stage: PerformanceStage;
  durationMs: number; bytes?: number; benchmarkRunId?: string;
}
export interface StageAggregate extends Omit<StageSample, "traceId" | "taskId" | "benchmarkRunId" | "bytes"> {
  count: number; p50Ms: number; p95Ms: number; bytes?: number;
}
const TELEMETRY_ACTIONS = new Set(["system","workspace","files","process","git","memory","browser","computer","tasks","system.timeout_probe"]);

export class PerformanceMonitor {
  private readonly origin = performance.now();
  private readonly startedEpoch = Date.now();
  private readonly milestones: PerformanceMilestone[] = [];
  private readonly operations: PerformanceOperationSample[] = [];
  private readonly stages: StageSample[] = [];
  public recordStage(sample: StageSample): void {
    if (!sample.traceId || !sample.action || !Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
    if (sample.benchmarkRunId) return;
    const safe: StageSample = {traceId: sample.traceId.slice(0, 80), action: TELEMETRY_ACTIONS.has(sample.action) ? sample.action : "unknown", stage: sample.stage, durationMs: round(sample.durationMs), ...(sample.taskId ? {taskId: sample.taskId.slice(0, 120)} : {}), ...(Number.isFinite(sample.bytes) && sample.bytes! >= 0 ? {bytes: Math.round(sample.bytes!)} : {})};
    this.stages.push(safe);
    if (this.stages.length > 1200) this.stages.splice(0, this.stages.length - 1200);
  }

  public getTaskPerformance(taskId: string): { taskId: string; samples: number; stages: StageAggregate[] } {
    const selected = this.stages.filter(s => s.taskId === taskId);
    return {taskId, samples: selected.length, stages: aggregateStages(selected)};
  }

  public stageSnapshot(): StageAggregate[] { return aggregateStages(this.stages); }

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
      stageAggregates: this.stageSnapshot(),
      portableCache: {
        enabled: process.env.QNECTOR_PORTABLE_CACHE_ENABLED === "1",
        hit: cacheFlag === "1" ? true : cacheFlag === "0" ? false : null,
      },
    };
  }
}

function aggregateStages(samples: StageSample[]): StageAggregate[] {
  const groups = new Map<string, StageSample[]>();
  for (const sample of samples) { const key = `${sample.action}\0${sample.stage}`; groups.set(key, [...(groups.get(key) ?? []), sample]); }
  return [...groups.values()].map(group => {
    const sorted = group.map(s => s.durationMs).sort((a,b)=>a-b);
    const percentile = (p:number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
    const bytes = group.flatMap(s => s.bytes === undefined ? [] : [s.bytes]);
    return {action:group[0]!.action, stage:group[0]!.stage, durationMs:round(sorted.reduce((a,b)=>a+b,0)/sorted.length), count:sorted.length, p50Ms:round(percentile(.5)), p95Ms:round(percentile(.95)), ...(bytes.length ? {bytes:Math.round(bytes.reduce((a,b)=>a+b,0)/bytes.length)} : {})};
  });
}

export const qnectorPerformance = new PerformanceMonitor();

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
