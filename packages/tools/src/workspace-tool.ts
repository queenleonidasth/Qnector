import { existsSync } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_RESULTS = 200;
let cachedRipgrepExecutable: string | null | undefined;

export const workspaceDefinition: ToolDefinition = {
  name: "workspace",
  description:
    "Manage the active Qnector workspace and inspect project context. Relative paths resolve from the active workspace; absolute paths are supported. Search actions paginate results. This tool searches filesystem/project files only; it does not capture the monitor. For a screenshot of the current display or window, call system with action screen_capture instead of searching workspace images.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "get",
          "set",
          "list_recent",
          "tree",
          "list",
          "glob",
          "grep",
          "stat",
          "summary",
          "diagnostics",
          "document_symbols",
          "definition",
          "references",
          "hover",
          "rename_locations",
          "workspace_symbols",
          "semantic_search",
          "lsp_status",
          "lsp_document_symbols",
          "lsp_workspace_symbols",
          "lsp_definition",
          "lsp_references",
          "lsp_hover",
          "watch",
          "watch_events",
          "unwatch",
          "wait_for_file",
          "wait_for_change",
        ],
      },
      path: { type: "string" },
      tsconfig: { type: "string" },
      severity: {
        type: "string",
        enum: ["error", "warning", "suggestion", "message"],
      },
      pattern: { type: "string" },
      query: { type: "string" },
      glob: { type: "string" },
      watchId: { type: "string" },
      cursor: { type: "integer", minimum: 0 },
      recursive: { type: "boolean" },
      timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
      intervalMs: { type: "integer", minimum: 50, maximum: 5000 },
      maxFiles: { type: "integer", minimum: 1, maximum: 10000 },
      serverCommand: { type: "string" },
      serverArgs: { type: "array", items: { type: "string" }, maxItems: 20 },
      line: { type: "integer", minimum: 1 },
      column: { type: "integer", minimum: 1 },
      maxResults: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      includeHidden: { type: "boolean" },
      details: {
        type: "boolean",
        description:
          "Return expanded project/memory context. Defaults to false for a compact high-signal summary.",
      },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

interface WalkEntry {
  absolute: string;
  relative: string;
  type: "file" | "directory";
  size?: number;
}

export async function executeWorkspace(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "workspace", action, input, async () => {
    if (action === "get") {
      const config = context.getConfig();
      return {
        summary: `Active workspace is ${config.activeWorkspace}`,
        data: {
          path: config.activeWorkspace,
          recentWorkspaces: config.recentWorkspaces,
        },
      };
    }
    if (action === "set") {
      const workspace = stringInput(object, "path", true)!;
      const resolved = context.workspace.resolve(workspace);
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error(`NOT_DIRECTORY: ${resolved}`);
      const next = await context.workspace.set(resolved);
      await context.setConfig(next);
      return {
        summary: `Active workspace set to ${next.activeWorkspace}`,
        data: {
          path: next.activeWorkspace,
          recentWorkspaces: next.recentWorkspaces,
        },
      };
    }
    if (action === "list_recent") {
      const recent = context.workspace.recent();
      return {
        summary: `${recent.length} recent workspace(s)`,
        data: { workspaces: recent },
      };
    }
    if (action === "stat") {
      const target = context.workspace.resolve(
        stringInput(object, "path") ?? ".",
      );
      const info = await stat(target);
      return {
        summary: `Stat ${target}`,
        data: {
          path: target,
          type: info.isDirectory() ? "directory" : "file",
          size: info.size,
          mode: info.mode,
          modifiedAt: info.mtime.toISOString(),
          createdAt: info.birthtime.toISOString(),
        },
      };
    }
    const root = context.workspace.resolve(stringInput(object, "path") ?? ".");
    const maxResults = Math.max(
      1,
      Math.min(numberInput(object, "maxResults", DEFAULT_MAX_RESULTS), 2000),
    );
    const offset = Math.max(0, numberInput(object, "offset", 0));
    const includeHidden = booleanInput(object, "includeHidden", false);
    if (action === "workspace_symbols") {
      if (!context.codeIntelligence)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: Code Intelligence is not available in this Qnector runtime",
        );
      const result = await context.codeIntelligence.workspaceSymbols({
        workspaceRoot: context.getConfig().activeWorkspace,
        query: stringInput(object, "query", true)!,
        tsconfig: stringInput(object, "tsconfig"),
        maxResults,
        offset,
      });
      return {
        summary: `Workspace symbol search returned ${result.symbols.length} of ${result.total} symbol(s)`,
        data: result,
        truncated: result.truncated,
        nextCursor: result.nextOffset,
      };
    }
    if (action === "semantic_search") {
      if (!context.semanticSearch)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: local semantic search is not configured in this Qnector runtime",
        );
      const result = await context.semanticSearch.search({
        workspaceRoot: context.getConfig().activeWorkspace,
        path: stringInput(object, "path") ?? ".",
        query: stringInput(object, "query", true)!,
        maxResults,
        maxFiles: numberInput(object, "maxFiles", 2_000),
      });
      return {
        summary: `Local semantic search returned ${result.matches.length} match(es) from ${result.indexedFiles} indexed file(s)`,
        data: result,
        truncated: result.truncated,
      };
    }
    if (action === "lsp_status") {
      if (!context.genericLsp)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: generic LSP adapters are not configured in this Qnector runtime",
        );
      const servers = context.genericLsp.status();
      return {
        summary: `Detected ${servers.filter((entry) => entry.available).length} available generic language server(s)`,
        data: { servers },
      };
    }
    if (action.startsWith("lsp_")) {
      if (!context.genericLsp)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: generic LSP adapters are not configured in this Qnector runtime",
        );
      const actionMap = {
        lsp_document_symbols: "document_symbols",
        lsp_workspace_symbols: "workspace_symbols",
        lsp_definition: "definition",
        lsp_references: "references",
        lsp_hover: "hover",
      } as const;
      const lspAction = actionMap[action as keyof typeof actionMap];
      if (!lspAction)
        throw new Error(
          `INVALID_ACTION: Unknown generic LSP action '${action}'`,
        );
      const serverArgs = Array.isArray(object.serverArgs)
        ? object.serverArgs.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : undefined;
      const result = await context.genericLsp.request({
        workspaceRoot: context.getConfig().activeWorkspace,
        path: stringInput(object, "path"),
        action: lspAction,
        query: stringInput(object, "query"),
        line: typeof object.line === "number" ? object.line : undefined,
        column: typeof object.column === "number" ? object.column : undefined,
        maxResults,
        serverCommand: stringInput(object, "serverCommand"),
        serverArgs,
      });
      return {
        summary: `Generic LSP ${lspAction} completed via ${result.server}`,
        data: result,
        truncated: result.truncated,
      };
    }
    if (
      [
        "watch",
        "watch_events",
        "unwatch",
        "wait_for_file",
        "wait_for_change",
      ].includes(action)
    ) {
      if (!context.fileWatch)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: filesystem watch service is not configured in this Qnector runtime",
        );
      if (action === "watch") {
        const snapshot = context.fileWatch.start({
          root,
          pattern: stringInput(object, "pattern"),
          recursive: booleanInput(object, "recursive", true),
        });
        return {
          summary: `Started filesystem watch ${snapshot.watchId}`,
          data: snapshot,
        };
      }
      if (action === "watch_events") {
        const watchId = stringInput(object, "watchId", true)!;
        const events = context.fileWatch.events(
          watchId,
          numberInput(object, "cursor", 0),
          maxResults,
        );
        return {
          summary: `Read ${events.events.length} filesystem event(s) from ${watchId}`,
          data: events,
          truncated: events.truncated,
          nextCursor: events.nextCursor,
        };
      }
      if (action === "unwatch") {
        const watchId = stringInput(object, "watchId", true)!;
        const snapshot = context.fileWatch.stop(watchId);
        return {
          summary: `Stopped filesystem watch ${watchId}`,
          data: snapshot,
        };
      }
      if (action === "wait_for_file") {
        const result = await context.fileWatch.waitForFile({
          root,
          pattern: stringInput(object, "pattern", true)!,
          timeoutMs: numberInput(object, "timeoutMs", 30_000),
          intervalMs: numberInput(object, "intervalMs", 250),
          maxResults,
        });
        return {
          summary: `Detected ${result.matches.length} matching file(s) after ${result.elapsedMs} ms`,
          data: result,
        };
      }
      const result = await context.fileWatch.waitForChange({
        path: root,
        timeoutMs: numberInput(object, "timeoutMs", 30_000),
        intervalMs: numberInput(object, "intervalMs", 250),
      });
      return {
        summary: `Detected filesystem change after ${result.elapsedMs} ms`,
        data: result,
      };
    }
    if (action === "diagnostics") {
      if (!context.codeIntelligence)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: Code Intelligence is not available in this Qnector runtime",
        );
      const severity = stringInput(object, "severity") as
        "error" | "warning" | "suggestion" | "message" | undefined;
      if (
        severity &&
        !["error", "warning", "suggestion", "message"].includes(severity)
      )
        throw new Error(
          "INVALID_INPUT: severity must be error, warning, suggestion, or message",
        );
      const result = await context.codeIntelligence.diagnostics({
        workspaceRoot: context.getConfig().activeWorkspace,
        path: root,
        tsconfig: stringInput(object, "tsconfig"),
        severity,
        maxResults,
        offset,
      });
      return {
        summary: `TypeScript diagnostics returned ${result.diagnostics.length} of ${result.total} issue(s)`,
        data: result,
        truncated: result.truncated,
        nextCursor: result.nextOffset,
      };
    }
    if (
      [
        "document_symbols",
        "definition",
        "references",
        "hover",
        "rename_locations",
      ].includes(action)
    ) {
      if (!context.codeIntelligence)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: Code Intelligence is not available in this Qnector runtime",
        );
      const sourcePath = stringInput(object, "path", true)!;
      const common = {
        workspaceRoot: context.getConfig().activeWorkspace,
        path: sourcePath,
        tsconfig: stringInput(object, "tsconfig"),
        maxResults,
        offset,
      };
      if (action === "document_symbols") {
        const result = await context.codeIntelligence.documentSymbols(common);
        return {
          summary: `Found ${result.symbols.length} of ${result.total} symbol(s) in ${sourcePath}`,
          data: result,
          truncated: result.truncated,
          nextCursor: result.nextOffset,
        };
      }
      const positioned = {
        ...common,
        line: numberInput(object, "line", Number.NaN),
        column: numberInput(object, "column", Number.NaN),
      };
      if (action === "hover") {
        const result = await context.codeIntelligence.hover(positioned);
        return {
          summary: result
            ? `Hover information found at ${sourcePath}:${positioned.line}:${positioned.column}`
            : `No hover information at ${sourcePath}:${positioned.line}:${positioned.column}`,
          data: { hover: result },
        };
      }
      const result =
        action === "definition"
          ? await context.codeIntelligence.definition(positioned)
          : action === "references"
            ? await context.codeIntelligence.references(positioned)
            : await context.codeIntelligence.renameLocations(positioned);
      return {
        summary: `${action} returned ${result.locations.length} of ${result.total} location(s)`,
        data: result,
        truncated: result.truncated,
        nextCursor: result.nextOffset,
      };
    }
    if (action === "list" || action === "tree" || action === "glob") {
      const entries = await walk(root, includeHidden, 20_000);
      const filtered =
        action === "glob"
          ? entries.filter((entry) =>
              matchGlob(entry.relative, stringInput(object, "glob", true)!),
            )
          : entries;
      const selected = filtered.slice(offset, offset + maxResults);
      return {
        summary: `${action} returned ${selected.length} of ${filtered.length} entries`,
        data: {
          root,
          entries: action === "tree" ? toTree(selected) : selected,
          total: filtered.length,
          offset,
          maxResults,
          truncated: offset + selected.length < filtered.length,
          nextOffset:
            offset + selected.length < filtered.length
              ? offset + selected.length
              : null,
        },
        truncated: offset + selected.length < filtered.length,
        nextCursor:
          offset + selected.length < filtered.length
            ? offset + selected.length
            : null,
      };
    }
    if (action === "grep") {
      const pattern = stringInput(object, "pattern", true)!;
      const glob = stringInput(object, "glob");
      const requiredMatches = offset + maxResults + 1;
      const ripgrep = await tryRipgrep({
        root,
        pattern,
        glob,
        includeHidden,
        maxMatches: requiredMatches,
      });
      const matches =
        ripgrep ??
        (await grepWithNode({
          root,
          pattern,
          glob,
          includeHidden,
          maxMatches: requiredMatches,
        }));
      const hasMore = matches.length > offset + maxResults;
      const selected = matches.slice(offset, offset + maxResults);
      return {
        summary: `grep found ${selected.length} match(es) via ${ripgrep ? "ripgrep" : "Node fallback"}`,
        data: {
          matches: selected,
          total: matches.length,
          totalExact: !hasMore,
          offset,
          maxResults,
          provider: ripgrep ? "ripgrep" : "node",
          truncated: hasMore,
        },
        truncated: hasMore,
        nextCursor: hasMore ? offset + selected.length : null,
      };
    }
    if (action === "summary") {
      return {
        summary: `Summary for ${root}`,
        data: await projectSummary(
          root,
          context,
          booleanInput(object, "details", false),
        ),
      };
    }
    throw new Error(`INVALID_ACTION: Unknown workspace action '${action}'`);
  });
}

interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

interface GrepOptions {
  root: string;
  pattern: string;
  glob?: string;
  includeHidden: boolean;
  maxMatches: number;
}

async function tryRipgrep(options: GrepOptions): Promise<GrepMatch[] | null> {
  let rootInfo;
  try {
    rootInfo = await stat(options.root);
  } catch {
    return null;
  }
  if (!rootInfo.isDirectory()) return null;

  const args = [
    "--line-number",
    "--with-filename",
    "--no-heading",
    "--color",
    "never",
    "--no-messages",
    "--max-columns",
    "1000",
    "--max-columns-preview",
  ];
  if (options.includeHidden) args.push("--hidden");
  for (const excluded of [
    "!node_modules/**",
    "!.git/**",
    "!dist/**",
    "!release/**",
  ]) {
    args.push("-g", excluded);
  }
  if (options.glob) args.push("-g", options.glob.replaceAll("\\", "/"));
  args.push("--", options.pattern, ".");

  const executable = await resolveRipgrepExecutable();
  if (!executable) return null;
  try {
    const result = await execFileAsync(executable, args, {
      cwd: options.root,
      windowsHide: true,
      maxBuffer: 4_000_000,
    });
    return parseRipgrepOutput(result.stdout, options.maxMatches);
  } catch (error) {
    const candidate = error as { code?: string | number; stdout?: string };
    if (candidate.code === 1) return [];
    if (candidate.code === "ENOENT") return null;
    // Keep JavaScript regex compatibility if rg rejects a pattern or the output
    // exceeds the bounded buffer.
    return null;
  }
}

async function resolveRipgrepExecutable(): Promise<string | null> {
  if (cachedRipgrepExecutable !== undefined) return cachedRipgrepExecutable;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const candidates = [
    process.env.QNECTOR_RIPGREP_PATH,
    process.env.QNECTOR_RG_PATH,
    resourcesPath ? path.join(resourcesPath, "ripgrep", "rg.exe") : undefined,
    process.platform === "win32"
      ? path.join(process.cwd(), "tools", "ripgrep", "rg.exe")
      : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedRipgrepExecutable = candidate;
      return candidate;
    }
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const name = process.platform === "win32" ? "rg.exe" : "rg";
  try {
    const result = await execFileAsync(locator, [name], { windowsHide: true });
    const located = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    cachedRipgrepExecutable = located ?? null;
  } catch {
    cachedRipgrepExecutable = null;
  }
  return cachedRipgrepExecutable;
}

function parseRipgrepOutput(stdout: string, maxMatches: number): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const row of stdout.split(/\r?\n/)) {
    if (!row) continue;
    const match = /^(.*?):(\d+):(.*)$/.exec(row);
    if (!match) continue;
    matches.push({
      path: path.normalize(match[1]!.replace(/^\.\//, "")),
      line: Number(match[2]),
      text: match[3]!.slice(0, 400),
    });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

async function grepWithNode(options: GrepOptions): Promise<GrepMatch[]> {
  const regex = new RegExp(options.pattern, "gm");
  const entries = (
    await walk(options.root, options.includeHidden, 20_000)
  ).filter(
    (entry) =>
      entry.type === "file" &&
      (!options.glob || matchGlob(entry.relative, options.glob)),
  );
  const matches: GrepMatch[] = [];
  for (const entry of entries) {
    if (matches.length >= options.maxMatches) break;
    try {
      const text = await readFile(entry.absolute, "utf8");
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        regex.lastIndex = 0;
        if (regex.test(line))
          matches.push({
            path: entry.relative,
            line: index + 1,
            text: line.slice(0, 400),
          });
        if (matches.length >= options.maxMatches) break;
      }
    } catch {
      // Ignore binary/unreadable files during search.
    }
  }
  return matches;
}

async function walk(
  root: string,
  includeHidden: boolean,
  limit: number,
): Promise<WalkEntry[]> {
  const result: WalkEntry[] = [];
  async function visit(current: string): Promise<void> {
    if (result.length >= limit) return;
    let children;
    try {
      children = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (!includeHidden && child.name.startsWith(".") && child.name !== ".env")
        continue;
      if (["node_modules", ".git", "dist", "release"].includes(child.name))
        continue;
      const absolute = path.join(current, child.name);
      const relative = path.relative(root, absolute) || ".";
      if (child.isDirectory()) {
        result.push({ absolute, relative, type: "directory" });
        await visit(absolute);
      } else if (child.isFile()) {
        let size: number | undefined;
        try {
          size = (await stat(absolute)).size;
        } catch {
          /* ignore */
        }
        result.push({
          absolute,
          relative,
          type: "file",
          ...(size === undefined ? {} : { size }),
        });
      }
      if (result.length >= limit) return;
    }
  }
  await access(root);
  const rootInfo = await stat(root);
  if (rootInfo.isFile())
    return [
      {
        absolute: root,
        relative: path.basename(root),
        type: "file",
        size: rootInfo.size,
      },
    ];
  await visit(root);
  return result;
}

function globRegex(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*" && pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else if (char === "{") {
      const end = pattern.indexOf("}", index);
      if (end >= 0) {
        source += `(${pattern
          .slice(index + 1, end)
          .split(",")
          .map(escapeRegex)
          .join("|")})`;
        index = end;
      } else source += escapeRegex(char);
    } else source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`, "i");
}

function matchGlob(value: string, pattern: string): boolean {
  return globRegex(pattern.replaceAll("\\", "/")).test(
    value.replaceAll("\\", "/"),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function toTree(entries: WalkEntry[]): Array<{
  name: string;
  path: string;
  type: string;
  size?: number;
  children?: unknown[];
}> {
  return entries.map((entry) => ({
    name: path.basename(entry.relative),
    path: entry.relative,
    type: entry.type,
    ...(entry.size === undefined ? {} : { size: entry.size }),
  }));
}

async function projectSummary(
  root: string,
  context: ToolContext,
  details = false,
): Promise<Record<string, unknown>> {
  const manifests = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
  ].filter((name) => name);
  const present: string[] = [];
  let packageJson: Record<string, unknown> | undefined;
  for (const name of manifests) {
    try {
      await access(path.join(root, name));
      present.push(name);
      if (name === "package.json")
        packageJson = JSON.parse(
          await readFile(path.join(root, name), "utf8"),
        ) as Record<string, unknown>;
    } catch {
      /* absent */
    }
  }
  let gitStatus = "";
  try {
    gitStatus = (
      await execFileAsync("git", ["status", "--short", "--branch"], {
        cwd: root,
        windowsHide: true,
      })
    ).stdout.trim();
  } catch {
    gitStatus = "not a git repository";
  }
  const topLevel = (await walk(root, false, 100)).filter(
    (entry) => !entry.relative.includes(path.sep),
  );
  const summary: Record<string, unknown> = {
    path: root,
    manifests: present,
    packageManager:
      present.includes("pnpm-workspace.yaml") ||
      present.includes("pnpm-lock.yaml")
        ? "pnpm"
        : present.includes("yarn.lock")
          ? "yarn"
          : present.includes("package-lock.json")
            ? "npm"
            : undefined,
    scripts: packageJson?.scripts ?? {},
    hasAgents: await existsAny(root, ["AGENTS.md", "CLAUDE.md"]),
    hasReadme: await existsAny(root, ["README.md", "README.txt"]),
    gitStatus,
    topLevel,
  };
  const activeWorkspace = path.resolve(context.getConfig().activeWorkspace);
  if (
    context.memory &&
    comparablePath(root) === comparablePath(activeWorkspace)
  ) {
    try {
      const memory = await context.memory.recall({
        checkpointLimit: details ? 10 : 1,
        factLimit: details ? 20 : 8,
        changeLimit: details ? 20 : 6,
      });
      summary.memory = capMemoryBlock(
        {
          available: memory.available,
          workspaceId: memory.workspaceId,
          updatedAt: memory.updatedAt,
          lastCheckpointAt: memory.checkpoints[0]?.createdAt ?? null,
          counts: memory.counts,
          truncated: memory.truncated,
          sanitized: memory.sanitized,
          currentTask: memory.state.active?.currentTask ?? null,
          completedSteps: memory.state.active?.completedSteps ?? [],
          pendingSteps: memory.state.active?.pendingSteps ?? [],
          criticalContext: memory.state.active?.criticalContext ?? null,
          coreFacts: memory.state.facts,
          recentChanges: memory.state.recentChanges,
          ...(memory.warning ? { warning: memory.warning } : {}),
        },
        details ? 12_000 : 6_000,
      );
    } catch (error) {
      summary.memory = {
        available: false,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    summary.memory = {
      available: false,
      reason: "Memory is available only for the active workspace.",
    };
  }
  return summary;
}

function comparablePath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function capMemoryBlock(
  value: Record<string, unknown>,
  maxBytes = 12_000,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const byteSize = (): number =>
    Buffer.byteLength(JSON.stringify(result), "utf8");
  const facts = Array.isArray(result.coreFacts) ? result.coreFacts : [];
  const changes = Array.isArray(result.recentChanges)
    ? result.recentChanges
    : [];
  while (byteSize() > maxBytes && changes.length > 0) changes.pop();
  while (byteSize() > maxBytes && facts.length > 0) facts.pop();
  if (typeof result.criticalContext === "string" && byteSize() > maxBytes)
    result.criticalContext = result.criticalContext.slice(0, 2_000);
  if (byteSize() > maxBytes) {
    result.currentTask =
      typeof result.currentTask === "string"
        ? result.currentTask.slice(0, 1_000)
        : result.currentTask;
    result.truncated = true;
  } else if (
    facts.length <
      (Array.isArray(value.coreFacts) ? value.coreFacts.length : 0) ||
    changes.length <
      (Array.isArray(value.recentChanges) ? value.recentChanges.length : 0)
  ) {
    result.truncated = true;
  }
  result.coreFacts = facts;
  result.recentChanges = changes;
  return result;
}

async function existsAny(root: string, names: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const name of names) {
    try {
      await access(path.join(root, name));
      existing.push(name);
    } catch {
      /* absent */
    }
  }
  return existing;
}
