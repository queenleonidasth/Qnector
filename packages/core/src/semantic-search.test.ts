import { mkdtemp, mkdir, rm, writeFile, utimes, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSemanticSearchService } from "./semantic-search.js";

let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture(files: Record<string, string>) {
  root = await mkdtemp(path.join(os.tmpdir(), "qnector-search-qc-"));
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }),
  );
  const service = new LocalSemanticSearchService();
  return {
    service,
    search: (query: string) => service.search({ workspaceRoot: root, query }),
  };
}

describe("semantic search QC", () => {
  it("reuses unchanged files and observes edits, additions and deletions", async () => {
    const { service, search } = await fixture({
      "a.ts": "export const inventory = 'stock export';",
      "b.md": "spreadsheet export workflow",
    });
    const first = await search("export");
    expect(first.cache).toEqual({ readFiles: 2, reusedFiles: 0 });
    const warm = await search("export");
    expect(warm.cache).toEqual({ readFiles: 0, reusedFiles: 2 });
    expect(warm.fingerprint).toBe(first.fingerprint);
    await writeFile(
      path.join(root, "a.ts"),
      "export const weather = 'sunshine forecast';",
    );
    const changed = await search("sunshine");
    expect(changed.cache).toEqual({ readFiles: 1, reusedFiles: 1 });
    expect(changed.matches[0]?.file).toBe("a.ts");
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    await writeFile(path.join(root, "c.md"), "sunshine");
    await rm(path.join(root, "a.ts"));
    const moved = await search("sunshine");
    expect(moved.matches.map((match) => match.file)).toEqual(["c.md"]);
    service.clear();
    expect((await search("sunshine")).cache.readFiles).toBe(2);
  });

  it("invalidates same-size edits even when modification time is restored", async () => {
    const { search } = await fixture({ "a.md": "stock export workflow" });
    const before = await stat(path.join(root, "a.md"));
    const first = await search("stock");
    await writeFile(path.join(root, "a.md"), "plant garden workflow");
    await utimes(path.join(root, "a.md"), before.atime, before.mtime);
    const next = await search("garden");
    expect(next.fingerprint).not.toBe(first.fingerprint);
    expect(next.matches[0]?.preview).toContain("garden");
  });

  it("finds Thai words with vowels and tone marks in unspaced sentences", async () => {
    const { search } = await fixture({
      "thai.md": "ระบบส่งออกข้อมูลสินค้าเป็นตารางสำหรับผู้ใช้",
      "other.md": "รูปภาพและสีพื้นหลัง",
    });
    const result = await search("ส่งออก สินค้า");
    expect(result.matches[0]?.file).toBe("thai.md");
    expect(result.matches.some((match) => match.file === "other.md")).toBe(
      false,
    );
  });

  it("matches snake_case and acronym identifiers and keeps short files", async () => {
    const { search } = await fixture({
      "a.py": "inventory_export",
      "b.ts": "HTTPServer",
      "c.md": "garden",
    });
    expect((await search("inventory export")).matches[0]?.file).toBe("a.py");
    expect((await search("http server")).matches[0]?.file).toBe("b.ts");
    expect((await search("garden")).matches[0]?.file).toBe("c.md");
  });

  it("does not return unrelated results from hash collisions", async () => {
    const { search } = await fixture({
      "a.md": "This document only describes image wallpapers and colors.",
    });
    expect((await search("stock export spreadsheet")).matches).toEqual([]);
  });

  it("paginates deterministically and distinguishes result limits from index limits", async () => {
    const { service } = await fixture({
      "a.md": "stock export",
      "b.md": "stock export",
      "c.md": "stock export",
    });
    const input = {
      workspaceRoot: root,
      query: "stock export",
      maxFiles: 3,
      maxResults: 2,
    };
    const first = await service.search(input);
    expect(first.indexTruncated).toBe(false);
    expect(first.truncated).toBe(true);
    expect(first.totalMatches).toBe(3);
    expect(first.nextOffset).toBe(2);
    const second = await service.search({ ...input, offset: first.nextOffset });
    expect(second.matches.map((match) => match.file)).toEqual(["c.md"]);
    expect(second.truncated).toBe(false);
    expect(second.nextOffset).toBeUndefined();
    expect(
      (await service.search({ ...input, maxFiles: 2 })).indexTruncated,
    ).toBe(true);
    await writeFile(path.join(root, "d.md"), "stock export");
    const limited = await service.search(input);
    expect(limited.indexTruncated).toBe(true);
    expect(limited.fingerprint).not.toBe(first.fingerprint);
  });

  it("filters by query coverage and minimum score", async () => {
    const { service } = await fixture({
      "a.md": "stock export",
      "b.md": "stock weather",
    });
    const result = await service.search({
      workspaceRoot: root,
      query: "stock export",
      minScore: 0.7,
    });
    expect(result.matches.map((match) => match.file)).toEqual(["a.md"]);
  });

  it("skips oversized and binary files while reporting an incomplete index", async () => {
    const { search } = await fixture({
      "big.md": "x".repeat(2 * 1024 * 1024 + 1),
      "binary.txt": "stock\0export",
      "ok.md": "stock export",
    });
    const result = await search("stock export");
    expect(result.skippedFiles).toBe(2);
    expect(result.indexedFiles).toBe(1);
    expect(result.indexTruncated).toBe(true);
    expect(result.matches.map((match) => match.file)).toEqual(["ok.md"]);
  });

  it("shares concurrent index builds and resolves paths per caller workspace", async () => {
    const { service } = await fixture({ "nested/a.md": "stock export" });
    const results = await Promise.all([
      service.search({ workspaceRoot: root, path: "nested", query: "stock" }),
      service.search({
        workspaceRoot: path.join(root, "nested"),
        query: "export",
      }),
    ]);
    expect(results[0]!.matches[0]?.file).toBe("nested/a.md");
    expect(results[1]!.matches[0]?.file).toBe("a.md");
    expect(results[0]!.fingerprint).toBe(results[1]!.fingerprint);
  });

  it("rejects non-finite limits and invalid relevance thresholds", async () => {
    const { service } = await fixture({ "a.md": "stock export" });
    for (const option of [
      { maxFiles: NaN },
      { maxResults: Infinity },
      { offset: NaN },
      { minScore: 2 },
    ])
      await expect(
        service.search({ workspaceRoot: root, query: "stock", ...option }),
      ).rejects.toThrow("INVALID_INPUT");
  });

  it("bounds chunk memory and reports clipped long text", async () => {
    const { service } = await fixture({
      "long.md": "stock ".repeat(1_500),
      "many.md": "stock\n".repeat(180_100),
    });
    const long = await service.search({
      workspaceRoot: root,
      path: "long.md",
      query: "stock",
    });
    expect(long.indexTruncated).toBe(true);
    const many = await service.search({
      workspaceRoot: root,
      path: "many.md",
      query: "stock",
    });
    expect(many.indexedChunks).toBe(10_000);
    expect(many.indexTruncated).toBe(true);
    expect(
      (
        await service.search({
          workspaceRoot: root,
          path: "many.md",
          query: "stock",
        })
      ).cache.readFiles,
    ).toBe(0);
  });

  it("evicts old roots from its bounded cache", async () => {
    const { service } = await fixture({
      "one/a.md": "stock",
      "two/a.md": "stock",
      "three/a.md": "stock",
      "four/a.md": "stock",
    });
    for (const directory of ["one", "two", "three", "four"])
      await service.search({
        workspaceRoot: root,
        path: directory,
        query: "stock",
      });
    const evicted = await service.search({
      workspaceRoot: root,
      path: "one",
      query: "stock",
    });
    expect(evicted.cache.readFiles).toBe(1);
  });
});
