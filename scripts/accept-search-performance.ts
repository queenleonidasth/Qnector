import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalSemanticSearchService } from "../packages/core/src/semantic-search.js";

const root = await mkdtemp(path.join(os.tmpdir(), "qnector-search-perf-"));
try {
  const files = 400;
  const content = Array.from(
    { length: 100 },
    (_, i) =>
      `export function inventory_export_${i}() { return 'stock spreadsheet export workflow ${i}'; }`,
  ).join("\n");
  for (let start = 0; start < files; start += 16) {
    await Promise.all(
      Array.from({ length: Math.min(16, files - start) }, (_, i) =>
        writeFile(path.join(root, `service-${start + i}.ts`), content),
      ),
    );
  }
  const service = new LocalSemanticSearchService();
  const input = {
    workspaceRoot: root,
    query: "stock spreadsheet export",
    maxResults: 10,
  };
  const measure = async () => {
    const start = performance.now();
    const result = await service.search(input);
    assert.equal(result.indexedFiles, files);
    assert.equal(result.matches.length, 10);
    return { ms: Number((performance.now() - start).toFixed(2)), result };
  };
  const cold = await measure();
  const warm = await measure();
  await writeFile(
    path.join(root, "service-0.ts"),
    `${content}\n// updated stock export\n`,
  );
  const changed = await measure();
  assert.notEqual(changed.result.fingerprint, cold.result.fingerprint);
  assert.equal(warm.result.fingerprint, cold.result.fingerprint);
  console.log(
    JSON.stringify(
      {
        ok: true,
        files,
        chunks: cold.result.indexedChunks,
        coldMs: cold.ms,
        warmMs: warm.ms,
        oneFileChangedMs: changed.ms,
      },
      null,
      2,
    ),
  );
} finally {
  // Only remove the directory returned by mkdtemp above.
  await rm(root, { recursive: true, force: true });
}
