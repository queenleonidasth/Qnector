import { toolDefinitions } from "./index.js";
import { isReadOnlyAction } from "./tool-effects.js";
import type { ToolDefinition } from "@qnector/shared";

export interface ActionContract {
  tool: string; action: string; requiredInputs: string[];
  effect: "read" | "write";
  inputProperties: Record<string, unknown>;
  outputSchema: { type: "object"; required: ["ok", "tool", "action"] };
  examples: Array<Record<string, unknown>>;
}

const definitions = (): Map<string, ToolDefinition> => new Map(toolDefinitions.map(definition => [definition.name, definition]));
const auxiliary: Record<string, {actions:string[];properties:Record<string,unknown>;required:string[]}> = {
  "system.timeout_probe":{actions:["probe"],properties:{durationSec:{type:"number"},mode:{type:"string"}},required:["durationSec"]},
  tasks:{actions:["start","get","list","wait","output","result","cancel","inspect","doctor","overview","lookup"],properties:{action:{type:"string"},taskId:{type:"string"},idempotencyKey:{type:"string"},command:{type:"object"}},required:["action"]},
};
const actionValues = (tool: string): string[] => {
  if (auxiliary[tool]) return auxiliary[tool]!.actions;
  const schema = definitions().get(tool)?.inputSchema ?? {};
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const values = properties?.action?.enum;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
};

/** Finite, schema-backed contract. Unknown pairs stay unknown and are never guessed read-only. */
export function getActionContract(tool: string, action: string): ActionContract | null {
  const definition = definitions().get(tool);
  const aux = auxiliary[tool];
  if ((!definition && !aux) || !actionValues(tool).includes(action)) return null;
  if (!definition) {
     const read = tool === "system.timeout_probe" || (tool === "tasks" && ["get","list","wait","output","result","inspect","doctor","overview","lookup"].includes(action));
    return {tool,action,requiredInputs:aux!.required,effect:read?"read":"write",
      inputProperties:aux!.properties,outputSchema:{type:"object",required:["ok","tool","action"]},examples:[{action}]};
  }
  const schemaRequired = Array.isArray(definition.inputSchema.required)
    ? definition.inputSchema.required.filter((field): field is string => typeof field === "string") : [];
  const properties = definition.inputSchema.properties as Record<string, unknown> | undefined;
  const requiredInputs = [...new Set([...schemaRequired, ...(actionRequiredInputs[tool]?.[action] ?? [])])];
  const probe = {action};
  const pureRead = isReadOnlyAction(tool, probe);
  return {
    tool, action, requiredInputs, effect: pureRead ? "read" : "write",
    inputProperties: properties ?? {},
    outputSchema: {type:"object", required:["ok","tool","action"]},
    examples: [{action, ...(requiredExampleValues[tool]?.[action] ?? {})}],
  };
}

export function diagnoseActionCompatibility(
  requested: Array<{tool:string;action:string}>, hostTools: Array<{name:string;inputSchema?:unknown}>,
): Array<{tool:string;action:string;reason:"tool_missing"|"action_missing"|"unknown_action"}> {
  const host = new Map(hostTools.map(item => [item.name, item.inputSchema]));
  const missing: Array<{tool:string;action:string;reason:"tool_missing"|"action_missing"|"unknown_action"}> = [];
  for (const item of requested) {
    if (!definitions().has(item.tool) && !auxiliary[item.tool]) { missing.push({...item, reason:"unknown_action"}); continue; }
    if (!host.has(item.tool)) { missing.push({...item, reason:"tool_missing"}); continue; }
    const schema = host.get(item.tool) as {properties?:{action?:{enum?:unknown[]}}} | undefined;
    const actions = schema?.properties?.action?.enum;
    if (!Array.isArray(actions) || !actions.includes(item.action)) missing.push({...item, reason:"action_missing"});
  }
  return missing;
}

const actionRequiredInputs: Record<string, Record<string, string[]>> = {
  files: {read:["path"],read_many:["paths"],preview:["path"],inspect:["path"],extract_text:["path"],render:["path"],document_query:["path","sql"],write:["path","content"],append:["path","content"],replace:["path","oldText","newText"],multi_edit:["edits"],apply_patch:["patch"],mkdir:["path"],move:["path","destination"],copy:["path","destination"],delete:["path"],hash:["path"]},
  workspace: {set:["path"],grep:["pattern"],glob:["pattern"],wait_for_file:["path"],wait_for_change:["path"]},
  process: {run:["command"],start:["command"],task_start:["command"],workflow_start:["workflowName"],output:["processId"],task_get:["taskId"],task_cancel:["taskId"]},
  git: {commit:["message"],branch:["name"]},
};
const requiredExampleValues: Record<string, Record<string, Record<string, unknown>>> = {
  workspace: {glob:{pattern:"src/**/*.ts"},grep:{pattern:"TODO"}},
  files: {read:{path:"README.md"},write:{path:"notes.txt",content:"…"}},
};
