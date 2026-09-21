import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { socialExec, validatedSocialUrl } from "../command-runner.js";
import type { SocialItem } from "../types.js";

/** Captions are untrusted text; return bounded cue text only. */
export function parseWebVttTranscript(vtt: string): string {
  if (!vtt.startsWith("WEBVTT")) return "";
  const cues: string[] = [];
  let inCue = false;
  for (const line of vtt.split(/\r?\n/)) {
    if (line.includes(" --> ")) {
      inCue = /^\d\d:\d\d:\d\d\.\d{3} --> /.test(line);
      continue;
    }
    if (!line.trim()) {
      inCue = false;
      continue;
    }
    if (!inCue) continue;
    const clean = line.replace(/<[^>]*>/g, "").trim();
    if (clean && clean !== cues.at(-1)) cues.push(clean);
    if (cues.join("\n").length >= 12000) break;
  }
  return cues.join("\n").slice(0, 12000);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "CONTENT_UNAVAILABLE: YouTube returned unexpected metadata.",
    );
  return value as Record<string, unknown>;
}
const text = (value: unknown, max = 1200): string | undefined =>
  typeof value === "string" ? value.slice(0, max) : undefined;
function item(value: unknown): SocialItem {
  const row = record(value);
  const id = text(row.id, 40);
  const raw = text(row.webpage_url ?? row.url, 2048);
  const url = raw?.startsWith("https://")
    ? validatedSocialUrl(raw, "youtube")
    : id && /^[\w-]{11}$/.test(id)
      ? `https://www.youtube.com/watch?v=${id}`
      : undefined;
  if (!url)
    throw new Error(
      "CONTENT_UNAVAILABLE: YouTube did not return a verified video URL.",
    );
  return {
    url,
    title: text(row.title, 300),
    author: text(row.channel ?? row.uploader, 150),
    publishedAt: text(row.upload_date, 16),
    excerpt: text(row.description),
  };
}

/** Download ONLY subtitles into a temporary directory owned by this invocation. */
async function verifiedCaptions(
  executable: string,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  nodePath?: string,
) {
  const id = new URL(url).searchParams.get("v")!;
  const owned = await mkdtemp(path.join(tmpdir(), "qnector-social-captions-"));
  try {
    for (const source of ["manual", "automatic"] as const) {
      try {
        await socialExec(
          executable,
          [
            "--ignore-config",
            "--no-remote-components",
            ...(nodePath ? ["--js-runtimes", `node:${nodePath}`] : []),
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            source === "manual" ? "--write-sub" : "--write-auto-sub",
            "--sub-langs",
            "th,en",
            "--sub-format",
            "vtt",
            "--paths",
            owned,
            "--output",
            "%(id)s.%(ext)s",
            "--",
            url,
          ],
          timeoutMs,
          signal,
          { nodePath },
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        continue;
      }
      for (const language of ["th", "en"] as const) {
        const filename = path.join(owned, `${id}.${language}.vtt`);
        const size = await stat(filename)
          .then((file) => file.size)
          .catch(() => 0);
        if (!size || size > 65536) continue;
        const transcript = parseWebVttTranscript(
          await readFile(filename, "utf8"),
        );
        if (transcript) return { transcript, source, language };
      }
    }
    return null;
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}
/** yt-dlp metadata and available subtitle text only; no media or cookies. */
export async function youtubeRead(
  executable: string,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  nodePath?: string,
) {
  const canonical = validatedSocialUrl(url, "youtube");
  const raw = await socialExec(
    executable,
    [
      "--ignore-config",
      "--no-remote-components",
      ...(nodePath ? ["--js-runtimes", `node:${nodePath}`] : []),
      "--skip-download",
      "--no-playlist",
      // Avoid yt-dlp's massive automatic_captions/formats JSON (often >256 KiB).
      // Each --print emits one JSON-escaped scalar; no subtitle text is claimed.
      ...[
        "id",
        "title",
        "webpage_url",
        "channel",
        "upload_date",
        "description",
      ].flatMap((field) => ["--print", `%(${field})j`]),
      "--",
      canonical,
    ],
    timeoutMs,
    signal,
    { nodePath },
  );
  const fields = [
    "id",
    "title",
    "webpage_url",
    "channel",
    "upload_date",
    "description",
  ] as const;
  const lines = raw.trimEnd().split(/\r?\n/);
  if (lines.length !== fields.length)
    throw new Error(
      "CONTENT_UNAVAILABLE: YouTube returned unexpected metadata fields.",
    );
  const metadata: Record<string, unknown> = {};
  for (let i = 0; i < fields.length; i++) {
    try {
      metadata[fields[i]!] = JSON.parse(lines[i]!) as unknown;
    } catch {
      throw new Error(
        "CONTENT_UNAVAILABLE: YouTube returned invalid metadata.",
      );
    }
  }
  const video = item(metadata);
  const captions = await verifiedCaptions(
    executable,
    canonical,
    timeoutMs,
    signal,
    nodePath,
  );
  if (captions) {
    video.transcript = captions.transcript;
    video.transcriptSource = captions.source;
    video.transcriptLanguage = captions.language;
  }
  return {
    items: [video],
    sourceUrl: canonical,
    completeness: captions ? ("PARTIAL" as const) : ("METADATA_ONLY" as const),
    warnings: captions
      ? [
          `Verified ${captions.source} ${captions.language} captions; transcript is limited to 12000 characters.`,
        ]
      : [
          "TRANSCRIPT_UNAVAILABLE: No accessible verified subtitles. No transcript or summary was generated.",
        ],
  };
}

export async function youtubeSearch(
  executable: string,
  query: string,
  limit: number,
  timeoutMs: number,
  signal?: AbortSignal,
  nodePath?: string,
) {
  if (!query.trim() || query.length > 200 || /[\u0000-\u001f]/.test(query))
    throw new Error(
      "INVALID_INPUT: Search query must contain 1-200 printable characters.",
    );
  const raw = await socialExec(
    executable,
    [
      "--ignore-config",
      "--no-remote-components",
      ...(nodePath ? ["--js-runtimes", `node:${nodePath}`] : []),
      "--flat-playlist",
      "--dump-single-json",
      "--",
      `ytsearch${limit}:${query}`,
    ],
    timeoutMs,
    signal,
    { nodePath },
  );
  const metadata = record(JSON.parse(raw) as unknown);
  const entries = metadata.entries;
  if (!Array.isArray(entries))
    throw new Error(
      "CONTENT_UNAVAILABLE: YouTube search returned unexpected data.",
    );
  const items = entries.slice(0, limit).flatMap((entry) => {
    try {
      return [item(entry)];
    } catch {
      return [];
    }
  });
  return {
    items,
    completeness: "METADATA_ONLY" as const,
    warnings:
      items.length < Math.min(entries.length, limit)
        ? ["Some entries lacked verified YouTube URLs and were omitted."]
        : [],
  };
}
