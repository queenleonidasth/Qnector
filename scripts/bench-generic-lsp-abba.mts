import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
import {GenericLspService as CandidateLsp} from "../packages/core/src/generic-lsp.js";

const root=path.resolve(import.meta.dirname,"..");
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE ?? "D:\\Projects\\Qnector-PlanMode2");
const {GenericLspService:BaselineLsp}=await import(pathToFileURL(path.join(baselineRoot,"packages/core/src/generic-lsp.ts")).href) as {GenericLspService:typeof CandidateLsp};
const rev=(cwd:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8",windowsHide:true}).trim();
const pct=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]!;
const ci=(values:number[],p:number,seed=19547):[number,number]=>{
 const data=[] as number[];
 for(let i=0;i<500;i++){
  const sample=[] as number[];
  for(let j=0;j<values.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;sample.push(values[Math.floor(seed/2**32*values.length)]!);}
  data.push(pct(sample,p));
 }
 return [pct(data,.025),pct(data,.975)];
};
const stats=(values:number[])=>({n:values.length,p50Ms:pct(values,.5),p95Ms:pct(values,.95),p50Confidence95Ms:ci(values,.5),p95Confidence95Ms:ci(values,.95,457)});
type Variant="baseline"|"candidate";
type Measurement={ms:number;parentCpuMicroseconds:number;rssBytes:number;sha256:string};
const warm:Record<Variant,Measurement[]>={baseline:[],candidate:[]};
const cold:Record<Variant,Measurement[]>={baseline:[],candidate:[]};
const folder=await mkdtemp(path.join(os.tmpdir(),"qnector-generic-lsp-benchmark-"));
const source=path.join(folder,"benchmark.py");
const fixtureServer=path.join(root,"packages/core/src/fixtures/fake-lsp-server.mjs");
const original=new BaselineLsp(),candidate=new CandidateLsp({maxSessions:2,idleMs:30_000});
const payload={workspaceRoot:folder,path:source,action:"document_symbols" as const,
 serverCommand:process.execPath,serverArgs:[fixtureServer]};
const expected=createHash("sha256").update(JSON.stringify({name:"fixture สวัสดี\n",kind:12})).digest("hex");
async function measure(variant:Variant,fresh=false):Promise<Measurement>{
 const service=fresh?(variant==="baseline"?new BaselineLsp():new CandidateLsp({idleMs:100})):variant==="baseline"?original:candidate;
 const cpu=process.cpuUsage(),start=performance.now();
 try{
  const answer=await service.request(payload);
  const symbol=(answer.result as Array<{name:string;kind:number}>)[0];
  const sha256=createHash("sha256").update(JSON.stringify({name:symbol?.name,kind:symbol?.kind})).digest("hex");
  if(sha256!==expected)throw Error("LSP_RESULT_DRIFT_"+variant);
  const elapsed=performance.now()-start,delta=process.cpuUsage(cpu);
  return {ms:elapsed,parentCpuMicroseconds:delta.user+delta.system,rssBytes:process.memoryUsage().rss,sha256};
 }finally {
  if(fresh && "close" in service && typeof service.close==="function")await service.close();
 }
}
function summarize(data:Record<Variant,Measurement[]>){
 return Object.fromEntries((["baseline","candidate"] as Variant[]).map(name=>[name,{
  elapsed:stats(data[name].map(x=>x.ms)),
  parentCpuMicroseconds:stats(data[name].map(x=>x.parentCpuMicroseconds)),
  maxParentRssBytes:Math.max(...data[name].map(x=>x.rssBytes)),
  outputSha256:[...new Set(data[name].map(x=>x.sha256))]
 }]));
}
try{
 await writeFile(source,"fixture สวัสดี\n");
 for(let round=0;round<20;round++)
  for(const name of (round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[]){
   const output=await measure(name);
   if(round>=5)warm[name].push(output);
  }
 for(let round=0;round<10;round++)
  for(const name of (round%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])
   cold[name].push(await measure(name,true));
 const report={
  schemaVersion:1,workload:"generic-lsp-on-demand-reuse",
  baselineRevision:rev(baselineRoot),candidateRevision:rev(root),
  environment:{node:process.version,platform:process.platform,cpuCount:os.cpus().length},
  warmupRounds:5,measuredPerVariant:30,freshServerStartsPerVariant:10,
  correctness:"PASS",outputSha256:expected,warm:summarize(warm),freshServer:summarize(cold),
  releaseEligible:false,
  limitations:"Real JSON-RPC over real Node child processes with an isolated deterministic fake LSP server. Warm candidate reuses one real child; fresh service starts a separate child. Not end-to-end ChatGPT/host/network, and process CPU covers the parent only."
 };
 console.log(JSON.stringify(report,null,2));
}finally{
 await candidate.close();
 await rm(folder,{recursive:true,force:true});
}
