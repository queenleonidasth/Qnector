import { describe, expect, it } from "vitest";
import {
  filterMemories,
  pendingTasks,
  presentMemories,
  visibleCount,
} from "./memory-center-model.js";
import type { MemoryFact, MemoryTask } from "@qnector/shared";

const fact = (id: string): MemoryFact => ({
  id,
  key: `กฎ ${id}`,
  value: "Keep data",
  category: "rule",
  tags: [],
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
});
const task = (id: string, status: MemoryTask["status"]): MemoryTask => ({
  id,
  workspaceId: "w",
  title: id,
  status,
  currentTask: "",
  completedSteps: [],
  pendingSteps: [],
  criticalContext: "",
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
  sessionCount: 0,
  touchedPaths: [],
});

describe("Memory Center data fidelity", () => {
  it("preserves both sources instead of silently merging identical migration text", () => {
    const records = presentMemories(
      [fact("v2")],
      [{ ...fact("legacy"), key: "กฎ v2" }],
    );
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.source)).toEqual([
      "Memory v2",
      "Legacy",
    ]);
  });
  it("filters Thai text and values without deleting loaded records", () => {
    const records = presentMemories([fact("one"), fact("two")], []);
    expect(filterMemories(records, "กฎ TWO")).toHaveLength(1);
    expect(records).toHaveLength(2);
  });
  it("keeps 60+ memories and 12+ tasks accessible through incremental display", () => {
    const records = presentMemories(
      Array.from({ length: 63 }, (_, i) => fact(String(i))),
      [],
    );
    const tasks = Array.from({ length: 13 }, (_, i) =>
      task(String(i), "active"),
    );
    expect(records).toHaveLength(63);
    expect(pendingTasks(tasks)).toHaveLength(13);
    expect(visibleCount(records.length, 12)).toBe(12);
    expect(visibleCount(records.length, 72)).toBe(63);
  });
  it("does not treat completed or idle tasks as active work", () => {
    expect(
      pendingTasks([
        task("a", "completed"),
        task("b", "idle"),
        task("c", "blocked"),
      ]).map((item) => item.id),
    ).toEqual(["c"]);
  });
});
