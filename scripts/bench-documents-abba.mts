import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import * as XLSXImport from "xlsx";
import { PDFDocument } from "pdf-lib";
import { DocumentIntelligenceService } from "../packages/core/src/document-intelligence.js";
import { clearDocumentSessions } from "../packages/core/src/document-session.js";

const XLSX = (XLSXImport as typeof XLSXImport & { default?: typeof XLSXImport }).default ?? XLSXImport;
type Variant = "baseline"|"candidate";
const root=path.resolve(import.meta.dirname,"..");
const baselineRoot=path.resolve(process.env.QNECTOR_BENCH_BASELINE??"D:\\Projects\\Qnector-PlanMode2");
const git=(cwd:string)=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8",windowsHide:true}).trim();
const {DocumentIntelligenceService:BaseService}=await import(
  pathToFileURL(path.join(baselineRoot,"packages/core/src/document-intelligence.ts")).href
) as {DocumentIntelligenceService:typeof DocumentIntelligenceService};
const candidates:{baseline:DocumentIntelligenceService;candidate:DocumentIntelligenceService}={
  baseline:new BaseService(),candidate:new DocumentIntelligenceService(),
};
const hash=(obj:unknown)=>createHash("sha256").update(JSON.stringify(obj)).digest("hex");
const pct=(arr:number[],q:number)=>[...arr].sort((a,b)=>a-b)[Math.max(0,Math.ceil(q*arr.length)-1)]!;
const bootstrap=(arr:number[],q:number,seed:number)=>{
  const vals=[] as number[];
  for(let i=0;i<1000;i++){
    const take=[] as number[];
    for(let j=0;j<arr.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;take.push(arr[Math.floor(seed/2**32*arr.length)]!);}
    vals.push(pct(take,q));
  }
  return [pct(vals,.025),pct(vals,.975)];
};
const summary=(arr:number[])=>({
  count:arr.length,p50Ms:pct(arr,.5),p95Ms:pct(arr,.95),
  p50Confidence95Ms:bootstrap(arr,.5,12345),p95Confidence95Ms:bootstrap(arr,.95,67890),
});
const fixtures=await mkdtemp(path.join(os.tmpdir(),"qnector-document-abba-"));
try{
  const pdf=await PDFDocument.create();
  for(let i=0;i<3;i++)pdf.addPage([612,792]);
  await writeFile(path.join(fixtures,"3page.pdf"),await pdf.save());
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
    ["ชื่อสินค้า","ยอดขาย"],["สมุด",100],["ปากกา",200],
  ]),"Thai");
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["label","value"],["other",7]]),"English");
  await writeFile(path.join(fixtures,"book.xlsx"),Buffer.from(XLSX.write(book,{type:"buffer",bookType:"xlsx"})));
  const docx=new AdmZip();
  docx.addFile("word/document.xml",Buffer.from(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ภาษาไทย report</w:t></w:r></w:p></w:body></w:document>'));
  await writeFile(path.join(fixtures,"doc.docx"),docx.toBuffer());
  const zip=new AdmZip();
  for(let i=0;i<30;i++)zip.addFile("รายงาน/"+String(i).padStart(3,"0")+".txt",Buffer.from("archive "+i));
  await writeFile(path.join(fixtures,"archive.zip"),zip.toBuffer());
  const report:Record<string,unknown>={
    schemaVersion:1,workload:"document-parser-extraction",
    baseline:{revision:git(baselineRoot)},candidate:{revision:git(root)},
    hostObserved:"UNKNOWN",trueColdProcessStarts:"UNKNOWN",warmupRounds:5,
    measuredRunsPerVariant:30,coldSessionRunsPerVariant:10,
    environment:{platform:process.platform,node:process.version,cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem()},
    limitations:"Actual original/candidate document source modules, same fixture bytes. Cold session clears candidate document result cache; NOT a cold process boot. No installed host/model/network/GUI; scanned empty PDF is not OCR.",
  };
  const cases=[] as unknown[];
  for(const [scenario,name,opts] of [
    ["pdf-scanned-three-pages","3page.pdf",{}],
    ["xlsx-thai","book.xlsx",{sheet:"Thai"}],
    ["docx-thai","doc.docx",{}],
    ["zip-thai","archive.zip",{}],
  ] as const){
    clearDocumentSessions();
    const input={path:path.join(fixtures,name),...opts};
    const records:Record<Variant,Array<{ms:number;cpuUs:number;rss:number;bytes:number}>>={baseline:[],candidate:[]};
    const cold:typeof records={baseline:[],candidate:[]};
    let expected:string|undefined;
    async function execute(variant:Variant,fresh=false){
      if(fresh)clearDocumentSessions();
      const service=fresh?new (variant==="baseline"?BaseService:DocumentIntelligenceService)():candidates[variant];
      const cpu=process.cpuUsage();
      const start=performance.now();
      const result=await service.extractText(input);
      const ms=performance.now()-start;
      const delta=process.cpuUsage(cpu);
      const observation=hash({kind:result.kind,text:result.text,chars:result.chars,truncated:result.truncated,metadata:result.metadata});
      if(expected===undefined)expected=observation;
      if(expected!==observation)throw new Error("DOCUMENT_OUTPUT_MISMATCH "+scenario+" "+variant+" expected "+expected+" actual "+observation);
      return {ms,cpuUs:delta.user+delta.system,rss:process.memoryUsage().rss,bytes:Buffer.byteLength(JSON.stringify(result))};
    }
    for(let round=0;round<20;round++){
      const order=(round%2===0?["baseline","candidate","candidate","baseline"]:["candidate","baseline","baseline","candidate"]) as Variant[];
      for(const variant of order){
        const v=await execute(variant);
        if(round>=5)records[variant].push(v);
      }
    }
    for(let round=0;round<10;round++){
      for(const variant of (round%2===0?["baseline","candidate"]:["candidate","baseline"]) as Variant[])
        cold[variant].push(await execute(variant,true));
    }
    const reduce=(data:typeof records)=>Object.fromEntries((["baseline","candidate"] as Variant[]).map(k=>[k,{
      elapsed:summary(data[k].map(v=>v.ms)),
      cpuMicroseconds:summary(data[k].map(v=>v.cpuUs)),
      maxRssBytes:Math.max(...data[k].map(v=>v.rss)),
      outputBytes:[...new Set(data[k].map(v=>v.bytes))],
    }]));
    cases.push({scenario,correctness:"PASS",outputSha256:expected,warm:reduce(records),coldSession:reduce(cold)});
  }
  report.cases=cases;
  report.releaseEligible=false;
  console.log(JSON.stringify(report,null,2));
}finally{
  clearDocumentSessions();
  await rm(fixtures,{recursive:true,force:true});
}
