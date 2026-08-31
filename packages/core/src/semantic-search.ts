import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface SemanticSearchInput {
  workspaceRoot: string;
  path?: string;
  query: string;
  maxResults?: number;
  maxFiles?: number;
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
}

interface IndexedChunk {
  file: string;
  line: number;
  endLine: number;
  text: string;
  vector: Float64Array;
}

interface IndexCache {
  fingerprint: string;
  files: number;
  chunks: IndexedChunk[];
}

const DIMENSIONS = 512;
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
    const index = await this.getIndex(workspaceRoot, root, maxFiles);
    const queryVector = vectorize(query);
    const matches = index.chunks
      .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.vector) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.chunk.file.localeCompare(right.chunk.file),
      )
      .slice(0, maxResults)
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
      truncated: index.files >= maxFiles,
    };
  }

  public clear(): void {
    this.cache.clear();
  }

  private async getIndex(
    workspaceRoot: string,
    root: string,
    maxFiles: number,
  ): Promise<IndexCache> {
    const files = await collectTextFiles(root, maxFiles);
    const fingerprint = await fingerprintFiles(files);
    const key = `${comparablePath(root)}:${maxFiles}`;
    const cached = this.cache.get(key);
    if (cached?.fingerprint === fingerprint) return cached;
    const chunks: IndexedChunk[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8").catch(() => "");
      if (!text || text.includes("\u0000")) continue;
      const lines = text.split(/\r?\n/);
      const chunkLines = 24;
      const overlap = 6;
      for (let start = 0; start < lines.length; start += chunkLines - overlap) {
        const end = Math.min(lines.length, start + chunkLines);
        const chunkText = lines.slice(start, end).join("\n").trim();
        if (chunkText.length < 20) continue;
        chunks.push({
          file,
          line: start + 1,
          endLine: end,
          text: chunkText.slice(0, 8_000),
          vector: vectorize(`${path.basename(file)} ${chunkText}`),
        });
        if (end >= lines.length) break;
      }
    }
    const index = { fingerprint, files: files.length, chunks };
    this.cache.set(key, index);
    return index;
  }
}

async function collectTextFiles(
  root: string,
  maxFiles: number,
): Promise<string[]> {
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo) throw new Error(`ENOENT: ${root}`);
  if (rootInfo.isFile()) return isTextFile(root) ? [root] : [];
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(
      () => [],
    );
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
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
  return files;
}

function isTextFile(file: string): boolean {
  return (
    TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) ||
    ["Dockerfile", "Makefile"].includes(path.basename(file))
  );
}

async function fingerprintFiles(files: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of files) {
    const info = await stat(file).catch(() => null);
    hash.update(
      `${comparablePath(file)}:${info?.mtimeMs ?? 0}:${info?.size ?? 0}|`,
    );
  }
  return hash.digest("hex").slice(0, 24);
}

function vectorize(text: string): Float64Array {
  const vector = new Float64Array(DIMENSIONS);
  const tokens = tokenize(text);
  for (const token of tokens) {
    addFeature(vector, token, 1);
    if (token.length >= 5) {
      for (let index = 0; index <= token.length - 3; index += 1)
        addFeature(vector, `#${token.slice(index, index + 3)}`, 0.22);
    }
  }
  normalize(vector);
  return vector;
}

function tokenize(text: string): string[] {
  const normalized = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ");
  return normalized
    .split(/\s+/)
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
  "import",
  "export",
  "public",
  "private",
  "protected",
  "string",
  "number",
  "boolean",
  "object",
]);
