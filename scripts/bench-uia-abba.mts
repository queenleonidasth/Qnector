import {readFileSync,existsSync} from "node:fs";
import {findVerifiedPackage} from "./package-evidence.mjs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
import {WindowsUiAutomationService} from "../packages/core/src/ui-automation.js";
type Variant="baseline"|"candidate";
const root=path.resolve(import.meta.dirname,"..");
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:\\Projects\\Qnector-PlanMode2");
const {WindowsUiAutomationService:LegacyService}=await import(pathToFileURL(path.join(baselineRoot,"packages/core/src/ui-automation.ts")).href) as {WindowsUiAutomationService:typeof WindowsUiAutomationService};
const baseHelper="C:\\Program Files\\Qnector\\resources\\uia-helper\\qnector-uia.exe";
const candidatePackage=findVerifiedPackage(execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8",windowsHide:true}).trim());
if(!candidatePackage)throw Error("CANDIDATE_EXACT_COMMIT_PACKAGE_NOT_VERIFIED");
const candidateHelper=path.join(candidatePackage.packageDirectory,"win-unpacked","resources","uia-helper","qnector-uia.exe");
if(!existsSync(candidateHelper))throw Error("CANDIDATE_UIA_HELPER_MISSING");
const baselineProvenance=JSON.parse(readFileSync("C:/Program Files/Qnector/resources/build-provenance.json","utf8")) as {sourceRevision:string;dirtyTree:boolean};
if(!/^[a-f0-9]{40}$/i.test(baselineProvenance.sourceRevision)||baselineProvenance.dirtyTree)throw Error("BASELINE_PROVENANCE_INVALID");
const git=(cwd:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8",windowsHide:true}).trim();
const helpers:{baseline:WindowsUiAutomationService;candidate:WindowsUiAutomationService}={
  baseline:new LegacyService({helperPath:baseHelper}),
  candidate:new WindowsUiAutomationService({helperPath:candidateHelper}),
};
const pct=(v:number[],p:number)=>[...v].sort((a,b)=>a-b)[Math.max(0,Math.ceil(v.length*p)-1)]!;
const bootstrap=(v:number[],p:number,seed=2012)=>{
  const b=[];for(let i=0;i<500;i++){const x=[];for(let j=0;j<v.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;x.push(v[Math.floor(seed/2**32*v.length)]!);}b.push(pct(x,p));}return [pct(b,.025),pct(b,.975)];
};
const metric=(v:number[])=>({n:v.length,p50:pct(v,.5),p95:pct(v,.95),p50Confidence95:bootstrap(v,.5),p95Confidence95:bootstrap(v,.95,9898)});
const samples:Record<Variant,Array<{ms:number;cpuUs:number;bytes:number;rss:number}>>={baseline:[],candidate:[]};
const cold:typeof samples={baseline:[],candidate:[]};
let expectedPid:number|undefined;
let canonicalHash:string|undefined;
async function measure(variant:Variant,useCold=false){
  const service=useCold?new (variant==="baseline"?LegacyService:WindowsUiAutomationService)({helperPath:variant==="baseline"?baseHelper:candidateHelper}):helpers[variant];
  const cpu=process.cpuUsage(),start=performance.now();
  try{
    const windows=await service.windows(50);
    const elapsed=performance.now()-start;
    const selected=windows.find(x=>x.name==="Qnector");
    if(!selected || !Number.isInteger(selected.processId))throw Error("QNECTOR_UIA_WINDOW_NOT_FOUND");
    if(expectedPid===undefined)expectedPid=selected.processId;
    if(expectedPid!==selected.processId)throw Error("QNECTOR_UIA_WINDOW_PID_CHANGED_DURING_TEST");
    // Only use stable identity attributes, never session-scoped element/window IDs.
    const identity={name:selected.name,processId:selected.processId,className:selected.className,controlType:selected.controlType};
    const digest=createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    if(canonicalHash===undefined)canonicalHash=digest;
    if(digest!==canonicalHash)throw Error("UIA_WINDOW_IDENTITY_DRIFT");
    const delta=process.cpuUsage(cpu);
    return {ms:elapsed,cpuUs:delta.user+delta.system,bytes:Buffer.byteLength(JSON.stringify(windows)),rss:process.memoryUsage().rss};
  }finally{if(useCold)await service.close();}
}
const summarize=(v:typeof samples)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(n=>[n,{
  elapsedMs:metric(v[n].map(x=>x.ms)),cpuMicroseconds:metric(v[n].map(x=>x.cpuUs)),
  responseBytes:metric(v[n].map(x=>x.bytes)),peakRssBytes:Math.max(...v[n].map(x=>x.rss))
}]));
try{
  for(let round=0;round<20;round++)for(const variant of (round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[]){
    const result=await measure(variant);
    if(round>=5)samples[variant].push(result);
  }
  for(let round=0;round<10;round++)for(const variant of (round%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])
    cold[variant].push(await measure(variant,true));
  console.log(JSON.stringify({
    schemaVersion:1,workload:"real-uia-native-helper-list-windows",
    baselineCodeRevision:git(baselineRoot),candidateCodeRevision:git(root),
    candidatePackagedHelperRevision:candidatePackage.revision,baselinePackagedHelperRevision:baselineProvenance.sourceRevision,
    baselineHelper:baseHelper,candidateHelper,
    countWindowsQuery:50,warmupRounds:5,measuredPerVariant:30,coldHelperProcessPerVariant:10,
    identitySha256:canonicalHash,identityProcessId:expectedPid,correctness:"PASS",
    warm:summarize(samples),coldHelper:summarize(cold),releaseEligible:false,
    limitations:"Actual UIA native helper against running installed QNECTOR window, read-only and no interaction. Candidate helper from exact-commit package, source from current branch. Does not verify candidate Electron GUI controls, ChatGPT host or true cold Windows reboot."
  },null,2));
}finally{
  await Promise.allSettled([helpers.baseline.close(),helpers.candidate.close()]);
}
