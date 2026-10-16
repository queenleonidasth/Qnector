import type { WorkflowDefinition, WorkflowStep } from "./workflow-manager.js";
import type { TaskContextRef } from "./context-revision.js";

export type RecipeName =
  | "inspect_repository"
  | "verify_changes"
  | "inspect_document"
  | "browser_read_check";

const RECIPE_NAMES = new Set<RecipeName>([
  "inspect_repository", "verify_changes", "inspect_document", "browser_read_check",
]);

export function compileRecipe(
  name: RecipeName,
  input: Record<string, unknown>,
  context: TaskContextRef,
): WorkflowDefinition {
  if (!RECIPE_NAMES.has(name)) throw new Error("RECIPE_UNKNOWN");
  if (!context.workspaceId.trim() || !context.taskId.trim() || !context.revision.trim())
    throw new Error("RECIPE_CONTEXT_REQUIRED");
  const now = new Date().toISOString();
  const steps = recipeSteps(name, input);
  return {
    version: 1,
    name: `recipe-${name}`,
    description: `Read-only ${name} recipe; task ${context.taskId}, revision ${context.revision}`,
    mode: name === "inspect_repository" && input.parallel === true ? "graph" : "sequential",
    maxConcurrency: name === "inspect_repository" && input.parallel === true ? 2 : 1,
    steps,
    createdAt: now,
    updatedAt: now,
  };
}

function recipeSteps(name: RecipeName, input: Record<string, unknown>): WorkflowStep[] {
  if (name === "inspect_repository" || name === "verify_changes") {
    onlyKeys(input, name === "inspect_repository" ? ["cwd", "paths", "parallel"] : ["cwd", "paths"]);
    if (input.parallel !== undefined && typeof input.parallel !== "boolean")
      throw new Error("RECIPE_INVALID_INPUT: parallel must be a boolean");
    const cwd = optionalString(input.cwd, "cwd");
    const paths = optionalStringList(input.paths, "paths");
    const common = { ...(cwd ? { cwd } : {}) };
    const steps: WorkflowStep[] = [
      { id: "status", type: "tool", tool: "git", input: { action: "status", ...common } },
      { id: "diff", type: "tool", tool: "git", input: { action: "diff", ...common, ...(paths ? { paths } : {}) }, dependsOn: input.parallel === true ? undefined : ["status"] },
    ];
    if (name === "verify_changes")
      steps.push({ id: "diagnostics", type: "tool", tool: "workspace", input: { action: "diagnostics", ...(cwd ? { path: cwd } : {}) }, dependsOn: ["diff"] });
    return steps;
  }
  if (name === "inspect_document") {
    onlyKeys(input, ["path"]);
    const path = requiredString(input.path, "path");
    return [
      { id: "inspect", type: "tool", tool: "files", input: { action: "inspect", path } },
      { id: "extract", type: "tool", tool: "files", input: { action: "extract_text", path }, dependsOn: ["inspect"], resourcePaths: [path] },
    ];
  }
  onlyKeys(input, ["targetId", "selector"]);
  return [{
    id: "read", type: "tool", tool: "browser",
    input: { action: "get_text", targetId: requiredString(input.targetId, "targetId"), selector: optionalString(input.selector, "selector") ?? "body" },
    resourcePaths: [`key:browser-target:${requiredString(input.targetId, "targetId")}`],
  }];
}

function onlyKeys(input: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`RECIPE_INVALID_INPUT: unsupported field ${extra[0]}`);
}
function requiredString(value: unknown, field: string): string {
  const result = optionalString(value, field);
  if (!result) throw new Error(`RECIPE_INVALID_INPUT: ${field} is required`);
  return result;
}
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`RECIPE_INVALID_INPUT: ${field} must be a non-empty string`);
  return value.trim();
}
function optionalStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim()))
    throw new Error(`RECIPE_INVALID_INPUT: ${field} must be an array of non-empty strings`);
  return value.map((entry: string) => entry.trim());
}
