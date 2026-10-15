import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(path.join(import.meta.dirname,"publish-github-release.ps1"),"utf8");

describe("GitHub release fail-closed publication guards",()=>{
  it("rejects existing tags pointing at a different commit before any network mutation",()=>{
    const tagCheck=script.indexOf('RELEASE_TAG_CONFLICT');
    const remoteWrite=script.indexOf('Invoke-RestMethod -Method Post');
    expect(tagCheck).toBeGreaterThan(0);
    expect(remoteWrite).toBeGreaterThan(tagCheck);
    expect(script).toContain('git rev-parse "refs/tags/$tag^{}"');
    expect(script).toContain('git rev-parse HEAD');
    expect(script).toContain('$tagRevision -ne $headRevision');
  });
  it("requires exact-commit package hashes and smoke evidence before any upload",()=>{
    const evidenceCheck=script.indexOf('"package-evidence.mjs") verify $ReleaseDir');
    const remoteWrite=script.indexOf('Invoke-RestMethod -Method Post');
    expect(evidenceCheck).toBeGreaterThan(0);
    expect(remoteWrite).toBeGreaterThan(evidenceCheck);
    expect(script).toContain('RELEASE_PACKAGE_ATTESTATION_FAILED');
    expect(script).toContain("inspect and resolve it manually");
  });
  it("never deletes a remote conflict or blindly replays an uncertain upload",()=>{
    expect(script).toContain("Remote asset");
    expect(script).toContain("already exists with a different or unverifiable digest");
    expect(script).toContain("no blind retry");
    expect(script).toContain("Get-ReleaseByTag");
    expect(script).not.toMatch(/Invoke-RestMethod -Method Delete/);
  });
});
