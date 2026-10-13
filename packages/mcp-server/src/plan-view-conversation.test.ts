import {Script} from "node:vm";
import {describe,expect,it} from "vitest";
import {PLAN_VIEW_HTML,PLAN_VIEW_URI} from "./plan-view.js";
describe("Plan panel is final approval only",()=>{
 it("has an uncached v5 resource and safe design/decision review",()=>{
  expect(PLAN_VIEW_URI).toBe("ui://qnector/plan-act-v5.html");
  for(const id of ["decisionLog","designDocument","implementationDocument"])expect(PLAN_VIEW_HTML).toContain('id="'+id+'"');
  expect(PLAN_VIEW_HTML).toContain("ai-delegated");
  expect(PLAN_VIEW_HTML).toContain("rationale");
  expect(PLAN_VIEW_HTML).not.toContain(".innerHTML=");
  const code=/<script>([\s\S]*?)<\/script>/.exec(PLAN_VIEW_HTML)?.[1];
  expect(code).toBeTruthy();expect(()=>new Script(code,{filename:"qnector-plan-v5.js"})).not.toThrow();
 });
 it("requires ready and a successful explicit approval before chat continuation",()=>{
  expect(PLAN_VIEW_HTML).toContain('plan.phase==="ready"');
  expect(PLAN_VIEW_HTML).toContain('busy||!taskId||!ready');
  expect(PLAN_VIEW_HTML).toContain('invoke("mode_approve",{expectedRevision:state.plan.revision})');
  expect(PLAN_VIEW_HTML).toContain('api.sendFollowUpMessage');
  expect(PLAN_VIEW_HTML).toContain("PLAN_APPROVED_CONTINUE");
  expect(PLAN_VIEW_HTML).toContain("followedUpRevision");
 });
});