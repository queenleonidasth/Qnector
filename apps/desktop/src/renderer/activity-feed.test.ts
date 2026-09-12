import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@qnector/shared";
import { coalesceActivity, mergeActivityEntry } from "./activity-feed.js";

const rendererUrl = new URL("./renderer.tsx", import.meta.url);

function activity(
  id: string,
  status: ActivityEntry["status"],
  timestamp: string,
  overrides: Partial<ActivityEntry> = {},
): ActivityEntry {
  return {
    id,
    timestamp,
    tool: "files",
    action: "read",
    argsSummary: "path=README.md",
    status,
    ...overrides,
  };
}

describe("activity feed coalescing", () => {
  it("replaces a matching running row with its completed tool call", () => {
    const running = activity("run-1", "running", "2026-08-31T09:00:00.000Z");
    const success = activity("done-1", "success", "2026-08-31T09:00:00.050Z", {
      durationMs: 50,
      summary: "Read README.md",
    });

    expect(coalesceActivity([running, success])).toEqual([
      { ...success, id: running.id },
    ]);
  });

  it("keeps another identical concurrent call running when one completes", () => {
    const running1 = activity("run-1", "running", "2026-08-31T09:00:00.000Z");
    const running2 = activity("run-2", "running", "2026-08-31T09:00:00.010Z");
    const success = activity("done-1", "success", "2026-08-31T09:00:00.020Z");

    const result = coalesceActivity([running1, running2, success]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ ...success, id: running2.id });
    expect(result[1]).toEqual(running1);
  });

  it("puts the latest tool event first and removes duplicate ids", () => {
    const older = activity("old", "success", "2026-08-31T09:00:00.000Z");
    const newer = activity("new", "success", "2026-08-31T09:00:01.000Z", {
      action: "write",
    });

    const merged = mergeActivityEntry([older, newer], {
      ...newer,
      summary: "Updated result",
    });

    expect(merged.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(merged[0]?.summary).toBe("Updated result");
  });

  it("keeps completed Skill trace evidence when a running row is coalesced", () => {
    const running = activity(
      "run-skill",
      "running",
      "2026-09-12T08:00:00.000Z",
    );
    const success = activity(
      "done-skill",
      "success",
      "2026-09-12T08:00:00.100Z",
      {
        skillTrace: {
          routeId: "route-1",
          query: "fix smooth animation",
          activatedAt: "2026-09-12T07:59:59.000Z",
          skills: ["ui-ux-design"],
          evidence: "in_context",
        },
      },
    );

    const [merged] = coalesceActivity([running, success]);
    expect(merged?.id).toBe("run-skill");
    expect(merged?.skillTrace?.skills).toEqual(["ui-ux-design"]);
    expect(merged?.skillTrace?.evidence).toBe("in_context");
  });

  it("surfaces Skill context evidence in Live Activity rows and details", async () => {
    const source = await readFile(rendererUrl, "utf8");
    expect(source).toContain("activity-skill-badge");
    expect(source).toContain('"SKILLS ACTIVATED"');
    expect(source).toContain('"SKILL CONTEXT"');
    expect(source).toContain(
      "Runtime evidence: this routing call loaded these Skill documents",
    );
    expect(source).toContain(
      "allowed-tools scope includes or does not restrict this tool",
    );
    expect(source).toContain("selectedActivity.skillTrace.routeId");
  });
});
