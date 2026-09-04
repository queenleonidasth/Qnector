import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import {
  ActivityLogger,
  QNECTOR_VERSION,
  activityLogPath,
  loadConfig,
  saveConfig,
  ProcessManager,
  WorkspaceState,
  MemoryStore,
  NodePlatformServices,
  TypeScriptCodeIntelligence,
  WindowsFileSearchService,
  WindowsUiAutomationService,
  FileWatchService,
  ManagedBrowserRuntime,
  GenericLspService,
  LocalSemanticSearchService,
  NativeProcessService,
  ReleaseManager,
  DocumentIntelligenceService,
  WorkflowManager,
  PtyManager,
  type CodeIntelligenceService,
  type FileSearchService,
  type UiAutomationService,
  type MemoryRecall,
  type PlatformServices,
} from "@qnector/core";
import type {
  QnectorConfig,
  ServerStatus,
  ToolDefinition,
} from "@qnector/shared";
import { localMcpUrl } from "@qnector/shared";
import { ToolRegistry } from "@qnector/tools";
import type { ToolContext } from "@qnector/tools";
import {
  buildSessionBootstrapError,
  buildSessionBootstrapInstructions,
} from "./session-bootstrap.js";

const execFileAsync = promisify(execFile);
const mcpInputSchemaCache = new Map<
  ToolDefinition["name"],
  ReturnType<typeof fromJsonSchema>
>();

export interface QnectorRuntimeOptions {
  config?: QnectorConfig;
  configFile?: string;
  logger?: ActivityLogger;
  nonBlockingActivityWrites?: boolean;
  processManager?: ProcessManager;
  codeIntelligence?: CodeIntelligenceService;
  fileSearch?: FileSearchService;
  uiAutomation?: UiAutomationService;
  fileWatch?: FileWatchService;
  browserRuntime?: ManagedBrowserRuntime;
  genericLsp?: GenericLspService;
  semanticSearch?: LocalSemanticSearchService;
  nativeProcess?: NativeProcessService;
  releaseManager?: ReleaseManager;
  documentIntelligence?: DocumentIntelligenceService;
  workflowManager?: WorkflowManager;
  ptyManager?: PtyManager;
  memory?: MemoryStore;
  platform?: PlatformServices;
  platformServices?: PlatformServices;
  app?: FastifyInstance;
}

export class QnectorRuntime {
  public readonly app: FastifyInstance;
  public readonly registry = new ToolRegistry();
  public readonly processManager: ProcessManager;
  public readonly codeIntelligence: CodeIntelligenceService;
  public readonly fileSearch: FileSearchService;
  public readonly uiAutomation: UiAutomationService;
  public readonly fileWatch: FileWatchService;
  public readonly browserRuntime: ManagedBrowserRuntime;
  public readonly genericLsp: GenericLspService;
  public readonly semanticSearch: LocalSemanticSearchService;
  public readonly nativeProcess: NativeProcessService;
  public readonly releaseManager: ReleaseManager;
  public readonly documentIntelligence: DocumentIntelligenceService;
  public readonly workflowManager: WorkflowManager;
  public readonly ptyManager: PtyManager;
  public readonly activity: ActivityLogger;
  public readonly workspace: WorkspaceState;
  public readonly memory: MemoryStore;
  public readonly platform: PlatformServices;
  private readonly configFile?: string;
  private config: QnectorConfig;
  private readonly mcpHandler: ReturnType<typeof createMcpHandler>;
  private readonly mcpNodeHandler: ReturnType<typeof toNodeHandler>;
  private startedAt = new Date().toISOString();
  private state: ServerStatus["state"] = "disconnected";
  private listening = false;

  public constructor(options: QnectorRuntimeOptions = {}) {
    this.config = options.config ?? {
      version: 1,
      deviceId: randomUUID(),
      machineName: "Qnector",
      activeWorkspace: process.cwd(),
      recentWorkspaces: [process.cwd()],
      localPort: 8787,
      host: "127.0.0.1",
      transport: { mode: "local-only" },
      shell: {
        windows: "powershell",
        defaultTimeoutMs: 120_000,
      },
      ui: { minimizeToTray: true, startMinimized: false, theme: "system" },
      memory: {
        workspaceMirror: "off",
        maxCheckpoints: 10,
        maxPayloadBytes: 256_000,
      },
    };
    this.configFile = options.configFile;
    this.processManager =
      options.processManager ?? new ProcessManager(this.config.shell.windows);
    this.codeIntelligence =
      options.codeIntelligence ?? new TypeScriptCodeIntelligence();
    this.fileSearch = options.fileSearch ?? new WindowsFileSearchService();
    this.uiAutomation =
      options.uiAutomation ??
      new WindowsUiAutomationService({
        powershellPath: this.config.shell.powershellPath,
      });
    this.fileWatch = options.fileWatch ?? new FileWatchService();
    this.browserRuntime = options.browserRuntime ?? new ManagedBrowserRuntime();
    this.genericLsp = options.genericLsp ?? new GenericLspService();
    this.semanticSearch =
      options.semanticSearch ?? new LocalSemanticSearchService();
    this.nativeProcess =
      options.nativeProcess ??
      new NativeProcessService(this.config.shell.powershellPath);
    this.releaseManager = options.releaseManager ?? new ReleaseManager();
    this.documentIntelligence =
      options.documentIntelligence ?? new DocumentIntelligenceService();
    this.workflowManager =
      options.workflowManager ??
      new WorkflowManager(this.processManager, this.fileWatch);
    this.ptyManager =
      options.ptyManager ?? new PtyManager(this.config.shell.windows);
    this.activity =
      options.logger ??
      new ActivityLogger(
        activityLogPath(),
        500,
        10_000_000,
        options.nonBlockingActivityWrites ?? false,
      );
    this.workspace = new WorkspaceState(this.config);
    this.memory =
      options.memory ??
      new MemoryStore(this.config.activeWorkspace, {
        ...(this.configFile
          ? {
              rootDirectory: path.join(path.dirname(this.configFile), "memory"),
            }
          : {}),
        workspaceMirror: this.config.memory?.workspaceMirror ?? "off",
        maxCheckpoints: this.config.memory?.maxCheckpoints,
        maxPayloadBytes: this.config.memory?.maxPayloadBytes,
      });
    this.platform =
      options.platform ??
      options.platformServices ??
      new NodePlatformServices(this.config.shell.powershellPath);
    this.app = options.app ?? Fastify({ logger: false, bodyLimit: 2_000_000 });
    this.mcpHandler = createMcpHandler((requestContext) =>
      this.createMcpServer(requestContext),
    );
    this.mcpNodeHandler = toNodeHandler(this.mcpHandler);
    void this.app.register(cors, { origin: true });
    this.registerRoutes();
  }

  public getConfig(): QnectorConfig {
    return this.config;
  }

  public async setConfig(config: QnectorConfig): Promise<void> {
    this.config = config;
    this.workspace.replace(config);
    this.memory.setWorkspace(config.activeWorkspace);
    this.memory.setMirrorMode(config.memory?.workspaceMirror ?? "off");
    await this.ensureAutomaticMemoryCheckpoint();
    if (config.memory?.workspaceMirror === "memory-md")
      await this.memory.syncMirror();
    this.processManager.setDefaultShell(config.shell.windows);
    this.ptyManager.setDefaultShell(config.shell.windows);
    if (this.configFile) await saveConfig(config, this.configFile);
  }

  public context(): ToolContext {
    return {
      workspace: this.workspace,
      processManager: this.processManager,
      codeIntelligence: this.codeIntelligence,
      fileSearch: this.fileSearch,
      uiAutomation: this.uiAutomation,
      fileWatch: this.fileWatch,
      browserRuntime: this.browserRuntime,
      genericLsp: this.genericLsp,
      semanticSearch: this.semanticSearch,
      nativeProcess: this.nativeProcess,
      releaseManager: this.releaseManager,
      documentIntelligence: this.documentIntelligence,
      workflowManager: this.workflowManager,
      ptyManager: this.ptyManager,
      memory: this.memory,
      platform: this.platform,
      activity: this.activity,
      getConfig: () => this.config,
      setConfig: (config) => this.setConfig(config),
    };
  }

  public status(): ServerStatus {
    const localUrl = localMcpUrl(this.config.host, this.config.localPort);
    return {
      name: "Qnector",
      version: QNECTOR_VERSION,
      state: this.state,
      host: this.config.host,
      port: this.config.localPort,
      localUrl,
      deviceId: this.config.deviceId,
      machineName: this.config.machineName,
      activeWorkspace: this.config.activeWorkspace,
      transport: this.config.transport.mode,
      startedAt: this.startedAt,
      processCount: this.processManager
        .list()
        .filter((entry) => entry.state === "running").length,
    };
  }

  public async start(
    options: { host?: string; port?: number } = {},
  ): Promise<ServerStatus> {
    if (this.listening) return this.status();
    this.state = "connecting";
    this.startedAt = new Date().toISOString();
    await this.activity.load();
    await this.ensureAutomaticMemoryCheckpoint();
    const host = options.host ?? this.config.host;
    const port = options.port ?? this.config.localPort;
    this.config = { ...this.config, host, localPort: port };
    try {
      await this.app.listen({ host, port });
      this.listening = true;
      this.state = "connected";
      return this.status();
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  public async stop(): Promise<void> {
    await this.mcpHandler.close().catch(() => undefined);
    this.fileWatch.stopAll();
    await Promise.all([
      this.browserRuntime.close().catch(() => undefined),
      Promise.resolve(this.uiAutomation.close?.()).catch(() => undefined),
    ]);
    await this.processManager.stopAll();
    await this.activity.flush();
    if (this.listening) await this.app.close();
    this.listening = false;
    this.state = "disconnected";
  }

  private async ensureAutomaticMemoryCheckpoint(): Promise<void> {
    const compatible = this.memory as MemoryStore & {
      ensureAutomaticCheckpoint?: () => Promise<unknown>;
    };
    if (typeof compatible.ensureAutomaticCheckpoint !== "function") return;
    await compatible.ensureAutomaticCheckpoint().catch(() => undefined);
  }

  private registerRoutes(): void {
    this.app.get("/healthz", async () => ({
      ok: true,
      service: "qnector",
      version: QNECTOR_VERSION,
    }));
    this.app.get("/readyz", async (_request, reply) => {
      if (!this.listening || this.state !== "connected")
        return reply
          .code(503)
          .send({ ok: false, ready: false, state: this.state });
      return {
        ok: true,
        ready: true,
        state: this.state,
        tools: this.registry.list().length,
      };
    });
    this.app.get("/status", async () => this.status());
    this.app.post("/mcp", async (request, reply) =>
      this.handleMcp(request, reply),
    );
    this.app.get("/mcp", async (request, reply) =>
      this.handleMcp(request, reply),
    );
    this.app.delete("/mcp", async (request, reply) =>
      this.handleMcp(request, reply),
    );
  }

  private async handleMcp(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    reply.hijack();
    await this.mcpNodeHandler(
      request.raw,
      reply.raw,
      request.method === "POST" ? request.body : undefined,
    );
  }

  private async createMcpServer(
    requestContext?: McpRequestContext,
  ): Promise<McpServer> {
    const instructions = await this.sessionBootstrapFor(requestContext);
    const server = new McpServer(
      { name: "Qnector", version: QNECTOR_VERSION },
      instructions ? { instructions } : undefined,
    );
    for (const definition of this.registry.list()) {
      const schema = inputSchemaFor(definition);
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: schema,
          annotations: definition.annotations,
        },
        async (input) => {
          const result = await this.registry.call(
            definition.name,
            this.context(),
            input,
          );
          const { attachments, ...jsonResult } = result;
          return {
            content: [
              { type: "text", text: toolResultText(jsonResult) },
              ...(attachments ?? []).map((attachment) => ({
                type: "image" as const,
                data: attachment.dataBase64,
                mimeType: attachment.mimeType,
              })),
            ],
            structuredContent: jsonResult as unknown as Record<string, unknown>,
            isError: !result.ok,
          };
        },
      );
    }
    server.registerResource(
      "workspace-status",
      "qnector://workspace/status",
      {
        title: "Qnector Workspace Status",
        description: "Current Qnector server, workspace and process status.",
        mimeType: "application/json",
      },
      async (uri) => {
        let gitStatus = "not a git repository";
        try {
          gitStatus = (
            await execFileAsync("git", ["status", "--short", "--branch"], {
              cwd: this.config.activeWorkspace,
              windowsHide: true,
            })
          ).stdout.trim();
        } catch {
          // The active workspace may not be a Git repository.
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                { ...this.status(), gitStatus: gitStatus.slice(0, 2_000) },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
    server.registerResource(
      "memory-latest",
      "qnector://memory/latest",
      {
        title: "Latest Qnector Memory",
        description: "Sanitized active task, facts and latest checkpoint.",
        mimeType: "application/json",
      },
      async (uri) => {
        const memory = await this.memory.recall({
          checkpointLimit: 1,
          factLimit: 50,
          changeLimit: 20,
        });
        const bounded = capMemoryResource(memory);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(bounded, null, 2),
            },
          ],
        };
      },
    );
    return server;
  }

  private async sessionBootstrapFor(
    requestContext?: McpRequestContext,
  ): Promise<string | undefined> {
    if (!(await isSessionBootstrapRequest(requestContext))) return undefined;
    try {
      const memory = await this.memory.recall({
        checkpointLimit: 1,
        factLimit: 100,
        changeLimit: 6,
      });
      return buildSessionBootstrapInstructions(memory, this.activity.list());
    } catch (error) {
      return buildSessionBootstrapError(
        this.config.activeWorkspace,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function isSessionBootstrapRequest(
  requestContext?: McpRequestContext,
): Promise<boolean> {
  if (
    !requestContext?.requestInfo ||
    requestContext.requestInfo.method.toUpperCase() !== "POST"
  ) {
    return false;
  }
  try {
    const payload = (await requestContext.requestInfo
      .clone()
      .json()) as unknown;
    if (
      payload === null ||
      Array.isArray(payload) ||
      typeof payload !== "object" ||
      !("method" in payload)
    ) {
      return false;
    }
    const method = (payload as { method?: unknown }).method;
    return method === "initialize" || method === "server/discover";
  } catch {
    return false;
  }
}

function capMemoryResource(value: MemoryRecall): MemoryRecall {
  const maxBytes = 12_000;
  const result = JSON.parse(JSON.stringify(value)) as MemoryRecall;
  const size = (): number => Buffer.byteLength(JSON.stringify(result), "utf8");
  const facts = result.state.facts;
  const changes = result.state.recentChanges;
  const checkpoints = result.checkpoints;
  const initialSize = size();
  while (size() > maxBytes && changes.length > 0) changes.pop();
  while (size() > maxBytes && facts.length > 0) facts.pop();
  while (size() > maxBytes && checkpoints.length > 0) checkpoints.pop();
  if (result.state.active && size() > maxBytes) {
    result.state.active.criticalContext =
      result.state.active.criticalContext.slice(0, 2_000);
    result.state.active.currentTask = result.state.active.currentTask.slice(
      0,
      1_000,
    );
    result.state.active.pendingSteps = result.state.active.pendingSteps
      .slice(0, 20)
      .map((entry) => entry.slice(0, 500));
    result.state.active.completedSteps = result.state.active.completedSteps
      .slice(0, 20)
      .map((entry) => entry.slice(0, 500));
  }
  result.truncated ||= size() < initialSize;
  if (size() > maxBytes) result.warning = "Memory resource was size-limited.";
  return result;
}

function toolResultText(result: Record<string, unknown>): string {
  const summary =
    typeof result.summary === "string"
      ? result.summary
      : "Qnector tool completed";
  if (result.ok === false && result.error && typeof result.error === "object") {
    const error = result.error as {
      code?: unknown;
      message?: unknown;
      hint?: unknown;
    };
    const code = typeof error.code === "string" ? error.code : "TOOL_ERROR";
    const message = typeof error.message === "string" ? error.message : summary;
    const hint = typeof error.hint === "string" ? ` Hint: ${error.hint}` : "";
    return `${code}: ${message}${hint}`;
  }
  return summary;
}

function inputSchemaFor(
  definition: ToolDefinition,
): ReturnType<typeof fromJsonSchema> {
  const cached = mcpInputSchemaCache.get(definition.name);
  if (cached) return cached;
  const schema = fromJsonSchema(definition.inputSchema);
  mcpInputSchemaCache.set(definition.name, schema);
  return schema;
}
export async function createRuntime(
  options: { configFile?: string; workspace?: string; port?: number } = {},
): Promise<QnectorRuntime> {
  const config = await loadConfig({
    file: options.configFile,
    workspace: options.workspace,
  });
  const runtime = new QnectorRuntime({
    config,
    configFile: options.configFile,
  });
  if (options.port) await runtime.start({ port: options.port });
  return runtime;
}
