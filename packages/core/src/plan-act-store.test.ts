import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanActStore } from "./plan-act-store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qnector-plan-act-"));
  roots.push(root);
  return { root, file: path.join(root, "plan-act.json"), workspace: path.join(root, "project") };
}

describe("PlanActStore", () => {
  it("preserves legacy Act behavior until a task begins planning", async () => {
    const { file, workspace } = await fixture();
    const store = new PlanActStore(file);
    expect((await store.get("task:old", workspace)).mode).toBe("act");
    expect(await store.hasActivePlan(workspace)).toBe(false);
    const plan = await store.begin("task:one", workspace, "Feature", "Design first", ["Analyze", "Implement", "Test"]);
    expect(plan.mode).toBe("plan");
    expect(plan.plan?.revision).toBe(1);
    expect(await store.hasActivePlan(workspace)).toBe(true);
    expect((await store.get("task:two", workspace)).mode).toBe("act");
  });

  it("requires exact approval, tracks steps and revokes approval on revision", async () => {
    const { file, workspace } = await fixture();
    const store = new PlanActStore(file);
    await store.begin("task:one", workspace, "Feature", "Build safe mode", ["Write code", "Test"]);
    await expect(store.approve("task:one", 99)).rejects.toThrow("PLAN_REVISION_MISMATCH");
    const approved = await store.approve("task:one", 1);
    expect(approved.mode).toBe("act");
    expect(approved.plan?.approvedRevision).toBe(1);
    expect((await store.markStep("task:one", 0, true)).plan?.steps[0]?.done).toBe(true);
    const back = await store.backToPlan("task:one");
    expect(back.mode).toBe("plan");
    expect(back.plan?.approvedRevision).toBeNull();
    await expect(store.markStep("task:one", 1, true)).rejects.toThrow("PLAN_NOT_APPROVED");
    const revised = await store.update("task:one", undefined, "New design", ["Write code", "Review"]);
    expect(revised.plan?.revision).toBe(2);
    await expect(store.approve("task:one", 1)).rejects.toThrow("PLAN_REVISION_MISMATCH");
    expect((await store.approve("task:one", 2)).mode).toBe("act");
    const recovered = new PlanActStore(file);
    expect((await recovered.get("task:one", workspace)).plan?.steps[0]?.text).toBe("Write code");
  });

  it("serializes updates for independent tasks without losing persisted state", async () => {
    const { file, workspace } = await fixture();
    const store = new PlanActStore(file);
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.begin(
      "task:" + i, workspace, "Task " + i, "Summary", ["Step"],
    )));
    const recovered = new PlanActStore(file);
    for (let i = 0; i < 8; i++)
      expect((await recovered.get("task:" + i, workspace)).plan?.title).toBe("Task " + i);
  });

  it("fails closed on corrupt saved plans", async () => {
    const { file, workspace } = await fixture();
    await writeFile(file, "{broken", "utf8");
    const store = new PlanActStore(file);
    await expect(store.get("task:x", workspace)).rejects.toThrow("PLAN_STATE_CORRUPTED");
  });

  it("rejects missing scope and malformed plans", async () => {
    const { file, workspace } = await fixture();
    const store = new PlanActStore(file);
    await expect(store.begin(undefined, workspace, "Test", "Summary", ["One"]))
      .rejects.toThrow("PLAN_SCOPE_REQUIRED");
    await expect(store.begin("task:one", workspace, "Test", "Summary", []))
      .rejects.toThrow("INVALID_PLAN");
  });
});
