import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("runs integrity-sensitive acceptance tests without cross-file parallelism", () => {
  const root=path.resolve(import.meta.dirname,"..");
  const pkg=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8")) as {scripts:Record<string,string>};
  expect(pkg.scripts["test:acceptance"]).toMatch(/vitest run .*--no-file-parallelism/);
  const runner=readFileSync(path.join(root,"scripts","accept-end-to-end-performance.mts"),"utf8");
  expect(runner).toContain('["test", "test:acceptance"]');
});

it("records every unresolved acceptance gate in a redacted sidecar even if API contract is wrong", () => {
  const root=path.resolve(import.meta.dirname,"..");
  const runner=readFileSync(path.join(root,"scripts","accept-end-to-end-performance.mts"),"utf8");
  expect(runner).toContain("writeAcceptanceExceptions(report");
  expect(runner).toContain('gate: "public-api-golden", status: "FAIL"');
  expect(runner).not.toContain('throw new Error("Golden contract fixture');
});
