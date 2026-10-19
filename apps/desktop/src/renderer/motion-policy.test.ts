import { describe, expect, it } from "vitest";
import {
  MIN_ACTIVE_MOTION_TARGET_FPS, // exported by the shared VSYNC driver, not a timer cap
} from "./royal-motion-clock.js";
import {
  QUALITY_OPTIONS,
  MOTION_CHANGE_EVENT,
  MOTION_TELEMETRY_EVENT,
  parseMotionQuality,
  effectiveMotionQuality,
  motionBudget,
} from "./motion-policy.js";
import { readFile } from "node:fs/promises";

describe("Royal Motion Quality policy", () => {
  it("allows four explicit profiles, defaulting corrupt saved values to Balanced", () => {
    expect(QUALITY_OPTIONS).toEqual(["full","balanced","eco","off"]);
    expect(parseMotionQuality("full")).toBe("full");
    expect(parseMotionQuality("eco")).toBe("eco");
    expect(parseMotionQuality("bad-setting")).toBe("balanced");
    expect(parseMotionQuality(null)).toBe("balanced");
  });
  it("keeps the old animationsEnabled=false override and respects OS Reduced Motion", () => {
    for (const quality of QUALITY_OPTIONS) {
      expect(effectiveMotionQuality(quality,false,false)).toBe("off");
    }
    expect(effectiveMotionQuality("full",true,true)).toBe("reduced");
    expect(effectiveMotionQuality("balanced",true,true)).toBe("reduced");
    expect(effectiveMotionQuality("off",true,true)).toBe("off");
    expect(effectiveMotionQuality("eco",true,false)).toBe("eco");
  });
  it("degrades complexity and DPR, never the VSYNC cadence", () => {
    expect(MIN_ACTIVE_MOTION_TARGET_FPS).toBe(60);
    expect(motionBudget("full").ribbons).toBeGreaterThan(motionBudget("balanced").ribbons);
    expect(motionBudget("balanced").ribbons).toBeGreaterThan(motionBudget("eco").ribbons);
    expect(motionBudget("full").maxDpr).toBeGreaterThan(motionBudget("eco").maxDpr);
    expect(motionBudget("full").moving).toBe(true);
    expect(motionBudget("off").moving).toBe(false);
    expect(motionBudget("reduced").moving).toBe(false);
    expect(MOTION_CHANGE_EVENT).toBe("qnector:motion-policy-change");
    expect(MOTION_TELEMETRY_EVENT).toBe("qnector:motion-telemetry");
  });
  it("renders quality and local-only QC controls without changing native config", async () => {
    const root = await readFile(new URL("./renderer.tsx", import.meta.url),"utf8");
    const clock = await readFile(new URL("./royal-motion-clock.ts", import.meta.url),"utf8");
    const css = await readFile(new URL("./royal-motion-system.css", import.meta.url),"utf8");
    expect(root).toContain('aria-label="Motion quality"');
    expect(root).toContain("motionPreferences.setQuality(option)");
    expect(root).toContain("motionPreferences.setTelemetryEnabled");
    expect(root).not.toContain("disabled={drawerTransition !== null}");
    expect(root).not.toContain("drawerSwitchTimeoutRef.current = window.setTimeout");
    expect(clock).toContain("frame = requestAnimationFrame(tick)");
    expect(clock).toContain('document.documentElement.dataset.motionTelemetry === "on"');
    expect(clock).toContain("subscribers.size===0");
    expect(css).toContain(".motion-quality-segments");
    expect(css).toContain("html[data-motion-quality=\"reduced\"]");
  });
});
