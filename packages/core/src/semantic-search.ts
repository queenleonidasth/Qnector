import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface SemanticSearchInput {
  workspaceRoot: string;
  path?: string;
  query: string;
  maxResults?: number;
  maxFiles?: number;
  offset?: number;
  minScore?: number;
}

export interface SemanticSearchMatch {
  file: string;
  line: number;
  endLine: number;
  score: number;
  preview: string;
}

export interface SemanticSearchResult {
  engine: "local-hashed-vector-v1";
  query: string;
  matches: SemanticSearchMatch[];
  indexedFiles: number;
  indexedChunks: number;
  fingerprint: string;
  truncated: boolean;
  indexTruncated: boolean;
  totalMatches: number;
  nextOffset?: number;
  skippedFiles: number;
  cache: { readFiles: number; reusedFiles: number };
}

interface IndexedChunk {
  file: string;
  line: number;
  endLine: number;
  text: string;
  vector: Float64Array;
  tokens: Set<string>;
}

interface IndexCache {
  fingerprint: string;
  files: number;
  chunks: IndexedChunk[];
  entries: Map<
    string,
    {
      stamp: string;
      chunks: IndexedChunk[];
      skipped: boolean;
      truncated: boolean;
    }
  >;
  truncated: boolean;
  skippedFiles: number;
  readFiles: number;
  reusedFiles: number;
}

const DIMENSIONS = 512;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS = 10_000;
const MAX_CACHED_ROOTS = 3;
const MAX_SCAN_ENTRIES = 50_000;
const WORD_SEGMENTER = new Intl.Segmenter("th", { granularity: "word" });
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".py",
  ".rs",
  ".go",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".java",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sql",
  ".ps1",
  ".sh",
]);

export class LocalSemanticSearchService {
  private readonly cache = new Map<string, IndexCache>();
  private readonly pending = new Map<string, Promise<IndexCache>>();

  public async search(
    input: SemanticSearchInput,
  ): Promise<SemanticSearchResult> {
    const query = input.query.trim();
    if (!query)
      throw new Error("INVALID_INPUT: semantic search query is required");
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const root = path.resolve(workspaceRoot, input.path ?? ".");
    const maxResults = clamp(input.maxResults ?? 20, 1, 100);
    const maxFiles = clamp(input.maxFiles ?? 2_000, 1, 10_000);
    const offset = clamp(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
    const minScore = input.minScore ?? 0;
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1)
      throw new Error("INVALID_INPUT: minScore must be between 0 and 1");
    const index = await this.getIndex(root, maxFiles);
    const queryVector = vectorize(query);
    const queryTokens = new Set(tokenize(query));
    const ranked = index.chunks
      .map((chunk) => {
        let overlap = 0;
        for (const token of queryTokens)
          if (chunk.tokens.has(token)) overlap += 1;
        // Hashed vectors can collide even when two texts share no words.
        // Require lexical evidence, then boost coverage of the actual query.
        const score =
          overlap === 0
            ? 0
            : 0.65 * (overlap / queryTokens.size) +
              0.35 * cosine(queryVector, chunk.vector);
        return { chunk, score };
      })
      .filter((entry) => entry.score > 0 && entry.score >= minScore)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.chunk.file.localeCompare(right.chunk.file) ||
          left.chunk.line - right.chunk.line,
      );
    const matches = ranked
      .slice(offset, offset + maxResults)
      .map(({ chunk, score }) => ({
        file: displayPath(chunk.file, workspaceRoot),
        line: chunk.line,
        endLine: chunk.endLine,
        score: Number(score.toFixed(4)),
        preview: chunk.text.replace(/\s+/g, " ").trim().slice(0, 500),
      }));
    return {
      engine: "local-hashed-vector-v1",
      query,
      matches,
      indexedFiles: index.files,
      indexedChunks: index.chunks.length,
      fingerprint: index.fingerprint,
      truncated: index.truncated || offset + matches.length < ranked.length,
      indexTruncated: index.truncated,
      totalMatches: ranked.length,
      ...(offset + matches.length < ranked.length
        ? { nextOffset: offset + matches.length }
        : {}),
      skippedFiles: index.skippedFiles,
      cache: { readFiles: index.readFiles, reusedFiles: index.reusedFiles },
    };
  }

  public clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private async getIndex(root: string, maxFiles: number): Promise<IndexCache> {
    const key = `${comparablePath(root)}:${maxFiles}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const build = this.buildIndex(root, maxFiles, key);
    this.pending.set(key, build);
    try {
      const index = await build;
      // clear() may have invalidated this build while filesystem I/O was pending.
      if (this.pending.get(key) === build) {
        this.cache.delete(key);
        this.cache.set(key, index);
        while (this.cache.size > MAX_CACHED_ROOTS)
          this.cache.delete(this.cache.keys().next().value!);
      }
      return index;
    } finally {
      if (this.pending.get(key) === build) this.pending.delete(key);
    }
  }

  private async buildIndex(
    root: string,
    maxFiles: number,
    key: string,
  ): Promise<IndexCache> {
    // Look ahead one file so an exactly full index is not reported as incomplete.
    const discovered = await collectTextFiles(root, maxFiles + 1);
    const files = discovered.files.slice(0, maxFiles);
    const discoveryTruncated =
      discovered.truncated || discovered.files.length > maxFiles;
    const metadata = await mapBounded(files, async (file) => {
      const info = await stat(file).catch(() => null);
      return {
        file,
        size: info?.size ?? 0,
        stamp: info
          ? `${info.mtimeMs}:${info.ctimeMs}:${info.size}`
          : "missing",
      };
    });
    const hash = createHash("sha256");
    for (const entry of metadata)
      hash.update(`${comparablePath(entry.file)}:${entry.stamp}|`);
    hash.update(`truncated:${discoveryTruncated}`);
    const fingerprint = hash.digest("hex").slice(0, 24);
    const cached = this.cache.get(key);
    if (cached?.fingerprint === fingerprint && cached.skippedFiles === 0)
      return { ...cached, readFiles: 0, reusedFiles: cached.entries.size };
    const chunks: IndexedChunk[] = [];
    const entries: IndexCache["entries"] = new Map();
    let readFiles = 0;
    let reusedFiles = 0;
    let skippedFiles = 0;
    let truncated = discoveryTruncated;
    // Bound both I/O concurrency and index memory; do not vectorize later batches
    // after the chunk budget has been exhausted.
    for (let start = 0; start < metadata.length; start += 8) {
      const batch = await Promise.all(
        metadata.slice(start, start + 8).map(async ({ file, size, stamp }) => {
          const previous = cached?.entries.get(file);
          if (
            previous?.stamp === stamp &&
            !previous.skipped &&
            !previous.truncated
          ) {
            reusedFiles += 1;
            return { file, stamp, previous, text: null };
          }
          if (stamp === "missing" || size > MAX_FILE_BYTES) {
            return { file, stamp, previous: undefined, text: null };
          }
          readFiles += 1;
          const text = await readBoundedText(file, size).catch(() => null);
          return { file, stamp, previous: undefined, text };
        }),
      );
      for (const { file, stamp, previous, text } of batch) {
        if (chunks.length >= MAX_CHUNKS) {
          truncated = true;
          break;
        }
        const remaining = MAX_CHUNKS - chunks.length;
        const entry = previous
          ? {
              ...previous,
              chunks: previous.chunks.slice(0, remaining),
              truncated: previous.chunks.length > remaining,
            }
          : {
              stamp,
              ...(text === null
                ? { chunks: [], truncated: false }
                : chunkFile(file, text, remaining)),
              skipped: text === null,
            };
        entries.set(file, entry);
        chunks.push(...entry.chunks);
        truncated ||= entry.truncated;
        if (entry.skipped) skippedFiles += 1;
      }
      if (chunks.length >= MAX_CHUNKS) {
        truncated = true;
        break;
      }
    }
    return {
      fingerprint,
      files: entries.size - skippedFiles,
      chunks,
      entries,
      truncated: truncated || skippedFiles > 0,
      skippedFiles,
      readFiles,
      reusedFiles,
    };
  }
}

function chunkFile(
  file: string,
  text: string,
  limit: number,
): { chunks: IndexedChunk[]; truncated: boolean } {
  const chunks: IndexedChunk[] = [];
  let truncated = false;
  const lines = text.split(/\r?\n/);
  const chunkLines = 24;
  const overlap = 6;
  for (let start = 0; start < lines.length; start += chunkLines - overlap) {
    const end = Math.min(lines.length, start + chunkLines);
    const chunkText = lines.slice(start, end).join("\n").trim();
    if (!chunkText) continue;
    if (chunkText.length > 8_000) truncated = true;
    const searchable = `${path.basename(file)} ${chunkText.slice(0, 8_000)}`;
    const tokens = tokenize(searchable);
    chunks.push({
      file,
      line: start + 1,
      endLine: end,
      text: chunkText.slice(0, 8_000),
      vector: vectorizeTokens(tokens),
      tokens: new Set(tokens),
    });
    if (end >= lines.length) break;
    if (chunks.length >= limit) {
      truncated = true;
      break;
    }
  }
  return { chunks, truncated };
}

async function readBoundedText(
  file: string,
  expectedSize: number,
): Promise<string | null> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min(expectedSize + 1, MAX_FILE_BYTES + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > expectedSize || length > MAX_FILE_BYTES) return null;
    const text = buffer.subarray(0, length).toString("utf8");
    return text.includes("\u0000") ? null : text;
  } finally {
    await handle.close();
  }
}

async function mapBounded<T, R>(
  values: T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  for (let start = 0; start < values.length; start += 8)
    result.push(
      ...(await Promise.all(values.slice(start, start + 8).map(mapper))),
    );
  return result;
}

async function collectTextFiles(
  root: string,
  maxFiles: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo) throw new Error(`ENOENT: ${root}`);
  if (rootInfo.isFile())
    return { files: isTextFile(root) ? [root] : [], truncated: false };
  const files: string[] = [];
  const queue = [root];
  let visited = 0;
  let truncated = false;
  for (
    let cursor = 0;
    cursor < queue.length && files.length < maxFiles;
    cursor += 1
  ) {
    const current = queue[cursor]!;
    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => {
        truncated = true;
        return [];
      },
    );
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_SCAN_ENTRIES) return { files, truncated: true };
      if (
        [
          "node_modules",
          ".git",
          "dist",
          "release",
          ".turbo",
          "coverage",
        ].includes(entry.name)
      )
        continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      else if (entry.isFile() && isTextFile(absolute)) files.push(absolute);
      if (files.length >= maxFiles) break;
    }
  }
  return { files, truncated };
}

function isTextFile(file: string): boolean {
  return (
    TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) ||
    ["Dockerfile", "Makefile"].includes(path.basename(file))
  );
}

export function localSemanticSimilarity(query: string, text: string): number {
  if (!query.trim() || !text.trim()) return 0;
  return cosine(vectorize(query), vectorize(text));
}

function vectorize(text: string): Float64Array {
  return vectorizeTokens(tokenize(text));
}

function vectorizeTokens(tokens: string[]): Float64Array {
  const vector = new Float64Array(DIMENSIONS);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of counts) {
    addFeature(vector, token, count);
    if (token.length >= 5) {
      for (let index = 0; index <= token.length - 3; index += 1)
        addFeature(vector, `#${token.slice(index, index + 3)}`, 0.22 * count);
    }
  }
  normalize(vector);
  return vector;
}

function tokenize(text: string): string[] {
  const normalized = text
    .normalize("NFC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");
  const words = normalized.split(/\s+/).flatMap((word) =>
    /\p{Script=Thai}/u.test(word)
      ? Array.from(WORD_SEGMENTER.segment(word))
          .filter((part) => part.isWordLike)
          .map((part) => part.segment)
      : [word],
  );
  return words
    .map(stem)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    .slice(0, 20_000);
}

function stem(token: string): string {
  if (/^[a-z]+$/.test(token)) {
    for (const suffix of [
      "ization",
      "ational",
      "fulness",
      "iveness",
      "ments",
      "ment",
      "ingly",
      "edly",
      "ing",
      "ed",
      "ies",
      "es",
      "s",
    ]) {
      if (token.length > suffix.length + 3 && token.endsWith(suffix))
        return token.slice(0, -suffix.length) + (suffix === "ies" ? "y" : "");
    }
  }
  return token;
}

function addFeature(
  vector: Float64Array,
  feature: string,
  weight: number,
): void {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const slot = (hash >>> 0) % DIMENSIONS;
  vector[slot] = (vector[slot] ?? 0) + weight;
}

function normalize(vector: Float64Array): void {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!norm) return;
  for (let index = 0; index < vector.length; index += 1)
    vector[index] = (vector[index] ?? 0) / norm;
}

function cosine(left: Float64Array, right: Float64Array): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1)
    score += left[index]! * right[index]!;
  return score;
}

function displayPath(file: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, file);
  return (relative && !relative.startsWith("..") ? relative : file).replaceAll(
    "\\",
    "/",
  );
}

function comparablePath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value))
    throw new Error("INVALID_INPUT: search limits must be finite numbers");
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "return",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "interface",
  "type",
  "class",
  "public",
  "private",
  "protected",
  "string",
  "number",
  "boolean",
  "object",
]);
