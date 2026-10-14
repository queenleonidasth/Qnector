import { afterEach, describe, expect, it } from "vitest";
import { GameActivitySensor, RESOURCE_LIMITS, ResourceBudget, startupSample } from "./resource-budget.js";

const previous = process.env.QNECTOR_SPECULATIVE_PREWARM;
afterEach(() => { if (previous === undefined) delete process.env.QNECTOR_SPECULATIVE_PREWARM; else process.env.QNECTOR_SPECULATIVE_PREWARM = previous; });

describe("resource budget", () => {
  it("hard caps cache and evicts lower priority entries first", () => {
    const budget = new ResourceBudget(10);
    expect(budget.put({ key: "spec", bytes: 6, value: 1, priority: "speculative" })).toBe(true);
    expect(budget.put({ key: "active", bytes: 8, value: 2, priority: "interactive" })).toBe(true);
    expect(budget.get("spec")).toBeUndefined();
    expect(budget.totalCacheBytes).toBeLessThanOrEqual(10);
    expect(RESOURCE_LIMITS.cacheBytes).toBe(128 * 1024 * 1024);
  });
  it("enforces explicit per-priority worker caps and idempotent release", () => {
    const budget = new ResourceBudget();
    const releases = Array.from({ length: 4 }, () => budget.acquireWorker("critical"));
    expect(budget.acquireWorker("critical")).toBeUndefined();
    releases[0]?.(); releases[0]?.();
    expect(budget.snapshot().workers.critical).toBe(3);
  });
  it("pauses prewarm in a foreground game and under memory pressure", async () => {
    process.env.QNECTOR_SPECULATIVE_PREWARM = "1";
    const budget = new ResourceBudget();
    const loader = async () => "value";
    expect(await budget.prewarm("x", 1, loader, { foregroundGame: () => true })).toBe(false);
    budget.setMemoryPressure(true);
    expect(await budget.prewarm("x", 1, loader, { foregroundGame: () => false })).toBe(false);
  });
  it("does not start by default and releases cancelled prewarm workers", async () => {
    delete process.env.QNECTOR_SPECULATIVE_PREWARM;
    const budget = new ResourceBudget();
    expect(await budget.prewarm("x", 1, async () => "x", { foregroundGame: () => false })).toBe(false);
    process.env.QNECTOR_SPECULATIVE_PREWARM = "1";
    const controller = new AbortController(); controller.abort();
    expect(await budget.prewarm("x", 1, async () => "x", { foregroundGame: () => false, signal: controller.signal })).toBe(false);
    expect(budget.snapshot().workers.speculative).toBe(0);
  });
  it("aborts speculative work when a game becomes foreground and leaves active work alone", async () => {
    process.env.QNECTOR_SPECULATIVE_PREWARM = "1";
    const budget = new ResourceBudget();
    let game = false;
    let activeJobContinued = false;
    const speculative = budget.prewarm("game-test", 1, (signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }), { foregroundGame: () => game, pollIntervalMs: 50 }).catch(() => false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    game = true;
    activeJobContinued = true;
    expect(await speculative).toBe(false);
    expect(activeJobContinued).toBe(true);
    expect(budget.snapshot().workers.speculative).toBe(0);
  });
  it("records cold-start resource samples without changing runtime settings", () => {
    const sample = startupSample();
    expect(sample.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(sample.rssBytes).toBeGreaterThan(0);
    expect(sample.cpu).toHaveProperty("system");
  });
  it("detects only the exact Delta Force process row and fails closed", async () => {
    const present = new GameActivitySensor(async () => '"DeltaForceClient-Win64-Shipping.exe","123","Console","1","10,000 K"');
    expect(await present.isGameRunning()).toBe(true);
    const absent = new GameActivitySensor(async () => '"other.exe","123","Console","1","10 K"');
    expect(await absent.isGameRunning()).toBe(false);
    const unknown = new GameActivitySensor(async () => { throw new Error("tasklist timeout"); });
    expect(await unknown.isGameRunning()).toBe(true);
  });
  it("deduplicates concurrent speculative prewarm by cache key", async () => {
    process.env.QNECTOR_SPECULATIVE_PREWARM = "1";
    const budget = new ResourceBudget();
    let calls = 0;
    const loader = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 20)); return "ready"; };
    const results = await Promise.all([
      budget.prewarm("same", 1, loader, { foregroundGame: () => false }),
      budget.prewarm("same", 1, loader, { foregroundGame: () => false }),
    ]);
    expect(results).toEqual([true, true]);
    expect(calls).toBe(1);
  });
});
