import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./renderer.tsx", import.meta.url), "utf8");

describe("Error-state accessibility", () => {
  it("announces failed runtime calls and exposes a named dismiss control", () => {
    expect(source).toContain(
      'className="error-toast" role="alert" aria-live="assertive"',
    );
    expect(source).toContain('aria-label="Dismiss error"');
    expect(source).toContain("onClick={() => setError(undefined)}");
  });
});
