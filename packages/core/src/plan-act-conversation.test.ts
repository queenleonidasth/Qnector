import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanActStore } from "./plan-act-store.js";
const folders:string[]=[];afterEach(async()=>{for(const dir of folders.splice(0))await rm(dir,{recursive:true,force:true})});
async function setup(){const root=await mkdtemp(path.join(tmpdir(),"qnector-chat-plan-"));folders.push(root);return{store:new PlanActStore(path.join(root,"state.json")),file:path.join(root,"state.json"),workspace:path.join(root,"workspace")}};
const design="A secure storefront with an accessible responsive product catalog, simple checkout and transparent fulfillment policy.";
const plan="Implement schema and catalog, write payment flow tests, build checkout, test user scenarios and document rollback.";
describe("Plan Mode chat-first decision gate",()=>{
 it("requires a real answered question and full design before approval",async()=>{
  const {store,workspace}=await setup();const initial=await store.begin("task:shop",workspace,"Store","Discuss first",["Build","Test"]);
  expect(initial.plan?.phase).toBe("discovery");await expect(store.approve("task:shop",1)).rejects.toThrow("PLAN_NOT_READY");
  await expect(store.finalize("task:shop",design,plan)).rejects.toThrow("PLAN_QUESTIONS_REQUIRED");
  const asked=await store.ask("task:shop","What will you sell?");const decision=asked.plan!.decisions![0]!.id;
  await expect(store.ask("task:shop","Where?")).rejects.toThrow("PLAN_DECISIONS_PENDING");
  await expect(store.finalize("task:shop",design,plan)).rejects.toThrow("PLAN_DECISIONS_PENDING");
  await store.resolve("task:shop",decision,"Books","human");
  const ready=await store.finalize("task:shop",design,plan);expect(ready.plan).toMatchObject({phase:"ready",revision:2,design,implementationPlan:plan});
  expect((await store.approve("task:shop",2)).mode).toBe("act");
 });
 it("AI delegation requires explicit authority, rationale and alternatives",async()=>{
  const {store,workspace}=await setup();await store.begin("task:shop",workspace,"Store","Plan",["Build"]);
  const q=await store.ask("task:shop","Which backend?");const decision=q.plan!.decisions![0]!.id;
  await expect(store.resolve("task:shop",decision,"Fastify","ai-delegated")).rejects.toThrow("PLAN_DELEGATION_REQUIRED");
  await expect(store.resolve("task:shop",decision,"Fastify","ai-delegated","Matches project",[],true)).rejects.toThrow("PLAN_ALTERNATIVES_REQUIRED");
  const chosen=await store.resolve("task:shop",decision,"Fastify","ai-delegated","Uses existing code",["Express"],true);
  expect(chosen.plan?.decisions![0]).toMatchObject({answer:"Fastify",decidedBy:"ai-delegated",rationale:"Uses existing code",alternatives:["Express"]});
 });
 it("persists Q&A across reconnect and revokes readiness on replan",async()=>{
  const {store,workspace,file}=await setup();await store.begin("task:shop",workspace,"Store","Decisions",["Build"]);
  const q=await store.ask("task:shop","Who are buyers?");const id=q.plan!.decisions![0]!.id;
  const loaded=new PlanActStore(file);expect((await loaded.get("task:shop",workspace)).plan?.decisions?.[0]?.answer).toBeNull();
  await loaded.resolve("task:shop",id,"Thai readers","human");
  await loaded.finalize("task:shop",design,plan);await loaded.approve("task:shop",2);
  const again=await loaded.backToPlan("task:shop",2);
  expect(again.plan?.phase).toBe("discovery");expect(again.plan?.approvedRevision).toBeNull();
  await expect(loaded.finalize("task:shop",design,plan)).rejects.toThrow("PLAN_QUESTIONS_REQUIRED");
  const next=await loaded.ask("task:shop","What changed?");await loaded.resolve("task:shop",next.plan!.decisions!.at(-1)!.id,"Added marketplace","human");
  expect((await loaded.finalize("task:shop",design,plan)).plan?.revision).toBe(3);
 });
 it("keeps legacy approved plans compatible",async()=>{
  const {store,file,workspace}=await setup();await store.begin("task:legacy",workspace,"Legacy","Summary",["Existing"]);
  const raw=JSON.parse(await readFile(file,"utf8"));const old=raw.states[0];
  delete old.plan.phase;delete old.plan.decisions;delete old.plan.design;delete old.plan.implementationPlan;
  old.mode="act";old.plan.approvedRevision=1;old.plan.approvedAt="2026-10-11T10:00:00.000Z";
  await writeFile(file,JSON.stringify(raw));const restored=new PlanActStore(file);
  expect((await restored.get("task:legacy",workspace)).mode).toBe("act");
  expect((await restored.markStep("task:legacy",0,true)).plan?.steps?.[0]?.done).toBe(true);
 });
});