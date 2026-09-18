import { describe, expect, it } from "vitest";
import { shouldEnableDurableTasks } from "./durable-policy.js";

describe("durable task startup policy", () => {
  it("enables the existing durable API on Windows by default", () => {
    expect(shouldEnableDurableTasks("win32")).toBe(true);
    expect(shouldEnableDurableTasks("win32", "1")).toBe(true);
  });
  it("permits an explicit non-destructive opt-out", () => {
    for (const flag of ["0", "false", "OFF"]) {
      expect(shouldEnableDurableTasks("win32", flag)).toBe(false);
    }
  });
  it("does not start Windows Job Host on other platforms", () => {
    expect(shouldEnableDurableTasks("linux")).toBe(false);
    expect(shouldEnableDurableTasks("darwin", "1")).toBe(false);
  });
});
