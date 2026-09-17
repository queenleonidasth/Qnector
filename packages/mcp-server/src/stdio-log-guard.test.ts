import { describe, expect, it, vi } from "vitest";
import { installStdioLogGuard } from "./stdio-log-guard.js";

describe("stdio protocol log isolation", () => {
  it("routes ordinary console diagnostics to stderr without printing protocol bytes", () => {
    const original = {log: console.log, info: console.info, debug: console.debug, warn: console.warn};
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      installStdioLogGuard();
      console.log("accidental debug", 12);
      console.info("loaded");
      console.debug("debug");
      console.warn("warning");
      expect(stderr.mock.calls).toEqual([
        ["accidental debug", 12], ["loaded"], ["debug"], ["warning"],
      ]);
    } finally {
      Object.assign(console, original);
      stderr.mockRestore();
    }
  });
});
