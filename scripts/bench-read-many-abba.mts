import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
import {ToolRegistry} from "../packages/tools/src/index.js";
import {defaultConfig} from "../packages/core/src/config.js";
import {WorkspaceState} from "../packages/core/src/workspace-state.js";
import {ProcessManager} from "../packages/core/src/process-manager.js";
import {TypeScriptCodeIntelligence} from "../packages/core/src/code-intelligence.js";
import {MemoryStore} from "../packages/core/src/memory-store.js";
import {ActivityLogger} from "../packages/core/src/activity-log.js";
import type {ToolContext} from "../packages/tools/src/index.js";

type Variant="baseline"|"candidate";
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:\\Projects\\Qnector-PlanMode2");
const root=path.resolve(import.meta.dirname,"..");
const baselineRevision=git(baselineRoot,["rev-parse","HEAD"]);
const candidateRevision=git(root,["rev-parse","HEAD"]);
const {ToolRegistry:OriginalRegistry}=await import(pathToFileURL(path.join(baselineRoot,"packages/tools/src/index.ts")).href) as {ToolRegistry:typeof ToolRegistry};
const contextFor=(rootPath:string):ToolContext=>{
  const config=defaultConfig(rootPath);
  return {
    workspace:new WorkspaceState(config),processManager:new ProcessManager("direct"),
    codeIntelligence:new TypeScriptCodeIntelligence(),
    memory:new MemoryStore(config.activeWorkspace,{rootDirectory:path.join(config.activeWorkspace,".memory-benchmark"),workspaceMirror:"off"}),
    activity:new ActivityLogger(path.join(config.activeWorkspace,"activity-benchmark.jsonl")),
    getConfig:()=>config,setConfig:async()=>undefined,
  };
};
const sha=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const pct=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]!;
const bootstrap=(a:number[],p:number,seed:number):[number,number]=>{
  const arr:number[]=[];
  for(let round=0;round<1000;round++){
    const res:number[]=[];
    for(let k=0;k<a.length;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;res.push(a[Math.floor(seed/2**32*a.length)]!);}
    arr.push(pct(res,p));
  }
  return [pct(arr,.025),pct(arr,.975)];
};
const summary=(a:number[])=>({
  n:a.length,p50Ms:pct(a,.5),p95Ms:pct(a,.95),meanMs:a.reduce((x,y)=>x+y,0)/a.length,
  p50Confidence95Ms:bootstrap(a,.5,12345),p95Confidence95Ms:bootstrap(a,.95,67890),
});
const report:Record<string,unknown>={
 schemaVersion:1,workload:"read_many",baseline:{revision:baselineRevision,root:baselineRoot},
 candidate:{revision:candidateRevision,root},node:process.version,arch:process.arch,
 environment:{cpuCount:os.cpus().length,totalMemory:os.totalmem()},warmupRounds:5,measuredEach:30,
 hostObserved:"UNKNOWN",coldProcessStarts:"UNKNOWN",
 limitations:"Actual baseline/candidate Qnector tools on same local synthetic fixtures. Fresh registry is not a cold process boot. Host/model/network and interactive GUI are unmeasured."
};
const cases:Record<string,unknown>[]=[];
for(const scenario of ["one-large","twenty-small","hundred-small"]){
 const dir=await mkdtemp(path.join(os.tmpdir(),"qnector-read-many-abba-"));
 try {
  const count=scenario==="one-large"?1:scenario==="twenty-small"?20:100;
  for(let i=0;i<count;i++){
   const data=scenario==="one-large" ? "large-file-".repeat(110_000)+"\r\nภาษาไทย😀\r\nend\n"
     : ("file_"+i+" export inventory สินค้า\n").repeat(4);
   await writeFile(path.join(dir,"file-"+String(i).padStart(3,"0")+".txt"),data,"utf8");
  }
  const ctx=contextFor(dir);
  const registry:{baseline:ToolRegistry;candidate:ToolRegistry}={
    baseline:new OriginalRegistry(),candidate:new ToolRegistry()};
  const input={action:"read_many",paths:Array.from({length:count},(_,i)=>
    "file-"+String(i).padStart(3,"0")+".txt"),maxChars:scenario==="one-large"?5000:50000};
  const samples:Record<Variant,Array<{ms:number;cpuUs:number;rss:number;bytes:number;sha:string}>>={baseline:[],candidate:[]};
  const fresh:typeof samples={baseline:[],candidate:[]};
  let expected:string|undefined;
  async function run(name:Variant,useFresh=false){
    const current=useFresh?new (name==="baseline"?OriginalRegistry:ToolRegistry)():registry[name];
    const startCpu=process.cpuUsage();
    const started=performance.now();
    const outcome=await current.call("files",ctx,input as never);
    const ms=performance.now()-started;
    const cpu=process.cpuUsage(startCpu);
    if(!outcome.ok)throw new Error(name+" read_many failed "+JSON.stringify(outcome.error));
    const data=(outcome.data as {data:{files:Array<Record<string,unknown>>;requested:number}}).data;
    if(data?.requested!==count)throw new Error("Requested file count mismatch "+name+" "+scenario+" "+JSON.stringify(outcome.data).slice(0,700));
    const normalized=data.files.map(x=>({path:path.basename(String(x.path)),content:x.content,
      sha256:x.sha256,truncated:x.truncated,error:x.error}));
    if(normalized.length!==count||normalized.some(x=>x.error))throw new Error("Wrong number of files/errors");
    const digest=sha(normalized);
    if(expected===undefined)expected=digest;
    if(expected!==digest)throw new Error("SHA outcome mismatch "+scenario+" "+name+" original="+expected+" candidate="+digest+" outcome="+JSON.stringify(normalized).slice(0,1500));
    return {ms,cpuUs:cpu.user+cpu.system,rss:process.memoryUsage().rss,bytes:Buffer.byteLength(JSON.stringify(outcome.data)),sha:digest};
  }
  for(let i=0;i<35;i++){
    const order=(i%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[];
    for(const name of order){const observation=await run(name);if(i>=5&&samples[name].length<30)samples[name].push(observation);}
  }
  for(let i=0;i<10;i++){
    for(const name of (i%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])fresh[name].push(await run(name,true));
  }
  const measurement=(records:typeof samples)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(n=>[n,{
    elapsed:summary(records[n].map(x=>x.ms)),cpuUs:summary(records[n].map(x=>x.cpuUs)),
    maxRssBytes:Math.max(...records[n].map(x=>x.rss)),
    outputBytes:Array.from(new Set(records[n].map(x=>x.bytes))),
  }]));
  cases.push({scenario,files:count,outcomeSha256:expected,correctness:"PASS",
     warm:measurement(samples),freshRegistry:measurement(fresh)});
 }finally{await rm(dir,{recursive:true,force:true});}
}
report.cases=cases;
report.releaseEligible=false;
report.note="Subset benchmark only. No full-host or all-format evidence; release remains blocked.";
console.log(JSON.stringify(report,null,2));
function git(cwd:string,args:string[]):string{
 return execFileSync("git",args,{cwd,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","ignore"]}).trim();
}