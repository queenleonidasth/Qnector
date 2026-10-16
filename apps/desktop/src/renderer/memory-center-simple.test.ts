import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryCenter, type MemoryCenterData } from "./memory-center.js";

const base: MemoryCenterData = {
  available: true,
  workspaceId: "w",
  updatedAt: "2026-09-20T05:00:00Z",
  state: { active: null, facts: [], recentChanges: [] },
  counts: { facts: 0, checkpoints: 0, recentChanges: 0 },
  v2: {
    version: 2,
    workspaceId: "w",
    workspacePath: "C:/work",
    updatedAt: "2026-09-20T05:00:00Z",
    revision: 1,
    tasks: [],
    events: [],
    memories: [],
    conflicts: [],
    counts: { tasks: 0, activeTasks: 0, events: 0, memories: 0, conflicts: 0 },
  },
};
function render(memory: MemoryCenterData) {
  return renderToStaticMarkup(
    React.createElement(MemoryCenter, {
      memory,
      workspace: "C:/work",
      busy: false,
      onOpen: () => undefined,
      onExport: () => undefined,
      onClear: () => undefined,
    }),
  );
}

describe("simplified Memory Center", () => {
  it("shows exactly three clear English panels and a truthful empty state", () => {
    const html = render(base);
    expect(html.match(/class="memory-center-panel"/g)).toHaveLength(3);
    expect(html).toContain("Latest Activity");
    expect(html).toContain("Current Task");
    expect(html).toContain("Activity Log");
    expect(html).toContain("No saved Qnector activity");
    expect(html).toContain("No active task is recorded");
    expect(html).toContain("No recorded activity");
    expect(html).not.toContain("General workspace activity");
  });
  it("uses a persisted session binding, not an invented chat transcript", () => {
    const html = render({
      ...base,
      v2: {
        ...base.v2!,
        lastSession: {
          taskId: "task-1",
          title: "Discussed deployment steps",
          currentTask: "Review updater",
          linkedAt: "2026-09-20T04:00:00Z",
        },
      },
    });
    expect(html).toContain("Discussed deployment steps");
    expect(html).toContain("Last linked session (saved topic only)");
    expect(html).toContain(
      "QNECTOR stores task/tool context. Chat words are saved only when the user explicitly opts in",
    );
    expect(html).not.toContain("Saved task context: Review updater");
  });
  it("shows the newest Qnector activity when no chat session is linked", () => {
    const html = render({
      ...base,
      v2: {
        ...base.v2!,
        tasks: [
          {
            id: "named-old",
            workspaceId: "w",
            title: "Package QNECTOR workspace plugin",
            status: "active",
            currentTask: "Old plugin work",
            completedSteps: [],
            pendingSteps: [],
            criticalContext: "",
            createdAt: "2026-09-22T10:00:00Z",
            updatedAt: "2026-09-22T10:32:33Z",
            lastEventAt: "2026-09-22T10:32:33Z",
            sessionCount: 0,
            touchedPaths: [],
          },
          {
            id: "general-new",
            workspaceId: "w",
            title: "General workspace activity",
            status: "idle",
            currentTask: "General workspace activity",
            completedSteps: [],
            pendingSteps: [],
            criticalContext: "",
            createdAt: "2026-09-20T00:00:00Z",
            updatedAt: "2026-09-23T07:01:20Z",
            lastEventAt: "2026-09-23T07:01:20Z",
            sessionCount: 0,
            touchedPaths: [],
          },
        ],
      },
    });
    expect(html).toContain("Latest Activity");
    expect(html).toContain("General workspace activity");
    expect(html).toContain("Newest saved task or workspace activity.");
    const firstPanel = html.split("</section>")[0] ?? "";
    expect(firstPanel).not.toContain("Old plugin work");
  });
  it("does not let an Oct 14 linked session hide Oct 16 saved work", () => {
    const html = render({
      ...base,
      v2: {
        ...base.v2!,
        lastSession: {
          taskId: "linked",
          title: "Old discussion",
          currentTask: "Legacy work",
          linkedAt: "2026-10-14T08:00:00Z",
        },
        tasks: [
          {
            id: "new-work",
            workspaceId: "w",
            title: "Repair Memory",
            status: "active",
            currentTask: "Fix QNECTOR memory",
            completedSteps: [],
            pendingSteps: [],
            criticalContext: "",
            createdAt: "2026-10-16T01:00:00Z",
            updatedAt: "2026-10-16T15:25:00Z",
            sessionCount: 0,
            touchedPaths: [],
          },
        ],
      },
    });
    expect(html).toContain(
      '<strong class="memory-center-primary">Repair Memory</strong>',
    );
    expect(html).toContain("Activity updated: Oct 16, 2026");
    expect(html).toContain("Last linked session (saved topic only):");
    expect(html).toContain("Old discussion");
    expect(html).not.toContain(
      '<strong class="memory-center-primary">Old discussion</strong>',
    );
  });
  it("distinguishes missing explicit chat records and facts from stale dates", () => {
    const html = render({
      ...base,
      v2: {
        ...base.v2!,
        freshness: {
          toolEventsAt: "2026-10-16T15:25:00Z",
          semanticFactsAt: null,
          conversationTurnsAt: null,
        },
      },
    });
    expect(html).toContain("Tool events:");
    expect(html).toContain("Oct 16, 2026");
    expect(html).toContain("Saved facts:");
    expect(html.match(/None recorded/g)).toHaveLength(2);
    expect(html).toContain("Explicit chat excerpts:");
  });
  it("does not hard-code Thai interface strings or expose deletion by default", () => {
    const source = readFileSync(
      new URL("./memory-center.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/[\u0e00-\u0e7f]/);
    const html = render(base);
    expect(html).toContain("Data tools");
    expect(html).toContain("Delete workspace memory");
    expect(html).toContain("disabled");
    expect(html).toContain("Saved context");
  });
});
