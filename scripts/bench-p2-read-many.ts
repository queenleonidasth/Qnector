import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalSemanticSearchService } from "../packages/core/src/semantic-search.js";

const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString(), source: "synthetic temporary files", cases: [] };
const cases = evidence.cases as Array<Record<string, unknown>>;
for (const count of [1, 20, 100]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qnector-p2-bench-"));
  try {
    const body = (i: number) => `export const inventory_${i} = 'stock export inventory batch ${i}';\n`;
    await Promise.all(Array.from({ length: count }, (_, i) => writeFile(path.join(root, `file-${i}.ts`), body(i))));
    const service = new LocalSemanticSearchService();
    const input = { workspaceRoot: root, query: "stock export inventory", maxFiles: 100 };
    const measure = async () => {
      const start = performance.now();
      const result = await service.search(input);
      return { ms: Number((performance.now() - start).toFixed(3)), result };
    };
    const cold = await measure();
    const warm = await measure();
    const before = createHash("sha256").update(JSON.stringify(cold.result.matches)).digest("hex");
    assert.equal(createHash("sha256").update(JSON.stringify(warm.result.matches)).digest("hex"), before);
    const changedFile = path.join(root, "file-0.ts");
    await writeFile(changedFile, "export const inventory_changed = 'stock export inventory freshness marker';\n");
    const afterChange = await measure();
    assert.ok(afterChange.result.matches.some((match) => match.preview.includes("freshness marker")));
    assert.notEqual(afterChange.result.fingerprint, cold.result.fingerprint);
    cases.push({ files: count, coldMs: cold.ms, warmMs: warm.ms, changedMs: afterChange.ms, coldReadFiles: cold.result.cache.readFiles, warmReadFiles: warm.result.cache.readFiles, changedReadFiles: afterChange.result.cache.readFiles, coldMatchDigest: before, warmMatchDigest: createHash("sha256").update(JSON.stringify(warm.result.matches)).digest("hex"), changedObserved: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(evidence, null, 2));
