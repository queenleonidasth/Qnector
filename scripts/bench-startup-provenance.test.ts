import {readFileSync} from "node:fs";
import path from "node:path";
import {describe,it,expect} from "vitest";

const source=readFileSync(path.join(import.meta.dirname,"bench-startup-abba.mts"),"utf8");

describe("startup benchmark provenance",()=>{
 it("selects an exact-commit, SHA-verified candidate package rather than a historical hardcoded build",()=>{
   expect(source).toContain("findVerifiedPackage");
   expect(source).toContain("candidatePackageRevision:candidatePackage.revision");
   expect(source).not.toContain("durable-candidate-20261015-104030");
   expect(source).not.toContain("7466deccb16e9579a7230c405ea1e3f8da1d1d6e");
 });
 it("reads baseline executable provenance rather than labeling installed 0.4.55 as an unrelated Git revision",()=>{
   expect(source).toContain("build-provenance.json");
   expect(source).toContain("baselineRevision:baselineProvenance.sourceRevision");
   expect(source).toContain("baselineRepositoryRevision:rev(baselineRoot)");
 });
});
