import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
import {WindowsFileSearchService} from "../packages/core/src/file-search.js";
type Variant="baseline"|"candidate";
const root=path.resolve(import.meta.dirname,"..");
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:\\Projects\\Qnector-PlanMode2");
const {WindowsFileSearchService:Base}=await import(pathToFileURL(path.join(baselineRoot,"packages/core/src/file-search.ts")).href) as {WindowsFileSearchService:typeof WindowsFileSearchService};
const git=(cwd:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8",windowsHide:true}).trim();
const sha=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const pct=(x:number[],p:number)=>[...x].sort((a,b)=>a-b)[Math.max(0,Math.ceil(p*x.length)-1)]!;
const ci=(x:number[],p:number,seed=1234)=>{const out=[];for(let i=0;i<500;i++){const sampled=[];for(let k=0;k<x.length;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;sampled.push(x[Math.floor(seed/2**32*x.length)]!);}out.push(pct(sampled,p));}return [pct(out,.025),pct(out,.975)];};
const summary=(x:number[])=>({n:x.length,p50:pct(x,.5),p95:pct(x,.95),p50CI:ci(x,.5),p95CI:ci(x,.95,3456)});
const report:Record<string,unknown>={schemaVersion:1,workload:"fallback-file-provider-1-20-100",baseline:git(baselineRoot),candidate:git(root),warmupRounds:5,measuredPerVariant:30,freshProviderPerVariant:10,localOnly:true,limitations:"Tests bounded filesystem fallback provider with Thai filenames on isolated fixtures; no Everything IPC latency, host/OS cold boot or external network."};
const cases=[] as unknown[];
for(const count of [1,20,100]){
  const dir=await mkdtemp(path.join(os.tmpdir(),"qnector-fallback-abba-"));
  try{
    for(let i=0;i<count;i++)await writeFile(path.join(dir,"report-"+String(i).padStart(3,"0")+".txt"),"ระบบรายการสินค้า "+i);
    // Scope the injected fallback roots to the immutable benchmark fixture,
    // avoiding the normal global-search roots (home directory and drives).
    const runtime={platform:process.platform,findEverythingExecutable:async()=>null,
      runExecutable:async()=>{throw new Error("EVERYTHING_NOT_REQUESTED");},
      fallbackRoots:(workspace?:string)=>workspace?[workspace]:[]};
    const services:{baseline:WindowsFileSearchService;candidate:WindowsFileSearchService}={baseline:new Base(runtime),candidate:new WindowsFileSearchService(runtime)};
    type Measurement={ms:number;cpuUs:number;rss:number;bytes:number};
    const values:Record<Variant,Measurement[]>={baseline:[],candidate:[]},cold:typeof values={baseline:[],candidate:[]};
    let oracle:string|undefined;
    async function run(name:Variant,fresh=false){
      const service=fresh?new (name==="baseline"?Base:WindowsFileSearchService)(runtime):services[name];
      const c=process.cpuUsage(),start=performance.now();
      const result=await service.search({query:"report",provider:"fallback",maxResults:count+1,workspaceRoot:dir,details:false});
      const elapsed=performance.now()-start;
      if(result.provider!=="fallback"||result.matches.length!==count)throw Error("FALLBACK_PROVIDER_INCOMPLETE "+name+" "+count+" "+result.matches.length+" "+JSON.stringify(result.matches.map(x=>x.name)));
      const normalized=result.matches.map(x=>({name:x.name,extension:x.extension}));
      const fingerprint=sha(normalized);
      if(oracle===undefined)oracle=fingerprint;
      if(oracle!==fingerprint)throw Error("FALLBACK_HASH_DRIFT "+name+" "+count);
      const cpu=process.cpuUsage(c);
      return {ms:elapsed,cpuUs:cpu.user+cpu.system,rss:process.memoryUsage().rss,bytes:Buffer.byteLength(JSON.stringify(result))};
    }
    for(let round=0;round<20;round++)for(const name of (round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[]){
      const out=await run(name);
      if(round>=5)values[name].push(out);
    }
    for(let round=0;round<10;round++)for(const name of (round%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])cold[name].push(await run(name,true));
    const measure=(data:typeof values)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(n=>[n,{elapsedMs:summary(data[n].map(x=>x.ms)),cpuMicroseconds:summary(data[n].map(x=>x.cpuUs)),responseBytes:summary(data[n].map(x=>x.bytes)),peakRssBytes:Math.max(...data[n].map(x=>x.rss))}]));
    cases.push({files:count,oracleSha256:oracle,correctness:"PASS",warm:measure(values),freshProvider:measure(cold)});
  }finally{await rm(dir,{recursive:true,force:true});}
}
report.cases=cases;report.releaseEligible=false;
console.log(JSON.stringify(report,null,2));
