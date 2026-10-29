const { contextBridge } = require("electron");

const bridge = {
  state: process.env.QNECTOR_QC_OFFLINE === "on" ? "disconnected" : "connected",
  mode: "local-only",
};
const status = {
  host: "127.0.0.1",
  port: 18887,
  localPort: 18887,
  localUrl: "http://127.0.0.1:18887/mcp",
  machineName: "QNECTOR-QC-ISOLATED",
  activeWorkspace: "C:\\QNector-QC-Fixture",
  bridge,
  toolsCount: 13,
  uptimeMs: 42000,
};
const config = {
  version: 1,
  deviceId: "qc-renderer-fixture",
  machineName: status.machineName,
  activeWorkspace: status.activeWorkspace,
  recentWorkspaces: [status.activeWorkspace],
  localPort: 18887,
  host: "127.0.0.1",
  transport: { mode: "local-only" },
  shell: { windows: "powershell", defaultTimeoutMs: 30000 },
  ui: {
    minimizeToTray: true,
    startMinimized: false,
    startAtLogin: false,
    globalShortcutEnabled: false,
    setupCompleted: true,
    animationsEnabled: process.env.QNECTOR_QC_MOTION === "on",
    theme: "dark",
  },
  memory: {
    workspaceMirror: "off",
    maxCheckpoints: 10,
    maxPayloadBytes: 100000,
  },
};
const memory = {
  available: true,
  workspaceId: "qc-renderer-fixture",
  workspacePath: status.activeWorkspace,
  updatedAt: new Date().toISOString(),
  sanitized: true,
  state: {
    active: {
      currentTask: "Review accessible QC UI",
      completedSteps: ["Connect securely", "Run software checks"],
      pendingSteps: ["Verify memory drawer", "Inspect Skills and Runtime"],
      criticalContext: "Synthetic test data; no live Qnector or private files",
    },
    facts: [
      {
        id: "qc1",
        key: "fixture-data",
        category: "fact",
        value: "Synthetic context",
        tags: ["test"],
        updatedAt: new Date().toISOString(),
      },
    ],
    recentChanges: [],
  },
  checkpoints: [],
  counts: { facts: 1, checkpoints: 0, recentChanges: 0 },
  v2: {
    workspaceId: "qc-renderer-fixture",
    memories: [],
    tasks: [],
    events: [],
    counts: { memories: 0, tasks: 0, events: 0 },
    conflicts: [],
    lastSession: null,
  },
};
let callCount = 0;
let failNextRuntime = false;
const result = (action, data = {}) => ({
  ok: true,
  tool: "system",
  action,
  summary: "QA mock " + action,
  data: { data },
  meta: { durationMs: 2, truncated: false },
});
function callTool(tool, input) {
  callCount++;
  const action = input?.action || "read";
  if (tool === "system" && action === "doctor" && failNextRuntime) {
    failNextRuntime = false;
    return Promise.reject(new Error("QC_SYNTHETIC_RUNTIME_FAILURE"));
  }
  if (tool === "system") {
    switch (action) {
      case "doctor":
        return Promise.resolve(
          result(action, {
            healthy: true,
            checks: [
              { name: "build", status: "pass", detail: "Packaged fixture" },
              { name: "mcp-tools", status: "pass", detail: "Ready" },
            ],
          }),
        );
      case "performance":
        return Promise.resolve(
          result(action, {
            uptimeMs: 42000,
            portableCache: { enabled: false, hit: null },
            milestones: [
              { name: "window-created", elapsedMs: 151 },
              { name: "mcp-runtime-ready", elapsedMs: 1122 },
              { name: "bridge-connected", elapsedMs: 2733 },
            ],
            aggregates: [],
            recentOperations: [],
          }),
        );
      case "release_status":
        return Promise.resolve(
          result(action, {
            status: "candidate",
            releaseRoot: "C:\\Qnector-QC-Fixture",
            packagedBuildCount: 1,
            recommendation: "Synthetic QC only",
            runningMatchesLatest: true,
            sourceChangedSinceLatestPackage: false,
          }),
        );
      case "context_snapshot":
        return Promise.resolve(
          result(action, {
            capturedAt: new Date().toISOString(),
            build: { version: "0.4.52", buildId: "qc-fixture" },
            workspace: status.activeWorkspace,
            managedProcesses: [],
            nativeQnectorProcesses: [],
            recentActivity: [],
            capabilities: {
              workflow: true,
              documentIntelligence: true,
              nativeProcess: true,
              releaseManager: true,
            },
          }),
        );
      case "mcp_servers":
        return Promise.resolve(result(action, { servers: [] }));
      case "mcp_tools":
        return Promise.resolve(result(action, { total: 0, tools: [] }));
      case "skills_list":
        return Promise.resolve(result(action, { skills: [], total: 0 }));
      case "skills_status":
        return Promise.resolve(
          result(action, { total: 0, enabled: 0, roots: [] }),
        );
      case "skills_search_remote":
        return Promise.resolve(result(action, { skills: [], total: 0 }));
      default:
        return Promise.resolve(result(action, {}));
    }
  }
  if (tool === "process") {
    if (action === "workflow_runs")
      return Promise.resolve(result(action, { runs: [] }));
    return Promise.resolve(result(action, { sessions: [], tasks: [] }));
  }
  if (tool === "memory") return Promise.resolve(result(action, memory));
  return Promise.resolve(result(action, {}));
}
const noop = () => () => {};
const statusListeners = new Set();
const emitQcBridge = (state) => {
  bridge.state = state;
  status.bridge = bridge;
  for (const fn of statusListeners) fn({ ...status, bridge: { ...bridge } });
};
const prevent = async () => {
  throw new Error("QC_FIXTURE_BLOCKS_MUTATING_ACTIONS");
};
const seededActivity =
  process.env.QNECTOR_QC_SEED_ACTIVITY === "on"
    ? [
        {
          id: "qa1",
          timestamp: "2026-10-29T16:40:00.000Z",
          tool: "system",
          action: "screen_capture",
          argsSummary: 'action="screen_capture"; source="primary"',
          status: "success",
          durationMs: 348,
        },
        {
          id: "qa2",
          timestamp: "2026-10-29T16:39:48.000Z",
          tool: "process",
          action: "run",
          argsSummary: "Build QNECTOR desktop renderer and test changes",
          status: "running",
        },
        {
          id: "qa3",
          timestamp: "2026-10-29T16:39:02.000Z",
          tool: "mcp",
          action: "exchange",
          argsSummary: '{traceId:"c0af49cf-7fa2-4481-a39b"}',
          status: "success",
          durationMs: 1923,
        },
        {
          id: "qa4",
          timestamp: "2026-10-29T16:38:46.000Z",
          tool: "files",
          action: "inspect",
          argsSummary: "path=D:/Projects/Qnector/renderer.tsx",
          status: "success",
          durationMs: 78,
          skillTrace: { skills: ["UI UX Pro Max", "Impeccable"] },
        },
        {
          id: "qa5",
          timestamp: "2026-10-29T16:38:01.000Z",
          tool: "browser",
          action: "navigate",
          argsSummary: 'url="https://localhost:18887"',
          status: "error",
          durationMs: 1204,
        },
        {
          id: "qa6",
          timestamp: "2026-10-29T16:37:30.000Z",
          tool: "memory",
          action: "recall",
          argsSummary: "Task=UI production QA and optical alignment",
          status: "success",
          durationMs: 15,
        },
        {
          id: "qa7",
          timestamp: "2026-10-29T16:36:12.000Z",
          tool: "system",
          action: "window_focus",
          argsSummary: "windowId=qnector-window",
          status: "success",
          durationMs: 104,
        },
        {
          id: "qa8",
          timestamp: "2026-10-29T16:35:04.000Z",
          tool: "mcp",
          action: "exchange",
          argsSummary: "Check QNECTOR MCP connection status",
          status: "success",
          durationMs: 389,
        },
      ]
    : [];
const api = {
  getWindowVisible: async () => true,
  onWindowVisible: noop,
  getBootstrap: async () => ({
    status,
    config,
    activity: seededActivity,
    processes: [],
    update: undefined,
    runtimeReady: true,
  }),
  getStatus: async () => status,
  getConfig: async () => config,
  getConnectionSetup: async () => ({
    mode: "local-only",
    setupCompleted: true,
    clientPath: "",
    clientAvailable: true,
    profile: "qc",
    tunnelIdConfigured: false,
    runtimeApiKeyConfigured: false,
    bridge,
  }),
  getUpdateState: async () => ({ status: "idle", phase: "idle" }),
  callMemory: async () => result("recall", memory),
  callTool,
  onRuntimeReady: noop,
  onStatus: (callback) => {
    statusListeners.add(callback);
    return () => statusListeners.delete(callback);
  },
  onActivity: noop,
  onMemory: noop,
  onProcess: noop,
  onUpdate: noop,
  getActivity: async () => seededActivity,
  getProcesses: async () => [],
  durableJobs: async () => ({
    state: "ready",
    jobs: [],
    health: { state: "ready", jobHostEnabled: true, protocol: 1 },
  }),
  durableOutput: async () => ({ text: "", complete: true, nextCursor: 0 }),
  getProcessOutput: async () => ({
    text: "",
    state: "exited",
    cursor: 0,
    nextCursor: 0,
    truncated: false,
  }),
  connect: prevent,
  disconnect: prevent,
  chooseWorkspace: prevent,
  setWorkspace: prevent,
  chooseSkillImport: prevent,
  updateConfig: prevent,
  stopProcess: prevent,
  cancelDurableJob: prevent,
  exportActivity: prevent,
  exportMemory: prevent,
  copyMcpUrl: async () => status.localUrl,
  openChatGpt: prevent,
  openPath: prevent,
  openUrl: prevent,
  checkForUpdates: async () => ({ status: "idle" }),
  downloadUpdate: prevent,
  installUpdate: prevent,
  openUpdateRelease: prevent,
  openTerminal: prevent,
};
contextBridge.exposeInMainWorld("qnector", api);
contextBridge.exposeInMainWorld("__qcFixture", {
  getCallCount: () => callCount,
  setBridgeState: (state) => emitQcBridge(state),
  failRuntimeOnce: () => {
    failNextRuntime = true;
  },
});
