import { describe, expect, it } from "vitest";
import { ContentCache } from "./content-cache.js";

describe("ContentCache", () => {
  it("deduplicates reads, isolates revisions and evicts least recently used entries", async () => {
    const cache = new ContentCache(2, 1024);
    let loads = 0;
    const key = { path: "./a.ts", fingerprint: "sha-a", schemaVersion: "1" };
    const loader = async () => { loads += 1; return { value: loads }; };
    const [a, b] = await Promise.all([cache.getOrCompute(key, loader), cache.getOrCompute(key, loader)]);
    expect(a).toEqual(b);
    expect(loads).toBe(1);
    await cache.getOrCompute({ ...key, fingerprint: "sha-b" }, loader);
    await cache.getOrCompute({ ...key, path: "./b.ts" }, loader);
    expect(await cache.getOrCompute(key, loader)).toEqual({ value: 4 });
    expect(loads).toBe(4);
  });

  it("clear invalidates an initial pending read and forbids stale result resurrection", async () => {
    const cache = new ContentCache();
    const key = { path: "./pending.txt", fingerprint: "sha-1", schemaVersion: "1" };
    let finish!: (value: string) => void;
    const started = cache.getOrCompute(key, () => new Promise<string>(resolve => { finish = resolve; }));
    cache.clear();
    finish("old data");
    expect(await started).toBe("old data");
    let freshCalls = 0;
    expect(await cache.getOrCompute(key, async () => { freshCalls++; return "new data"; })).toBe("new data");
    expect(freshCalls).toBe(1);
    expect(await cache.getOrCompute(key, async () => { freshCalls++; return "WRONG"; })).toBe("new data");
    expect(freshCalls).toBe(1);
  });

  it("invalidates on rename/write events and does not publish an in-flight stale value", async () => {
    const cache = new ContentCache();
    let finish!: (value: string) => void;
    const pending = cache.getOrCompute(
      { path: "./old.ts", fingerprint: "old", schemaVersion: "1" },
      () => new Promise<string>((resolve) => { finish = resolve; }),
    );
    cache.invalidate("./old.ts");
    finish("stale");
    expect(await pending).toBe("stale");
    let reads = 0;
    const fresh = () => { reads += 1; return Promise.resolve("fresh"); };
    const key = { path: "./old.ts", fingerprint: "new", schemaVersion: "1" };
    expect(await cache.getOrCompute(key, fresh)).toBe("fresh");
    cache.invalidate("./old.ts");
    expect(await cache.getOrCompute(key, fresh)).toBe("fresh");
    expect(reads).toBe(2);
  });
});
