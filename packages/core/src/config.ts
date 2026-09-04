import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configSchema } from "@qnector/shared";
import type { QnectorConfig, TransportMode } from "@qnector/shared";

export const QNECTOR_VERSION = "0.4.6";

export function configDirectory(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "Qnector",
    );
  }
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Qnector");
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "Qnector",
  );
}

export function configPath(): string {
  return path.join(configDirectory(), "config.json");
}

export function activityLogPath(): string {
  return path.join(configDirectory(), "logs", "activity.jsonl");
}

function defaultShell(): QnectorConfig["shell"] {
  return {
    windows: "powershell",
    defaultTimeoutMs: 120_000,
  };
}

export function defaultConfig(workspace = process.cwd()): QnectorConfig {
  const normalizedWorkspace = path.resolve(workspace);
  const mode: TransportMode = "openai-tunnel";
  return {
    version: 1,
    deviceId: randomUUID(),
    machineName: os.hostname(),
    activeWorkspace: normalizedWorkspace,
    recentWorkspaces: [normalizedWorkspace],
    localPort: 8787,
    host: "127.0.0.1",
    transport: { mode, openaiProfile: "qnector", relayUrl: "" },
    shell: defaultShell(),
    ui: {
      minimizeToTray: true,
      startMinimized: false,
      startAtLogin: false,
      globalShortcut: "CommandOrControl+Shift+Q",
      globalShortcutEnabled: true,
      setupCompleted: false,
      theme: "system",
    },
    memory: {
      workspaceMirror: "off",
      maxCheckpoints: 10,
      maxPayloadBytes: 256_000,
    },
  };
}

export async function saveConfig(
  config: QnectorConfig,
  file = configPath(),
): Promise<void> {
  const parsed = configSchema.parse(config) as QnectorConfig;
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function loadConfig(
  options: { file?: string; workspace?: string; persist?: boolean } = {},
): Promise<QnectorConfig> {
  const file = options.file ?? configPath();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = configSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      const loaded = parsed.data as QnectorConfig;
      return {
        ...loaded,
        shell: normalizeShell(loaded.shell),
        ui: {
          ...loaded.ui,
          setupCompleted: loaded.ui.setupCompleted ?? true,
        },
      };
    }
  } catch {
    // First run or a partially written config: fall through to defaults.
  }
  const config = defaultConfig(options.workspace ?? process.cwd());
  if (options.persist ?? true) await saveConfig(config, file);
  return config;
}

function normalizeShell(shell: QnectorConfig["shell"]): QnectorConfig["shell"] {
  const requested = shell.powershellPath?.trim();
  if (!requested || executableAvailable(requested)) return { ...shell };
  const { powershellPath: _invalid, ...rest } = shell;
  return rest;
}

function executableAvailable(command: string): boolean {
  try {
    if (path.isAbsolute(command)) return existsSync(command);
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    return (
      spawnSync(lookup, [command], {
        windowsHide: true,
        stdio: "ignore",
      }).status === 0
    );
  } catch {
    return false;
  }
}

export function withWorkspace(
  config: QnectorConfig,
  workspace: string,
): QnectorConfig {
  const absolute = path.resolve(workspace);
  return {
    ...config,
    activeWorkspace: absolute,
    recentWorkspaces: [
      absolute,
      ...config.recentWorkspaces.filter(
        (entry) => path.resolve(entry) !== absolute,
      ),
    ].slice(0, 12),
  };
}
