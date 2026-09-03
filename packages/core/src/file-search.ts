import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FileSearchProviderName = "auto" | "everything" | "fallback";

export interface FileSearchInput {
  query: string;
  provider?: FileSearchProviderName;
  maxResults?: number;
  offset?: number;
  details?: boolean;
  workspaceRoot?: string;
}

export interface FileSearchMatch {
  path: string;
  name: string;
  extension: string;
  size?: number;
  modifiedAt?: string;
}

export interface FileSearchResult {
  provider: Exclude<FileSearchProviderName, "auto">;
  query: string;
  matches: FileSearchMatch[];
  totalReturned: number;
  offset: number;
  maxResults: number;
  truncated: boolean;
  warning?: string;
}

export interface FileSearchService {
  search(input: FileSearchInput): Promise<FileSearchResult>;
  status?(): Promise<{
    everythingAvailable: boolean;
    executablePath: string | null;
    fallbackAvailable: true;
  }>;
}

interface FileSearchRuntime {
  platform: NodeJS.Platform;
  findEverythingExecutable(): Promise<string | null>;
  runExecutable(
    executable: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }>;
  fallbackRoots(workspaceRoot?: string): string[];
}

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS = 1_000;
const FALLBACK_ENTRY_BUDGET = 50_000;
let everythingExecutablePromise: Promise<string | null> | undefined;

export class WindowsFileSearchService implements FileSearchService {
  public constructor(
    private readonly runtime: FileSearchRuntime = defaultRuntime(),
  ) {}

  public async status(): Promise<{
    everythingAvailable: boolean;
    executablePath: string | null;
    fallbackAvailable: true;
  }> {
    const executablePath = await this.runtime.findEverythingExecutable();
    return {
      everythingAvailable: Boolean(executablePath),
      executablePath,
      fallbackAvailable: true,
    };
  }

  public async search(input: FileSearchInput): Promise<FileSearchResult> {
    const query = input.query.trim();
    if (!query) throw new Error("INVALID_INPUT: query is required");
    const provider = input.provider ?? "auto";
    if (!["auto", "everything", "fallback"].includes(provider))
      throw new Error(
        "INVALID_INPUT: provider must be auto, everything, or fallback",
      );
    const maxResults = Math.max(
      1,
      Math.min(
        Math.floor(input.maxResults ?? DEFAULT_MAX_RESULTS),
        MAX_RESULTS,
      ),
    );
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const details = input.details !== false;

    if (provider !== "fallback") {
      const executable = await this.runtime.findEverythingExecutable();
      if (executable) {
        try {
          return await this.searchEverything(
            executable,
            query,
            offset,
            maxResults,
            details,
          );
        } catch (error) {
          if (provider === "everything") throw error;
        }
      } else if (provider === "everything") {
        throw new Error(
          "EVERYTHING_UNAVAILABLE: es.exe was not found. Install Everything CLI or use provider='fallback'.",
        );
      }
    }

    return this.searchFallback(
      query,
      offset,
      maxResults,
      details,
      input.workspaceRoot,
    );
  }

  private async searchEverything(
    executable: string,
    query: string,
    offset: number,
    maxResults: number,
    details: boolean,
  ): Promise<FileSearchResult> {
    const requested = Math.min(
      offset + maxResults + 1,
      MAX_RESULTS + offset + 1,
    );
    let result: { stdout: string; stderr: string };
    try {
      result = await this.runtime.runExecutable(executable, [
        "-n",
        String(requested),
        query,
      ]);
    } catch (error) {
      throw new Error(
        `EVERYTHING_SEARCH_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const paths = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const selected = paths.slice(offset, offset + maxResults);
    const matches = await Promise.all(
      selected.map((entry) => fileMatch(entry, details)),
    );
    const truncated = paths.length > offset + selected.length;
    return {
      provider: "everything",
      query,
      matches,
      totalReturned: matches.length,
      offset,
      maxResults,
      truncated,
    };
  }

  private async searchFallback(
    query: string,
    offset: number,
    maxResults: number,
    details: boolean,
    workspaceRoot?: string,
  ): Promise<FileSearchResult> {
    const matcher = createFallbackMatcher(query);
    const roots = uniqueExistingRoots(
      this.runtime.fallbackRoots(workspaceRoot),
    );
    const wanted = offset + maxResults + 1;
    const paths: string[] = [];
    let visited = 0;
    const seen = new Set<string>();

    for (const root of roots) {
      const queue = [root];
      while (queue.length > 0 && visited < FALLBACK_ENTRY_BUDGET) {
        // Read a small deterministic BFS batch concurrently. Processing still
        // happens in queue order, so result ordering remains identical to the
        // serial fallback while slow network/filesystem directories no longer
        // block every other directory behind one readdir call.
        const batch = queue.splice(0, 8);
        const batches = await Promise.all(
          batch.map(async (current) => {
            try {
              const entries = await readdir(current, { withFileTypes: true });
              entries.sort((left, right) =>
                left.name.localeCompare(right.name),
              );
              return { current, entries };
            } catch {
              return { current, entries: [] };
            }
          }),
        );
        for (const { current, entries } of batches) {
          for (const entry of entries) {
            visited += 1;
            if (visited > FALLBACK_ENTRY_BUDGET) break;
            const absolute = path.join(current, entry.name);
            const key = comparablePath(absolute);
            if (seen.has(key)) continue;
            seen.add(key);
            if (entry.isDirectory()) {
              if (!skipFallbackDirectory(entry.name)) queue.push(absolute);
              continue;
            }
            if (!entry.isFile()) continue;
            if (matcher(absolute)) paths.push(absolute);
            if (paths.length >= wanted) break;
          }
          if (paths.length >= wanted || visited >= FALLBACK_ENTRY_BUDGET) break;
        }
        if (paths.length >= wanted) break;
      }
      if (paths.length >= wanted || visited >= FALLBACK_ENTRY_BUDGET) break;
    }

    const selected = paths.slice(offset, offset + maxResults);
    const matches = await Promise.all(
      selected.map((entry) => fileMatch(entry, details)),
    );
    const budgetHit = visited >= FALLBACK_ENTRY_BUDGET;
    const truncated = paths.length > offset + selected.length || budgetHit;
    return {
      provider: "fallback",
      query,
      matches,
      totalReturned: matches.length,
      offset,
      maxResults,
      truncated,
      warning: budgetHit
        ? `Fallback search stopped after ${FALLBACK_ENTRY_BUDGET} filesystem entries. Install Everything/es.exe for fast complete filename search.`
        : "Fallback search is bounded and may be less complete than Everything/es.exe.",
    };
  }
}

function defaultRuntime(): FileSearchRuntime {
  return {
    platform: process.platform,
    findEverythingExecutable: findEverythingExecutable,
    runExecutable: async (executable, args) =>
      execFileAsync(executable, args, {
        windowsHide: true,
        maxBuffer: 8_000_000,
      }),
    fallbackRoots: (workspaceRoot) => defaultFallbackRoots(workspaceRoot),
  };
}

async function findEverythingExecutable(): Promise<string | null> {
  everythingExecutablePromise ??= probeEverythingExecutable();
  return everythingExecutablePromise;
}

async function probeEverythingExecutable(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  try {
    const result = await execFileAsync("where.exe", ["es.exe"], {
      windowsHide: true,
    });
    const first = result.stdout.split(/\r?\n/).find(Boolean)?.trim();
    if (first) return first;
  } catch {
    // Continue with common install locations.
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = [
    process.env.QNECTOR_EVERYTHING_CLI,
    resourcesPath
      ? path.join(resourcesPath, "everything-cli", "es.exe")
      : undefined,
    path.join(process.cwd(), "tools", "everything-cli", "es.exe"),
    path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "Microsoft",
      "WinGet",
      "Links",
      "es.exe",
    ),
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Everything",
      "es.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Everything",
      "es.exe",
    ),
    path.join(os.homedir(), "scoop", "apps", "everything", "current", "es.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function defaultFallbackRoots(workspaceRoot?: string): string[] {
  const roots: string[] = [];
  if (workspaceRoot) roots.push(path.resolve(workspaceRoot));
  roots.push(os.homedir());
  if (process.platform === "win32") {
    for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) roots.push(drive);
    }
  } else roots.push("/");
  return roots;
}

function uniqueExistingRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const resolved = path.resolve(root);
    const key = comparablePath(resolved);
    if (seen.has(key) || !existsSync(resolved)) return false;
    seen.add(key);
    return true;
  });
}

async function fileMatch(
  file: string,
  details: boolean,
): Promise<FileSearchMatch> {
  const base: FileSearchMatch = {
    path: file,
    name: path.basename(file),
    extension: path.extname(file),
  };
  if (!details) return base;
  try {
    const info = await stat(file);
    return {
      ...base,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  } catch {
    return base;
  }
}

function createFallbackMatcher(query: string): (file: string) => boolean {
  const tokens = tokenizeQuery(query);
  const extensionTokens = tokens
    .filter((token) => /^ext:/i.test(token))
    .flatMap((token) => token.slice(4).split(/[;,|]/))
    .map((entry) => entry.replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  const pathTokens = tokens
    .filter((token) => /^path:/i.test(token))
    .map((token) => token.slice(5).toLowerCase())
    .filter(Boolean);
  const plainTokens = tokens.filter(
    (token) => !/^ext:/i.test(token) && !/^path:/i.test(token),
  );
  const regexes = plainTokens.map(wildcardRegex);
  return (file) => {
    const normalized = file.replaceAll("\\", "/").toLowerCase();
    const extension = path.extname(file).slice(1).toLowerCase();
    if (extensionTokens.length > 0 && !extensionTokens.includes(extension))
      return false;
    if (
      pathTokens.some(
        (token) => !normalized.includes(token.replaceAll("\\", "/")),
      )
    )
      return false;
    return regexes.every((regex) => regex.test(normalized));
  };
}

function tokenizeQuery(query: string): string[] {
  return (query.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? []).map(
    (token) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      )
        return token.slice(1, -1);
      return token;
    },
  );
}

function wildcardRegex(token: string): RegExp {
  const normalized = token.replaceAll("\\", "/").toLowerCase();
  if (!/[?*]/.test(normalized)) return new RegExp(escapeRegex(normalized), "i");
  const source = [...normalized]
    .map((character) =>
      character === "*"
        ? ".*"
        : character === "?"
          ? "."
          : escapeRegex(character),
    )
    .join("");
  return new RegExp(source, "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skipFallbackDirectory(name: string): boolean {
  return [
    ".git",
    "node_modules",
    "$Recycle.Bin",
    "System Volume Information",
    "Windows",
    "WinSxS",
  ].includes(name);
}

function comparablePath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
