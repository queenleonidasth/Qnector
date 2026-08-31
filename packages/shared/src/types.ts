export type BridgeState = "disconnected" | "connecting" | "connected" | "error";

export type TransportMode =
  | "local-only"
  | "cloudflare-quick"
  | "cloudflare-named"
  | "ngrok"
  | "openai-tunnel"
  | "relay";

export interface TransportConfig {
  mode: TransportMode;
  cloudflaredPath?: string;
  namedHostname?: string;
  namedTunnelToken?: string;
  ngrokPath?: string;
  ngrokDomain?: string;
  ngrokAuthtoken?: string;
  openaiTunnelClientPath?: string;
  openaiProfile?: string;
  openaiTunnelId?: string;
  openaiRuntimeApiKey?: string;
  relayUrl?: string;
}

export interface ShellConfig {
  windows: "powershell" | "cmd";
  powershellPath?: string;
  defaultTimeoutMs: number;
}

export interface UiConfig {
  minimizeToTray: boolean;
  startMinimized: boolean;
  startAtLogin?: boolean;
  globalShortcut?: string;
  globalShortcutEnabled?: boolean;
  theme: "system" | "light" | "dark";
}

export interface MemoryConfig {
  workspaceMirror?: "off" | "memory-md";
  maxCheckpoints?: number;
  maxPayloadBytes?: number;
}

export interface QnectorConfig {
  version: 1;
  deviceId: string;
  machineName: string;
  activeWorkspace: string;
  recentWorkspaces: string[];
  localPort: number;
  host: string;
  transport: TransportConfig;
  shell: ShellConfig;
  ui: UiConfig;
  memory?: MemoryConfig;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  tool: string;
  action: string;
  argsSummary: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  outputSize?: number;
  summary?: string;
  error?: ToolError;
}

export type MemoryCategory = "fact" | "decision" | "rule" | "note";

export interface MemoryActiveState {
  currentTask: string;
  completedSteps: string[];
  pendingSteps: string[];
  criticalContext: string;
}

export interface MemoryFact {
  id: string;
  key: string;
  category: MemoryCategory;
  value: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryChange {
  timestamp: string;
  source: "files" | "git" | "manual";
  summary: string;
  paths: string[];
}

export interface MemoryState {
  version: 1;
  workspaceId: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  active: MemoryActiveState | null;
  facts: MemoryFact[];
  recentChanges: MemoryChange[];
}

export interface MemoryCheckpoint {
  id: string;
  createdAt: string;
  label?: string;
  active: MemoryActiveState | null;
}

export interface ProcessSnapshot {
  id: string;
  pid?: number;
  command: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  state: "running" | "exited" | "failed" | "stopped";
  exitCode?: number | null;
  cursor: number;
  outputSize: number;
}

export interface ToolError {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
}

export interface ToolMeta {
  durationMs: number;
  truncated: boolean;
  nextCursor: string | number | null;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  action: string;
  summary: string;
  data?: T;
  attachments?: ToolAttachment[];
  error?: ToolError;
  meta: ToolMeta;
}

export interface ToolAttachment {
  type: "image";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataBase64: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface ToolAnnotation {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name:
    | "system"
    | "workspace"
    | "files"
    | "process"
    | "git"
    | "memory"
    | "browser"
    | "computer";
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotation;
}

export interface ActivityExportOptions {
  tool?: string;
  status?: ActivityEntry["status"];
  from?: string;
  to?: string;
}

export interface ServerStatus {
  name: "Qnector";
  version: string;
  state: BridgeState;
  host: string;
  port: number;
  localUrl: string;
  publicUrl?: string;
  deviceId: string;
  machineName: string;
  activeWorkspace: string;
  transport: TransportMode;
  startedAt: string;
  processCount: number;
}

export interface HttpRequestMessage {
  type: "http.request";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyBase64?: string;
}

export interface HttpResponseStartMessage {
  type: "http.response.start";
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

export interface HttpResponseChunkMessage {
  type: "http.response.chunk";
  requestId: string;
  sequence: number;
  bodyBase64: string;
}

export interface HttpResponseEndMessage {
  type: "http.response.end";
  requestId: string;
}

export type RelayMessage =
  | HttpRequestMessage
  | HttpResponseStartMessage
  | HttpResponseChunkMessage
  | HttpResponseEndMessage
  | { type: "agent.hello"; deviceId: string; version: string }
  | { type: "agent.ready"; deviceId: string }
  | { type: "heartbeat.ping"; timestamp: string }
  | { type: "heartbeat.pong"; timestamp: string }
  | { type: "request.cancel"; requestId: string }
  | { type: "agent.error"; requestId?: string; error: ToolError };

export interface TransportSnapshot {
  state: BridgeState;
  mode: TransportMode;
  publicUrl?: string;
  message?: string;
}

export interface TransportAdapter {
  readonly mode: TransportMode;
  start(): Promise<TransportSnapshot>;
  stop(): Promise<void>;
  getSnapshot(): TransportSnapshot;
  onState(listener: (snapshot: TransportSnapshot) => void): () => void;
}
