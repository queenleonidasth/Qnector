import { describe, expect, it } from "vitest";
import { BENCH_INPUT, runBenchmark, scheduleAbba } from "./bench-e2e.mts";

describe("fixed benchmark harness", () => {
  it("uses_abba_and_fixed_sample_counts_with_correctness_oracle", async () => {
    expect(scheduleAbba("A","B")).toEqual(["A","B","B","A"]);
    const result=await runBenchmark();
    expect(result.correctness.passed).toBe(true);
    expect(result.variants.baseline.samples).toBe(BENCH_INPUT.measured);
    expect(result.variants.candidate.samples).toBe(BENCH_INPUT.measured);
    expect(result.inputManifest.clientObservedMs).toBeNull();
    expect(result.interpretation).toContain("no speedup claim");
  });
});
