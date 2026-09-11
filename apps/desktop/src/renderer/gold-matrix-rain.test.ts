import { describe, expect, it } from "vitest";
import { matrixDisconnectSpeedScale } from "./gold-matrix-rain.js";

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
});
