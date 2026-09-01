import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, configPath, QNECTOR_VERSION } from "@qnector/core";
import { QnectorRuntime } from "@qnector/mcp-server";
import {
  CloudflareNamedAdapter,
  CloudflareQuickAdapter,
  LocalOnlyAdapter,
  NgrokAdapter,
  OpenAiTunnelAdapter,
  RelayClient,
} from "@qnector/transports";
import { localMcpUrl } from "@qnector/shared";
import type {
  QnectorConfig,
  ActivityExportOptions,
  ToolResult,
  TransportAdapter,
  TransportSnapshot,
} from "@qnector/shared";
import { ElectronPlatformServices } from "./platform-services.js";
import {
  createWindowsLoginItemSettings,
  LEGACY_WINDOWS_LOGIN_ITEM_NAME,
  WINDOWS_LOGIN_ITEM_NAME,
} from "./login-item.js";
import { DesktopUpdater } from "./updater.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const WINDOWS_APP_ID = WINDOWS_LOGIN_ITEM_NAME;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let runtime: QnectorRuntime | undefined;
let transport: TransportAdapter | undefined;
let updater: DesktopUpdater | undefined;
let isQuitting = false;
let shutdownStarted = false;
let registeredShortcut: string | undefined;

type ConfigPatch = {
  host?: string;
  localPort?: number;
  transport?: Partial<QnectorConfig["transport"]>;
  shell?: Partial<QnectorConfig["shell"]>;
  ui?: Partial<QnectorConfig["ui"]>;
  memory?: Partial<NonNullable<QnectorConfig["memory"]>>;
};

export async function bootstrap(): Promise<void> {
  if (process.platform === "win32") app.setAppUserModelId(WINDOWS_APP_ID);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  await app.whenReady();
  const config = await loadConfig({
    file: configPath(),
    ...(process.env.QNECTOR_WORKSPACE
      ? { workspace: process.env.QNECTOR_WORKSPACE }
      : {}),
  });
  runtime = new QnectorRuntime({
    config,
    configFile: configPath(),
    platform: new ElectronPlatformServices(),
  });
  await runtime.start();
  updater = new DesktopUpdater((state) => broadcast("updater:state", state));
  applyLoginItemSetting(config);
  registerIpc();
  runtime.activity.subscribe((event) => broadcast("activity:new", event.entry));
  runtime.processManager.subscribeAll((snapshot) =>
    broadcast("process:update", snapshot),
  );
  createWindow();
  createTray();
  setTimeout(() => void updater?.check(), 4_000);
  applyGlobalShortcut(config);
  transport = makeTransport(config);
  transport.onState((snapshot) =>
    broadcast("bridge:state", statusWithBridge(snapshot)),
  );
  broadcast("bridge:state", statusWithBridge(transport.getSnapshot()));
  if (config.ui.setupCompleted !== false) {
    void connectBridge().catch((error: unknown) => {
      broadcast(
        "bridge:state",
        statusWithBridge({
          state: "error",
          mode: config.transport.mode,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  } else {
    broadcast(
      "bridge:state",
      statusWithBridge({
        state: "disconnected",
        mode: config.transport.mode,
        message: "Complete Connection Setup to start the OpenAI tunnel.",
      }),
    );
  }
}

function getResourcePath(relativePath: string): string {
  const devPath = path.join(currentDir, "../../resources", relativePath);
  if (existsSync(devPath)) return devPath;
  const prodPath = path.join(process.resourcesPath, relativePath);
  if (existsSync(prodPath)) return prodPath;
  const appPath = path.join(app.getAppPath(), "resources", relativePath);
  if (existsSync(appPath)) return appPath;
  return devPath;
}

function createWindow(): void {
  const iconPath = getResourcePath("icon.png");
  const windowIcon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : undefined;

  mainWindow = new BrowserWindow({
    width: 440,
    height: 820,
    minWidth: 400,
    minHeight: 720,
    backgroundColor: "#121316",
    title: "Qnector",
    icon: windowIcon,
    webPreferences: {
      preload: path.join(currentDir, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: !runtime?.getConfig().ui.startMinimized,
  });
  if (process.platform === "win32") {
    mainWindow.setAppDetails({
      appId: WINDOWS_APP_ID,
      appIconPath: process.execPath,
      appIconIndex: 0,
    });
  }
  void mainWindow.loadFile(path.join(currentDir, "../../index.html"));
  mainWindow.on("close", (event) => {
    const config = runtime?.getConfig();
    if (!isQuitting && config?.ui.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const trayIconPath = getResourcePath("tray-icon.png");
  const trayImage = existsSync(trayIconPath)
    ? nativeImage.createFromPath(trayIconPath)
    : nativeImage.createEmpty();

  tray = new Tray(trayImage);
  tray.setToolTip("Qnector — MCP Bridge");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Qnector",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { label: "Connect", click: () => void connectBridge() },
      { label: "Disconnect", click: () => void disconnectBridge() },
      { label: "Copy MCP URL", click: () => void copyUrl() },
      {
        label: "Check for Updates",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
          void updater?.check();
        },
      },
      {
        label: "Create ChatGPT Plugin",
        click: () => void shell.openExternal("https://chatgpt.com/plugins"),
      },
      {
        label: "Open Logs",
        click: () => void shell.openPath(path.dirname(configPath())),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerIpc(): void {
  ipcMain.handle("status:get", () =>
    statusWithBridge(
      transport?.getSnapshot() ?? {
        state: "disconnected",
        mode: runtime?.getConfig().transport.mode ?? "local-only",
      },
    ),
  );
  ipcMain.handle("config:get", () => runtime?.getConfig());
  ipcMain.handle("setup:inspect", () => inspectConnectionSetup());
  ipcMain.handle("updater:get-state", () => updater?.getState());
  ipcMain.handle("updater:check", () => updater?.check());
  ipcMain.handle("updater:download", () => updater?.download());
  ipcMain.handle("updater:install", () => updater?.install());
  ipcMain.handle("updater:open-release", () =>
    shell
      .openExternal(
        updater?.getReleaseUrl() ??
          "https://github.com/queenleonidasth/Qnector/releases",
      )
      .then(() => undefined),
  );
  ipcMain.handle("config:update", (_event, patch: ConfigPatch) =>
    updateConfig(patch),
  );
  ipcMain.handle("activity:list", () => runtime?.activity.list() ?? []);
  ipcMain.handle("memory:call", (_event, input: Record<string, unknown>) =>
    runtime!.registry.call("memory", runtime!.context(), input),
  );
  ipcMain.handle(
    "tool:call",
    (
      _event,
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
    ) => runtime!.registry.call(tool, runtime!.context(), input),
  );
  ipcMain.handle(
    "activity:export",
    (_event, format: "json" | "markdown", options?: ActivityExportOptions) =>
      exportActivity(format, options),
  );
  ipcMain.handle("memory:export", (_event, format: "json" | "markdown") =>
    exportMemory(format),
  );
  ipcMain.handle("process:list", () => runtime?.processManager.list() ?? []);
  ipcMain.handle(
    "process:output",
    (
      _event,
      processId: string,
      cursor = 0,
      maxChars = 20_000,
      outputMode: "raw" | "smart" = "raw",
    ) =>
      runtime!.processManager.output(processId, cursor, maxChars, outputMode),
  );
  ipcMain.handle("process:stop", async (_event, processId: string) => {
    const snapshot = await runtime!.processManager.stop(processId);
    broadcast("process:update", snapshot);
    return snapshot;
  });
  ipcMain.handle("bridge:connect", () => connectBridge());
  ipcMain.handle("bridge:disconnect", () => disconnectBridge());
  ipcMain.handle("bridge:copy-url", () => copyUrl());
  ipcMain.handle("bridge:open-chatgpt", () =>
    shell.openExternal("https://chatgpt.com/plugins").then(() => undefined),
  );
  ipcMain.handle("workspace:choose", () => chooseWorkspace());
  ipcMain.handle("workspace:set", (_event, workspace: string) =>
    setWorkspace(workspace),
  );
  ipcMain.handle("system:open-path", (_event, target: string) =>
    shell.openPath(path.resolve(target)),
  );
  ipcMain.handle("system:open-terminal", (_event, target: string) => {
    openTerminal(path.resolve(target));
  });
  ipcMain.handle("system:open-url", (_event, url: string) =>
    shell.openExternal(url).then(() => undefined),
  );
}

async function connectBridge(): Promise<TransportSnapshot> {
  if (!transport) transport = makeTransport(runtime!.getConfig());
  const snapshot = await transport.start();
  broadcast("bridge:state", statusWithBridge(snapshot));
  return snapshot;
}

async function disconnectBridge(): Promise<void> {
  await transport?.stop();
  broadcast("bridge:state", statusWithBridge(transport?.getSnapshot()));
}

async function updateConfig(patch: ConfigPatch): Promise<QnectorConfig> {
  const current = runtime!.getConfig();
  const localPort = patch.localPort ?? current.localPort;
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535)
    throw new Error(
      "INVALID_CONFIG: localPort must be an integer from 1 to 65535",
    );
  const next: QnectorConfig = {
    ...current,
    ...(patch.host ? { host: patch.host } : {}),
    localPort,
    transport: { ...current.transport, ...(patch.transport ?? {}) },
    shell: { ...current.shell, ...(patch.shell ?? {}) },
    ui: { ...current.ui, ...(patch.ui ?? {}) },
    memory: { ...(current.memory ?? {}), ...(patch.memory ?? {}) },
  };
  const transportChanged =
    JSON.stringify(current.transport) !== JSON.stringify(next.transport);
  const serverChanged =
    current.host !== next.host || current.localPort !== next.localPort;
  const nextTransport =
    transportChanged || serverChanged ? makeTransport(next) : undefined;

  if (nextTransport) await transport?.stop();
  if (serverChanged) await runtime!.stop();
  await runtime!.setConfig(next);
  if (serverChanged)
    await runtime!.start({ host: next.host, port: next.localPort });
  if (nextTransport) {
    transport = nextTransport;
    transport.onState((snapshot) =>
      broadcast("bridge:state", statusWithBridge(snapshot)),
    );
  }
  applyLoginItemSetting(next);
  applyGlobalShortcut(next);
  broadcast("bridge:state", statusWithBridge(transport?.getSnapshot()));
  return next;
}

async function exportActivity(
  format: "json" | "markdown",
  options?: ActivityExportOptions,
): Promise<string | undefined> {
  if (!mainWindow || !runtime) return undefined;
  const selected = await dialog.showSaveDialog(mainWindow, {
    title: "Export Qnector Activity",
    defaultPath: path.join(
      runtime.getConfig().activeWorkspace,
      `qnector-activity.${format === "json" ? "json" : "md"}`,
    ),
    filters:
      format === "json"
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "Markdown", extensions: ["md"] }],
  });
  if (selected.canceled || !selected.filePath) return undefined;
  await writeFile(
    selected.filePath,
    runtime.activity.export(format, options),
    "utf8",
  );
  return selected.filePath;
}

async function exportMemory(
  format: "json" | "markdown",
): Promise<string | undefined> {
  if (!mainWindow || !runtime) return undefined;
  const selected = await dialog.showSaveDialog(mainWindow, {
    title: "Export Qnector Memory",
    defaultPath: path.join(
      runtime.getConfig().activeWorkspace,
      `qnector-memory.${format === "json" ? "json" : "md"}`,
    ),
    filters:
      format === "json"
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "Markdown", extensions: ["md"] }],
  });
  if (selected.canceled || !selected.filePath) return undefined;
  await writeFile(
    selected.filePath,
    (await runtime.memory.export(format)).content,
    "utf8",
  );
  return selected.filePath;
}

async function copyUrl(): Promise<string> {
  const url =
    transport?.getSnapshot().publicUrl ??
    localMcpUrl(runtime!.getConfig().host, runtime!.getConfig().localPort);
  clipboard.writeText(url);
  return url;
}

async function chooseWorkspace(): Promise<
  ReturnType<QnectorRuntime["status"]>
> {
  if (!mainWindow) return runtime!.status();
  const selection = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) return runtime!.status();
  return setWorkspace(selection.filePaths[0]);
}

async function setWorkspace(
  workspace: string,
): Promise<ReturnType<QnectorRuntime["status"]>> {
  const next = await runtime!.workspace.set(workspace);
  await runtime!.setConfig(next);
  broadcast("bridge:state", statusWithBridge(transport?.getSnapshot()));
  return runtime!.status();
}

function makeTransport(config: QnectorConfig): TransportAdapter {
  const localUrl = localMcpUrl(config.host, config.localPort);
  switch (config.transport.mode) {
    case "cloudflare-quick":
      return new CloudflareQuickAdapter(
        localUrl,
        resolveCloudflaredExecutable(config.transport.cloudflaredPath),
      );
    case "cloudflare-named":
      if (!config.transport.namedHostname)
        throw new Error(
          "namedHostname is required for cloudflare-named transport",
        );
      return new CloudflareNamedAdapter(localUrl, {
        executable: config.transport.cloudflaredPath,
        hostname: config.transport.namedHostname,
        token: config.transport.namedTunnelToken,
      });
    case "ngrok":
      return new NgrokAdapter(localUrl, {
        executable: config.transport.ngrokPath,
        domain: config.transport.ngrokDomain,
        authtoken: config.transport.ngrokAuthtoken,
      });
    case "openai-tunnel":
      return new OpenAiTunnelAdapter(localUrl, {
        executable: resolveOpenAiTunnelClientExecutable(
          config.transport.openaiTunnelClientPath,
        ),
        profile: config.transport.openaiProfile,
        tunnelId: config.transport.openaiTunnelId,
        runtimeApiKey: config.transport.openaiRuntimeApiKey,
      });
    case "relay": {
      const relayBase = config.transport.relayUrl ?? "";
      const relayUrl = relayBase.endsWith(`/agent/${config.deviceId}`)
        ? relayBase
        : `${relayBase.replace(/\/$/, "")}/agent/${config.deviceId}`;
      return new RelayClient(config.host, config.localPort, {
        relayUrl,
        deviceId: config.deviceId,
        version: QNECTOR_VERSION,
      });
    }
    case "local-only":
    default:
      return new LocalOnlyAdapter(localUrl);
  }
}

function resolveCloudflaredExecutable(configured?: string): string {
  if (configured?.trim()) return configured.trim();
  if (process.platform !== "win32") return "cloudflared";

  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value));
  const candidates = [
    path.join(process.resourcesPath, "cloudflared.exe"),
    ...roots.map((root) => path.join(root, "cloudflared", "cloudflared.exe")),
    ...(process.env.LOCALAPPDATA
      ? [
          path.join(
            process.env.LOCALAPPDATA,
            "Microsoft",
            "WinGet",
            "Links",
            "cloudflared.exe",
          ),
        ]
      : []),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "cloudflared";
}

function resolveOpenAiTunnelClientExecutable(configured?: string): string {
  if (configured?.trim()) return configured.trim();
  if (process.platform !== "win32") return "tunnel-client";
  const directCandidates = [
    path.join(process.resourcesPath, "openai-tunnel", "tunnel-client.exe"),
    path.join(process.resourcesPath, "tunnel-client.exe"),
    path.resolve(process.cwd(), "tools", "tunnel-client", "tunnel-client.exe"),
  ];
  const roots = [
    path.join(process.resourcesPath, "bin"),
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value));
  const candidates = [
    ...directCandidates,
    ...roots.flatMap((root) => [
      path.join(root, "tunnel-client.exe"),
      path.join(root, "OpenAI", "tunnel-client.exe"),
      path.join(root, "Qnector", "tunnel-client.exe"),
    ]),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? "tunnel-client.exe"
  );
}

function inspectConnectionSetup(): {
  mode: QnectorConfig["transport"]["mode"];
  setupCompleted: boolean;
  clientPath: string;
  clientAvailable: boolean;
  profile: string;
  tunnelIdConfigured: boolean;
  runtimeApiKeyConfigured: boolean;
  bridge: TransportSnapshot;
} {
  const config = runtime!.getConfig();
  const clientPath = resolveOpenAiTunnelClientExecutable(
    config.transport.openaiTunnelClientPath,
  );
  return {
    mode: config.transport.mode,
    setupCompleted: config.ui.setupCompleted === true,
    clientPath,
    clientAvailable: existsSync(clientPath),
    profile: config.transport.openaiProfile?.trim() || "qnector",
    tunnelIdConfigured: Boolean(config.transport.openaiTunnelId?.trim()),
    runtimeApiKeyConfigured: Boolean(
      config.transport.openaiRuntimeApiKey?.trim(),
    ),
    bridge: transport?.getSnapshot() ?? {
      state: "disconnected",
      mode: config.transport.mode,
    },
  };
}

function statusWithBridge(snapshot: TransportSnapshot | undefined): ReturnType<
  QnectorRuntime["status"]
> & {
  bridge: TransportSnapshot;
  publicUrl?: string;
} {
  const status = runtime!.status();
  const bridge = snapshot ?? {
    state: "disconnected" as const,
    mode: status.transport,
  };
  return {
    ...status,
    state: bridge.state === "error" ? "error" : status.state,
    bridge,
    ...(bridge.publicUrl ? { publicUrl: bridge.publicUrl } : {}),
  };
}

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, payload);
}

function openTerminal(target: string): void {
  if (process.platform === "win32") {
    const executable =
      runtime?.getConfig().shell.powershellPath ?? "powershell.exe";
    const child = spawn(executable, ["-NoLogo", "-NoExit"], {
      cwd: target,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", () => {
      const fallback = spawn("powershell.exe", ["-NoLogo", "-NoExit"], {
        cwd: target,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      fallback.unref();
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

function applyLoginItemSetting(config: QnectorConfig): void {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  const openAtLogin = config.ui.startAtLogin === true;
  if (process.platform === "win32") {
    app.setLoginItemSettings(
      createWindowsLoginItemSettings(
        openAtLogin,
        process.env,
        process.execPath,
      ),
    );
    // Older releases used Electron's default value name. Disable that stale
    // item so a portable update cannot leave a second Temp-based entry behind.
    app.setLoginItemSettings({
      openAtLogin: false,
      enabled: false,
      name: LEGACY_WINDOWS_LOGIN_ITEM_NAME,
    });
    return;
  }
  app.setLoginItemSettings({ openAtLogin });
}

async function shutdown(): Promise<void> {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = undefined;
  }
  await transport?.stop().catch(() => undefined);
  await runtime?.stop().catch(() => undefined);
  tray?.destroy();
}

function applyGlobalShortcut(config: QnectorConfig): void {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = undefined;
  }
  const shortcut =
    config.ui.globalShortcut?.trim() ?? "CommandOrControl+Shift+Q";
  if (config.ui.globalShortcutEnabled === false || !shortcut) return;
  const registered = globalShortcut.register(shortcut, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  if (registered) {
    registeredShortcut = shortcut;
    return;
  }
  void runtime?.activity.record({
    tool: "system",
    action: "global_shortcut",
    argsSummary: JSON.stringify({ shortcut }),
    status: "error",
    summary: `Could not register global shortcut ${shortcut}`,
  });
}
app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  isQuitting = true;
  shutdownStarted = true;
  void shutdown().finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    /* tray keeps Qnector alive until Quit */
  }
});

if (process.env.QNECTOR_NO_BOOTSTRAP !== "1") void bootstrap();
