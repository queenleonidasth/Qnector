import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

describe("GitHub release pipeline", () => {
  it("uses resilient curl uploads and exact-size post-upload verification", async () => {
    const script = await readFile(
      path.join(projectRoot, "scripts", "publish-github-release.ps1"),
      "utf8",
    );
    expect(script).toContain("[switch]$VerifyOnly");
    expect(script).toContain("--retry 5");
    expect(script).toContain("--retry-all-errors");
    expect(script).toContain("--connect-timeout 30");
    expect(script).toContain("--max-time 1800");
    expect(script).toMatch(/entry\.size[\s\S]*?local\.Length/);
    expect(script).toContain('state -ne "uploaded"');
    expect(script).toContain("Assert-ReleaseAssets $verified");
  });
});
