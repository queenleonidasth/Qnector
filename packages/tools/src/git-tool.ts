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

export const gitDefinition: ToolDefinition = {
  name: "git",
  description:
    "Run structured Git operations in a local repository: status, diff, log, show, branches, checkout, add, commit, pull, push, fetch, stash, reset, clean, and rev-parse. Use process for Git commands not covered by an action.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "status",
          "diff",
          "log",
          "show",
          "branch",
          "checkout",
          "add",
          "commit",
          "pull",
          "push",
          "fetch",
          "stash",
          "reset",
          "clean",
          "rev_parse",
        ],
      },
      cwd: { type: "string" },
      path: { type: "string" },
      paths: { type: "array", items: { type: "string" } },
      staged: { type: "boolean" },
      maxChars: { type: "integer", minimum: 1 },
      maxCount: { type: "integer", minimum: 1 },
      ref: { type: "string" },
      name: { type: "string" },
      create: { type: "boolean" },
      delete: { type: "boolean" },
      all: { type: "boolean" },
      message: { type: "string" },
      remote: { type: "string" },
      branch: { type: "string" },
      stashAction: { type: "string" },
      mode: { type: "string" },
      force: { type: "boolean" },
      dryRun: { type: "boolean" },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export async function executeGit(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "git", action, input, async () => {
    const cwd = context.workspace.resolve(stringInput(object, "cwd") ?? ".");
    const args = buildArgs(action, object);
    const maxChars = Math.max(
      1_000,
      Math.min(Math.floor(numberInput(object, "maxChars", 100_000)), 1_000_000),
    );
    const pathValue = stringInput(object, "path");
    const paths = Array.isArray(object.paths)
      ? object.paths.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    let result;
    try {
      result = await execFileAsync("git", args, {
        cwd,
        windowsHide: true,
        maxBuffer: Math.max(maxChars * 2, 2_000_000),
      });
    } catch (error: unknown) {
      const candidate = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: string | number;
      };
      throw new Error(
        `GIT_COMMAND_FAILED: ${(candidate.stderr || candidate.message || "git command failed").trim()}`,
      );
    }
    const stdout = result.stdout.slice(0, maxChars);
    const stderr = result.stderr.slice(0, maxChars);
    const truncated =
      stdout.length < result.stdout.length ||
      stderr.length < result.stderr.length;
    if (!["status", "diff", "log", "show", "rev_parse"].includes(action)) {
      try {
        await context.memory?.recordChange({
          source: "git",
          summary: `git ${action} completed`,
          paths: [
            ...(paths.length ? paths : []),
            ...(pathValue ? [pathValue] : []),
          ],
        });
      } catch {
        // Git already completed; an optional memory ledger must not change its result.
      }
    }
    return {
      summary: `git ${action} completed`,
      data: { cwd, args, exitCode: 0, stdout, stderr, truncated },
      truncated,
      nextCursor: null,
    };
  });
}

function buildArgs(action: string, input: Record<string, unknown>): string[] {
  const pathValue = stringInput(input, "path");
  const paths = Array.isArray(input.paths)
    ? input.paths.filter((value): value is string => typeof value === "string")
    : [];
  if (action === "status")
    return [
      "status",
      "--short",
      "--branch",
      ...(pathValue ? ["--", pathValue] : []),
    ];
  if (action === "diff")
    return [
      "diff",
      ...(booleanInput(input, "staged", false) ? ["--cached"] : []),
      ...(pathValue ? ["--", pathValue] : []),
    ];
  if (action === "log")
    return [
      "log",
      "--oneline",
      "--decorate",
      "-n",
      String(Math.max(1, Math.floor(numberInput(input, "maxCount", 30)))),
      ...(pathValue ? ["--", pathValue] : []),
    ];
  if (action === "show")
    return [
      "show",
      stringInput(input, "ref") ?? "HEAD",
      ...(pathValue ? ["--", pathValue] : []),
    ];
  if (action === "branch") {
    const name = stringInput(input, "name");
    if (booleanInput(input, "delete", false))
      return ["branch", "-D", name ?? ""];
    if (booleanInput(input, "create", false)) return ["branch", name ?? ""];
    return ["branch", "--all"];
  }
  if (action === "checkout")
    return [
      "checkout",
      ...(booleanInput(input, "create", false) ? ["-b"] : []),
      stringInput(input, "name", true)!,
    ];
  if (action === "add")
    return [
      "add",
      ...(booleanInput(input, "all", false)
        ? ["-A"]
        : paths.length
          ? ["--", ...paths]
          : pathValue
            ? ["--", pathValue]
            : []),
    ];
  if (action === "commit")
    return ["commit", "-m", stringInput(input, "message", true)!];
  if (action === "pull")
    return [
      "pull",
      ...(stringInput(input, "remote") ? [stringInput(input, "remote")!] : []),
      ...(stringInput(input, "branch") ? [stringInput(input, "branch")!] : []),
    ];
  if (action === "push")
    return [
      "push",
      ...(stringInput(input, "remote") ? [stringInput(input, "remote")!] : []),
      ...(stringInput(input, "branch") ? [stringInput(input, "branch")!] : []),
    ];
  if (action === "fetch")
    return [
      "fetch",
      ...(stringInput(input, "remote") ? [stringInput(input, "remote")!] : []),
    ];
  if (action === "stash") {
    const stashAction = stringInput(input, "stashAction") ?? "list";
    return [
      "stash",
      stashAction,
      ...(stashAction === "push" && stringInput(input, "message")
        ? ["-m", stringInput(input, "message")!]
        : []),
    ];
  }
  if (action === "reset")
    return [
      "reset",
      stringInput(input, "mode") ?? "--mixed",
      ...(pathValue ? ["--", pathValue] : []),
    ];
  if (action === "clean")
    return [
      "clean",
      ...(booleanInput(input, "dryRun", !booleanInput(input, "force", false))
        ? ["-n"]
        : ["-f"]),
      ...(booleanInput(input, "all", false) ? ["-d"] : []),
    ];
  if (action === "rev_parse")
    return ["rev-parse", stringInput(input, "ref") ?? "--show-toplevel"];
  throw new Error(`INVALID_ACTION: Unknown git action '${action}'`);
}
