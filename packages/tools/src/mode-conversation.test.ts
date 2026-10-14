import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {ActivityLogger} from "../../core/src/activity-log.js";
import {PlanActStore} from "../../core/src/plan-act-store.js";
import type {ToolContext} from "./tool-result.js";
import {executeMode,modeDefinition} from "./mode-tool.js";
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true})});
const skillNames=["using-superpowers","brainstorming","writing-plans"];
const design="A secure and accessible online store with product catalog, verified checkout, payment strategy and shipping requirements.";
const implementationPlan="Write failing integration tests, implement the storefront, test mobile and checkout flows, verify security and prepare rollback.";
async function fixture(missing?:string){
 const root=await mkdtemp(path.join(tmpdir(),"qnector-mode-tool-"));roots.push(root);const store=new PlanActStore(path.join(root,"state.json"));const calls:string[]=[];
 const context={planActStore:store,agentSkills:{get:async(name:string)=>{calls.push(name);if(name===missing)throw Error("SKILL_NOT_FOUND");return{name,enabled:true,source:"test",instructions:"# "+name+"\nAsk before building."}}},
  activity:new ActivityLogger(path.join(root,"activity.jsonl")),getConfig:()=>({activeWorkspace:root})} as unknown as ToolContext;
 const invoke=(action:string,more:Record<string,unknown>={})=>executeMode(context,{action,memoryTaskId:"test-task",...more});
 return{root,store,calls,invoke};
}
describe("Chat-first Plan Mode MCP tool",()=>{
 it("loads 3 local Superpowers documents on every start, resume and back-to-plan",async()=>{
  const {invoke,calls}=await fixture();const begin=await invoke("begin",{title:"Shop",summary:"Discuss first",steps:["Code","Test"]});
  expect(begin.ok).toBe(true);expect(calls).toEqual(skillNames);
  const data=begin.data as {data:{mode:string;superpowers:{skills:Array<{name:string;instructions:string}>}}};
  expect(data.data.mode).toBe("plan");expect(data.data.superpowers.skills.map(s=>s.name)).toEqual(skillNames);
  expect(data.data.superpowers.skills[1]?.instructions).toContain("Ask before building.");
  const inspected=await invoke("get");expect(calls).toEqual([...skillNames,...skillNames]);
  const compact=(inspected.data as {data:{superpowers:{skills:Array<{name:string;instructions?:string}>}}}).data.superpowers;
  expect(compact.skills).toHaveLength(3);
  expect(compact.skills.every(s=>s.instructions===undefined)).toBe(true);
  expect(JSON.stringify(compact).length).toBeLessThan(1300);
  const q=await invoke("ask",{question:"What product?"});const did=(q.data as {data:{plan:{decisions:Array<{id:string}>}}}).data.plan.decisions[0]!.id;
  await invoke("resolve",{decisionId:did,answer:"Books",decidedBy:"human"});
  await invoke("finalize",{design,implementationPlan});await invoke("approve",{expectedRevision:2});
  const back=await invoke("back_to_plan",{expectedRevision:2});expect(back.ok).toBe(true);expect(calls.slice(-3)).toEqual(skillNames);
 });
 it("missing required skill blocks finalize and keeps read-only Plan Mode active",async()=>{
  const {root,store,invoke}=await fixture("brainstorming");
  const begin=await invoke("begin",{title:"Store",summary:"Discuss",steps:["Code"]});
  expect(begin.ok).toBe(false);expect(begin.error?.code).toBe("PLAN_SUPERPOWERS_MISSING");
  expect((await store.get("task:test-task",root)).mode).toBe("plan");
  const q=await store.ask("task:test-task","What will you sell?");
  await store.resolve("task:test-task",q.plan!.decisions![0]!.id,"Books","human");
  const final=await invoke("finalize",{design,implementationPlan});expect(final.error?.code).toBe("PLAN_SUPERPOWERS_MISSING");
 });
 it("exposes ask/resolve/finalize including AI delegation provenance",async()=>{
  const actions=(modeDefinition.inputSchema as {properties:{action:{enum:string[]}}}).properties.action.enum;
  expect(actions).toEqual(expect.arrayContaining(["ask","resolve","finalize"]));
  const {invoke}=await fixture();await invoke("begin",{title:"Store",summary:"Discuss",steps:["Code"]});
  const q=await invoke("ask",{question:"Which backend?"});const did=(q.data as {data:{plan:{decisions:Array<{id:string}>}}}).data.plan.decisions[0]!.id;
  const no=await invoke("resolve",{decisionId:did,answer:"Fastify",decidedBy:"ai-delegated"});expect(no.error?.code).toBe("PLAN_DELEGATION_REQUIRED");
  const yes=await invoke("resolve",{decisionId:did,answer:"Fastify",decidedBy:"ai-delegated",delegationConfirmed:true,rationale:"Reuses current framework",alternatives:["Express"]});expect(yes.ok).toBe(true);
  const final=await invoke("finalize",{design,implementationPlan});expect((final.data as {data:{plan:{phase:string;revision:number}}}).data.plan).toMatchObject({phase:"ready",revision:2});
 });
});