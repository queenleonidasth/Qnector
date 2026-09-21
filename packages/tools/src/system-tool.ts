import { executeSystemDiagnostics } from "./system-diagnostics-adapter.js";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  getBuildIdentity,
  qnectorPerformance,
  sanitizedHash,
} from "@qnector/core";
import { stat } from "node:fs/promises";
import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  success,
  failure,
  errorFromUnknown,
  type ToolContext,
} from "./tool-result.js";
import { executeSystemMcp } from "./system-mcp-adapter.js";
import { executeSystemSkills } from "./system-skills-adapter.js";
import { executeSystemDesktop } from "./system-desktop-adapter.js";

const execFileAsync = promisify(execFile);

export const systemDefinition: ToolDefinition = {
  name: "system",
  description:
    "Inspect the local computer and Qnector bridge. Use separate Qnector tool calls for independent operations; do not batch multiple tool actions into one call. Prefer context_snapshot as the one-call, compact first-use state discovery action; pass details=true only when expanded process/window context is needed. Direct tools are the default: do not automatically search, match, route, or activate Agent Skills. Only when the user explicitly requests a named Skill, call skill_get; use skills_route only when the user explicitly asks you to select Skills for a task. Use skills_match only for requested discovery. When the user asks to discover or install new Agent Skills, use skills_search_remote and skill_install_remote for the public skills.sh catalog; never install a remote skill without user intent. For configured external MCP servers, use mcp_servers to inspect available upstreams, mcp_tools to discover/filter their tool schemas, and mcp_call to invoke one without exposing configured secret values. Other actions locate executables, inspect environment variables, open a path/URL, read or write the clipboard, show a notification, capture the current display/window as an image, or list/focus windows. Work is headless by default: open_path, open_url, toast, and window_focus are presentation-only actions and require presentToUser=true. Use screen_capture for headless visual inspection. No model API is used.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Use screen_capture with source primary/screen/window to capture the current display; use window_list first when a specific window is needed.",
        enum: [
          "info",
          "status",
          "build_info",
          "release_status",
          "context_snapshot",
          "performance",
          "processes",
          "process_info",
          "find_process",
          "ports",
          "doctor",
          "mcp_servers",
          "mcp_tools",
          "mcp_call",
          "skills_status",
          "skills_list",
          "skills_match",
          "skills_route",
          "skills_search_remote",
          "skill_install_remote",
          "skill_get",
          "skill_create",
          "skill_update",
          "skill_delete",
          "skill_enable",
          "skill_duplicate",
          "skill_import",
          "skill_validate",
          "everything_status",
          "which",
          "search_files",
          "env",
          "open_path",
          "open_url",
          "clipboard_read",
          "clipboard_write",
          "toast",
          "screen_capture",
          "window_list",
          "window_focus",
        ],
      },
      name: {
        type: "string",
        description:
          "Executable name for which, or Agent Skill name for skill_get/management actions",
      },
      newName: { type: "string" },
      scope: { type: "string", enum: ["user", "workspace"] },
      description: { type: "string" },
      instructions: { type: "string" },
      license: { type: "string" },
      compatibility: { type: "string" },
      allowedTools: {
        type: "array",
        items: { type: "string" },
      },
      enabled: { type: "boolean" },
      sourcePath: { type: "string" },
      remoteId: {
        type: "string",
        description: "skills.sh registry id in owner/repo/skill form",
      },
      owner: {
        type: "string",
        description: "Optional GitHub owner filter for skills.sh search",
      },
      query: {
        type: "string",
        description:
          "Filename/path, native process search query, or external MCP tool filter depending on action",
      },
      server: {
        type: "string",
        description:
          "Configured external MCP server name for mcp_tools/mcp_call",
      },
      toolName: {
        type: "string",
        description: "External MCP tool name for mcp_call",
      },
      arguments: {
        type: "object",
        additionalProperties: true,
        description: "Arguments forwarded to the external MCP tool",
      },
      maxChars: {
        type: "integer",
        minimum: 1000,
        maximum: 1000000,
        description: "Maximum serialized result size returned by mcp_call",
      },
      pid: { type: "integer", minimum: 1 },
      provider: {
        type: "string",
        enum: ["auto", "everything", "fallback"],
      },
      maxResults: { type: "integer", minimum: 1, maximum: 1000 },
      offset: { type: "integer", minimum: 0 },
      details: { type: "boolean" },
      profile: {
        type: "string",
        enum: ["minimal", "coding", "full"],
        description:
          "Optional context_snapshot verbosity only; does not change available MCP tools or permissions",
      },
      keys: {
        type: "array",
        items: { type: "string" },
        description: "Optional environment variable names",
      },
      path: { type: "string" },
      url: { type: "string" },
      text: { type: "string" },
      html: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      silent: { type: "boolean" },
      presentToUser: {
        type: "boolean",
        description:
          "Explicit opt-in for visible UI. Required for open_path, open_url, toast, and window_focus; use only when intentionally presenting final output to the user.",
      },
      source: { type: "string", enum: ["primary", "screen", "window"] },
      sourceId: { type: "string" },
      format: { type: "string", enum: ["png", "jpeg"] },
      maxWidth: { type: "integer", minimum: 320 },
      windowId: { type: "string" },
      id: { type: "string" },
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

export async function executeSystem(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(
    context,
    "system",
    action,
    activityInput(action, object, input),
    async () => {
      if (["info", "status", "build_info", "performance", "release_status"].includes(action)) {
        return executeSystemDiagnostics(context, action);
      }
      if (action === "processes" || action === "find_process") {
        if (!context.nativeProcess)
          throw new Error(
            "UNSUPPORTED_CAPABILITY: native process intelligence is not configured in this Qnector runtime",
          );
        const query =
          action === "find_process"
            ? stringInput(object, "query", true)!
            : stringInput(object, "query");
        const result = await context.nativeProcess.list({
          ...(query ? { query } : {}),
          maxResults: numberInput(object, "maxResults", 100),
        });
        return {
          summary: `${action === "find_process" ? "Process search" : "Native process list"} returned ${result.processes.length} of ${result.total} process(es)`,
          data: result,
          truncated: result.truncated,
        };
      }
      if (action === "process_info") {
        if (!context.nativeProcess)
          throw new Error(
            "UNSUPPORTED_CAPABILITY: native process intelligence is not configured in this Qnector runtime",
          );
        const pid = numberInput(object, "pid", Number.NaN);
        const processInfo = await context.nativeProcess.inspect(pid);
        if (!processInfo)
          throw new Error(`PROCESS_NOT_FOUND: native PID ${pid}`);
        const ports = await context.nativeProcess.ports({
          pid,
          maxResults: numberInput(object, "maxResults", 100),
        });
        return {
          summary: `Native process ${processInfo.name} (${processInfo.pid})`,
          data: {
            process: processInfo,
            ports: ports.ports,
            portsTruncated: ports.truncated,
          },
        };
      }
      if (action === "ports") {
        if (!context.nativeProcess)
          throw new Error(
            "UNSUPPORTED_CAPABILITY: native process intelligence is not configured in this Qnector runtime",
          );
        const pid =
          object.pid === undefined
            ? undefined
            : numberInput(object, "pid", Number.NaN);
        const result = await context.nativeProcess.ports({
          ...(pid === undefined ? {} : { pid }),
          maxResults: numberInput(object, "maxResults", 100),
        });
        return {
          summary: `Listed ${result.ports.length} of ${result.total} TCP endpoint(s)`,
          data: result,
          truncated: result.truncated,
        };
      }
      if (action === "context_snapshot") {
        const config = context.getConfig();
        const requestedProfile = stringInput(object, "profile");
        if (
          requestedProfile &&
          !["minimal", "coding", "full"].includes(requestedProfile)
        )
          throw new Error(
            "INVALID_INPUT: profile must be minimal, coding, or full",
          );
        const details =
          booleanInput(object, "details", false) || requestedProfile === "full";
        const minimal = requestedProfile === "minimal" && !details;
        const [build, memory, release, nativeQnector, windows] =
          await Promise.all([
            getBuildIdentity(),
            context.memory
              ?.recall({
                checkpointLimit: 1,
                factLimit: minimal ? 1 : details ? 8 : 4,
                changeLimit: minimal ? 1 : details ? 8 : 4,
              })
              .catch(() => undefined),
            details
              ? context.releaseManager
                  ?.status(config.activeWorkspace)
                  .catch(() => undefined)
              : Promise.resolve(undefined),
            details
              ? context.nativeProcess
                  ?.list({ query: "Qnector", maxResults: 20 })
                  .catch(() => undefined)
              : Promise.resolve(undefined),
            details
              ? context.uiAutomation?.windows(30).catch(() => [])
              : Promise.resolve([]),
          ]);
        const recentActivity = minimal
          ? []
          : context.activity
              .list()
              .filter((entry) => entry.status !== "running")
              .slice(details ? -20 : -8)
              .reverse()
              .map((entry) => ({
                timestamp: entry.timestamp,
                tool: entry.tool,
                action: entry.action,
                status: entry.status,
                summary: entry.summary ?? entry.error?.message ?? "",
              }));
        return {
          summary: `Context snapshot for ${config.activeWorkspace}${details ? " (expanded)" : " (compact)"}`,
          data: {
            capturedAt: new Date().toISOString(),
            mode: requestedProfile ?? (details ? "expanded" : "compact"),
            machine: {
              hostname: os.hostname(),
              platform: process.platform,
              architecture: process.arch,
            },
            build,
            release: release ?? null,
            workspace: config.activeWorkspace,
            memory: memory
              ? {
                  updatedAt: memory.updatedAt,
                  active: memory.state.active,
                  recentChanges: memory.state.recentChanges,
                  facts: memory.state.facts,
                }
              : null,
            managedProcesses: minimal
              ? []
              : context.processManager.list().slice(details ? -50 : -15),
            nativeQnectorProcesses: details
              ? (nativeQnector?.processes ?? [])
              : [],
            windows: details ? (windows ?? []) : [],
            recentActivity,
            capabilities: {
              workflow: Boolean(context.workflowManager),
              documentIntelligence: Boolean(context.documentIntelligence),
              nativeProcess: Boolean(context.nativeProcess),
              releaseManager: Boolean(context.releaseManager),
              browser: Boolean(context.browserRuntime),
              codeIntelligence: Boolean(context.codeIntelligence),
              semanticSearch: Boolean(context.semanticSearch),
              agentSkills: Boolean(context.agentSkills),
            },
          },
        };
      }

      if (action.startsWith("skills_") || action.startsWith("skill_")) {
        return executeSystemSkills(context, action, object);
      }
      if (action === "everything_status") {
        const status = await context.fileSearch?.status?.();
        return {
          summary: status?.everythingAvailable
            ? `Everything CLI is available at ${status.executablePath}`
            : "Everything CLI is not available; bounded fallback search remains available",
          data: status ?? {
            everythingAvailable: false,
            executablePath: null,
            fallbackAvailable: true,
          },
        };
      }
      if (action === "mcp_servers" || action === "mcp_tools" || action === "mcp_call") {
        return executeSystemMcp(action, object);
      }
      if (action === "doctor") {
        const config = context.getConfig();
        const build = await getBuildIdentity();
        const checks: Array<{
          name: string;
          status: "pass" | "warn" | "fail";
          detail: string;
        }> = [];
        const add = (
          name: string,
          status: "pass" | "warn" | "fail",
          detail: string,
        ): void => {
          checks.push({ name, status, detail });
        };
        add(
          "build",
          "pass",
          `${build.version} ${build.buildId} (${build.channel})`,
        );
        add(
          "mcp-tools",
          "pass",
          "8 grouped tools registered by Qnector runtime",
        );
        try {
          const info = await stat(config.activeWorkspace);
          add(
            "workspace",
            info.isDirectory() ? "pass" : "fail",
            config.activeWorkspace,
          );
        } catch (error) {
          add(
            "workspace",
            "fail",
            error instanceof Error ? error.message : String(error),
          );
        }
        const shellPath = await locateExecutable(
          config.shell.powershellPath ||
            (process.platform === "win32" ? "powershell.exe" : "pwsh"),
        );
        add(
          "shell",
          shellPath ? "pass" : "fail",
          shellPath ?? "PowerShell executable not found",
        );
        const gitPath = await locateExecutable("git");
        add(
          "git",
          gitPath ? "pass" : "warn",
          gitPath ?? "git not found in PATH",
        );
        try {
          const everything = await context.fileSearch?.status?.();
          add(
            "everything",
            everything?.everythingAvailable ? "pass" : "warn",
            everything?.executablePath ??
              "es.exe unavailable; bounded fallback enabled",
          );
        } catch (error) {
          add(
            "everything",
            "warn",
            error instanceof Error ? error.message : String(error),
          );
        }
        try {
          const memory = await context.memory?.recall({
            checkpointLimit: 1,
            factLimit: 1,
            changeLimit: 1,
          });
          add(
            "memory",
            memory?.available ? "pass" : "warn",
            memory?.workspaceId ?? "memory unavailable",
          );
        } catch (error) {
          add(
            "memory",
            "warn",
            error instanceof Error ? error.message : String(error),
          );
        }
        try {
          const windows = await context.uiAutomation?.windows(1);
          add(
            "windows-uia",
            context.uiAutomation ? "pass" : "warn",
            context.uiAutomation
              ? `${windows?.length ?? 0} window(s) sampled successfully`
              : "UI Automation service unavailable",
          );
        } catch (error) {
          add(
            "windows-uia",
            "warn",
            error instanceof Error ? error.message : String(error),
          );
        }
        const managedBrowser = context.browserRuntime?.status();
        add(
          "managed-browser",
          context.browserRuntime
            ? managedBrowser?.running
              ? "pass"
              : "warn"
            : "warn",
          managedBrowser?.running
            ? `${managedBrowser.browser} on ${managedBrowser.host}:${managedBrowser.port}`
            : "runtime available; browser not currently launched",
        );
        const lsp = context.genericLsp?.status() ?? [];
        const lspAvailable = lsp.filter((entry) => entry.available);
        add(
          "generic-lsp",
          lspAvailable.length > 0 ? "pass" : "warn",
          lspAvailable.length > 0
            ? lspAvailable.map((entry) => entry.command).join(", ")
            : "adapter ready; no external language server currently found",
        );
        add(
          "semantic-search",
          context.semanticSearch ? "pass" : "fail",
          context.semanticSearch
            ? "local hashed-vector index available; no model API required"
            : "service unavailable",
        );
        add(
          "file-watch",
          context.fileWatch ? "pass" : "fail",
          context.fileWatch
            ? "filesystem watch/wait service available"
            : "service unavailable",
        );
        add(
          "native-process",
          context.nativeProcess ? "pass" : "fail",
          context.nativeProcess
            ? "native process/port intelligence available"
            : "service unavailable",
        );
        add(
          "release-manager",
          context.releaseManager ? "pass" : "fail",
          context.releaseManager
            ? "local build/release comparison available"
            : "service unavailable",
        );
        add(
          "document-intelligence",
          context.documentIntelligence ? "pass" : "fail",
          context.documentIntelligence
            ? "Native PDF/DOCX/XLSX/CSV/ZIP/JSON/SQLite handling available"
            : "service unavailable",
        );
        if (context.documentIntelligence) {
          try {
            const providers = await context.documentIntelligence.providers();
            add(
              "document-markitdown",
              providers.markitdown.available ? "pass" : "warn",
              providers.markitdown.available
                ? `${providers.markitdown.version ?? "MarkItDown"} via ${providers.markitdown.command}`
                : "optional MarkItDown provider not found; extended PPTX/EPUB/RTF/MSG/media extraction is unavailable",
            );
          } catch (error) {
            add(
              "document-markitdown",
              "warn",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        if (context.agentSkills) {
          try {
            const skills = await context.agentSkills.status();
            add(
              "agent-skills",
              skills.skillCount > 0 ? "pass" : "warn",
              `${skills.skillCount} skill(s) discovered across ${skills.roots.length} root(s)`,
            );
          } catch (error) {
            add(
              "agent-skills",
              "warn",
              error instanceof Error ? error.message : String(error),
            );
          }
        } else {
          add("agent-skills", "fail", "Agent Skills runtime unavailable");
        }
        add(
          "workflow-engine",
          context.workflowManager ? "pass" : "fail",
          context.workflowManager
            ? "persistent multi-step workflow engine available"
            : "service unavailable",
        );
        add(
          "interactive-pty",
          context.ptyManager ? "pass" : "fail",
          context.ptyManager
            ? "interactive pseudoterminal/ConPTY service available"
            : "service unavailable",
        );
        const failed = checks.filter((entry) => entry.status === "fail").length;
        const warnings = checks.filter(
          (entry) => entry.status === "warn",
        ).length;
        return {
          summary: `Qnector doctor: ${checks.length - failed - warnings} pass, ${warnings} warning(s), ${failed} failure(s)`,
          data: { build, checks, healthy: failed === 0 },
        };
      }
      if (action === "which") {
        const name = stringInput(object, "name", true)!;
        const located = await locateExecutable(name);
        return located
          ? { summary: `Located ${name}`, data: { name, path: [located] } }
          : { summary: `${name} was not found`, data: { name, path: [] } };
      }
      if (action === "search_files") {
        if (!context.fileSearch)
          throw new Error(
            "UNSUPPORTED_CAPABILITY: file search is not configured in this Qnector runtime",
          );
        const provider = stringInput(object, "provider") as
          "auto" | "everything" | "fallback" | undefined;
        if (provider && !["auto", "everything", "fallback"].includes(provider))
          throw new Error(
            "INVALID_INPUT: provider must be auto, everything, or fallback",
          );
        const result = await context.fileSearch.search({
          query: stringInput(object, "query", true)!,
          provider,
          maxResults: numberInput(object, "maxResults", 100),
          offset: numberInput(object, "offset", 0),
          details: booleanInput(object, "details", true),
          workspaceRoot: context.getConfig().activeWorkspace,
        });
        return {
          summary: `File search returned ${result.matches.length} match(es) via ${result.provider}`,
          data: result,
          truncated: result.truncated,
          nextCursor: result.truncated
            ? result.offset + result.matches.length
            : null,
        };
      }
      if (action === "env") {
        const keys = Array.isArray(object.keys)
          ? object.keys.filter((key): key is string => typeof key === "string")
          : undefined;
        const data = keys
          ? Object.fromEntries(
              keys.map((key) => [key, process.env[key] ?? null]),
            )
          : { ...process.env };
        return {
          summary: keys
            ? `Read ${keys.length} environment variables`
            : "Read environment variables",
          data,
        };
      }
      if (["open_path", "open_url", "clipboard_read", "clipboard_write", "toast", "screen_capture", "window_list", "window_focus"].includes(action)) {
        return executeSystemDesktop(context, action, object);
      }
      throw new Error(`INVALID_ACTION: Unknown system action '${action}'`);
    },
  );
}

function activityInput(
  action: string,
  object: Record<string, unknown>,
  original: unknown,
): unknown {
  if (action === "mcp_call") {
    const args =
      object.arguments && typeof object.arguments === "object"
        ? (object.arguments as Record<string, unknown>)
        : {};
    return {
      action,
      server: typeof object.server === "string" ? object.server : undefined,
      toolName:
        typeof object.toolName === "string" ? object.toolName : undefined,
      argumentKeys: Object.keys(args).sort(),
    };
  }
  if (action !== "clipboard_write") return original;
  const text = typeof object.text === "string" ? object.text : "";
  const html = typeof object.html === "string" ? object.html : undefined;
  return {
    action,
    type: "text",
    chars: text.length,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sanitizedHash(text),
    ...(html === undefined
      ? {}
      : {
          htmlChars: html.length,
          htmlBytes: Buffer.byteLength(html, "utf8"),
          htmlSha256: sanitizedHash(html),
        }),
  };
}

async function locateExecutable(name: string): Promise<string | null> {
  if (path.isAbsolute(name)) {
    try {
      await stat(name);
      return name;
    } catch {
      return null;
    }
  }
  if (
    process.platform === "win32" &&
    ["rg", "rg.exe"].includes(name.toLowerCase())
  ) {
    const resourcesPath = (
      process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath;
    const candidates = [
      process.env.QNECTOR_RIPGREP_PATH,
      process.env.QNECTOR_RG_PATH,
      resourcesPath ? path.join(resourcesPath, "ripgrep", "rg.exe") : undefined,
      path.join(process.cwd(), "tools", "ripgrep", "rg.exe"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      try {
        await stat(candidate);
        return candidate;
      } catch {
        // Continue to PATH lookup.
      }
    }
  }
  const command = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(command, [name], { windowsHide: true });
    return (
      result.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean) ?? null
    );
  } catch {
    return null;
  }
}
