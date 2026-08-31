import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { localMcpUrl } from "@qnector/shared";
import { getBuildIdentity, sanitizedHash } from "@qnector/core";
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

const execFileAsync = promisify(execFile);

export const systemDefinition: ToolDefinition = {
  name: "system",
  description:
    "Inspect the local computer and Qnector bridge. IMPORTANT: when 2 or more independent Qnector operations are known up front, prefer action=parallel with calls[] so Qnector runs them concurrently in one MCP round-trip instead of making separate tool calls. Prefer context_snapshot as the one-call, compact first-use state discovery action; pass details=true only when expanded process/window context is needed. Other actions locate executables, inspect environment variables, open a path/URL, read or write the clipboard, show a notification, capture the current display/window as an image, or list/focus windows. Work is headless by default: open_path, open_url, toast, and window_focus are presentation-only actions and require presentToUser=true. Use screen_capture for headless visual inspection. No model API is used.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Use screen_capture with source primary/screen/window to capture the current display; use window_list first when a specific window is needed.",
        enum: [
          "parallel",
          "info",
          "status",
          "build_info",
          "release_status",
          "context_snapshot",
          "processes",
          "process_info",
          "find_process",
          "ports",
          "doctor",
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
      calls: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        description:
          "Independent Qnector operations to execute concurrently in one MCP round-trip. Do not use system.parallel inside calls. Preserve dependent operations as separate sequential calls.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Optional stable label for matching a result to this call",
            },
            tool: {
              type: "string",
              enum: [
                "system",
                "workspace",
                "files",
                "process",
                "git",
                "memory",
                "browser",
                "computer",
              ],
            },
            input: {
              type: "object",
              additionalProperties: true,
              description: "Normal input object for the selected Qnector tool",
            },
          },
          required: ["tool", "input"],
          additionalProperties: false,
        },
      },
      maxConcurrency: {
        type: "integer",
        minimum: 1,
        maximum: 8,
        description:
          "Maximum subcalls running at once; defaults to 6. Results remain in calls[] input order.",
      },
      name: { type: "string", description: "Executable name for which" },
      query: {
        type: "string",
        description:
          "Filename/path or native process search query, depending on action",
      },
      pid: { type: "integer", minimum: 1 },
      provider: {
        type: "string",
        enum: ["auto", "everything", "fallback"],
      },
      maxResults: { type: "integer", minimum: 1, maximum: 1000 },
      offset: { type: "integer", minimum: 0 },
      details: { type: "boolean" },
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
      if (action === "info") {
        const config = context.getConfig();
        const build = await getBuildIdentity();
        return {
          summary: `System information for ${config.machineName}`,
          data: {
            os: `${os.type()} ${os.release()}`,
            platform: process.platform,
            architecture: process.arch,
            username: os.userInfo().username,
            hostname: os.hostname(),
            homeDirectory: os.homedir(),
            currentDirectory: process.cwd(),
            activeWorkspace: config.activeWorkspace,
            shell: config.shell.windows,
            nodeVersion: process.version,
            qnectorVersion: build.version,
            build,
            localMcpUrl: localMcpUrl(config.host, config.localPort),
            capabilities: context.platform?.capabilities() ?? {
              provider: "unsupported",
              clipboardText: false,
              toast: false,
              screenCapture: false,
              windowList: false,
              windowFocus: false,
            },
          },
        };
      }
      if (action === "status") {
        const config = context.getConfig();
        return {
          summary: "Qnector local status",
          data: {
            state: "connected",
            host: config.host,
            port: config.localPort,
            localUrl: localMcpUrl(config.host, config.localPort),
            activeWorkspace: config.activeWorkspace,
            transport: config.transport.mode,
            processCount: context.processManager
              .list()
              .filter((entry) => entry.state === "running").length,
          },
        };
      }
      if (action === "build_info") {
        const build = await getBuildIdentity();
        return {
          summary: `Qnector ${build.version} build ${build.buildId}`,
          data: build,
        };
      }
      if (action === "release_status") {
        if (!context.releaseManager)
          throw new Error(
            "UNSUPPORTED_CAPABILITY: release manager is not configured in this Qnector runtime",
          );
        const result = await context.releaseManager.status(
          context.getConfig().activeWorkspace,
        );
        return {
          summary: `Qnector release status: ${result.status}`,
          data: result,
        };
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
        const details = booleanInput(object, "details", false);
        const [build, memory, release, nativeQnector, windows] =
          await Promise.all([
            getBuildIdentity(),
            context.memory
              ?.recall({
                checkpointLimit: 1,
                factLimit: details ? 8 : 4,
                changeLimit: details ? 8 : 4,
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
        const recentActivity = context.activity
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
            mode: details ? "expanded" : "compact",
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
            managedProcesses: context.processManager
              .list()
              .slice(details ? -50 : -15),
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
            },
          },
        };
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
            ? "PDF/DOCX/XLSX/CSV/ZIP/JSON/SQLite document inspection available"
            : "service unavailable",
        );
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
      if (action === "open_path") {
        requirePresentationIntent(object, action);
        const target = path.resolve(stringInput(object, "path", true)!);
        openExternal(target);
        return { summary: `Opened ${target}`, data: { path: target } };
      }
      if (action === "open_url") {
        requirePresentationIntent(object, action);
        const url = stringInput(object, "url", true)!;
        openExternal(url);
        return { summary: `Opened ${url}`, data: { url } };
      }
      if (action === "clipboard_read") {
        const result = await requirePlatform(context).readClipboard();
        return {
          summary: `Read ${result.sizeBytes} clipboard bytes`,
          data: result,
          truncated: result.truncated,
        };
      }
      if (action === "clipboard_write") {
        const text = stringInput(object, "text", true)!;
        if (text.length > 1_000_000)
          throw new Error(
            "CLIPBOARD_TOO_LARGE: text exceeds 1000000 characters",
          );
        const html = stringInput(object, "html");
        if (html && html.length > 1_000_000)
          throw new Error(
            "CLIPBOARD_TOO_LARGE: html exceeds 1000000 characters",
          );
        await requirePlatform(context).writeClipboard({
          text,
          ...(html ? { html } : {}),
        });
        return {
          summary: `Wrote ${Buffer.byteLength(text, "utf8")} clipboard bytes`,
          data: { type: "text", bytes: Buffer.byteLength(text, "utf8") },
        };
      }
      if (action === "toast") {
        requirePresentationIntent(object, action);
        const title = stringInput(object, "title", true)!;
        const body = stringInput(object, "body", true)!;
        if (title.length > 160)
          throw new Error(
            "INVALID_INPUT: toast title must be 160 characters or fewer",
          );
        if (body.length > 2_000)
          throw new Error(
            "INVALID_INPUT: toast body must be 2000 characters or fewer",
          );
        await requirePlatform(context).showToast({
          title,
          body,
          silent: object.silent === true,
        });
        return {
          summary: `Displayed notification '${title}'`,
          data: { title },
        };
      }
      if (action === "screen_capture") {
        const source = stringInput(object, "source") ?? "primary";
        if (!["primary", "screen", "window"].includes(source))
          throw new Error(
            `INVALID_INPUT: unsupported capture source '${source}'`,
          );
        const format = stringInput(object, "format") ?? "jpeg";
        if (!["png", "jpeg"].includes(format))
          throw new Error(
            `INVALID_INPUT: unsupported capture format '${format}'`,
          );
        const attachment = await requirePlatform(context).captureScreen({
          source: source as "primary" | "screen" | "window",
          ...(stringInput(object, "sourceId")
            ? { sourceId: stringInput(object, "sourceId") }
            : {}),
          format: format as "png" | "jpeg",
          maxWidth:
            typeof object.maxWidth === "number" ? object.maxWidth : 1_600,
        });
        return {
          summary: `Captured ${attachment.mimeType} image (${attachment.sizeBytes ?? 0} bytes)`,
          data: {
            type: "image",
            mimeType: attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
            sizeBytes: attachment.sizeBytes,
          },
          attachments: [attachment],
        };
      }
      if (action === "window_list") {
        if (context.uiAutomation) {
          try {
            const semanticWindows = await context.uiAutomation.windows(100);
            const windows = semanticWindows.map((entry) => ({
              id: `window_${entry.processId}`,
              title: entry.name,
              processName: "",
              pid: entry.processId,
            }));
            return {
              summary: `Listed ${windows.length} window(s) via native UI Automation`,
              data: { windows, provider: "ui-automation" },
            };
          } catch {
            // Fall back to the platform implementation for compatibility.
          }
        }
        const windows = await requirePlatform(context).listWindows();
        return {
          summary: `Listed ${windows.length} window(s)`,
          data: { windows, provider: "platform" },
        };
      }
      if (action === "window_focus") {
        requirePresentationIntent(object, action);
        const windowId =
          stringInput(object, "windowId") ?? stringInput(object, "id", true)!;
        await requirePlatform(context).focusWindow(windowId);
        return { summary: `Focused window ${windowId}`, data: { windowId } };
      }
      throw new Error(`INVALID_ACTION: Unknown system action '${action}'`);
    },
  );
}

function requirePresentationIntent(
  object: Record<string, unknown>,
  action: string,
): void {
  if (object.presentToUser === true) return;
  throw new Error(
    `VISIBLE_UI_BLOCKED: system.${action} is presentation-only. Keep intermediate work headless; set presentToUser=true only when intentionally showing final output to the user.`,
  );
}

function activityInput(
  action: string,
  object: Record<string, unknown>,
  original: unknown,
): unknown {
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

function requirePlatform(context: ToolContext) {
  if (!context.platform)
    throw new Error(
      "UNSUPPORTED_CAPABILITY: platform services are not configured",
    );
  return context.platform;
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

function openExternal(target: string): void {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", target], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }
  const executable = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(executable, [target], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
