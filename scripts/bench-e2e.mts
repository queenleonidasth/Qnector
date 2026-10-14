import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PerformanceMonitor } from "../packages/core/src/performance-monitor.js";

export const BENCH_INPUT = Object.freeze({
  manifest: "fixtures/performance/manifest.json",
  fixtureId: "metadata-stage-overhead-v1",
  workload: "fixed deterministic payload hashing, with stage telemetry off/on",
  warmups: 5,
  measured: 30,
  clientObservedMs: null as number | null,
  unknownGap: "ChatGPT host orchestration, network/provider latency and client-observed completion are not captured by this local harness.",
});

export function scheduleAbba<T>(baseline: T, candidate: T): T[] {
  return [baseline, candidate, candidate, baseline];
}

export async function runBenchmark() {
  const packageInfo=JSON.parse(await readFile("package.json","utf8")) as {version?:string};
  const bytes = Buffer.from("Qnector fixed fixture • ภาษาไทย • ".repeat(256), "utf8");
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  const monitor = new PerformanceMonitor();
  const runId = randomUUID();
  const variants = {
    baseline: () => createHash("sha256").update(bytes).digest("hex"),
    candidate: (traceId: string) => {
      const started = performance.now();
      const hash = createHash("sha256").update(bytes).digest("hex");
      // This monitor is harness-local. Samples measure real in-memory stage
      // recording cost without touching the process-wide production monitor.
      monitor.recordStage({traceId, action:"files", stage:"execute", durationMs:performance.now()-started, bytes:bytes.length});
      return hash;
    },
  };
  const timing: Record<string, number[]> = {baseline:[],candidate:[]};
  let index = 0;
  for (let round=0; round<BENCH_INPUT.warmups+BENCH_INPUT.measured; round++) {
    for (const name of scheduleAbba<"baseline"|"candidate">("baseline","candidate")) {
      const started=performance.now();
      const hash = name === "baseline" ? variants.baseline() : variants.candidate(`${runId}-${index++}`);
      const elapsed=performance.now()-started;
      if (hash !== expectedHash) throw new Error(`CORRECTNESS_HASH_MISMATCH:${name}`);
      if (round >= BENCH_INPUT.warmups && timing[name]!.length < BENCH_INPUT.measured) timing[name]!.push(elapsed);
    }
  }
  return {
    schemaVersion:1, runId, fixtureId:BENCH_INPUT.fixtureId,
    inputManifest:BENCH_INPUT, correctness:{expectedSha256:expectedHash, passed:true},
    environment:{os:os.platform(),release:os.release(),arch:os.arch(),runtime:process.version,nodeExecutable:process.execPath,commit:gitValue(["rev-parse","HEAD"]),lockfile:"pnpm-lock.yaml",lockfileSha256:createHash("sha256").update(await readFile("pnpm-lock.yaml")).digest("hex"),worktreeState:gitValue(["status","--porcelain"]) ? "dirty" : "clean",packageBuild:packageInfo.version??"unknown",resourceProfile:{cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),freeMemoryBytes:os.freemem()}},
    variants:Object.fromEntries(Object.entries(timing).map(([name,values])=>[name,{samples:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),medianConfidence95Ms:bootstrapMedianInterval(values,1000,name),valuesMs:values.map(v=>Number(v.toFixed(4)))}])),
    interpretation:"This fixture compares local hash work with telemetry disabled/enabled. It is not a Qnector end-to-end or client-host performance comparison; no speedup claim is made.",
  };
}

function gitValue(args:string[]):string {
  try{return execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();}
  catch{return "unknown";}
}

function percentile(values:number[],p:number):number {
  const sorted=[...values].sort((a,b)=>a-b);
  return Number((sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??0).toFixed(4));
}

function bootstrapMedianInterval(values:number[],iterations:number,seedText:string):[number,number] {
  let seed=createHash("sha256").update(seedText).digest().readUInt32LE(0)||1;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x1_0000_0000;};
  const medians:number[]=[];
  for(let i=0;i<iterations;i++) {
    const sample=Array.from({length:values.length},()=>values[Math.floor(random()*values.length)]!);
    medians.push(percentile(sample,.5));
  }
  return [percentile(medians,.025),percentile(medians,.975)];
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await runBenchmark();
  const target=process.argv[2];
  const output=JSON.stringify(report,null,2)+"\n";
  if(target) await writeFile(target,output,"utf8"); else process.stdout.write(output);
}
