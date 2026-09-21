import { describe, expect, it } from "vitest";
import { parseWebVttTranscript } from "./youtube.js";

describe("YouTube subtitle normalization", () => {
  it("extracts verified cue text without timestamps, markup or consecutive duplicates", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "",
      "00:00:01.200 --> 00:00:03.360 align:start position:0%",
      "<c>Here we are</c>",
      "",
      "00:00:03.400 --> 00:00:05.000",
      "Here we are",
      "",
      "00:00:05.100 --> 00:00:06.000",
      "in front of the elephants",
      "",
    ].join("\n");
    expect(parseWebVttTranscript(vtt)).toBe(
      "Here we are\nin front of the elephants",
    );
  });
  it("fails closed for missing captions and limits text length", () => {
    expect(parseWebVttTranscript("WEBVTT\n\n")).toBe("");
    const long = `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${"a".repeat(20000)}\n`;
    expect(parseWebVttTranscript(long).length).toBeLessThanOrEqual(12000);
  });
});
