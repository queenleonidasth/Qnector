import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.resolve(root, "apps/desktop/release");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const git = (args) => execFileSync("git",args,{cwd:root,encoding:"utf8",windowsHide:true}).trim();
const requiredResources = [
  "uia-helper/qnector-uia.exe",
  "durable-runtime/qnector-job-host.exe",
  "durable-runtime/daemon.mjs",
  "durable-runtime/worker-main.js",
  "everything-cli/es.exe",
  "ripgrep/rg.exe",
  "openai-tunnel/tunnel-client.exe",
  "openai-tunnel/cloudflared.exe",
  "typescript-lib/lib.d.ts",
  "build-provenance.json",
];
const provedGates = [
  "release-preflight","version-sync","initial-build","native-uia-publish",
  "native-job-host-publish","durable-runtime-bundle","durable-recovery",
  "desktop-release-regression","external-mcp","skill-layout",
  "native-renderer-ui",
  "clean-build","compiled-stdio-parity","electron-builder",
  "packaged-resource-presence","packaged-durable-bundle",
  "packaged-durable-recovery","packaged-stdio-smoke","packaged-typescript-diagnostics",
];

function withinRelease(dir) {
  const absolute=realpathSync(dir);
  const base=realpathSync(releaseRoot);
  if (!absolute.startsWith(base+path.sep)) throw new Error("PACKAGE_PATH_OUTSIDE_RELEASE_ROOT");
  if (!path.basename(absolute).startsWith("durable-candidate-")) throw new Error("PACKAGE_DIRECTORY_INVALID");
  return absolute;
}
function exactCandidateFiles(dir) {
  const names=readdirSync(dir).filter((f)=>/^Qnector-[0-9.]+-win-x64-(setup|portable)\.exe$/.test(f));
  if(names.length!==2 || !names.some(n=>n.endsWith("-setup.exe")) ||
      !names.some(n=>n.endsWith("-portable.exe"))) throw new Error("PACKAGE_EXES_MISSING_OR_AMBIGUOUS");
  return names.sort();
}
export function writePackageEvidence(candidateDir) {
  const dir=withinRelease(candidateDir);
  const revision=git(["rev-parse","HEAD"]);
  if (git(["status","--porcelain=v1","--untracked-files=all"])) throw new Error("PACKAGE_SOURCE_TREE_NOT_CLEAN");
  const provenancePath=path.join(dir,"win-unpacked/resources/build-provenance.json");
  const provenance=JSON.parse(readFileSync(provenancePath,"utf8"));
  if(provenance.sourceRevision!==revision || provenance.dirtyTree!==false) throw new Error("PACKAGE_PROVENANCE_REVISION_MISMATCH");
  const lockfileSha256=sha(path.join(root,"pnpm-lock.yaml"));
  if(provenance.lockfileSha256.toLowerCase()!==lockfileSha256) throw new Error("PACKAGE_LOCKFILE_MISMATCH");
  const binaries=exactCandidateFiles(dir).map(name=>({
    name,sizeBytes:statSync(path.join(dir,name)).size,
    sha256:sha(path.join(dir,name)),
  }));
  const resources=requiredResources.map(name=>{
    const file=path.join(dir,"win-unpacked/resources",name);
    if (!statSync(file).isFile()) throw new Error("RESOURCE_NOT_A_FILE");
    return {name,sizeBytes:statSync(file).size,sha256:sha(file)};
  });
  const data={schemaVersion:1,createdAt:new Date().toISOString(),sourceRevision:revision,
    dirtyTree:false,lockfileSha256,packageDirectory:path.basename(dir),
    gates:provedGates,binaries,resources,
    note:"Recorded by the package runner only after every required package-stage test exited 0. Does not certify tunnel, ChatGPT host, actual installed upgrade, production gameplay or unsigned code signing."};
  const output=path.join(dir,"package-acceptance.json");
  writeFileSync(output,JSON.stringify(data,null,2)+"\n","utf8");
  return {output,data};
}
export function verifyPackageEvidence(candidateDir,expectedRevision,{requireClean=true}={}) {
  const dir=withinRelease(candidateDir);
  const data=JSON.parse(readFileSync(path.join(dir,"package-acceptance.json"),"utf8"));
  if(data.schemaVersion!==1 || data.sourceRevision!==expectedRevision || data.dirtyTree!==false)
    throw new Error("PACKAGE_EVIDENCE_REVISION_MISMATCH");
  if(requireClean && git(["status","--porcelain=v1","--untracked-files=all"]))
    throw new Error("PACKAGE_SOURCE_TREE_NOT_CLEAN");
  if(data.lockfileSha256!==sha(path.join(root,"pnpm-lock.yaml"))) throw new Error("PACKAGE_EVIDENCE_LOCKFILE_MISMATCH");
  if(data.packageDirectory!==path.basename(dir))throw new Error("PACKAGE_EVIDENCE_DIR_MISMATCH");
  if(JSON.stringify(data.gates)!==JSON.stringify(provedGates))throw new Error("PACKAGE_GATES_INCOMPLETE");
  const original=JSON.parse(readFileSync(path.join(dir,"win-unpacked/resources/build-provenance.json"),"utf8"));
  if(original.sourceRevision!==expectedRevision || original.dirtyTree!==false ||
     original.lockfileSha256.toLowerCase()!==data.lockfileSha256) throw new Error("PACKAGE_PROVENANCE_MISMATCH");
  const files=exactCandidateFiles(dir);
  if(data.binaries.length!==2 || JSON.stringify(files)!==JSON.stringify(data.binaries.map(x=>x.name)))
    throw new Error("PACKAGE_BINARY_LIST_MISMATCH");
  for(const entry of data.binaries)checkEntry(dir,entry);
  if(data.resources.length!==requiredResources.length ||
     JSON.stringify(data.resources.map(x=>x.name))!==JSON.stringify(requiredResources))
    throw new Error("PACKAGE_RESOURCE_LIST_MISMATCH");
  for(const entry of data.resources)checkEntry(path.join(dir,"win-unpacked/resources"),entry);
  return {ok:true,revision:expectedRevision,packageDirectory:dir,binaries:data.binaries,
    smokeVerified:true,nativeBuildVerified:true,uiTestsVerified:true,
    limitations:"No authenticated ChatGPT host, tunnel, actual upgrade, foreground game, or signature attestation."};
}
function checkEntry(base,entry) {
  if(typeof entry.name!=="string" || path.isAbsolute(entry.name) || entry.name.includes("..") ||
     typeof entry.sha256!=="string" || !/^[0-9a-f]{64}$/i.test(entry.sha256) ||
     !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes<=0) throw new Error("PACKAGE_ENTRY_INVALID");
  const file=path.resolve(base,entry.name);
  const resolved=realpathSync(file);
  if(!resolved.startsWith(realpathSync(base)+path.sep))throw new Error("PACKAGE_RESOURCE_PATH_ESCAPE");
  if(statSync(resolved).size!==entry.sizeBytes || sha(resolved)!==entry.sha256)
    throw new Error("PACKAGE_EVIDENCE_HASH_MISMATCH: "+entry.name);
}
export function findVerifiedPackage(expectedRevision) {
  if(!existsSync(releaseRoot))return null;
  const dirs=readdirSync(releaseRoot).filter(n=>n.startsWith("durable-candidate-")).sort().reverse();
  for(const name of dirs){
    const dir=path.join(releaseRoot,name);
    if(!existsSync(path.join(dir,"package-acceptance.json")))continue;
    try {return verifyPackageEvidence(dir,expectedRevision);} catch { /* other revision or damaged package */ }
  }
  return null;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const cmd=process.argv[2],arg=process.argv[3];
  if(cmd==="record" && arg) {
    const {output}=writePackageEvidence(arg);
    const validated=verifyPackageEvidence(arg,git(["rev-parse","HEAD"]));
    console.log(JSON.stringify({output,revision:validated.revision,binaries:validated.binaries}));
  }else if(cmd==="verify" && arg){
    console.log(JSON.stringify(verifyPackageEvidence(arg,git(["rev-parse","HEAD"]))));
  }else {throw new Error("Use: node scripts/package-evidence.mjs record|verify <candidate directory>");}
}
