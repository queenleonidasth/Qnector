import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
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
import {FileWatchService} from "../packages/core/src/file-watch.js";
import {WorkflowManager} from "../packages/core/src/workflow-manager.js";

type Variant="baseline"|"candidate";
const sourceRoot=path.resolve(import.meta.dirname,"..");
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:\\Projects\\Qnector-PlanMode2");
const {ToolRegistry:OriginalRegistry}=await import(pathToFileURL(path.join(baselineRoot,"packages/tools/src/index.ts")).href) as {ToolRegistry:typeof ToolRegistry};
const git=(cwd:string,args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8",windowsHide:true}).trim();
const percent=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]!;
function CI(values:number[],percentile:number,seed=123456){const drawn=[];for(let i=0;i<1000;i++){const samples=[];for(let j=0;j<values.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples.push(values[Math.floor(seed/2**32*values.length)]!);}drawn.push(percent(samples,percentile));}return [percent(drawn,.025),percent(drawn,.975)];}
const stats=(values:number[])=>({n:values.length,p50:percent(values,.5),p95:percent(values,.95),p50Confidence95:CI(values,.5),p95Confidence95:CI(values,.95,8477)});
const fixture=await mkdtemp(path.join(os.tmpdir(),"qnector-recipe-abba-"));
const report:Record<string,unknown>={
  schemaVersion:1,workload:"inspect_repository_recipe-vs-legacy-standalone",
  baseline:git(baselineRoot,["rev-parse","HEAD"]),candidate:git(sourceRoot,["rev-parse","HEAD"]),
  warmupRounds:5,measuredPerVariant:30,freshServiceRounds:10,
  platform:process.platform,node:process.version,cpus:os.cpus().length,
  hostLatency:"UNKNOWN",
  limitations:"Measures client-side registry+workflow executor only, not ChatGPT model/network/tool-call overhead. Fresh-service resets service, not OS process cold boot. Source fixture identical, no remote GitHub or user modifications."
};
try{
  git(fixture,["init","--quiet"]);
  git(fixture,["config","user.name","Benchmark Fixture"]);
  git(fixture,["config","user.email","benchmark@localhost.invalid"]);
  await writeFile(path.join(fixture,".gitignore"),".qnector/\n.memory-bench/\nactivity-bench.jsonl\n");
  await writeFile(path.join(fixture,"notes.md"),"original repository text\n");
  git(fixture,["add",".gitignore","notes.md"]);
  git(fixture,["commit","--quiet","-m","baseline"]);
  await writeFile(path.join(fixture,"notes.md"),"original repository text\nchanged Thai ภาษาไทย\n");
  const stableExpected={status:git(fixture,["status","--short","--branch"]),diff:git(fixture,["diff"])};
  let counter=0;
  const records:Record<Variant,Array<{usefulMs:number;verifiedMs:number;bytes:number;cpuUs:number;rss:number}>>={baseline:[],candidate:[]};
  const cold:typeof records={baseline:[],candidate:[]};
  async function measure(variant:Variant){
    const config=defaultConfig(fixture);
    const base:ToolContext={
      workspace:new WorkspaceState(config),processManager:new ProcessManager("direct"),
      codeIntelligence:new TypeScriptCodeIntelligence(),
      memory:new MemoryStore(fixture,{rootDirectory:path.join(fixture,".memory-bench"),workspaceMirror:"off"}),
      activity:new ActivityLogger(path.join(fixture,"activity-bench.jsonl")),
      getConfig:()=>config,setConfig:async()=>undefined,
    };
    const registry=variant==="baseline"?new OriginalRegistry():new ToolRegistry();
    const fileWatch=new FileWatchService();
    let ctx:ToolContext=base;
    const workflowManager=new WorkflowManager(base.processManager,fileWatch,{
      executeTool:async (name,input)=>registry.call(name,ctx,input),
    });
    ctx={...base,memoryTaskId:"recipe-abba-task",workflowManager,fileWatch};
    const cpu=process.cpuUsage();
    const begin=performance.now();
    let useful=0;
    let resultBytes=0;
    if(variant==="baseline"){
      for(const action of ["status","diff"] as const){
        const result=await registry.call("git",ctx,{action,cwd:fixture});
        if(!result.ok)throw Error("Legacy git "+action+" failed: "+JSON.stringify(result.error));
        const data=(result.data as {data:{stdout:string,exitCode:number}}).data;
        if(data.stdout.trim()!==stableExpected[action]||data.exitCode!==0)throw Error("Legacy result drift for "+action);
        resultBytes+=Buffer.byteLength(JSON.stringify(result));
        if(action==="status")useful=performance.now()-begin;
      }
    } else{
      const working=await registry.call("memory",ctx,{action:"working_set"});
      if(!working.ok)throw Error("working_set failed");
      const revision=(working.data as {data:{revision:string}}).data.revision;
      const submit=await registry.call("process",ctx,{
        action:"workflow_recipe",recipeName:"inspect_repository",recipeInput:{cwd:fixture},
        revision,idempotencyKey:"abba-"+(++counter),
      });
      if(!submit.ok)throw Error("recipe submit failed "+JSON.stringify(submit.error));
      const runId=(submit.data as {data:{runId:string}}).data.runId;
      const final=await workflowManager.wait(fixture,runId,20_000);
      if(final.run.state!=="succeeded")throw Error("Recipe state "+final.run.state);
      for(const action of ["status","diff"] as const){
        const step=await workflowManager.result(fixture,runId,action) as {tool?:{result:{data?:{data?:{stdout:string;exitCode:number}}}}};
        const data=step.tool?.result.data?.data;
        if(data?.stdout.trim()!==stableExpected[action]||data?.exitCode!==0)throw Error("Workflow output drift for "+action);
        resultBytes+=Buffer.byteLength(JSON.stringify(step));
        if(action==="status"){
          const first=final.run.steps.find(x=>x.id==="status");
          useful=first?.endedAt?new Date(first.endedAt).getTime()-beginEpoch:performance.now()-begin;
        }
      }
      resultBytes+=Buffer.byteLength(JSON.stringify(submit));
    }
    const duration=performance.now()-begin;
    const delta=process.cpuUsage(cpu);
    await workflowManager.shutdown();
    await base.processManager.stopAll();
    return {usefulMs:Math.max(0,Math.min(useful,duration)),verifiedMs:duration,bytes:resultBytes,cpuUs:delta.user+delta.system,rss:process.memoryUsage().rss};
  }
  // Useful is measured by wall time at the first verified status result. Epoch baseline set per run.
  let beginEpoch=0;
  for(let round=0;round<20;round++){
    for(const variant of (round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[]){
      beginEpoch=Date.now();
      const value=await measure(variant);
      if(round>=5)records[variant].push(value);
    }
  }
  for(let round=0;round<10;round++)for(const variant of (round%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[]){
    beginEpoch=Date.now();
    cold[variant].push(await measure(variant));
  }
  const summarize=(input:typeof records)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(variant=>{
    const x=input[variant];
    return [variant,{usefulMs:stats(x.map(y=>y.usefulMs)),verifiedMs:stats(x.map(y=>y.verifiedMs)),
      payloadBytes:stats(x.map(y=>y.bytes)),cpuMicroseconds:stats(x.map(y=>y.cpuUs)),peakRssBytes:Math.max(...x.map(y=>y.rss))}];
  }));
  report.oracleSha256=createHash("sha256").update(JSON.stringify(stableExpected)).digest("hex");
  report.correctness="PASS";report.warm=summarize(records);report.freshService=summarize(cold);
  report.releaseEligible=false;
  console.log(JSON.stringify(report,null,2));
}finally{await rm(fixture,{recursive:true,force:true});}
