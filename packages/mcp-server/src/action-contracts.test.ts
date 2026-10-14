import { describe, expect, it } from "vitest";
import { diagnoseActionCompatibility, getActionContract } from "../../tools/src/action-contracts.js";
import { isPureReadAction, isPlanSafeAction } from "../../tools/src/plan-guard.js";
import { toolDefinitions } from "../../tools/src/index.js";

describe("finite action contracts", () => {
  it("rejects_unknown_actions_and_reports_stale_host_snapshots", () => {
    expect(getActionContract("files", "invented")).toBeNull();
    expect(diagnoseActionCompatibility([{tool:"mode",action:"ask"}], [
      {name:"mode",inputSchema:{properties:{action:{enum:["get","begin"]}}}},
    ])).toEqual([{tool:"mode",action:"ask",reason:"action_missing"}]);
  });
  it("distinguishes_glob_from_pattern_and_missing_implementation_fields", () => {
    expect(getActionContract("workspace","glob")?.requiredInputs).toContain("pattern");
    expect(getActionContract("workspace","grep")?.requiredInputs).toContain("pattern");
    expect(getActionContract("files","read")?.requiredInputs).toContain("path");
  });
  it("does_not_treat_mutation_or_nested_dispatch_as_read_only", () => {
    expect(getActionContract("files","write")?.effect).toBe("write");
    expect(isPureReadAction("files",{action:"write",path:"x",content:"x"})).toBe(false);
    expect(isPureReadAction("system",{action:"mcp_call",server:"x",toolName:"files",toolArgs:{action:"write"}})).toBe(false);
    expect(getActionContract("process","workflow_start")?.effect).toBe("write");
    expect(getActionContract("mode_approve","approve")?.effect).toBe("write");
  });
  it("matches_the_dispatch_guard_for_every_existing_action", () => {
    for (const definition of toolDefinitions) {
      const actions=(definition.inputSchema.properties as {action?:{enum?:string[]}}).action?.enum ?? [];
      for (const action of actions) {
        const contract=getActionContract(definition.name,action)!;
        expect(contract.planAllowed).toBe(isPlanSafeAction(definition.name,{action}));
        expect(contract.effect==="read").toBe(isPureReadAction(definition.name,{action}));
      }
    }
  });
});
