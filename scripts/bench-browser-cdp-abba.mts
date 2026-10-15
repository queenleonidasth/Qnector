import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
import {ToolRegistry,type ToolContext} from "../packages/tools/src/index.js";
import {defaultConfig} from "../packages/core/src/config.js";
import {WorkspaceState} from "../packages/core/src/workspace-state.js";
import {ProcessManager} from "../packages/core/src/process-manager.js";
import {TypeScriptCodeIntelligence} from "../packages/core/src/code-intelligence.js";
import {MemoryStore} from "../packages/core/src/memory-store.js";
import {ActivityLogger} from "../packages/core/src/activity-log.js";
type Variant="baseline"|"candidate";
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:\\Projects\\Qnector-PlanMode2");
const root=path.resolve(import.meta.dirname,"..");
const revision=(cwd:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8",windowsHide:true}).trim();
const {ToolRegistry:OriginalRegistry}=await import(pathToFileURL(path.join(baselineRoot,"packages/tools/src/index.ts")).href) as {ToolRegistry:typeof ToolRegistry};
const targets=await (await fetch("http://127.0.0.1:9222/json/list")).json() as Array<{id:string;url:string}>;
const target=targets.find(x=>x.url==="http://127.0.0.1:48341/qc");
if(!target)throw Error("EXPECTED_HEADLESS_TEST_BROWSER_NOT_AVAILABLE");
const fixture=await mkdtemp(path.join(os.tmpdir(),"qnector-cdp-abba-"));
const config=defaultConfig(fixture);
const context:ToolContext={workspace:new WorkspaceState(config),processManager:new ProcessManager("direct"),
  codeIntelligence:new TypeScriptCodeIntelligence(),
  memory:new MemoryStore(fixture,{rootDirectory:path.join(fixture,".memory-cdp-bench"),workspaceMirror:"off"}),
  activity:new ActivityLogger(path.join(fixture,"activity-cdp-bench.jsonl")),
  getConfig:()=>config,setConfig:async()=>undefined};
const services:{baseline:ToolRegistry;candidate:ToolRegistry}={baseline:new OriginalRegistry(),candidate:new ToolRegistry()};
const pct=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]!;
const CI=(a:number[],p:number,seed=12345)=>{const out=[];for(let i=0;i<500;i++){const b=[];for(let k=0;k<a.length;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;b.push(a[Math.floor(seed/2**32*a.length)]!);}out.push(pct(b,p));}return [pct(out,.025),pct(out,.975)];};
const metrics=(a:number[])=>({n:a.length,p50:pct(a,.5),p95:pct(a,.95),p50Confidence95:CI(a,.5),p95Confidence95:CI(a,.95,67890)});
const results:Record<Variant,Array<{ms:number;cpuUs:number;bytes:number;rss:number}>>={baseline:[],candidate:[]};
const fresh:typeof results={baseline:[],candidate:[]};
const expected=createHash("sha256").update("READY ภาษาไทย").digest("hex");
async function run(variant:Variant){
  const cpu=process.cpuUsage();const start=performance.now();
  const response=await services[variant].call("browser",context,{
    action:"get_text",targetId:target!.id,selector:"#delayed",port:9222,host:"127.0.0.1"
  });
  const ms=performance.now()-start;
  if(!response.ok)throw Error("BROWSER_READ_FAILED_"+variant+"_"+JSON.stringify(response.error));
  const data=(response.data as {data?:{text:string;target:{targetId:string}}}).data;
  if(data?.target?.targetId!==target!.id || createHash("sha256").update(data.text).digest("hex")!==expected)
    throw Error("BROWSER_READ_OUTPUT_MISMATCH_"+variant);
  const change=process.cpuUsage(cpu);
  return {ms,cpuUs:change.user+change.system,bytes:Buffer.byteLength(JSON.stringify(response)),rss:process.memoryUsage().rss};
}
try{
  for(let round=0;round<20;round++){
    for(const name of (round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[]){
      const value=await run(name);
      if(round>=5)results[name].push(value);
    }
  }
  for(let i=0;i<10;i++){
    for(const name of (i%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])
      fresh[name].push(await run(name));
  }
  const measure=(data:typeof results)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(n=>[n,{
    elapsedMs:metrics(data[n].map(v=>v.ms)),cpuMicroseconds:metrics(data[n].map(v=>v.cpuUs)),
    payloadBytes:metrics(data[n].map(v=>v.bytes)),maxRssBytes:Math.max(...data[n].map(v=>v.rss))
  }]));
  console.log(JSON.stringify({
    schemaVersion:1,workload:"real-headless-chromium-cdp-read",
    baselineRevision:revision(baselineRoot),candidateRevision:revision(root),
    browser:"Chromium 141.0.7390.37 / CDP loopback",localhostPort:9222,
    sampleTargetUrl:target.url,sampleSelector:"#delayed",outputSha256:expected,
    warmupRounds:5,measuredPerVariant:30,lateReadSamplesPerVariant:10,
    correctness:"PASS",warm:measure(results),lateRead:measure(fresh),
    releaseEligible:false,
    limitations:"Real local headless CDP against isolated QNECTOR test page, not ChatGPT host or candidate Electron. Late reads are not cold browser/OS process boots. Browser target identity and text hashes verified on every request; no user browser data accessed."
  },null,2));
}finally{await context.processManager.stopAll();await rm(fixture,{recursive:true,force:true});}
// The source and baseline browser-tool modules retain CDP WebSocket transports;
// the browser is a separately owned test runtime and must remain running.
// Only terminate this completed benchmark process after stdout has flushed.
setTimeout(()=>process.exit(0),100).unref();
