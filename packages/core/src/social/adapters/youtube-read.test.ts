import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { youtubeRead } from "./youtube.js";
import { socialExec } from "../command-runner.js";

vi.mock("../command-runner.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../command-runner.js")>();
  return { ...original, socialExec: vi.fn() };
});

const metadata =
  [
    "jNQXAC9IVRw",
    "Me at the zoo",
    "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "jawed",
    "20050424",
    "Description",
  ]
    .map((value) => JSON.stringify(value))
    .join("\n") + "\n";

describe("youtubeRead transcript fallback and owned cleanup", () => {
  it("returns actual caption text, source and removes its own temporary files", async () => {
    let owned = "";
    vi.mocked(socialExec).mockImplementation(async (_path, args) => {
      if (args.includes("--print")) return metadata;
      owned = args[args.indexOf("--paths") + 1]!;
      writeFileSync(
        `${owned}/jNQXAC9IVRw.en.vtt`,
        "WEBVTT\n\n00:00:01.200 --> 00:00:03.360\nHello elephants\n",
      );
      return "";
    });
    const out = await youtubeRead(
      "yt-dlp.exe",
      "https://youtu.be/jNQXAC9IVRw",
      12000,
      undefined,
      process.execPath,
    );
    for (const [, args, , , options] of vi.mocked(socialExec).mock.calls) {
      expect(args).toContain("--no-remote-components");
      expect(args).toContain(`node:${process.execPath}`);
      expect(options?.nodePath).toBe(process.execPath);
    }
    expect(out.items[0]).toMatchObject({
      transcript: "Hello elephants",
      transcriptSource: "manual",
      transcriptLanguage: "en",
    });
    expect(out.completeness).toBe("PARTIAL");
    expect(existsSync(owned)).toBe(false);
  });
  it("never invents a transcript when neither manual nor automatic captions exist", async () => {
    vi.mocked(socialExec).mockImplementation(async (_path, args) =>
      args.includes("--print") ? metadata : "",
    );
    const out = await youtubeRead(
      "yt-dlp.exe",
      "https://youtu.be/jNQXAC9IVRw",
      12000,
    );
    expect(out.items[0]?.transcript).toBeUndefined();
    expect(
      out.warnings.some((warning) =>
        warning.includes("TRANSCRIPT_UNAVAILABLE"),
      ),
    ).toBe(true);
  });
});
