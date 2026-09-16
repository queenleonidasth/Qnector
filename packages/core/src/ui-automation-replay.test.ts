import { describe, expect, it } from "vitest";
import {
  isUiAutomationReplaySafeAction,
  WindowsUiAutomationService,
} from "./ui-automation.js";

describe("UI Automation replay policy", () => {
  it("sanitizes non-finite UI Automation rectangles in the PowerShell fallback", async () => {
    let script = "";
    const service = new WindowsUiAutomationService({
      platform: "win32",
      runPowerShell: async (value) => {
        script = value;
        return JSON.stringify([
          {
            RuntimeId: "1",
            ProcessId: 1,
            Name: "Fixture",
            X: 0,
            Y: 0,
            Width: 100,
            Height: 100,
          },
        ]);
      },
    });

    const windows = await service.windows(1);
    expect(windows).toHaveLength(1);
    expect(script).toContain("function Finite($value)");
    expect(script).toContain("X=(Finite $r.X)");
    expect(script).toContain("Height=(Finite $r.Height)");
  });

  it("retries observations but never blindly replays mutations", () => {
    expect(isUiAutomationReplaySafeAction("windows")).toBe(true);
    expect(isUiAutomationReplaySafeAction("inspect")).toBe(true);
    expect(isUiAutomationReplaySafeAction("find")).toBe(true);
    expect(isUiAutomationReplaySafeAction("wait")).toBe(true);

    for (const action of [
      "invoke",
      "toggle",
      "set_value",
      "focus",
      "select",
      "expand",
      "collapse",
      "scroll_into_view",
      "set_range_value",
    ])
      expect(isUiAutomationReplaySafeAction(action)).toBe(false);
  });
});
