import { describe, expect, it } from "vitest";
import {
  matrixContinuousMotionEnabled,
  matrixDisconnectSpeedScale,
} from "./gold-matrix-rain.js";

describe("Royal Gold Matrix disconnect deceleration", () => {
  it("decelerates monotonically from full speed to a complete stop", () => {
    const checkpoints = [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      matrixDisconnectSpeedScale(progress),
    );

    expect(checkpoints[0]).toBe(1);
    expect(checkpoints[4]).toBe(0);
    for (let index = 1; index < checkpoints.length; index += 1) {
      expect(checkpoints[index]).toBeLessThan(checkpoints[index - 1]!);
    }
  });

  it("clamps invalid progress values safely", () => {
    expect(matrixDisconnectSpeedScale(-1)).toBe(1);
    expect(matrixDisconnectSpeedScale(2)).toBe(0);
    expect(matrixDisconnectSpeedScale(Number.NaN)).toBe(1);
  });

  it("keeps cold-start idle motion running instead of treating disconnected as frozen", () => {
    expect(matrixContinuousMotionEnabled(false, false, 0)).toBe(true);
  });

  it("stops at a completed hold or an intentional post-disconnect freeze", () => {
    expect(matrixContinuousMotionEnabled(false, false, 1)).toBe(false);
    expect(matrixContinuousMotionEnabled(true, false, 0)).toBe(false);
  });

  it("resumes after a cancelled hold or reconnect", () => {
    expect(matrixContinuousMotionEnabled(false, false, 0.75)).toBe(true);
    expect(matrixContinuousMotionEnabled(false, false, 0)).toBe(true);
  });

  it("respects reduced-motion independently of connection state", () => {
    expect(matrixContinuousMotionEnabled(false, true, 0)).toBe(false);
  });
});
