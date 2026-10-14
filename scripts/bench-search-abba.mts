import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { LocalSemanticSearchService as Candidate } from "../packages/core/src/semantic-search.js";

const baselineRoot = path.resolve(process.env.QNECTOR_BENCH_BASELINE ?? "D:\\Projects\\Qnector-PlanMode2");
const candidateRoot = path.resolve(import.meta.dirname, "..");
const baselineRevision = git(baselineRoot, ["rev-parse", "HEAD"]);
const candidateRevision = git(candidateRoot, ["rev-parse", "HEAD"]);
if (baselineRevision === candidateRevision) throw new Error("Benchmark requires distinct baseline and candidate commits");
if (git(baselineRoot, ["status", "--porcelain"])) throw new Error("Benchmark baseline must be clean");
const originalModule = pathToFileURL(path.join(baselineRoot, "packages/core/src/semantic-search.ts")).href;
const { LocalSemanticSearchService: Baseline } = await import(originalModule) as {LocalSemanticSearchService: typeof Candidate};

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pct = (samples: number[], fraction: number) =>
  [...samples].sort((a,b)=>a-b)[Math.max(0,Math.ceil(samples.length*fraction)-1)] ?? NaN;
function bootstrap95(samples: number[], quantile: number, seed: number):[number,number] {
  const estimate:number[]=[];
  for(let repeat=0;repeat<1000;repeat++){
    const sampled:number[]=[];
    for(let k=0;k<samples.length;k++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      sampled.push(samples[Math.floor(seed/2**32*samples.length)]!);
    }
    estimate.push(pct(sampled,quantile));
  }
  return [pct(estimate,.025),pct(estimate,.975)];
}
function describe(samples: number[]) {
  if (!samples.length) throw new Error("Missing benchmark samples");
  return {n:samples.length,p50Ms:pct(samples,.5),p95Ms:pct(samples,.95),
    medianConfidence95Ms:bootstrap95(samples,.5,0x31a5),
    p95Confidence95Ms:bootstrap95(samples,.95,0x7ec1),
    minMs:Math.min(...samples),maxMs:Math.max(...samples),
    meanMs:samples.reduce((a,b)=>a+b,0)/samples.length};
}
type Variant = "baseline"|"candidate";
type Sample = {durationMs:number;cpuUserUs:number;cpuSystemUs:number;rssBytes:number;sha256:string;readFiles:number};
const out:Record<string,unknown> = {
  schemaVersion:1,benchmark:"semantic-search-actual-baseline-vs-candidate",createdAt:new Date().toISOString(),
  baseline:{root:baselineRoot,revision:baselineRevision},candidate:{root:candidateRoot,revision:candidateRevision},
  platform:process.platform,node:process.version,freeMemoryBytes:os.freemem(),warmupRounds:5,
  samplesPerVariant:30,coldIndexSamplesPerVariant:10,
  hostClientGap:"UNKNOWN",coldProcessStarts:"UNKNOWN",limitations:
    "Same-process source-module comparison of actual semantic search under synthetic local read-only fixtures. Cold index means a fresh search service, NOT cold process or OS disk cache. No host/model/network, interactive UI, documents or package performance is inferred."};
const cases:unknown[]=[];
for (const count of [20,100]) {
  const dir=await mkdtemp(path.join(os.tmpdir(),"qnector-e2e-search-abba-"));
  try {
    await Promise.all(Array.from({length:count},(_,i)=>writeFile(path.join(dir,`document-${String(i).padStart(3,"0")}.ts`),
      `/** report inventory สินค้า Thai QA ${i} */\nexport const stock_${i} = {name:"inventory stock warehouse",quantity:${i},label:"สินค้า"};\n`,"utf8")));
    const input={workspaceRoot:dir,query:"inventory stock warehouse สินค้า",maxFiles:count,maxResults:20};
    const services:{baseline:InstanceType<typeof Candidate>;candidate:InstanceType<typeof Candidate>} =
      {baseline:new Baseline(),candidate:new Candidate()};
    const measures:{baseline:Sample[];candidate:Sample[]}={baseline:[],candidate:[]};
    const cold:{baseline:Sample[];candidate:Sample[]}={baseline:[],candidate:[]};
    let oracle:string|undefined;
    async function execute(name:Variant, fresh:boolean):Promise<Sample>{
      const service=fresh ? name==="baseline" ? new Baseline() : new Candidate() : services[name];
      const startCpu=process.cpuUsage();const t=performance.now();
      const result=await service.search(input);
      const durationMs=performance.now()-t;const cpu=process.cpuUsage(startCpu);
      const content={engine:result.engine,query:result.query,matches:result.matches,indexedFiles:result.indexedFiles,
        indexedChunks:result.indexedChunks,truncated:result.truncated,indexTruncated:result.indexTruncated,
        skippedFiles:result.skippedFiles,totalMatches:result.totalMatches};
      const digest=sha(content);
      if (oracle===undefined) oracle=digest;
      if (oracle!==digest) throw new Error(`Semantic outcome differs baseline/candidate ${count} files ${name}`);
      if(result.indexedFiles!==count)throw new Error(`Indexed count mismatch expected ${count}`);
      return {durationMs,cpuUserUs:cpu.user,cpuSystemUs:cpu.system,rssBytes:process.memoryUsage().rss,
        sha256:digest,readFiles:result.cache.readFiles};
    }
    for(let i=0;i<35;i++){
      for(const name of ["baseline","candidate","candidate","baseline"] as Variant[]){
        const result=await execute(name,false);
        if(i>=5 && measures[name].length<30)measures[name].push(result);
      }
    }
    for(let i=0;i<10;i++){
      const order=(i%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[];
      for(const name of order){const result=await execute(name,true);if(cold[name].length<10)cold[name].push(result);}
    }
    const aggregate=(data:{baseline:Sample[];candidate:Sample[]})=>
      Object.fromEntries((["baseline","candidate"] as Variant[]).map(k=>[k,{
        elapsed:describe(data[k].map(x=>x.durationMs)),
        cpuUserUs:describe(data[k].map(x=>x.cpuUserUs)),
        cpuSystemUs:describe(data[k].map(x=>x.cpuSystemUs)),
        peakRssBytes:Math.max(...data[k].map(x=>x.rssBytes)),
        readFiles:Array.from(new Set(data[k].map(x=>x.readFiles))) }]));
    cases.push({files:count,oracleSha256:oracle,correctness:"PASS",warm:aggregate(measures),coldIndex:aggregate(cold)});
  } finally {await rm(dir,{recursive:true,force:true});}
}
out.cases=cases;
out.releaseEligible=false;
out.note="Workload subset only. Full Task12 ABBA, client-host timings, and cold PROCESS startups remain unverified.";
process.stdout.write(JSON.stringify(out,null,2)+"\n");
function git(cwd:string,args:string[]):string {
  return execFileSync("git",args,{cwd,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","ignore"]}).trim();
}
