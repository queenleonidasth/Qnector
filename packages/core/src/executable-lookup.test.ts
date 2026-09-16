import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { executableAvailable } from "./executable-lookup.js";

describe("executableAvailable", () => {
  it("accepts an existing executable and rejects nonexistent paths and commands", () => {
    expect(executableAvailable(process.execPath)).toBe(true);
    expect(
      executableAvailable(
        path.join(tmpdir(), "qnector-not-a-real-program.exe"),
      ),
    ).toBe(false);
    expect(executableAvailable("qnector-not-a-real-command-987654321")).toBe(
      false,
    );
  });
});
