import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanActStore } from "../../core/src/plan-act-store.js";
import { ToolRegistry } from "./index.js";
import { checkPlanActGuard, isPlanSafeAction } from "./plan-guard.js";
import type { ToolContext } from "./tool-result.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function contextForTest() {
  const root = await mkdtemp(path.join(tmpdir(), "qnector-plan-guard-"));
  roots.push(root);
  const store = new PlanActStore(path.join(root, "plan-act.json"));
  const taskId = "task_11111111-1111-4111-8111-111111111111";
  const context = {
    planActStore: store,
    memoryTaskId: taskId,
    getConfig: () => ({ activeWorkspace: root }),
  } as unknown as ToolContext;
  return { context, store, root, taskId };
}

describe("Plan/Act MCP dispatch guard", () => {
  it("keeps individual read actions while denying file, process, browser and Git mutations", async () => {
    const { context, store, root, taskId } = await contextForTest();
    await store.begin("task:" + taskId, root, "Plan", "No changes until approval", ["Read code", "Implement"]);
    const read = [
      ["files", { action: "read", path: "a.ts" }],
      ["workspace", { action: "grep", pattern: "foo" }],
      ["process", { action: "output" }],
      ["git", { action: "branch" }],
      ["browser", { action: "dom_snapshot" }],
      ["computer", { action: "inspect" }],
      ["memory", { action: "task_start" }],
      ["tasks", { action: "get" }],
    ] as const;
    for (const [name, input] of read)
      expect((await checkPlanActGuard(context, name, input)).allowed, name + "." + input.action).toBe(true);
    const dangerous = [
      ["files", { action: "write", path: "a.ts", content: "change" }],
      ["files", { action: "apply_patch", patch: "test" }],
      ["process", { action: "run", command: "echo bypass" }],
      ["process", { action: "workflow_start", workflowName: "write" }],
      ["process", { action: "pty_write", text: "secret" }],
      ["git", { action: "branch", name: "oops", create: true }],
      ["git", { action: "push" }],
      ["system", { action: "mcp_call", server: "remote", toolName: "write" }],
      ["browser", { action: "evaluate", expression: "document.write('x')" }],
      ["browser", { action: "navigate", url: "https://example.com" }],
      ["computer", { action: "invoke" }],
      ["workspace", { action: "set", path: root }],
      ["memory", { action: "clear" }],
      ["tasks", { action: "start" }],
    ] as const;
    for (const [name, input] of dangerous) {
      const result = await checkPlanActGuard(context, name, input);
      expect(result.code, name + "." + input.action).toBe("PLAN_MODE_READ_ONLY");
      expect(result.allowed).toBe(false);
    }
    const registry = new ToolRegistry();
    const blocked = await registry.call("files", context, {action: "write", path: "a.ts", content: "not written"});
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("PLAN_MODE_READ_ONLY");
    expect(isPlanSafeAction("git", {action:"branch", delete:true})).toBe(false);
  });

  it("does not let missing task scope silently bypass an active Plan Mode", async () => {
    const { context, root, store, taskId } = await contextForTest();
    await store.begin("task:" + taskId, root, "Plan", "summary", ["one"]);
    delete context.memoryTaskId;
    const blocked = await checkPlanActGuard(context, "files", { action: "delete", path: root });
    expect(blocked.code).toBe("PLAN_SCOPE_REQUIRED");
    expect((await checkPlanActGuard(context, "files", { action: "read", path: root })).allowed).toBe(true);
  });

  it("permits work in an approved Act task but not an unrelated Plan task", async () => {
    const { context, root, store, taskId } = await contextForTest();
    await store.begin("task:" + taskId, root, "Plan", "summary", ["one"]);
    await store.begin("task:other", root, "Plan", "summary", ["one"]);
    await store.approve("task:" + taskId, 1);
    expect((await checkPlanActGuard(context, "process", { action:"run", command:"echo safe" })).allowed).toBe(true);
    expect((await checkPlanActGuard(context, "process", {
      action:"run", command:"echo blocked", memoryTaskId:"other",
    })).code).toBe("PLAN_MODE_READ_ONLY");
  });
});
