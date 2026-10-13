import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  booleanInput, numberInput, objectInput, runWithActivity,
  stringInput, type ToolContext,
} from "./tool-result.js";
import { planScopeForCall } from "./plan-guard.js";

const REQUIRED_SUPERPOWERS = ["using-superpowers","brainstorming","writing-plans"] as const;

/** Use only the three allowlisted user-installed local skills. Never auto-install remote code. */
async function loadPlanSuperpowers(context: ToolContext) {
  if (!context.agentSkills)
    throw new Error("PLAN_SUPERPOWERS_MISSING: Qnector Agent Skills service unavailable.");
  const skills: Array<{name:string;instructions:string;origin:string}> = [];
  for(const name of REQUIRED_SUPERPOWERS){
    let skill: Awaited<ReturnType<NonNullable<ToolContext["agentSkills"]>["get"]>>;
    try{skill=await context.agentSkills.get(name);}catch{
      throw new Error("PLAN_SUPERPOWERS_MISSING: Install obra/superpowers/"+name+" in Qnector Skills before planning.");
    }
    const expected="obra/superpowers/"+name;
    const origin=skill.origin?.id;
    if(origin && origin!==expected)
      throw new Error("PLAN_SUPERPOWERS_MISSING: Wrong skill origin for "+name+"; expected "+expected);
    if(skill.enabled===false || !skill.instructions?.trim())
      throw new Error("PLAN_SUPERPOWERS_MISSING: Skill "+name+" is disabled or empty.");
    skills.push({name,origin:origin??skill.source,instructions:skill.instructions.slice(0,12_000)});
  }
  return{status:"loaded" as const,skills,
    workflow:"ChatGPT: discuss ONE human decision at a time. Record with mode.ask, await reply and mode.resolve. " +
     "When a human delegates a choice, record author=ai-delegated with rationale and alternatives. " +
     "Do not display Plan Panel during discovery. When all decisions are resolved, mode.update, " +
     "mode.finalize with full design and implementation plan, mode.get; only then call plan_panel ONCE " +
     "in the final response. Do not modify the product until an explicit mode_approve for that revision."};
}

/** Plan Mode drives a ChatGPT conversation, not an intermediate checklist. */
export const modeDefinition: ToolDefinition = {
 name:"mode",
 description:"Chat-first Qnector Plan/Act controller. EVERY mode.begin/back_to_plan activates local obra/superpowers using-superpowers, brainstorming and writing-plans. Ask one substantive decision question in normal ChatGPT chat via mode.ask and await reply, record via mode.resolve, repeat until resolved. AI-delegated decisions require user's explicit delegation, rationale and alternatives. No Plan Panel during discovery. When complete, mode.update with full actionable checklist, mode.finalize(design,implementationPlan), mode.get, then plan_panel ONCE as final action. Only separate mode_approve on exact revision enables Act Mode. Keep memoryTaskId across calls; read-only while planning.",
 inputSchema:{type:"object",properties:{
  action:{type:"string",enum:["get","begin","update","ask","resolve","finalize","back_to_plan","step"]},
  title:{type:"string",maxLength:200},summary:{type:"string",maxLength:8000},
  steps:{type:"array",items:{type:"string",maxLength:500},maxItems:60},
  question:{type:"string",maxLength:600},decisionId:{type:"string"},
  answer:{type:"string",maxLength:2000},
  decidedBy:{type:"string",enum:["human","ai-delegated"]},
  rationale:{type:"string",maxLength:2000},
  alternatives:{type:"array",items:{type:"string",maxLength:500},maxItems:10},
  delegationConfirmed:{type:"boolean"},
  design:{type:"string",maxLength:12000},
  implementationPlan:{type:"string",maxLength:16000},
  index:{type:"integer",minimum:0},done:{type:"boolean"},
  expectedRevision:{type:"integer",minimum:1},expectedStepId:{type:"string"},
  expectedApprovedAt:{type:"string"}
 },required:["action"]},
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
};

export async function executeMode(context:ToolContext,input:unknown):Promise<ToolResult>{
 const object=objectInput(input);const action=stringInput(object,"action",true)!;
 return runWithActivity(context,"mode",action,input,async()=>{
  if(!context.planActStore)throw new Error("UNSUPPORTED_CAPABILITY: Plan/Act state store unavailable.");
  const scopeId=planScopeForCall(context,input),workspace=context.getConfig().activeWorkspace;
  const store=context.planActStore;
  if(action==="get"){
   const state=await store.get(scopeId,workspace);
   const superpowers=state.mode==="plan"?await loadPlanSuperpowers(context):undefined;
   return{summary:state.plan?"Task "+state.mode+" Mode, revision "+state.plan.revision:
     "Task defaults to Act Mode (no plan saved)",data:{...state,...(superpowers?{superpowers}:{}),scoped:!!scopeId}};
  }
  if(action==="begin"){
   const steps=object.steps;
   if(!Array.isArray(steps)||!steps.every(x=>typeof x==="string"))
    throw Error("INVALID_PLAN: steps must be an array of strings.");
   const state=await store.begin(scopeId,workspace,
    stringInput(object,"title",true)!,stringInput(object,"summary",true)!,steps as string[]);
   // Make the read-only guard active before loading skill files.
   const superpowers=await loadPlanSuperpowers(context);
   return{summary:"Plan Mode active, revision "+state.plan?.revision+
    ". Local Superpowers loaded; ask ONE substantive question in ChatGPT.",data:{...state,superpowers}};
  }
  if(action==="update"){
   if(object.steps!==undefined&&(!Array.isArray(object.steps)||!object.steps.every(x=>typeof x==="string")))
     throw Error("INVALID_PLAN: steps must be strings.");
   const state=await store.update(scopeId,stringInput(object,"title"),stringInput(object,"summary"),
    object.steps as string[]|undefined);
   return{summary:"Plan updated to revision "+state.plan?.revision+
     ". Approval and finalization reset; continue chat before mode.finalize.",data:state};
  }
  if(action==="ask"){
   const state=await store.ask(scopeId,stringInput(object,"question",true)!);
   return{summary:"Question recorded. Ask it in normal ChatGPT and wait for one user answer.",data:state};
  }
  if(action==="resolve"){
   const raw=object.alternatives;
   if(raw!==undefined&&(!Array.isArray(raw)||!raw.every(x=>typeof x==="string")))
     throw Error("INVALID_PLAN: alternatives must be strings.");
   const source=stringInput(object,"decidedBy",true)!;
   if(source!=="human"&&source!=="ai-delegated")throw Error("PLAN_INVALID_DECIDER: choose human or ai-delegated.");
   const state=await store.resolve(scopeId,stringInput(object,"decisionId",true)!,
    stringInput(object,"answer",true)!,source,stringInput(object,"rationale"),
    raw as string[]|undefined,booleanInput(object,"delegationConfirmed",false));
   return{summary:"Decision recorded. Ask further questions only if important choices remain.",data:state};
  }
  if(action==="finalize"){
   const superpowers=await loadPlanSuperpowers(context);
   const state=await store.finalize(scopeId,stringInput(object,"design",true)!,
    stringInput(object,"implementationPlan",true)!);
   return{summary:"Full design and implementation finalized, revision "+state.plan?.revision+
    ". Verify via mode.get and show plan_panel ONCE in the final response.",data:{...state,superpowers}};
  }
  if(action==="back_to_plan"){
   const state=await store.backToPlan(scopeId,object.expectedRevision===undefined?undefined:
    numberInput(object,"expectedRevision",-1),stringInput(object,"expectedApprovedAt"));
   const superpowers=await loadPlanSuperpowers(context);
   return{summary:"Returned to read-only Plan Mode; previous approval revoked. Start chat Q&A.",
    data:{...state,superpowers}};
  }
  if(action==="step"){
   if(object.index===undefined||object.done===undefined)throw Error("INVALID_INPUT: index and done required.");
   const state=await store.markStep(scopeId,numberInput(object,"index",-1),
    booleanInput(object,"done",false),
    object.expectedRevision===undefined?undefined:numberInput(object,"expectedRevision",-1),
    stringInput(object,"expectedStepId"),stringInput(object,"expectedApprovedAt"));
   return{summary:"Updated plan step "+object.index+".",data:state};
  }
  // Hidden approval path: only separately consent-annotated mode_approve tool calls this.
  if(action==="approve"){
   const state=await store.approve(scopeId,numberInput(object,"expectedRevision",-1));
   return{summary:"Approved plan revision "+state.plan?.revision+". Act Mode enabled.",data:state};
  }
  throw Error("INVALID_ACTION: unknown Plan/Act action "+action);
 });
}
