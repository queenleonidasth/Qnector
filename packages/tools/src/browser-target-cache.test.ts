import { describe, expect, it } from "vitest";
import { BrowserTargetCache } from "./browser-target-cache.js";

describe("BrowserTargetCache", () => {
  it("singleflights targeted lookups and rejects stale generations", async () => {
    const cache = new BrowserTargetCache<{ id: string; live: boolean }>();
    const generation = cache.currentGeneration();
    let lookups = 0;
    const resolve = () => cache.resolveTarget("tab-a", generation, async () => {
      lookups += 1;
      await Promise.resolve();
      return { id: "tab-a", live: true };
    }, (target) => target.live);
    const [a, b] = await Promise.all([resolve(), resolve()]);
    expect(a).toBe(b);
    expect(lookups).toBe(1);
    cache.invalidateTargets("browser disconnected");
    expect(await cache.resolveTarget("tab-a", generation, async () => ({ id: "wrong-generation", live: true }), () => true)).toBeUndefined();
    const nextGeneration = cache.currentGeneration();
    expect(await cache.resolveTarget("tab-a", nextGeneration, async () => ({ id: "tab-a", live: true }), () => true)).toMatchObject({ id: "tab-a" });
  });

  it("drops closed or replaced tabs and does not cache stale resolver results", async () => {
    const cache = new BrowserTargetCache<{ id: string; live: boolean }>();
    const generation = cache.currentGeneration();
    const resolve = (value: { id: string; live: boolean }) => cache.resolveTarget("tab-a", generation, async () => value, (target) => target.live);
    expect(await resolve({ id: "tab-a", live: false })).toBeUndefined();
    expect(await resolve({ id: "replacement", live: true })).toMatchObject({ id: "replacement" });
    cache.delete("tab-a");
    expect(await resolve({ id: "new-target", live: true })).toMatchObject({ id: "new-target" });
  });
});
