import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { PLAN_VIEW_HTML, PLAN_VIEW_URI } from "./plan-view.js";

describe("Qnector ChatGPT Task Controller", () => {
  it("keeps a versioned MCP Apps resource and a self-contained valid script", () => {
    expect(PLAN_VIEW_URI).toMatch(/^ui:\/\/qnector\/plan-act-v\d+\.html$/);
    expect(PLAN_VIEW_HTML).toContain('role="tablist"');
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
  it("uses real MCP calls and a user-triggered revisioned approval instead of a simulated toggle", () => {
    expect(PLAN_VIEW_HTML).toContain("api.callTool(name,call)");
    expect(PLAN_VIEW_HTML).toContain(
      'invoke("mode_approve",{expectedRevision:state.plan.revision})',
    );
    expect(PLAN_VIEW_HTML).toContain('invoke("mode",{action:"back_to_plan"})');
    expect(PLAN_VIEW_HTML).toContain(
      'invoke("inspect",{target:"mode",request:{action:"get"}})',
    );
    expect(PLAN_VIEW_HTML).toContain("api.sendFollowUpMessage");
  });
});
