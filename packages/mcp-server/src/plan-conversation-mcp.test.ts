import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {AddressInfo} from "node:net";
import {afterEach,describe,expect,it} from "vitest";
import {ActivityLogger} from "../../core/src/activity-log.js";
import {AgentSkillService} from "../../core/src/agent-skills.js";
import {defaultConfig} from "../../core/src/config.js";
import {QnectorRuntime} from "./server.js";
import {PLAN_VIEW_URI} from "./plan-view.js";
let runtime:QnectorRuntime|undefined;let root:string|undefined;
afterEach(async()=>{await runtime?.stop();runtime=undefined;if(root)await rm(root,{recursive:true,force:true});root=undefined});
async function rpc(port:number,method:string,params:Record<string,unknown>={}) {
 const res=await fetch("http://127.0.0.1:"+port+"/mcp",{method:"POST",headers:{"content-type":"application/json",accept:"application/json,text/event-stream"},
  body:JSON.stringify({jsonrpc:"2.0",id:100,method,params})});
 const body=await res.text(),data=body.split(/\r?\n/).find(l=>l.startsWith("data:"));
 return (data?JSON.parse(data.slice(5).trim()):JSON.parse(body)) as {result?:{structuredContent?:{ok:boolean;error?:{code:string};data?:{data?:Record<string,unknown>}};tools?:Array<{name:string}>}};
}
async function call(port:number,name:string,args:Record<string,unknown>){return (await rpc(port,"tools/call",{name,arguments:args})).result?.structuredContent;}
async function setup(withSkills=true){
 root=await mkdtemp(path.join(tmpdir(),"qnector-mcp-chat-plan-"));
 const skills=path.join(root,"skills");await mkdir(skills);
 if(withSkills)for(const name of ["using-superpowers","brainstorming","writing-plans"]){
  const dir=path.join(skills,name);await mkdir(dir);
  await writeFile(path.join(dir,"SKILL.md"),"---\nname: "+name+"\ndescription: Test local Superpowers "+name+"\n---\n# "+name+"\nDiscuss options with the human before building.");
 }
 runtime=new QnectorRuntime({config:{...defaultConfig(root),localPort:0},configFile:path.join(root,"config.json"),
  logger:new ActivityLogger(path.join(root,"activity.jsonl")),
  agentSkills:new AgentSkillService({roots:[{path:skills,source:"test"}]})});
 await runtime.start({port:0});return{port:(runtime.app.server.address() as AddressInfo).port,task:"plan-mcp-test"};
}
const design="A secure, accessible webshop with products, checkout, clear pricing and shipping details for target customers.";
const implementationPlan="Implement catalog and checkout with tests first, verify order/payment lifecycle, run security audit and document rollback.";
describe("ChatGPT Q&A and final panel MCP boundary",()=>{
 it("loads Superpowers and refuses panel/approval until decisions and full plan complete",async()=>{
  const {port,task}=await setup();const input={memoryTaskId:task};
  const begin=await call(port,"mode",{...input,action:"begin",title:"Store",summary:"Discuss first",steps:["Build","Test"]});
  expect(begin?.ok).toBe(true);expect(begin?.data?.data?.superpowers).toMatchObject({status:"loaded"});
  const early=await call(port,"plan_panel",input);expect(early?.error?.code).toBe("PLAN_DISCOVERY_IN_PROGRESS");
  const denied=await call(port,"mode_approve",{...input,expectedRevision:1});expect(denied?.error?.code).toBe("PLAN_NOT_READY");
  const q=await call(port,"mode",{...input,action:"ask",question:"What products?"});expect(q?.ok).toBe(true);
  const did=((q?.data?.data?.plan as {decisions:Array<{id:string}>}).decisions)[0]!.id;
  expect((await call(port,"mode",{...input,action:"resolve",decisionId:did,answer:"Books",decidedBy:"human"}))?.ok).toBe(true);
  const revised=await call(port,"mode",{...input,action:"update",summary:"Catalog, checkout, shipping",
    steps:["Build storefront","Test checkout","Security review"]});
  expect((revised?.data?.data?.plan as {revision:number}).revision).toBe(2);
  const ready=await call(port,"mode",{...input,action:"finalize",design,implementationPlan});
  expect(ready?.ok).toBe(true);expect((ready?.data?.data?.plan as {phase:string;revision:number})).toMatchObject({phase:"ready",revision:3});
  const panel=await call(port,"plan_panel",input);expect(panel?.ok).toBe(true);
  expect((panel?.data?.data?.plan as {design:string}).design).toBe(design);
  const approved=await call(port,"mode_approve",{...input,expectedRevision:3});
  expect(approved?.ok).toBe(true);expect(approved?.data?.data?.mode).toBe("act");
  const resource=await rpc(port,"resources/read",{uri:PLAN_VIEW_URI});expect(resource.result).toBeDefined();
 });
 it("missing Superpowers prevents use and Plan remains read-only",async()=>{
  const {port,task}=await setup(false),input={memoryTaskId:task};
  const begin=await call(port,"mode",{...input,action:"begin",title:"Store",summary:"Discuss",steps:["Build"]});
  expect(begin?.error?.code).toBe("PLAN_SUPERPOWERS_MISSING");
  const denied=await call(port,"files",{...input,action:"write",path:"unsafe.txt",content:"no"});
  expect(denied?.error?.code).toBe("PLAN_MODE_READ_ONLY");
  const panel=await call(port,"plan_panel",input);expect(panel?.error?.code).toBe("PLAN_SUPERPOWERS_MISSING");
 });
});