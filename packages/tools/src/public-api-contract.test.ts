import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toolDefinitions } from "./index.js";

const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/performance/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  baselineCommit:string; tools:Array<{name:string;actions:string[];required:string[];properties:string[];permissionHints:unknown;legacyCallShape:string}>;
  hostAliases:Array<{name:string;actions:string[];required:string[];permissionHints:unknown}>;
};

describe("baseline public API golden manifest", () => {
  it("preserves_all_public_actions", () => {
    expect(manifest.baselineCommit).toBe("e809591d9cceca0140c9cc66fdcf7b4dc62be0f6");
    expect(toolDefinitions.map(t => t.name).sort()).toEqual(manifest.tools.map(t=>t.name).sort());
    for (const definition of toolDefinitions) {
      const golden = manifest.tools.find(item=>item.name===definition.name)!;
      expect((definition.inputSchema.properties as any)?.action?.enum ?? [], definition.name).toEqual(golden.actions);
      expect(definition.inputSchema.required ?? [], definition.name).toEqual(golden.required);
      expect(Object.keys((definition.inputSchema.properties as object) ?? {}).sort(), definition.name).toEqual([...golden.properties].sort());
      expect(definition.annotations, definition.name).toEqual(golden.permissionHints);
      expect(golden.legacyCallShape).toBe("{action,...action-specific fields}");
    }
    expect(manifest.hostAliases.map(item=>item.name).sort()).toEqual(["inspect","mode_approve","plan_panel","system.timeout_probe","tasks"].sort());
    expect(manifest.hostAliases.find(item=>item.name==="mode_approve")?.required).toContain("expectedRevision");
    expect(manifest.hostAliases.find(item=>item.name==="inspect")?.permissionHints).toMatchObject({readOnlyHint:true,destructiveHint:false});
  });
});
