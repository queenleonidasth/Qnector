import { describe, expect, it } from "vitest";
import { requireSafeExternalUrl } from "./external-url.js";

describe("requireSafeExternalUrl", () => {
  it("allows only ordinary HTTP(S) URLs", () => {
    expect(requireSafeExternalUrl("https://chatgpt.com/plugins")).toBe(
      "https://chatgpt.com/plugins",
    );
    expect(requireSafeExternalUrl("http://127.0.0.1:8787/")).toBe(
      "http://127.0.0.1:8787/",
    );
  });

  it("rejects commands, local files, credentials and malformed targets", () => {
    for (const input of [
      "javascript:alert(1)",
      "file:///C:/Windows/System32/calc.exe",
      "ms-settings:privacy",
      "mailto:user@example.com",
      "ftp://example.com",
      "https://user:pass@example.com/",
      "not a url",
      "",
      "x".repeat(2049),
      null,
    ])
      expect(() => requireSafeExternalUrl(input)).toThrow(
        "UNSAFE_EXTERNAL_URL",
      );
  });
});
