import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

describe("GitHub release pipeline", () => {
  it("verifies immutable asset digests and inspects uncertain uploads without replay", async () => {
    const script = await readFile(
      path.join(projectRoot, "scripts", "publish-github-release.ps1"),
      "utf8",
    );
    expect(script).toContain("[switch]$VerifyOnly");
    expect(script).toContain("--connect-timeout 30");
    expect(script).toContain("--max-time 1800");
    expect(script).toMatch(/entry\.size[\s\S]*?local\.Length/);
    expect(script).toContain('state -ne "uploaded"');
    expect(script).toContain('entry.digest -ne "sha256:$localDigest"');
    expect(script).toContain("Remote asset");
    expect(script).toContain("no blind retry was made");
    expect(script).not.toContain("releases/assets/$($old.id)");
    expect(script).not.toContain("--retry-all-errors");
    expect(script).toContain("Assert-ReleaseAssets $verified");
  });

  it("runs release preflight before native packaging and remote publishing", async () => {
    const [pack, publish] = await Promise.all([
      readFile(path.join(projectRoot, "scripts", "package-windows.ps1"), "utf8"),
      readFile(path.join(projectRoot, "scripts", "publish-github-release.ps1"), "utf8"),
    ]);
    expect(pack).toContain("release-preflight.mjs");
    expect(pack).toContain("build-job-host.ps1");
    expect(publish).toContain("release-preflight.mjs");
  });

  it("blocks Windows packaging when desktop UI regression gates fail", async () => {
    const script = await readFile(
      path.join(projectRoot, "scripts", "package-windows.ps1"),
      "utf8",
    );
    expect(script).toContain("apps/desktop/src/renderer/skill-manager.test.ts");
    expect(script).toContain("apps/desktop/src/renderer/royal-effects.test.ts");
    expect(script).toContain(
      "apps/desktop/src/renderer/gold-matrix-rain.test.ts",
    );
    expect(script).toContain(
      "apps/desktop/src/renderer/scroll-completeness.test.ts",
    );
    expect(script).toContain("accept-skill-layout.ps1");
    expect(script).toContain("Desktop release regression gate failed");
    expect(script).toContain("Skill discovery layout gate failed");
    expect(script).toContain("build-provenance.json");
    expect(script).toContain("sourceRevision");
    expect(script).toContain("lockfileSha256");
    expect(script).toContain('"qnector-icon.ico"');
  });

  it("declares the runtime MCP client as a desktop production dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.join(projectRoot, "apps", "desktop", "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["@modelcontextprotocol/client"]).toBe(
      "2.2.0",
    );
  });
});
