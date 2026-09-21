import { parseDocument } from "yaml";
import { socialExec, validatedSocialUrl } from "../command-runner.js";
import type { SocialItem } from "../types.js";

function outputItems(raw: string, limit: number): SocialItem[] {
  const doc = parseDocument(raw, { uniqueKeys: true, strict: true });
  if (doc.errors.length)
    throw new Error(
      "CONTENT_UNAVAILABLE: OpenCLI returned invalid structured output.",
    );
  const parsed: unknown = doc.toJS({ maxAliasCount: 0 });
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).results
      : undefined;
  if (!Array.isArray(rows))
    throw new Error(
      "CONTENT_UNAVAILABLE: OpenCLI output format is not verified for this operation.",
    );
  return rows.slice(0, limit).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const rawUrl = row.url ?? row.link ?? row.profile_url;
    if (typeof rawUrl !== "string") return [];
    let url: string;
    try {
      url = validatedSocialUrl(rawUrl, "facebook");
    } catch {
      return [];
    }
    const text = (v: unknown, max: number) =>
      typeof v === "string" ? v.slice(0, max) : undefined;
    return [
      {
        url,
        title: text(row.title ?? row.name, 300),
        author: text(row.author, 150),
        publishedAt: text(row.date, 32),
        excerpt: text(row.description ?? row.text, 1200),
      },
    ];
  });
}

/** OpenCLI Chrome-extension calls require separately verified user authorization. */
export async function facebookSearch(
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
    ["facebook", "search", query, "--limit", String(limit), "-f", "yaml"],
    timeoutMs,
    signal,
    { nodePath },
  );
  return {
    items: outputItems(raw, limit),
    completeness: "PARTIAL" as const,
    warnings: [
      "Only verified Facebook URLs returned by the authenticated session are included; completeness cannot be guaranteed.",
    ],
  };
}
