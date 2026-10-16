import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir,mkdtemp,readFile,rm} from "node:fs/promises";
import {existsSync,readFileSync} from "node:fs";
import {findVerifiedPackage} from "./package-evidence.mjs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
type Variant="baseline"|"candidate";
const root=path.resolve(import.meta.dirname,"..");
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:/Projects/Qnector-PlanMode2");
const rev=(cwd:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8",windowsHide:true}).trim();
const candidatePackage=findVerifiedPackage(rev(root));
if(!candidatePackage)throw Error("CANDIDATE_EXACT_COMMIT_PACKAGE_NOT_VERIFIED: build and verify this HEAD before benchmarking");
const candidateExe=path.join(candidatePackage.packageDirectory,"win-unpacked","Qnector.exe");
if(!existsSync(candidateExe))throw Error("CANDIDATE_PACKAGED_ELECTRON_EXE_MISSING");
const baselineExe=process.env.QNECTOR_BENCH_BASELINE_EXE??"C:/Program Files/Qnector/Qnector.exe";
if(!existsSync(baselineExe))throw Error("BASELINE_ELECTRON_EXE_MISSING");
const baselineManifest=path.join(path.dirname(baselineExe),"resources","build-provenance.json");
if(!existsSync(baselineManifest))throw Error("BASELINE_EXECUTABLE_PROVENANCE_MISSING");
const baselineProvenance=JSON.parse(readFileSync(baselineManifest,"utf8")) as {sourceRevision:string;dirtyTree:boolean};
if(!/^[0-9a-f]{40}$/i.test(baselineProvenance.sourceRevision)||baselineProvenance.dirtyTree!==false)
  throw Error("BASELINE_EXECUTABLE_PROVENANCE_INVALID");
const executables:Record<Variant,string>={baseline:baselineExe,candidate:candidateExe};
const temp=await mkdtemp(path.join(os.tmpdir(),"qnector-isolated-startup-abba-"));
const pct=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]!;
const ci=(a:number[],p:number,seed=9876)=>{const results=[];for(let i=0;i<500;i++){const x=[];for(let j=0;j<a.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;x.push(a[Math.floor(seed/2**32*a.length)]!);}results.push(pct(x,p));}return [pct(results,.025),pct(results,.975)];};
const summary=(a:number[])=>({n:a.length,p50Ms:pct(a,.5),p95Ms:pct(a,.95),p50Confidence95Ms:ci(a,.5),p95Confidence95Ms:ci(a,.95,2019)});
let serial=0;
async function run(variant:Variant){
  const folder=path.join(temp,String(++serial)+"-"+variant);
  await mkdir(path.join(folder,"Roaming"),{recursive:true});
  await mkdir(path.join(folder,"Local"),{recursive:true});
  const marker=path.join(folder,"startup.json");
  const now=performance.now();
  const env={...process.env,
    APPDATA:path.join(folder,"Roaming"),LOCALAPPDATA:path.join(folder,"Local"),
    QNECTOR_STARTUP_PROBE:"1",QNECTOR_ACCEPT_MULTI_INSTANCE:"1",
    QNECTOR_STARTUP_PROBE_FILE:marker,QNECTOR_WORKSPACE:temp,QNECTOR_DURABLE_PREVIEW:"0",
    QNECTOR_START_HIDDEN:"1",
  };
  const child=spawn(executables[variant],[],{cwd:folder,windowsHide:true,env,stdio:"ignore"});
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error("STARTUP_PROBE_TIMEOUT_"+variant));},20_000);
    child.once("error",e=>{clearTimeout(timer);reject(e);});
    child.once("close",(code)=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error("STARTUP_PROBE_EXIT_"+variant+"_"+code));});
  });
  const measuredMs=performance.now()-now;
  const data=JSON.parse(await readFile(marker,"utf8")) as {milestones:Array<{name:string;elapsedMs:number}>;uptimeMs:number};
  const mile=(name:string)=>data.milestones.find(x=>x.name===name)?.elapsedMs;
  const rendered=mile("renderer-ready-to-show");
  const loaded=mile("renderer-loaded");
  const window=mile("window-created");
  // renderer-loaded precedes ready-to-show; both happen after the BrowserWindow exists.
  if(!Number.isFinite(rendered)||!Number.isFinite(loaded)||!Number.isFinite(window)||loaded!<window!||rendered!<loaded!)
    throw Error("STARTUP_MILESTONE_INVALID_"+variant);
  const stages=data.milestones.map(x=>x.name).join("|");
  await rm(folder,{recursive:true,force:true});
  return {wallMs:measuredMs,rendererReadyMs:rendered!,rendererLoadedMs:loaded!,windowCreatedMs:window!,stagesHash:createHash("sha256").update(stages).digest("hex")};
}
const measurements:Record<Variant,Awaited<ReturnType<typeof run>>[]>={baseline:[],candidate:[]};
const extra:typeof measurements={baseline:[],candidate:[]};
try{
  if(process.env.QNECTOR_BENCH_SMOKE_ONLY==="1"){
    const baseline=await run("baseline");
    const candidate=await run("candidate");
    console.log(JSON.stringify({smoke:true,baseline,candidate}));
  }else{
    for(let round=0;round<20;round++)for(const name of (round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[]){
      const sample=await run(name);
      if(round>=5)measurements[name].push(sample);
    }
    for(let round=0;round<10;round++)for(const name of (round%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])
      extra[name].push(await run(name));
    const render=(arr:typeof measurements)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(n=>[n,{
      wall:summary(arr[n].map(x=>x.wallMs)),rendererReady:summary(arr[n].map(x=>x.rendererReadyMs)),
      rendererLoaded:summary(arr[n].map(x=>x.rendererLoadedMs)),
      windowCreated:summary(arr[n].map(x=>x.windowCreatedMs)),
      stageHashes:[...new Set(arr[n].map(x=>x.stagesHash))],
    }]));
    console.log(JSON.stringify({
      schemaVersion:1,workload:"isolated-hidden-packaged-electron-process-startup",
      baselineRevision:baselineProvenance.sourceRevision,baselineRepositoryRevision:rev(baselineRoot),
      baselineRepositoryMatchesExecutable:baselineProvenance.sourceRevision===rev(baselineRoot),
      candidatePackageRevision:candidatePackage.revision,
      candidateCodeHeadAtRun:rev(root),warmupRounds:5,measuredPerVariant:30,
      coldProcessStartsPerVariant:10,realProcessStarts:true,isolatedProfile:true,
      environment:{os:os.platform(),node:process.version,cpuCount:os.cpus().length,freeMemoryBytes:os.freemem()},
      measures:render(measurements),coldStarts:render(extra),correctness:"PASS",
      releaseEligible:false,
      limitations:"Hidden startup probe renders the packaged Electron UI but skips live MCP/tunnel, tray and user workflow. BaselineRevision is read from installed executable provenance, not inferred from baseline source checkout. Isolated APPDATA and LOCALAPPDATA; no update/install. Does not verify production launch/game frame-time/interactive host tool exposure."
    },null,2));
  }
}finally{await rm(temp,{recursive:true,force:true});}
