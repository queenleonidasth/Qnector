import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@qnector/shared";
import { coalesceActivity, mergeActivityEntry } from "./activity-feed.js";

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
});
