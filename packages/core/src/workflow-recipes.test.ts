import { describe, expect, it } from "vitest";
import { compileRecipe } from "./workflow-recipes.js";

const context = { workspaceId: "ws", taskId: "task-1", revision: "rev-1" };

describe("typed workflow recipes", () => {
  it("allows independent read-only repository inspections to run concurrently", () => {
    const recipe = compileRecipe("inspect_repository", { cwd: ".", paths: ["src"], parallel: true }, context);
    expect(recipe.mode).toBe("graph");
    expect(recipe.maxConcurrency).toBe(2);
    expect(recipe.steps.map((step) => step.id)).toEqual(["status", "diff"]);
    expect(recipe.steps.every((step) => step.type === "tool")).toBe(true);
    expect(recipe.steps[1]?.dependsOn).toBeUndefined();
  });

  it("preserves default failure dependency and requires explicit parallel opt-in", () => {
    const legacy = compileRecipe("inspect_repository", { cwd: "." }, context);
    expect(legacy.mode).toBe("sequential");
    expect(legacy.maxConcurrency).toBe(1);
    expect(legacy.steps[1]?.dependsOn).toEqual(["status"]);
    const verify = compileRecipe("verify_changes", { cwd: "." }, context);
    expect(verify.mode).toBe("sequential");
    expect(verify.steps[1]?.dependsOn).toEqual(["status"]);
    expect(verify.steps[2]?.dependsOn).toEqual(["diff"]);
    expect(() => compileRecipe("inspect_repository", { parallel: "yes" }, context))
      .toThrow("parallel must be a boolean");
    expect(() => compileRecipe("verify_changes", { parallel: true }, context))
      .toThrow("RECIPE_INVALID_INPUT");
  });

  it("rejects invalid recipe input before producing any workflow steps", () => {
    expect(() => compileRecipe("inspect_document", { path: "x.pdf", destination: "out.pdf" }, context))
      .toThrow("RECIPE_INVALID_INPUT");
    expect(() => compileRecipe("inspect_document", {}, context)).toThrow("path is required");
  });

  it("requires a task context and compiles document and browser reads without speculative writes", () => {
    expect(() => compileRecipe("inspect_repository", {}, { ...context, revision: "" }))
      .toThrow("RECIPE_CONTEXT_REQUIRED");
    const document = compileRecipe("inspect_document", { path: "report.pdf" }, context);
    const browser = compileRecipe("browser_read_check", { targetId: "tab-1" }, context);
    expect(document.steps.map((step) => step.type)).toEqual(["tool", "tool"]);
    expect(browser.steps).toHaveLength(1);
    expect(JSON.stringify([...document.steps, ...browser.steps])).not.toMatch(/write|delete|commit|publish/i);
  });
});
