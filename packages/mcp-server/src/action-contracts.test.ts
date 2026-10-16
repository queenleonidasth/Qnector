import { describe, expect, it } from "vitest";
import { diagnoseActionCompatibility, getActionContract } from "../../tools/src/action-contracts.js";
import { isReadOnlyAction } from "../../tools/src/tool-effects.js";
import { toolDefinitions } from "../../tools/src/index.js";

describe("finite action contracts without legacy planning tools", () => {
  it("does not advertise removed planning actions and detects stale host snapshots", () => {
    expect(getActionContract("files", "invented")).toBeNull();
    for (const tool of ["mode", "mode_approve", "plan_panel", "inspect"])
      expect(getActionContract(tool, "get")).toBeNull();
    expect(diagnoseActionCompatibility([{tool:"files",action:"read_many"}], [
      {name:"files",inputSchema:{properties:{action:{enum:["read"]}}}},
    ])).toEqual([{tool:"files",action:"read_many",reason:"action_missing"}]);
    expect(diagnoseActionCompatibility([{tool:"mode",action:"get"}], []))
      .toEqual([{tool:"mode",action:"get",reason:"unknown_action"}]);
  });
  it("distinguishes_glob_from_pattern_and_missing_implementation_fields", () => {
    expect(getActionContract("workspace","glob")?.requiredInputs).toContain("pattern");
    expect(getActionContract("workspace","grep")?.requiredInputs).toContain("pattern");
    expect(getActionContract("files","read")?.requiredInputs).toContain("path");
  });
  it("classifies mutations and nested dispatch as writes without changing host permissions", () => {
    expect(getActionContract("files","write")?.effect).toBe("write");
    expect(isReadOnlyAction("files",{action:"write",path:"x",content:"x"})).toBe(false);
    expect(isReadOnlyAction("system",{action:"mcp_call",server:"x",toolName:"files"})).toBe(false);
    expect(getActionContract("process","workflow_start")?.effect).toBe("write");
    expect(getActionContract("tasks","start")?.effect).toBe("write");
    expect(getActionContract("tasks","list")?.effect).toBe("read");
  });
  it("matches the conservative action classifier for every grouped tool action", () => {
    for (const definition of toolDefinitions) {
      const actions=(definition.inputSchema.properties as {action?:{enum?:string[]}}).action?.enum ?? [];
      for (const action of actions) {
        const contract=getActionContract(definition.name,action)!;
        expect(contract.effect==="read").toBe(isReadOnlyAction(definition.name,{action}));
        expect("planAllowed" in contract).toBe(false);
      }
    }
  });
});
