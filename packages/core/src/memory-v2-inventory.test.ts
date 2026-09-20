import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryV2Store } from "./memory-v2-store.js";

describe("Memory v2 paged read-only inventory", () => {
  it("returns all scopes, exact totals and stable pages without crossing workspaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qnector-inventory-"));
    const store = new MemoryV2Store(path.join(root, "first"), {
      file: path.join(root, "db.sqlite"),
    });
    try {
      const task = store.createTask({ title: "Scoped task" });
      for (let index = 0; index < 121; index++) {
        store.upsertMemory({
          key: `workspace-${index}`,
          category: "fact",
          value: String(index),
          scope: "workspace",
        });
      }
      store.upsertMemory({
        key: "private-task-note",
        category: "note",
        value: "task context",
        taskId: task.id,
      });
      const first = store.listMemoryPage(0, 100);
      const second = store.listMemoryPage(first.nextCursor ?? 0, 100);
      expect(first.total).toBe(122);
      expect(first.items).toHaveLength(100);
      expect(second.items).toHaveLength(22);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
      ).toBe(122);
      expect(
        [...first.items, ...second.items].find(
          (item) => item.key === "private-task-note",
        ),
      ).toMatchObject({
        scope: "task",
        taskId: task.id,
        taskTitle: "Scoped task",
      });
      for (let index = 0; index < 105; index++)
        store.createTask({ title: `extra-${index}` });
      const tasksOne = store.listTaskPage(0, 100);
      const tasksTwo = store.listTaskPage(tasksOne.nextCursor ?? 0, 100);
      expect(tasksOne.total).toBe(
        tasksOne.items.length + tasksTwo.items.length,
      );
      expect(tasksOne.nextCursor).toBe(100);
      expect(tasksTwo.nextCursor).toBeNull();
      expect(
        new Set([...tasksOne.items, ...tasksTwo.items].map((item) => item.id))
          .size,
      ).toBe(tasksOne.total);
      store.setWorkspace(path.join(root, "second"));
      expect(store.listMemoryPage().total).toBe(0);
      expect(
        store.listTaskPage().items.some((item) => item.id === task.id),
      ).toBe(false);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
