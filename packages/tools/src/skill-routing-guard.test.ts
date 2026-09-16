import { describe, expect, it } from "vitest";
import {
  missingSkillRoutingWarning,
  type SkillTraceState,
} from "./tool-result.js";

const routed: SkillTraceState = {
  routeId: "route-test",
  query: "edit source code",
  activatedAt: "2026-09-15T00:00:00.000Z",
  skills: [{ name: "typescript-best-practices" }],
};

describe("missing skill routing diagnostic", () => {
  it("flags substantive mutations without an activated skill route", () => {
    expect(
      missingSkillRoutingWarning("files", "write", { path: "src/a.ts" }),
    ).toMatchObject({ code: "SKILL_ROUTING_MISSING" });
    expect(
      missingSkillRoutingWarning("process", "run", { command: "pnpm build" }),
    ).toMatchObject({ code: "SKILL_ROUTING_MISSING" });
    expect(
      missingSkillRoutingWarning("git", "commit", { message: "test" }),
    ).toMatchObject({ code: "SKILL_ROUTING_MISSING" });
  });

  it("warns when a route exists but activated no skills or no skill supports the tool", () => {
    expect(
      missingSkillRoutingWarning(
        "files",
        "write",
        { path: "a.txt" },
        {
          ...routed,
          skills: [],
        },
      )?.code,
    ).toBe("SKILL_ROUTING_MISSING");
    expect(
      missingSkillRoutingWarning(
        "files",
        "write",
        { path: "a.txt" },
        {
          ...routed,
          skills: [{ name: "browser-only", allowedTools: ["browser"] }],
        },
      )?.code,
    ).toBe("SKILL_ROUTING_MISSING");
  });

  it("does not flag read-only calls or work that already has route context", () => {
    expect(
      missingSkillRoutingWarning("files", "read", { path: "src/a.ts" }),
    ).toBeUndefined();
    expect(
      missingSkillRoutingWarning(
        "files",
        "write",
        { path: "src/a.ts" },
        routed,
      ),
    ).toBeUndefined();
    expect(
      missingSkillRoutingWarning("system", "skills_route", {
        query: "edit source",
      }),
    ).toBeUndefined();
  });
});
