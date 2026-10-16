import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderAcceptanceExceptions, writeAcceptanceExceptions } from "./acceptance-exception-report.mjs";

const created: string[] = [];
afterEach(async () => { for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true }); });

const report = {
  generatedAt: "2026-10-16T08:02:00.000Z",
  revision: "b87140150e9abff9066b2d0e3d2ed76bb7eaa068",
  releaseEligible: false,
  localValidationEligible: false,
  gates: [
    { gate: "typecheck", status: "PASS", evidence: "exit 0" },
    { gate: "test", status: "FAIL", evidence: "token=top-secret-password should NEVER be included" },
    { gate: "tunnel", status: "SKIPPED", evidence: "user opted out" },
    { gate: "controlled-performance-suite", status: "UNKNOWN", evidence: "no exact-commit evidence" },
  ],
};

describe("QA exception report generation", () => {
  it("records failed, unverified and waived gates without calling them PASS", () => {
    const text = renderAcceptanceExceptions(report);
    expect(text).toContain("b87140150e9abff9066b2d0e3d2ed76bb7eaa068");
    expect(text).toContain("| FAIL | test |");
    expect(text).toContain("| SKIPPED | tunnel |");
    expect(text).toContain("| UNKNOWN | controlled-performance-suite |");
    expect(text).not.toContain("| PASS | typecheck |");
    expect(text).toContain("1 PASS, 1 FAIL, 1 SKIPPED, 1 UNKNOWN");
    expect(text).toContain("Do not count SKIPPED or UNKNOWN as PASS");
    expect(text).not.toContain("top-secret-password");
  });
  it("writes atomically into an explicit ignored output directory and preserves revision identity", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qnector-qa-exceptions-"));
    created.push(dir);
    const result = await writeAcceptanceExceptions(report, path.join(dir, "qc"));
    expect(path.basename(result)).toBe("acceptance-exceptions-b87140150e9a.md");
    expect((await readFile(result, "utf8"))).toContain("| FAIL | test |");
  });
  it("never invents an observed failure when every gate genuinely passed", () => {
    const green = { ...report, releaseEligible: true, localValidationEligible: true,
      gates: [{ gate: "test", status: "PASS", evidence: "exit 0" }] };
    const text = renderAcceptanceExceptions(green);
    expect(text).toContain("0 FAIL, 0 SKIPPED, 0 UNKNOWN");
    expect(text).toContain("No failed, skipped or unknown gates");
  });
});
