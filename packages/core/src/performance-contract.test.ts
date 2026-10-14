import { describe, expect, it } from "vitest";
import { PerformanceMonitor } from "./performance-monitor.js";

describe("stage telemetry contract", () => {
  it("separates_queue_execution_serialization", () => {
    const monitor = new PerformanceMonitor();
    monitor.recordStage({traceId:"a", taskId:"task-a", action:"files.read", stage:"queue", durationMs:2});
    monitor.recordStage({traceId:"b", taskId:"task-a", action:"files.read", stage:"execute", durationMs:8});
    monitor.recordStage({traceId:"c", taskId:"task-a", action:"files.read", stage:"serialize", durationMs:1, bytes:42});
    expect(monitor.getTaskPerformance("task-a").stages.map(x=>x.stage)).toEqual(["queue","execute","serialize"]);
  });
  it("excludes_bench_samples", () => {
    const monitor = new PerformanceMonitor();
    monitor.recordStage({traceId:"bench", action:"files.read", stage:"execute", durationMs:1, benchmarkRunId:"bench-1"});
    expect(monitor.stageSnapshot()).toEqual([]);
  });
  it("does_not_log_secrets", () => {
    const monitor = new PerformanceMonitor();
    monitor.recordStage({traceId:"trace", taskId:"task-id", action:"Bearer super-secret-token", stage:"execute", durationMs:1});
    expect(JSON.stringify(monitor.stageSnapshot())).not.toMatch(/super-secret-token|password|https?:\/\//i);
  });
  it("bounds_histograms", () => {
    const monitor = new PerformanceMonitor();
    for (let i=0;i<1300;i++) monitor.recordStage({traceId:String(i), action:"x", stage:"execute", durationMs:i});
    expect(monitor.stageSnapshot()[0]?.count).toBe(1200);
    expect(monitor.stageSnapshot()[0]?.p95Ms).toBeLessThan(1300);
  });
});
