import { describe, expect, it } from "vitest";
import { isUiAutomationReplaySafeAction } from "./ui-automation.js";

describe("UI Automation replay policy", () => {
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
