import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config.js";
import { configSchema } from "@qnector/shared";
import {
  validatedSocialUrl,
  checkedExecutable,
  socialExec,
} from "./command-runner.js";
import { executeSocialRead } from "./service.js";
import { resolveSocialBackend } from "./backend-resolver.js";

const disabled = {
  enabled: false,
  platforms: [] as Array<"youtube" | "facebook">,
};
describe("social security and opt-in pilot", () => {
  it("is disabled by default and does not require Agent Reach at startup", async () => {
    expect(defaultConfig().social).toEqual(disabled);
    expect(configSchema.parse(defaultConfig()).social?.enabled).toBe(false);
    const health = await executeSocialRead(disabled, { action: "health" });
    expect(health.status).toBe("disabled");
    expect(health.capabilities?.youtubeRead).toBe(false);
    await expect(
      executeSocialRead(disabled, {
        action: "search",
        platform: "youtube",
        query: "hello",
      }),
    ).rejects.toThrow("CHANNEL_DISABLED");
  });
  it("rejects URL injection, SSRF, credentials and host suffix confusion", () => {
    for (const url of [
      "http://youtube.com/watch?v=x",
      "https://youtube.com.evil.test/",
      "https://127.0.0.1/",
      "https://user:pass@youtube.com/",
      "https://youtube.com:8080/",
      "file:///etc/passwd",
      "https://youtube.com/#secret",
      "https://youtube.com/?access_token=secret",
    ]) {
      expect(() => validatedSocialUrl(url, "youtube")).toThrow("INVALID_INPUT");
    }
    expect(validatedSocialUrl("https://youtu.be/abcdef12345", "youtube")).toBe(
      "https://www.youtube.com/watch?v=abcdef12345",
    );
  });
  it("requires pinned absolute executables and rejects arbitrary shell commands", async () => {
    expect(await checkedExecutable("yt-dlp")).toBeNull();
    expect(
      await checkedExecutable("C:\\Windows\\System32\\cmd.exe"),
    ).toBeNull();
    await expect(
      socialExec("C:\\Windows\\System32\\cmd.exe", ["/c", "whoami"]),
    ).rejects.toThrow("NOT_INSTALLED");
  });
  it("does not treat an available binary as authorized Facebook access", () => {
    const config = {
      enabled: true,
      platforms: ["facebook"] as Array<"youtube" | "facebook">,
    };
    expect(() =>
      resolveSocialBackend(
        "facebook",
        "search",
        config,
        { youtube: "yt-dlp", facebook: "opencli" },
        { youtube: null, facebook: "C:\\opencli.exe" },
      ),
    ).toThrow("AUTH_REQUIRED");
    expect(() =>
      resolveSocialBackend(
        "facebook",
        "read",
        { ...config, authMode: "existing-chrome-session" },
        { youtube: "yt-dlp", facebook: "opencli" },
        { youtube: null, facebook: "C:\\opencli.exe" },
      ),
    ).toThrow("UNSUPPORTED_OPERATION");
  });
  it("does not claim durable jobs or unverified Facebook post/feed reading", async () => {
    const config = {
      enabled: true,
      platforms: ["facebook"] as Array<"youtube" | "facebook">,
    };
    await expect(
      executeSocialRead(config, {
        action: "read",
        platform: "facebook",
        url: "https://www.facebook.com/example",
      }),
    ).rejects.toThrow("UNSUPPORTED_OPERATION");
    await expect(
      executeSocialRead(config, { action: "feed", platform: "facebook" }),
    ).rejects.toThrow("UNSUPPORTED_OPERATION");
    await expect(
      executeSocialRead(config, { action: "start" as "read" }),
    ).rejects.toThrow("UNSUPPORTED_OPERATION");
  });
});
