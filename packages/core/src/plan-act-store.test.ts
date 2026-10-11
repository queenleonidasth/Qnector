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

  it("preserves completed steps by stable identity through Plan edits, reordering, and insertion", async () => {
    const { file, workspace } = await fixture();
    const store = new PlanActStore(file);
    const initial = await store.begin(
      "task:progress", workspace, "Plan", "Original details", ["Analyze", "Implement", "Validate"],
    );
    const originalIds = initial.plan!.steps.map((entry) => entry.id);
    await store.approve("task:progress", 1);
    await store.markStep("task:progress", 0, true);
    await store.markStep("task:progress", 2, true);
    await store.backToPlan("task:progress");
    const summaryOnly = await store.update("task:progress", undefined, "More details");
    expect(summaryOnly.plan?.revision).toBe(2);
    expect(summaryOnly.mode).toBe("plan");
    expect(summaryOnly.plan?.approvedRevision).toBeNull();
    expect(summaryOnly.plan?.steps.map((entry) => entry.done)).toEqual([true, false, true]);
    expect(summaryOnly.plan?.steps.map((entry) => entry.id)).toEqual(originalIds);

    const edited = await store.update(
      "task:progress", undefined, undefined, ["Validate", "New step", "Implement", "Analyze"],
    );
    expect(edited.plan?.revision).toBe(3);
    expect(edited.plan?.steps.map((entry) => entry.done)).toEqual([true, false, false, true]);
    expect(edited.plan?.steps.map((entry) => entry.id)).toEqual([
      originalIds[2], expect.any(String), originalIds[1], originalIds[0],
    ]);
    expect(edited.plan?.steps[1]?.id).not.toBe(originalIds[0]);
    expect(edited.plan?.steps[1]?.id).not.toBe(originalIds[1]);
    await store.approve("task:progress", 3);
    const reopened = new PlanActStore(file);
    expect((await reopened.get("task:progress", workspace)).plan?.steps.map((entry) => entry.done))
      .toEqual([true, false, false, true]);
  });

  it("rejects stale panel writes and stale revocation without changing current mode or checklist", async () => {
    const { file, workspace } = await fixture();
    const store = new PlanActStore(file);
    await store.begin("task:safe", workspace, "Safe approval", "Do not replay stale UI writes", ["Inspect", "Execute"]);
    const first = await store.approve("task:safe", 1);
    const firstAt = first.plan!.approvedAt!;
    const firstStepId = first.plan!.steps[0]!.id;

    await expect(store.backToPlan("task:safe", 77, firstAt))
      .rejects.toThrow("PLAN_REVISION_MISMATCH");
    await expect(store.backToPlan("task:safe", 1, "old-approval"))
      .rejects.toThrow("PLAN_APPROVAL_MISMATCH");
    expect((await store.get("task:safe", workspace)).mode).toBe("act");

    await expect(store.markStep("task:safe", 0, true, 2, firstStepId, firstAt))
      .rejects.toThrow("PLAN_REVISION_MISMATCH");
    await expect(store.markStep("task:safe", 0, true, 1, "outdated-step", firstAt))
      .rejects.toThrow("PLAN_STEP_MISMATCH");
    await expect(store.markStep("task:safe", 0, true, 1, firstStepId, "old-approval"))
      .rejects.toThrow("PLAN_APPROVAL_MISMATCH");
    expect((await store.get("task:safe", workspace)).plan?.steps[0]?.done).toBe(false);

    const updated = await store.markStep("task:safe", 0, true, 1, firstStepId, firstAt);
    expect(updated.plan?.steps[0]?.done).toBe(true);
    await store.backToPlan("task:safe", 1, firstAt);
    const revision2 = await store.update("task:safe", undefined, "New revision", ["Inspect", "Execute"]);
    expect(revision2.plan?.revision).toBe(2);
    const reapproved = await store.approve("task:safe", 2);
    expect(reapproved.plan?.approvedRevision).toBe(2);
    await expect(store.backToPlan("task:safe", 1, firstAt)).rejects.toThrow("PLAN_REVISION_MISMATCH");
    await expect(store.markStep("task:safe", 0, true, 1, firstStepId, firstAt))
      .rejects.toThrow("PLAN_REVISION_MISMATCH");
    expect((await store.get("task:safe", workspace)).mode).toBe("act");
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
