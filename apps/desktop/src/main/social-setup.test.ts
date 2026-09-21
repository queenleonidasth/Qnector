import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSocialRead } from "@qnector/core";
import { configureLocalYouTube } from "./social-setup.js";

vi.mock("@qnector/core", () => ({ executeSocialRead: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const healthBase = {
  summary: "Health checked",
  operation: "health" as const,
  status: "limited" as const,
  items: [],
  retrievedAt: "2026-09-19T00:00:00.000Z",
  completeness: "METADATA_ONLY" as const,
  warnings: [],
  nextCursor: null,
};

describe("opt-in, non-disruptive YouTube setup", () => {
  it("keeps social off until explicitly enabled and never probes backends on disable", async () => {
    const next = await configureLocalYouTube(
      { enabled: true, platforms: ["youtube"] },
      undefined,
      undefined,
      false,
    );
    expect(next).toEqual({ enabled: false, platforms: [] });
    expect(executeSocialRead).not.toHaveBeenCalled();
  });

  it("fails closed without explicitly selected local paths or Node", async () => {
    await expect(
      configureLocalYouTube(undefined, undefined, undefined, true),
    ).rejects.toThrow("NOT_INSTALLED");
    expect(executeSocialRead).not.toHaveBeenCalled();
  });

  it("enables only YouTube after a successful read-only health gate", async () => {
    vi.mocked(executeSocialRead).mockResolvedValueOnce({
      ...healthBase,
      capabilities: {
        youtubeRead: true,
        youtubeSearch: true,
        facebookSearch: false,
        facebookFeed: false,
        facebookPostRead: false,
        durable: false,
      },
    });
    const next = await configureLocalYouTube(
      { enabled: false, platforms: [] },
      "C:\\Users\\Test\\AppData\\Local",
      "C:\\Tools\\node.exe",
      true,
    );
    expect(next.enabled).toBe(true);
    expect(next.platforms).toEqual(["youtube"]);
    expect(next.youtubePath).toMatch(/yt-dlp\.exe$/);
    expect(next.opencliPath).toBeUndefined();
    expect(executeSocialRead).toHaveBeenCalledWith(next, { action: "health" });
  });

  it("refuses to save a false doctor badge", async () => {
    vi.mocked(executeSocialRead).mockResolvedValueOnce({
      ...healthBase,
      capabilities: {
        youtubeRead: false,
        youtubeSearch: false,
        facebookSearch: false,
        facebookFeed: false,
        facebookPostRead: false,
        durable: false,
      },
    });
    await expect(
      configureLocalYouTube(
        undefined,
        "C:\\Users\\Test\\AppData\\Local",
        "C:\\Tools\\node.exe",
        true,
      ),
    ).rejects.toThrow("BACKEND_UNAVAILABLE");
  });
});
