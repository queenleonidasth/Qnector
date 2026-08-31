import { z } from "zod";

export const transportModeSchema = z.enum([
  "local-only",
  "cloudflare-quick",
  "cloudflare-named",
  "ngrok",
  "openai-tunnel",
  "relay",
]);

export const configSchema = z.object({
  version: z.literal(1),
  deviceId: z.string().min(1),
  machineName: z.string().min(1),
  activeWorkspace: z.string().min(1),
  recentWorkspaces: z.array(z.string()),
  localPort: z.number().int().min(1).max(65535),
  host: z.string().min(1),
  transport: z.object({
    mode: transportModeSchema,
    cloudflaredPath: z.string().optional(),
    namedHostname: z.string().optional(),
    namedTunnelToken: z.string().optional(),
    ngrokPath: z.string().optional(),
    ngrokDomain: z.string().optional(),
    ngrokAuthtoken: z.string().optional(),
    openaiTunnelClientPath: z.string().optional(),
    openaiProfile: z.string().optional(),
    openaiTunnelId: z.string().optional(),
    openaiRuntimeApiKey: z.string().optional(),
    relayUrl: z.string().optional(),
  }),
  shell: z.object({
    windows: z.enum(["powershell", "cmd"]),
    powershellPath: z.string().optional(),
    defaultTimeoutMs: z.number().int().positive(),
  }),
  ui: z.object({
    minimizeToTray: z.boolean(),
    startMinimized: z.boolean(),
    startAtLogin: z.boolean().optional(),
    globalShortcut: z.string().min(1).optional(),
    globalShortcutEnabled: z.boolean().optional(),
    setupCompleted: z.boolean().optional(),
    theme: z.enum(["system", "light", "dark"]),
  }),
  memory: z
    .object({
      workspaceMirror: z.enum(["off", "memory-md"]).optional(),
      maxCheckpoints: z.number().int().min(1).max(100).optional(),
      maxPayloadBytes: z.number().int().min(1024).max(1_000_000).optional(),
    })
    .optional(),
});

export const memoryCategorySchema = z.enum([
  "fact",
  "decision",
  "rule",
  "note",
]);

export const memoryStateSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string().min(1),
  workspacePath: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  active: z
    .object({
      currentTask: z.string(),
      completedSteps: z.array(z.string()),
      pendingSteps: z.array(z.string()),
      criticalContext: z.string(),
    })
    .nullable(),
  facts: z.array(
    z.object({
      id: z.string().min(1),
      key: z.string().min(1),
      category: memoryCategorySchema,
      value: z.string(),
      tags: z.array(z.string()),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
    }),
  ),
  recentChanges: z.array(
    z.object({
      timestamp: z.string().min(1),
      source: z.enum(["files", "git", "manual"]),
      summary: z.string(),
      paths: z.array(z.string()),
    }),
  ),
});

export const memoryCheckpointSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  label: z.string().optional(),
  active: memoryStateSchema.shape.active,
});

export const relayMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http.request"),
    requestId: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
    headers: z.record(z.string(), z.string()),
    bodyBase64: z.string().optional(),
  }),
  z.object({
    type: z.literal("http.response.start"),
    requestId: z.string().min(1),
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
  }),
  z.object({
    type: z.literal("http.response.chunk"),
    requestId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    bodyBase64: z.string(),
  }),
  z.object({
    type: z.literal("http.response.end"),
    requestId: z.string().min(1),
  }),
  z.object({
    type: z.literal("agent.hello"),
    deviceId: z.string().min(1),
    version: z.string().min(1),
  }),
  z.object({ type: z.literal("agent.ready"), deviceId: z.string().min(1) }),
  z.object({ type: z.literal("heartbeat.ping"), timestamp: z.string() }),
  z.object({ type: z.literal("heartbeat.pong"), timestamp: z.string() }),
  z.object({ type: z.literal("request.cancel"), requestId: z.string().min(1) }),
  z.object({
    type: z.literal("agent.error"),
    requestId: z.string().optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      hint: z.string().optional(),
      details: z.unknown().optional(),
    }),
  }),
]);

export type ConfigInput = z.input<typeof configSchema>;
