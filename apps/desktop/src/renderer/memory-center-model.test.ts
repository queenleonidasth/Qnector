import { describe, expect, it } from "vitest";
import {
  currentSavedTask,
  filterMemories,
  latestSavedActivityTask,
  latestLinkedSessionTask,
  pendingTasks,
  presentMemories,
  recentSavedLog,
  visibleCount,
} from "./memory-center-model.js";
import type { MemoryFact, MemoryTask, MemoryV2Event } from "@qnector/shared";

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

const event = (id: string, timestamp: string): MemoryV2Event => ({
  id,
  workspaceId: "w",
  taskId: "t",
  timestamp,
  source: "git",
  action: "status",
  status: "success",
  summary: `Checked ${id}`,
  paths: [],
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
    expect(
      currentSavedTask([task("a", "completed"), task("b", "idle")]),
    ).toBeUndefined();
  });
  it("labels a topic as a saved session only if a task was explicitly linked", () => {
    expect(
      latestLinkedSessionTask([task("unlinked", "active")]),
    ).toBeUndefined();
    const older = {
      ...task("older", "idle"),
      sessionCount: 1,
      updatedAt: "2026-09-19T00:00:00Z",
    };
    const latest = {
      ...task("latest", "completed"),
      sessionCount: 1,
      lastEventAt: "2026-09-20T00:00:00Z",
    };
    expect(
      latestLinkedSessionTask([older, task("unlinked", "active"), latest])?.id,
    ).toBe("latest");
  });
  it("uses the newest saved activity including the general workspace task", () => {
    const staleNamed = {
      ...task("Package QNECTOR workspace plugin", "active"),
      lastEventAt: "2026-09-22T10:32:33Z",
    };
    const freshGeneral = {
      ...task("General workspace activity", "idle"),
      lastEventAt: "2026-09-23T07:01:20Z",
    };
    expect(latestSavedActivityTask([staleNamed, freshGeneral])?.title).toBe(
      "General workspace activity",
    );
  });
  it("shows a blocked task only when no in-progress task exists", () => {
    const blocked = {
      ...task("blocked", "blocked"),
      updatedAt: "2026-09-20T02:00:00Z",
    };
    const active = {
      ...task("active", "active"),
      updatedAt: "2026-09-20T01:00:00Z",
    };
    expect(currentSavedTask([blocked, active])?.id).toBe("active");
    expect(currentSavedTask([blocked, task("done", "completed")])?.id).toBe(
      "blocked",
    );
  });
  it("keeps saved log provenance, error status and most-recent-first order", () => {
    const entries = recentSavedLog(
      [
        event("old", "2026-09-20T01:00:00Z"),
        { ...event("failed", "2026-09-20T03:00:00Z"), status: "error" },
      ],
      [{ timestamp: "2026-09-20T02:00:00Z", summary: "Legacy edit" }],
    );
    expect(entries.map((entry) => entry.summary)).toEqual([
      "Checked failed",
      "Legacy edit",
      "Checked old",
    ]);
    expect(entries[0]?.status).toBe("error");
    expect(entries[1]?.source).toBe("Legacy");
    expect(
      recentSavedLog(
        Array.from({ length: 20 }, (_, i) =>
          event(String(i), `2026-09-20T00:${String(i).padStart(2, "0")}:00Z`),
        ),
        [],
      ),
    ).toHaveLength(12);
  });
});
