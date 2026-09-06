import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryV2Store } from "./memory-v2-store.js";

let roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "qnector-memory-v2-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const file = path.join(root, "memory-v2.sqlite");
  return { root, workspace, file };
}

describe("MemoryV2Store", () => {
  it("isolates concurrent task streams inside the same workspace", async () => {
    const { workspace, file } = await fixture();
    const store = new MemoryV2Store(workspace, { file });
    const model = store.createTask({
      title: "Build 3D model",
      currentTask: "Convert Peridot to VRM",
    });
    const ui = store.createTask({
      title: "Desktop UI",
      currentTask: "Improve maid controls",
    });

    store.recordToolEvent({
      taskId: model.id,
      source: "files",
      action: "write",
      status: "success",
      summary: "Updated avatar runtime",
      paths: [path.join(workspace, "app", "avatar.ts")],
    });
    store.recordToolEvent({
      taskId: ui.id,
      source: "files",
      action: "write",
      status: "success",
      summary: "Updated control panel",
      paths: [path.join(workspace, "app", "controls.ts")],
    });

    const modelSnapshot = store.snapshot({ taskId: model.id });
    expect(modelSnapshot.events).toHaveLength(1);
    expect(modelSnapshot.events[0]?.taskId).toBe(model.id);
    expect(store.getTask(model.id)?.currentTask).toBe("Convert Peridot to VRM");
    expect(store.getTask(ui.id)?.currentTask).toBe("Improve maid controls");
    store.close();
  });

  it("detects active task file conflicts and ignores foreign workspace events", async () => {
    const { root, workspace, file } = await fixture();
    const store = new MemoryV2Store(workspace, { file });
    const a = store.createTask({ title: "Rig body" });
    const b = store.createTask({ title: "Animate body" });
    const shared = path.join(workspace, "model", "body.ts");

    expect(
      store.recordToolEvent({
        taskId: a.id,
        source: "files",
        action: "write",
        status: "success",
        summary: "Rig edit",
        paths: [shared],
      }),
    ).not.toBeNull();
    expect(
      store.recordToolEvent({
        taskId: b.id,
        source: "files",
        action: "write",
        status: "success",
        summary: "Animation edit",
        paths: [shared],
      }),
    ).not.toBeNull();
    expect(
      store.recordToolEvent({
        taskId: b.id,
        source: "files",
        action: "write",
        status: "success",
        summary: "Foreign helper",
        paths: [path.join(root, "outside", "helper.ps1")],
      }),
    ).toBeNull();

    const snapshot = store.snapshot();
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0]?.taskIds).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
    expect(
      snapshot.events.some((event) => event.summary === "Foreign helper"),
    ).toBe(false);
    store.close();
  });

  it("uses workspace-specific default tasks and persists session bindings", async () => {
    const { root, file } = await fixture();
    const first = new MemoryV2Store(path.join(root, "one"), { file });
    const firstDefault = first.defaultTaskId;
    const task = first.createTask({ title: "First task" });
    first.bindSession("chat-session-a", task.id);
    expect(first.taskForSession("chat-session-a")).toBe(task.id);

    first.setWorkspace(path.join(root, "two"));
    const secondDefault = first.defaultTaskId;
    expect(secondDefault).not.toBe(firstDefault);
    expect(first.getTask(secondDefault)).not.toBeNull();
    expect(first.taskForSession("chat-session-a")).toBeNull();
    first.close();
  });

  it("migrates legacy workspace state once without duplicating events", async () => {
    const { workspace, file } = await fixture();
    const store = new MemoryV2Store(workspace, { file });
    const legacy = {
      active: {
        currentTask: "Finish Live2D prototype",
        completedSteps: ["Imported model"],
        pendingSteps: ["Test motion"],
        criticalContext: "Keep current character identity",
      },
      facts: [
        {
          id: "fact_old",
          key: "render mode",
          category: "decision" as const,
          value: "desktop overlay",
          tags: ["ui"],
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      recentChanges: [
        {
          timestamp: "2026-09-01T00:00:00.000Z",
          source: "files",
          summary: "Updated app/main.cjs",
          paths: [path.join(workspace, "app", "main.cjs")],
        },
      ],
    };

    store.migrateLegacy(legacy);
    store.migrateLegacy(legacy);
    const snapshot = store.snapshot();
    expect(store.getTask(store.defaultTaskId)?.currentTask).toBe(
      "Finish Live2D prototype",
    );
    expect(snapshot.memories.some((fact) => fact.key === "render mode")).toBe(
      true,
    );
    expect(
      snapshot.events.filter((event) => event.action === "legacy.change"),
    ).toHaveLength(1);
    store.close();
  });

  it("emits live revisions for task and event changes", async () => {
    const { workspace, file } = await fixture();
    const store = new MemoryV2Store(workspace, { file });
    const events: string[] = [];
    const off = store.subscribe((event) =>
      events.push(`${event.revision}:${event.type}`),
    );
    const task = store.createTask({ title: "Live memory" });
    store.recordToolEvent({
      taskId: task.id,
      source: "process",
      action: "run",
      status: "success",
      summary: "Tests passed",
      workspaceEvidence: [workspace],
    });
    off();
    expect(events).toEqual([
      "1:task.created",
      "2:event.recorded",
      "3:checkpoint.created",
    ]);
    store.close();
  });
});
