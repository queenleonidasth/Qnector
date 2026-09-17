import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";

interface ExternalMcpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  dpapiEnv?: Record<string, string>;
  enabled?: boolean;
}

interface ExternalMcpConfigFile {
  version?: number;
  servers?: Record<string, ExternalMcpServerConfig>;
}

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESULT_CHARS = 100_000;
const execFileAsync = promisify(execFile);

export interface ExternalMcpServerSummary {
  name: string;
  enabled: boolean;
  command: string;
  args: string[];
  cwd?: string;
  envKeys: string[];
  secretEnvKeys: string[];
}

export function externalMcpConfigPath(): string {
  const base =
    process.env.APPDATA?.trim() || path.join(os.homedir(), ".config");
  return path.join(base, "Qnector", "external-mcp.json");
}

async function loadConfig(): Promise<ExternalMcpConfigFile> {
  const configPath = externalMcpConfigPath();
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as ExternalMcpConfigFile;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("external MCP config must be a JSON object");
    }
    if (
      parsed.servers !== undefined &&
      (!parsed.servers || typeof parsed.servers !== "object")
    ) {
      throw new Error("external MCP config servers must be an object");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, servers: {} };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MCP_CONFIG_ERROR: ${configPath}: ${message}`);
  }
}

function validateServerConfig(
  name: string,
  value: ExternalMcpServerConfig | undefined,
): ExternalMcpServerConfig {
  if (!value || typeof value !== "object") {
    throw new Error(
      `MCP_SERVER_NOT_FOUND: External MCP server '${name}' is not configured`,
    );
  }
  if (value.enabled === false) {
    throw new Error(
      `MCP_SERVER_DISABLED: External MCP server '${name}' is disabled`,
    );
  }
  if (typeof value.command !== "string" || !value.command.trim()) {
    throw new Error(
      `MCP_CONFIG_ERROR: External MCP server '${name}' has no command`,
    );
  }
  if (value.args !== undefined && !Array.isArray(value.args)) {
    throw new Error(
      `MCP_CONFIG_ERROR: External MCP server '${name}' args must be an array`,
    );
  }
  if (
    value.env !== undefined &&
    (!value.env || typeof value.env !== "object")
  ) {
    throw new Error(
      `MCP_CONFIG_ERROR: External MCP server '${name}' env must be an object`,
    );
  }
  if (
    value.dpapiEnv !== undefined &&
    (!value.dpapiEnv || typeof value.dpapiEnv !== "object")
  ) {
    throw new Error(
      `MCP_CONFIG_ERROR: External MCP server '${name}' dpapiEnv must be an object`,
    );
  }
  return value;
}

async function configuredServer(
  name: string,
): Promise<ExternalMcpServerConfig> {
  const config = await loadConfig();
  return validateServerConfig(name, config.servers?.[name]);
}

function timeoutAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`MCP_TIMEOUT: ${label} exceeded ${ms} ms`));
    }, ms);
    timer.unref?.();
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([promise, timeoutAfter(ms, label)]);
}

async function decryptDpapiSecret(
  filePath: string,
): Promise<string | undefined> {
  if (process.platform !== "win32") {
    throw new Error(
      "MCP_SECRET_ERROR: DPAPI secrets are supported only on Windows",
    );
  }
  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw error;
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "$encrypted=Get-Content -LiteralPath $env:QNECTOR_DPAPI_FILE -Raw",
    "$secure=$encrypted | ConvertTo-SecureString",
    "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) } finally { if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      maxBuffer: 128 * 1024,
      env: { ...process.env, QNECTOR_DPAPI_FILE: filePath },
    },
  );
  const value = stdout.trim();
  return value || undefined;
}

async function serverEnvironment(
  server: ExternalMcpServerConfig,
): Promise<Record<string, string> | undefined> {
  if (!server.env && !server.dpapiEnv) return undefined;
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    ...(server.env ?? {}),
  };
  for (const [key, filePath] of Object.entries(server.dpapiEnv ?? {})) {
    if (typeof filePath !== "string" || !filePath.trim()) continue;
    const value = await decryptDpapiSecret(filePath);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function withClient<T>(
  serverName: string,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  const server = await configuredServer(serverName);
  const env = await serverEnvironment(server);
  const stderrChunks: string[] = [];
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    ...(server.cwd ? { cwd: server.cwd } : {}),
    ...(env ? { env } : {}),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
    if (stderrChunks.length > 20) stderrChunks.shift();
  });

  const client = new Client({
    name: "qnector-upstream-mcp",
    version: "1.0.0",
  });

  try {
    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `Connecting to external MCP server '${serverName}'`,
    );
    return await callback(client);
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}${stderr ? ` | server stderr: ${stderr.slice(-4_000)}` : ""}`,
    );
  } finally {
    try {
      await client.close();
    } catch {
      try {
        await transport.close();
      } catch {
        // Best-effort cleanup. The child process also exits with its parent.
      }
    }
  }
}

export async function listExternalMcpServers(): Promise<{
  configPath: string;
  servers: ExternalMcpServerSummary[];
}> {
  const config = await loadConfig();
  const servers = Object.entries(config.servers ?? {})
    .map(([name, server]) => ({
      name,
      enabled: server.enabled !== false,
      command: typeof server.command === "string" ? server.command : "",
      args: Array.isArray(server.args)
        ? server.args.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      ...(typeof server.cwd === "string" && server.cwd
        ? { cwd: server.cwd }
        : {}),
      envKeys:
        server.env && typeof server.env === "object"
          ? Object.keys(server.env).sort()
          : [],
      secretEnvKeys:
        server.dpapiEnv && typeof server.dpapiEnv === "object"
          ? Object.keys(server.dpapiEnv).sort()
          : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { configPath: externalMcpConfigPath(), servers };
}

export async function listExternalMcpTools(
  serverName: string,
  query?: string,
  maxResults = 40,
): Promise<{
  server: string;
  total: number;
  matched: number;
  returned: number;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: unknown;
    annotations?: unknown;
  }>;
}> {
  return withClient(serverName, async (client) => {
    const response = await withTimeout(
      client.listTools(),
      REQUEST_TIMEOUT_MS,
      `Listing tools from '${serverName}'`,
    );
    const needle = query?.trim().toLowerCase();
    const filtered = response.tools.filter((tool) => {
      if (!needle) return true;
      return (
        tool.name.toLowerCase().includes(needle) ||
        (tool.description ?? "").toLowerCase().includes(needle)
      );
    });
    const limit = Math.max(1, Math.min(200, Math.trunc(maxResults)));
    const tools = filtered.slice(0, limit).map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }));
    return {
      server: serverName,
      total: response.tools.length,
      matched: filtered.length,
      returned: tools.length,
      tools,
    };
  });
}

export async function callExternalMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  maxChars = DEFAULT_MAX_RESULT_CHARS,
): Promise<{
  server: string;
  tool: string;
  isError: boolean;
  truncated: boolean;
  result: unknown;
  originalChars?: number;
}> {
  return withClient(serverName, async (client) => {
    const response = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      REQUEST_TIMEOUT_MS,
      `Calling '${toolName}' on '${serverName}'`,
    );
    const limit = Math.max(1_000, Math.min(1_000_000, Math.trunc(maxChars)));
    const serialized = JSON.stringify(response);
    if (serialized.length <= limit) {
      return {
        server: serverName,
        tool: toolName,
        isError: response.isError === true,
        truncated: false,
        result: response,
      };
    }
    return {
      server: serverName,
      tool: toolName,
      isError: response.isError === true,
      truncated: true,
      originalChars: serialized.length,
      result: serialized.slice(0, limit),
    };
  });
}
