import { contextBridge, ipcRenderer } from "electron";
import type { QnectorApi } from "./api.js";

const api: QnectorApi = {
  getStatus: () => ipcRenderer.invoke("status:get"),
  connect: () => ipcRenderer.invoke("bridge:connect"),
  disconnect: () => ipcRenderer.invoke("bridge:disconnect"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  setWorkspace: (path) => ipcRenderer.invoke("workspace:set", path),
  getActivity: () => ipcRenderer.invoke("activity:list"),
  callMemory: (input) => ipcRenderer.invoke("memory:call", input),
  callTool: (tool, input) => ipcRenderer.invoke("tool:call", tool, input),
  exportActivity: (format, options) =>
    ipcRenderer.invoke("activity:export", format, options),
  exportMemory: (format) => ipcRenderer.invoke("memory:export", format),
  getProcesses: () => ipcRenderer.invoke("process:list"),
  getProcessOutput: (processId, cursor, maxChars, outputMode) =>
    ipcRenderer.invoke(
      "process:output",
      processId,
      cursor,
      maxChars,
      outputMode,
    ),
  stopProcess: (processId) => ipcRenderer.invoke("process:stop", processId),
  copyMcpUrl: () => ipcRenderer.invoke("bridge:copy-url"),
  openChatGpt: () => ipcRenderer.invoke("bridge:open-chatgpt"),
  openPath: (path) => ipcRenderer.invoke("system:open-path", path),
  openTerminal: (path) => ipcRenderer.invoke("system:open-terminal", path),
  openUrl: (url) => ipcRenderer.invoke("system:open-url", url),
  getConfig: () => ipcRenderer.invoke("config:get"),
  getConnectionSetup: () => ipcRenderer.invoke("setup:inspect"),
  getUpdateState: () => ipcRenderer.invoke("updater:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  openUpdateRelease: () => ipcRenderer.invoke("updater:open-release"),
  updateConfig: (patch) => ipcRenderer.invoke("config:update", patch),
  onStatus: (listener) => subscribe("bridge:state", listener),
  onActivity: (listener) => subscribe("activity:new", listener),
  onProcess: (listener) => subscribe("process:update", listener),
  onUpdate: (listener) => subscribe("updater:state", listener),
};

function subscribe<T>(
  channel: string,
  listener: (value: T) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void =>
    listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("qnector", api);
