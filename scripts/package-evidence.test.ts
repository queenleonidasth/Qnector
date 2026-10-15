import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPackageEvidence, writePackageEvidence } from "./package-evidence.mjs";

const root=path.resolve(import.meta.dirname,"..");
const release=path.join(root,"apps/desktop/release");
let candidate:string|undefined;
const git=(args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
afterEach(async()=>{if(candidate)await rm(candidate,{recursive:true,force:true});candidate=undefined;});

describe("package evidence exact-commit and integrity guards",()=>{
  it("does not trust missing evidence or an outside release directory",()=>{
    expect(()=>verifyPackageEvidence(root,"invalid-revision")).toThrow("PACKAGE_PATH_OUTSIDE_RELEASE_ROOT");
  });

  it("verifies source revision, exe/resources SHA-256, rejects corruption and tampered revision",async()=>{
    candidate=path.join(release,"durable-candidate-test-"+randomUUID());
    const resources=path.join(candidate,"win-unpacked/resources");
    await mkdir(resources,{recursive:true});
    const locked=hash(await readFile(path.join(root,"pnpm-lock.yaml"),"utf8"));
    const revision=git(["rev-parse","HEAD"]);
    await writeFile(path.join(resources,"build-provenance.json"),JSON.stringify({
      version:1,sourceRevision:revision,dirtyTree:false,lockfileSha256:locked
    }));
    const paths=[
      "uia-helper/qnector-uia.exe","durable-runtime/qnector-job-host.exe",
      "durable-runtime/daemon.mjs","durable-runtime/worker-main.js",
      "everything-cli/es.exe","ripgrep/rg.exe",
      "openai-tunnel/tunnel-client.exe","openai-tunnel/cloudflared.exe",
      "typescript-lib/lib.d.ts"
    ];
    for(const name of paths) {
      const filepath=path.join(resources,name);
      await mkdir(path.dirname(filepath),{recursive:true});
      await writeFile(filepath,"release integrity fixture "+name);
    }
    const setup=path.join(candidate,"Qnector-0.4.56-win-x64-setup.exe");
    const portable=path.join(candidate,"Qnector-0.4.56-win-x64-portable.exe");
    await writeFile(setup,"fixture setup");
    await writeFile(portable,"fixture portable");
    const report=writePackageEvidence(candidate);
    expect(report.data.sourceRevision).toBe(revision);
    expect(verifyPackageEvidence(candidate,revision).ok).toBe(true);
    expect(()=>verifyPackageEvidence(candidate,"not-the-right-revision")).toThrow("PACKAGE_EVIDENCE_REVISION_MISMATCH");
    await writeFile(setup,"changed setup");
    expect(()=>verifyPackageEvidence(candidate,revision)).toThrow("PACKAGE_EVIDENCE_HASH_MISMATCH");
  });
});
