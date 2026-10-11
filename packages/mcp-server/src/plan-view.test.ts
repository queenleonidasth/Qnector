import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { PLAN_VIEW_HTML, PLAN_VIEW_URI } from "./plan-view.js";

describe("Qnector ChatGPT Task Controller", () => {
  it("keeps a versioned MCP Apps resource and a self-contained valid script", () => {
    expect(PLAN_VIEW_URI).toBe("ui://qnector/plan-act-v4.html");
    expect(PLAN_VIEW_HTML).toContain('role="group"');
    expect(PLAN_VIEW_HTML).toContain('aria-pressed="true"');
    expect(PLAN_VIEW_HTML).toContain('id="planTab"');
    expect(PLAN_VIEW_HTML).toContain('id="actTab"');
    expect(PLAN_VIEW_HTML).toContain('id="steps"');
    expect(PLAN_VIEW_HTML).toContain('aria-live="polite"');
    expect(PLAN_VIEW_HTML).not.toMatch(/<script[^>]+src=/i);
    const source = /<script>([\s\S]*?)<\/script>/.exec(PLAN_VIEW_HTML)?.[1];
    expect(source).toBeTruthy();
    expect(
      () => new Script(source, { filename: "qnector-plan-panel.js" }),
    ).not.toThrow();
  });
  it("defaults to a compact review with accessible progressive disclosure", () => {
    expect(PLAN_VIEW_HTML).toContain('id="summaryToggle"');
    expect(PLAN_VIEW_HTML).toContain('id="stepsToggle"');
    expect(PLAN_VIEW_HTML).toContain('id="taskProgress"');
    expect(PLAN_VIEW_HTML).toContain('aria-label="ความคืบหน้าของแผน"');
    expect(PLAN_VIEW_HTML).toContain("var summaryLimit=280");
    expect(PLAN_VIEW_HTML).toContain("var visibleLimit=3");
    expect(PLAN_VIEW_HTML).toContain("pending.slice(0,visibleLimit)");
    expect(PLAN_VIEW_HTML).toContain('id="approve"');
    expect(PLAN_VIEW_HTML).toContain('id="revokeConfirmation"');
    expect(PLAN_VIEW_HTML).toContain('id="cancelBackToPlan"');
    expect(PLAN_VIEW_HTML).toContain('id="confirmBackToPlan"');
    expect(PLAN_VIEW_HTML).toContain("expectedRevision:state.plan.revision");
    expect(PLAN_VIEW_HTML).toContain("api.setWidgetState");
    expect(PLAN_VIEW_HTML).toContain("prefers-reduced-motion:reduce");
    expect(PLAN_VIEW_HTML).not.toContain(".innerHTML=");
  });

  it("uses real MCP calls and a user-triggered revisioned approval instead of a simulated toggle", () => {
    expect(PLAN_VIEW_HTML).toContain("api.callTool(name,call)");
    expect(PLAN_VIEW_HTML).toContain(
      'invoke("mode_approve",{expectedRevision:state.plan.revision})',
    );
    expect(PLAN_VIEW_HTML).toContain('action:"back_to_plan",expectedRevision:state.plan.revision');
    expect(PLAN_VIEW_HTML).toContain("expectedStepId:step.id");
    expect(PLAN_VIEW_HTML).toContain("expectedApprovedAt:plan.approvedAt");
    expect(PLAN_VIEW_HTML).toContain(
      'invoke("inspect",{target:"mode",request:{action:"get"}})',
    );
    expect(PLAN_VIEW_HTML).toContain("api.sendFollowUpMessage");
    expect(PLAN_VIEW_HTML).toContain('$("actTab").addEventListener("click",function(){');
    expect(PLAN_VIEW_HTML).toContain('$("approve").addEventListener("click",approve)');
    expect(PLAN_VIEW_HTML).not.toContain('$("actTab").addEventListener("click",approve)');
    expect(PLAN_VIEW_HTML).not.toContain('$("planTab").addEventListener("click",back)');
    expect(PLAN_VIEW_HTML).toContain('$("backToPlan").addEventListener("click",requestBack)');
    expect(PLAN_VIEW_HTML).toContain('$("confirmBackToPlan").addEventListener("click",confirmBack)');
  });
});
