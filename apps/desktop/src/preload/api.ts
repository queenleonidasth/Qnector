import type { DesktopUpdateState } from "../updater-types.js";
import type {
  ActivityEntry,
  ProcessSnapshot,
  QnectorConfig,
  ServerStatus,
  TransportConfig,
  TransportSnapshot,
  ActivityExportOptions,
  ToolResult,
} from "@qnector/shared";

export interface ConnectionSetupStatus {
  mode: TransportConfig["mode"];
  setupCompleted: boolean;
  clientPath: string;
  clientAvailable: boolean;
  profile: string;
  tunnelIdConfigured: boolean;
  runtimeApiKeyConfigured: boolean;
  bridge: TransportSnapshot;
}

export interface QnectorApi {
  getStatus(): Promise<
    ServerStatus & { publicUrl?: string; bridge: TransportSnapshot }
  >;
  connect(): Promise<TransportSnapshot>;
  disconnect(): Promise<void>;
  chooseWorkspace(): Promise<ServerStatus>;
  setWorkspace(path: string): Promise<ServerStatus>;
  getActivity(): Promise<ActivityEntry[]>;
  callMemory(input: Record<string, unknown>): Promise<ToolResult>;
  callTool(
    tool:
      | "system"
      | "workspace"
      | "files"
      | "process"
      | "git"
      | "memory"
      | "browser"
      | "computer",
    input: Record<string, unknown>,
  ): Promise<ToolResult>;
  exportActivity(
    format: "json" | "markdown",
    options?: ActivityExportOptions,
  ): Promise<string | undefined>;
  exportMemory(format: "json" | "markdown"): Promise<string | undefined>;
  getProcesses(): Promise<ProcessSnapshot[]>;
  stopProcess(processId: string): Promise<ProcessSnapshot>;
  copyMcpUrl(): Promise<string>;
  openChatGpt(): Promise<void>;
  openPath(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  getConfig(): Promise<QnectorConfig>;
  getConnectionSetup(): Promise<ConnectionSetupStatus>;
  getUpdateState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  downloadUpdate(): Promise<DesktopUpdateState>;
  installUpdate(): Promise<DesktopUpdateState>;
  openUpdateRelease(): Promise<void>;
  updateConfig(patch: {
    host?: string;
    localPort?: number;
    transport?: Partial<TransportConfig>;
    shell?: Partial<QnectorConfig["shell"]>;
    ui?: Partial<QnectorConfig["ui"]>;
    memory?: Partial<NonNullable<QnectorConfig["memory"]>>;
  }): Promise<QnectorConfig>;
  getProcessOutput(
    processId: string,
    cursor?: number,
    maxChars?: number,
    outputMode?: "raw" | "smart",
  ): Promise<{
    processId: string;
    text: string;
    cursor: number;
    nextCursor: number;
    truncated: boolean;
    state: ProcessSnapshot["state"];
    reductionMode?: "raw" | "smart";
    omittedChars?: number;
    omittedLines?: number;
  }>;
  openTerminal(path: string): Promise<void>;
  onStatus(
    listener: (
      status: ServerStatus & { publicUrl?: string; bridge: TransportSnapshot },
    ) => void,
  ): () => void;
  onActivity(listener: (entry: ActivityEntry) => void): () => void;
  onProcess(listener: (process: ProcessSnapshot) => void): () => void;
  onUpdate(listener: (state: DesktopUpdateState) => void): () => void;
}

declare global {
  interface Window {
    qnector: QnectorApi;
  }
}

export type {
  ActivityEntry,
  ActivityExportOptions,
  ProcessSnapshot,
  ServerStatus,
  ToolResult,
  TransportSnapshot,
};
