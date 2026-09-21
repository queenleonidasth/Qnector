import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSocialRead } from "@qnector/core";
import { configureLocalFacebook } from "./social-setup.js";

vi.mock("@qnector/core", () => ({ executeSocialRead: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const local = "C:\\Users\\Test\\AppData\\Local";
const node = "C:\\Tools\\node.exe";
const base = {
  summary: "Health checked",
  operation: "health" as const,
  status: "limited" as const,
  items: [],
  retrievedAt: "2026-09-19T00:00:00.000Z",
  completeness: "METADATA_ONLY" as const,
  warnings: [],
  nextCursor: null,
};
const capabilities = {
  youtubeRead: false,
  youtubeSearch: false,
  facebookSearch: true,
  facebookFeed: false,
  facebookPostRead: false,
  durable: false,
};

describe("manual Facebook consent and authenticated verification", () => {
  it("disables without contacting the browser and preserves YouTube", async () => {
    const next = await configureLocalFacebook(
      { enabled: true, platforms: ["youtube", "facebook"] },
      undefined,
      undefined,
      false,
    );
    expect(next).toEqual({ enabled: true, platforms: ["youtube"] });
    expect(executeSocialRead).not.toHaveBeenCalled();
  });

  it("requires absolute isolated setup paths before touching any browser", async () => {
    await expect(
      configureLocalFacebook(undefined, undefined, undefined, true),
    ).rejects.toThrow("NOT_INSTALLED");
    expect(executeSocialRead).not.toHaveBeenCalled();
  });

  it("never attempts an account search while the extension is disconnected", async () => {
    vi.mocked(executeSocialRead).mockResolvedValueOnce({
      ...base,
      capabilities: { ...capabilities, facebookSearch: false },
    });
    await expect(
      configureLocalFacebook(undefined, local, node, true),
    ).rejects.toThrow("EXTENSION_DISCONNECTED");
    expect(executeSocialRead).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeSocialRead).mock.calls[0]?.[1]).toEqual({
      action: "health",
    });
  });

  it("does not enable Facebook when the authenticated test fails", async () => {
    vi.mocked(executeSocialRead)
      .mockResolvedValueOnce({ ...base, capabilities })
      .mockRejectedValueOnce(
        new Error("AUTH_REQUIRED: Please sign in manually."),
      );
    await expect(
      configureLocalFacebook(undefined, local, node, true),
    ).rejects.toThrow("AUTH_REQUIRED");
    expect(executeSocialRead).toHaveBeenCalledTimes(2);
  });

  it("enables Facebook only after a verified real-read result is reported", async () => {
    vi.mocked(executeSocialRead)
      .mockResolvedValueOnce({ ...base, capabilities })
      .mockResolvedValueOnce({
        ...base,
        operation: "search",
        status: "ready",
        items: [
          {
            url: "https://www.facebook.com/example",
            title: "Public test result",
          },
        ],
        completeness: "PARTIAL",
      });
    const enabled = await configureLocalFacebook(undefined, local, node, true);
    expect(enabled.platforms).toEqual(["facebook"]);
    expect(enabled.authMode).toBe("existing-chrome-session");
    expect(enabled.opencliPath).toMatch(/main\.js$/);
    expect(executeSocialRead).toHaveBeenNthCalledWith(2, enabled, {
      action: "search",
      platform: "facebook",
      query: "OpenAI",
      limit: 1,
    });
  });
});
