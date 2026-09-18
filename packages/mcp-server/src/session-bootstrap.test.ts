import { describe, expect, it } from "vitest";
import type { MemoryRecall } from "@qnector/core";
import type { MemoryV2Snapshot } from "@qnector/shared";
import {
  buildSessionBootstrapError,
  buildSessionBootstrapInstructions,
} from "./session-bootstrap.js";

describe("session memory bootstrap", () => {
  it("prioritizes continuity within a 3 KB bootstrap budget", () => {
    const now = "2026-08-29T14:30:00.000Z";
    const active = {
      currentTask: "Continue Qnector development",
      completedSteps: ["Finished P1-P10", "Packaged the previous build"],
      pendingSteps: ["Verify the new package", "Update the handoff"],
      criticalContext: `Do not rebuild completed work. ${"à¸šà¸£à¸´à¸šà¸—à¸ªà¸³à¸„à¸±à¸ ".repeat(500)}`,
    };
    const memory: MemoryRecall = {
      available: true,
      workspaceId: "workspace-test",
      workspacePath: "C:\\Users\\QUEEN\\qnector",
      updatedAt: now,
      state: {
        version: 1,
        workspaceId: "workspace-test",
        workspacePath: "C:\\Users\\QUEEN\\qnector",
        createdAt: now,
        updatedAt: now,
        active,
        facts: Array.from({ length: 30 }, (_, index) => ({
          id: `fact-${index}`,
          key: `rule-${index}`,
          category: index < 20 ? ("note" as const) : ("rule" as const),
          value: `Keep rule ${index}: ${"x".repeat(500)}`,
          tags: [],
          createdAt: now,
          updatedAt: now,
        })),
        recentChanges: [],
      },
      checkpoints: [
        {
          id: "checkpoint-test",
          createdAt: now,
          label: "latest-release",
          active,
        },
      ],
      counts: { facts: 30, checkpoints: 1, recentChanges: 0 },
      truncated: true,
      sanitized: false,
    };

    const result = buildSessionBootstrapInstructions(memory, [
      {
        id: "activity-test",
        timestamp: "2026-08-29T14:31:00.000Z",
        tool: "files",
        action: "replace",
        argsSummary: "{}",
        status: "success",
        summary: "Updated runtime dashboard",
      },
    ]);
    expect(result).toContain("QNECTOR SESSION BOOTSTRAP");
    expect(result).toContain("CURRENT CAPABILITY RULE");
    expect(result).toContain("current tool list outranks conversation history");
    expect(result).toContain(
      "probe system.status before saying Qnector cannot be used",
    );
    expect(result).toContain("system.status");
    expect(result).toContain("older claim of unavailability is stale");
    expect(result).toContain("Continue Qnector development");
    expect(result).toContain("Verify the new package");
    expect(result).toContain("Resume next: Verify the new package");
    expect(result).toContain("rule-0");
    expect(result).toContain("rule-20");
    expect(result).toContain("Recent working set");
    expect(result).toContain("Updated runtime dashboard");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(3_000);
    const polluted: MemoryRecall = {
      ...memory,
      state: {
        ...memory.state,
        facts: [],
        active: {
          ...active,
          criticalContext: "",
          completedSteps: ["files: Wrote a file", "Verified release manually"],
        },
      },
    };
    const recovered = buildSessionBootstrapInstructions(polluted);
    expect(recovered).toContain("Legacy auto-completed tool entries omitted");
    expect(recovered).not.toContain("files: Wrote a file");
    expect(recovered).toContain("Verified release manually");

    const memoryV2: MemoryV2Snapshot = {
      version: 2,
      workspaceId: memory.workspaceId,
      workspacePath: memory.workspacePath,
      updatedAt: now,
      revision: 1,
      tasks: Array.from({ length: 4 }, (_, index) => ({
        id: `task-${index}`,
        workspaceId: memory.workspaceId,
        title: `Task ${index}`,
        status: index === 3 ? ("blocked" as const) : ("active" as const),
        currentTask: `Current task ${index}`,
        completedSteps: [],
        pendingSteps: [],
        criticalContext: "",
        createdAt: now,
        updatedAt: `2026-08-${20 + index}T14:30:00.000Z`,
        sessionCount: 1,
        touchedPaths: [],
      })),
      events: [],
      memories: [],
      conflicts: [
        {
          id: "conflict",
          path: "shared.ts",
          taskIds: ["task-1", "task-3"],
          taskTitles: ["Task 1", "Task 3"],
          severity: "warning",
        },
      ],
      counts: {
        tasks: 4,
        activeTasks: 4,
        events: 0,
        memories: 0,
        conflicts: 1,
      },
    };
    const dense = buildSessionBootstrapInstructions(memory, [], memoryV2, 24);
    expect(Buffer.byteLength(dense, "utf8")).toBeLessThanOrEqual(3_000);
    expect(dense).toContain("Agent Skills: 24 available");
    expect(dense).toContain("task-3 [blocked]");
    expect(dense).not.toContain("task-0 [active]");
    expect(dense).toContain("Task conflict warning");
    expect(dense).toContain("Resume next: Verify the new package");
    expect(dense).toContain("Do not rebuild completed work.");
    expect(dense).toContain("rule-20");
    expect(dense).toContain("rule-0");
  });

  it("requires explicit skill routing and completion disclosure when skills exist", () => {
    const memory: MemoryRecall = {
      available: false,
      workspaceId: "skill-routing",
      workspacePath: "C:/work/skill-routing",
      updatedAt: "2026-09-11T00:00:00.000Z",
      state: {
        version: 1,
        workspaceId: "skill-routing",
        workspacePath: "C:/work/skill-routing",
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T00:00:00.000Z",
        active: null,
        facts: [],
        recentChanges: [],
      },
      checkpoints: [],
      counts: { facts: 0, checkpoints: 0, recentChanges: 0 },
      truncated: false,
      sanitized: false,
    };
    const result = buildSessionBootstrapInstructions(memory, [], undefined, [
      {
        name: "typescript-best-practices",
        description: "Type-safe TypeScript development",
        path: "C:/skills/typescript-best-practices/SKILL.md",
        directory: "C:/skills/typescript-best-practices",
        source: "project",
        enabled: true,
      },
    ]);
    expect(result).toContain("EXPLICIT ROUTING ONLY");
    expect(result).toContain("system.skills_route");
    expect(result).toContain("skillRouteId");
    expect(result).toContain("system.skills_search_remote");
    expect(result).toContain("system.skill_install_remote");
    expect(result).toContain("English intent/technology hint");
    expect(result).toContain("Skills used:");
    expect(result).toContain("Agent Skills: 1 available");
    expect(result).not.toContain("typescript-best-practices");
  });

  it("reports the full skill count without embedding the skill catalog", () => {
    const now = "2026-09-15T00:00:00.000Z";
    const memory: MemoryRecall = {
      available: false,
      workspaceId: "skill-catalog-count",
      workspacePath: "C:/work/skill-catalog-count",
      updatedAt: now,
      state: {
        version: 1,
        workspaceId: "skill-catalog-count",
        workspacePath: "C:/work/skill-catalog-count",
        createdAt: now,
        updatedAt: now,
        active: null,
        facts: [],
        recentChanges: [],
      },
      checkpoints: [],
      counts: { facts: 0, checkpoints: 0, recentChanges: 0 },
      truncated: false,
      sanitized: false,
    };
    const skills = Array.from({ length: 24 }, (_, index) => ({
      name: `skill-${index + 1}`,
      description: `Skill ${index + 1}`,
      path: `C:/skills/skill-${index + 1}/SKILL.md`,
      directory: `C:/skills/skill-${index + 1}`,
      source: "project" as const,
      enabled: true,
    }));

    const result = buildSessionBootstrapInstructions(
      memory,
      [],
      undefined,
      skills,
    );

    expect(result).toContain("Agent Skills: 24 available");
    expect(result).not.toContain("showing 20 below");
    expect(result).not.toContain("Available skill catalog");
    expect(result).not.toContain("skill-1:");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(2_500);
  });

  it("reports empty memory and non-fatal memory errors clearly", () => {
    const now = "2026-08-29T14:30:00.000Z";
    const empty: MemoryRecall = {
      available: false,
      workspaceId: "workspace-empty",
      workspacePath: "C:\\work\\empty",
      updatedAt: now,
      state: {
        version: 1,
        workspaceId: "workspace-empty",
        workspacePath: "C:\\work\\empty",
        createdAt: now,
        updatedAt: now,
        active: null,
        facts: [],
        recentChanges: [],
      },
      checkpoints: [],
      counts: { facts: 0, checkpoints: 0, recentChanges: 0 },
      truncated: false,
      sanitized: false,
    };

    expect(buildSessionBootstrapInstructions(empty)).toContain(
      "No saved continuity memory exists",
    );
    expect(
      buildSessionBootstrapInstructions({
        ...empty,
        warning: "memory read warning",
      }),
    ).toContain("Memory warning: memory read warning");
    const error = buildSessionBootstrapError(
      "C:\\work\\empty",
      "corrupt state",
    );
    expect(error).toContain("corrupt state");
    expect(error).toContain("CURRENT CAPABILITY RULE");
    expect(error).toContain(
      "probe system.status before saying Qnector cannot be used",
    );
    expect(error).toContain("must not block normal Qnector tools");
  });
});
