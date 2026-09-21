import path from "node:path";
import {
  ActivityLogger,
  activityLogPath,
  ProcessManager,
  WorkspaceState,
  MemoryStore,
  MemoryV2Store,
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
  ResourceCoordinator,
  PtyManager,
  AgentSkillService,
} from "@qnector/core";
import type { QnectorConfig } from "@qnector/shared";
import type { ToolContext } from "@qnector/tools";
import { ToolRegistry } from "@qnector/tools";
import type { QnectorRuntimeOptions } from "./server.js";

/** Owns service composition, not execution. Injected services retain their identity. */
export function createRuntimeServices(input: {
  options: QnectorRuntimeOptions;
  configFile?: string;
  getConfig: () => QnectorConfig;
  getContext: () => ToolContext;
  registry: ToolRegistry;
}) {
  const { options, configFile, getConfig, getContext, registry } = input;
  const processManager =
    options.processManager ?? new ProcessManager(getConfig().shell.windows);
  const codeIntelligence =
    options.codeIntelligence ?? new TypeScriptCodeIntelligence();
  const fileSearch = options.fileSearch ?? new WindowsFileSearchService();
  const uiAutomation =
    options.uiAutomation ??
    new WindowsUiAutomationService({
      powershellPath: getConfig().shell.powershellPath,
    });
  const fileWatch = options.fileWatch ?? new FileWatchService();
  const browserRuntime = options.browserRuntime ?? new ManagedBrowserRuntime();
  const genericLsp = options.genericLsp ?? new GenericLspService();
  const semanticSearch =
    options.semanticSearch ?? new LocalSemanticSearchService();
  const nativeProcess =
    options.nativeProcess ??
    new NativeProcessService(getConfig().shell.powershellPath);
  const releaseManager = options.releaseManager ?? new ReleaseManager();
  const documentIntelligence =
    options.documentIntelligence ?? new DocumentIntelligenceService();
  const resourceCoordinator =
    options.resourceCoordinator ?? new ResourceCoordinator();
  const workflowManager =
    options.workflowManager ??
    new WorkflowManager(processManager, fileWatch, {
      resourceCoordinator: resourceCoordinator,
      executeTool: async (tool, input, workflowContext) => {
        const scopedConfig = {
          ...getConfig(),
          activeWorkspace: workflowContext.workspace,
        };
        const scopedContext: ToolContext = {
          ...getContext(),
          workspace: new WorkspaceState(scopedConfig),
          abortSignal: workflowContext.signal,
          resourceCoordinator: resourceCoordinator,
          resourceOwnerToken: workflowContext.resourceOwnerToken,
          getConfig: () => scopedConfig,
          setConfig: async () => {
            throw new Error(
              "WORKFLOW_WORKSPACE_PINNED: tool steps cannot change the active workspace for a running workflow",
            );
          },
        };
        return registry.call(tool, scopedContext, {
          ...input,
          ...(workflowContext.memoryTaskId
            ? { memoryTaskId: workflowContext.memoryTaskId }
            : {}),
        });
      },
    });
  const ptyManager =
    options.ptyManager ?? new PtyManager(getConfig().shell.windows);
  const agentSkills =
    options.agentSkills ??
    new AgentSkillService({
      roots: defaultAgentSkillRoots(),
      workspaceRoot: () => getConfig().activeWorkspace,
    });
  const activity =
    options.logger ??
    new ActivityLogger(
      activityLogPath(),
      500,
      10_000_000,
      options.nonBlockingActivityWrites ?? false,
    );
  const workspace = new WorkspaceState(getConfig());
  const memory =
    options.memory ??
    new MemoryStore(getConfig().activeWorkspace, {
      ...(configFile
        ? {
            rootDirectory: path.join(path.dirname(configFile), "memory"),
          }
        : {}),
      workspaceMirror: getConfig().memory?.workspaceMirror ?? "off",
      maxCheckpoints: getConfig().memory?.maxCheckpoints,
      maxPayloadBytes: getConfig().memory?.maxPayloadBytes,
    });
  const memoryV2 = new MemoryV2Store(getConfig().activeWorkspace, {
    ...(configFile
      ? { file: path.join(path.dirname(configFile), "memory-v2.sqlite") }
      : {}),
  });
  const platform =
    options.platform ??
    options.platformServices ??
    new NodePlatformServices(getConfig().shell.powershellPath);
  return {
    processManager,
    codeIntelligence,
    fileSearch,
    uiAutomation,
    fileWatch,
    browserRuntime,
    genericLsp,
    semanticSearch,
    nativeProcess,
    releaseManager,
    documentIntelligence,
    resourceCoordinator,
    workflowManager,
    ptyManager,
    agentSkills,
    activity,
    workspace,
    memory,
    memoryV2,
    platform,
  };
}

function defaultAgentSkillRoots() {
  const runtimeResources = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const appData = process.env.APPDATA;
  return [
    ...(runtimeResources
      ? [{ path: path.join(runtimeResources, "skills"), source: "bundled" }]
      : []),
    // Project skills are resolved dynamically from config.activeWorkspace.
    ...(appData
      ? [{ path: path.join(appData, "Qnector", "skills"), source: "user" }]
      : []),
  ];
}
