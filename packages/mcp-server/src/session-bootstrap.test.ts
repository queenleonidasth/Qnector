import { describe, expect, it } from "vitest";
import type { MemoryRecall } from "@qnector/core";
import {
  buildSessionBootstrapError,
  buildSessionBootstrapInstructions,
} from "./session-bootstrap.js";

describe("session memory bootstrap", () => {
  it("formats saved continuity context and stays within the 6 KB budget", () => {
    const now = "2026-08-29T14:30:00.000Z";
    const active = {
      currentTask: "Continue Qnector development",
      completedSteps: ["Finished P1-P10", "Packaged the previous build"],
      pendingSteps: ["Verify the new package", "Update the handoff"],
      criticalContext: `Do not rebuild completed work. ${"บริบทสำคัญ ".repeat(500)}`,
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
    expect(result).toContain("probe system.status before saying Qnector cannot be used");
    expect(result).toContain("system.status");
    expect(result).toContain("older claim of unavailability is stale");
    expect(result).toContain("Continue Qnector development");
    expect(result).toContain("Verify the new package");
    expect(result).toContain("Resume next: Verify the new package");
    expect(result).toContain("rule-0");
    expect(result).toContain("rule-20");
    expect(result).toContain("Recent working set");
    expect(result).toContain("Updated runtime dashboard");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(6_000);
  });

  it("requires automatic skill routing and completion disclosure when skills exist", () => {
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
    expect(result).toContain("AUTOMATIC ROUTING");
    expect(result).toContain("system.skills_route");
    expect(result).toContain("skillRouteId");
    expect(result).toContain("system.skills_search_remote");
    expect(result).toContain("system.skill_install_remote");
    expect(result).toContain("English intent/technology hint");
    expect(result).toContain("Skills used:");
    expect(result).toContain("typescript-best-practices");
  });

  it("reports the full skill count when the bootstrap catalog is clipped", () => {
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
    expect(result).toContain("showing 20 below");
    expect(result).toContain("skill-20");
    expect(result).not.toContain("skill-21:");
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
    const error = buildSessionBootstrapError(
      "C:\\work\\empty",
      "corrupt state",
    );
    expect(error).toContain("corrupt state");
    expect(error).toContain("CURRENT CAPABILITY RULE");
    expect(error).toContain("probe system.status before saying Qnector cannot be used");
    expect(error).toContain("must not block normal Qnector tools");
  });
});
