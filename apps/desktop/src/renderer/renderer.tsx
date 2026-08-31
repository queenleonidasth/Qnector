import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { QnectorConfig, TransportMode } from "@qnector/shared";
import type {
  ActivityEntry,
  ProcessSnapshot,
  ServerStatus,
  ToolResult,
  TransportSnapshot,
} from "../preload/api.js";

const fallbackBridge: TransportSnapshot = {
  state: "disconnected",
  mode: "cloudflare-quick",
};

const transportOptions: Array<{ value: TransportMode; label: string }> = [
  { value: "cloudflare-quick", label: "Cloudflare Quick (Auto)" },
  { value: "openai-tunnel", label: "OpenAI Tunnel Client" },
  { value: "relay", label: "Qnector Relay" },
  { value: "cloudflare-named", label: "Cloudflare Named" },
  { value: "ngrok", label: "ngrok" },
  { value: "local-only", label: "Local Only" },
];

interface MemoryActiveView {
  currentTask: string;
  completedSteps: string[];
  pendingSteps: string[];
  criticalContext: string;
}

interface MemoryFactView {
  id: string;
  key: string;
  category: string;
  value: string;
  tags: string[];
  updatedAt: string;
}

interface RuntimeDashboardView {
  doctor?: {
    checks: Array<{
      name: string;
      status: "pass" | "warn" | "fail";
      detail: string;
    }>;
    healthy: boolean;
  };
  release?: {
    status: string;
    recommendation: string;
    runningMatchesLatest: boolean | null;
    sourceChangedSinceLatestPackage: boolean | null;
    latestPackaged?: { path: string; modifiedAt: string } | null;
  };
  snapshot?: {
    capturedAt: string;
    managedProcesses: ProcessSnapshot[];
    nativeQnectorProcesses: Array<{
      pid: number;
      name: string;
      executablePath?: string | null;
    }>;
    recentActivity: Array<{
      timestamp: string;
      tool: string;
      action: string;
      status: string;
      summary: string;
    }>;
  };
  workflowRuns: Array<{
    runId: string;
    workflow: string;
    state: string;
    updatedAt: string;
  }>;
}

interface MemoryRecallView {
  available: boolean;
  workspaceId: string;
  updatedAt: string;
  sanitized: boolean;
  state: {
    active: MemoryActiveView | null;
    facts: MemoryFactView[];
    recentChanges: Array<{ timestamp: string; summary: string }>;
  };
  checkpoints: Array<{ id: string; createdAt: string; label?: string }>;
  counts: { facts: number; checkpoints: number; recentChanges: number };
  warning?: string;
}

function App(): React.ReactElement {
  const [status, setStatus] = useState<
    | (ServerStatus & { publicUrl?: string; bridge: TransportSnapshot })
    | undefined
  >();
  const [bridge, setBridge] = useState<TransportSnapshot>(fallbackBridge);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [config, setConfig] = useState<QnectorConfig>();
  const [memory, setMemory] = useState<MemoryRecallView>();
  const [runtimeDashboard, setRuntimeDashboard] =
    useState<RuntimeDashboardView>({ workflowRuns: [] });
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<
    "workspace" | "memory" | "runtime" | "settings" | null
  >(null);
  const [isClosingDrawer, setIsClosingDrawer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  // 3-second hold-to-disconnect state
  const holdStartRef = React.useRef<number | null>(null);
  const animFrameRef = React.useRef<number | null>(null);
  const didLongPressRef = React.useRef<boolean>(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [burstFlash, setBurstFlash] = useState(false);

  const closeDrawer = () => {
    if (!activeDrawer || isClosingDrawer) return;
    setIsClosingDrawer(true);
    window.setTimeout(() => {
      setActiveDrawer(null);
      setIsClosingDrawer(false);
    }, 240);
  };

  const toggleDrawer = (
    drawer: "workspace" | "memory" | "runtime" | "settings",
  ) => {
    if (isClosingDrawer) return;
    if (activeDrawer === drawer) {
      closeDrawer();
    } else {
      if (drawer === "memory") void refreshMemory();
      if (drawer === "runtime") void refreshRuntime();
      setActiveDrawer(drawer);
    }
  };

  const refreshRuntime = async (): Promise<void> => {
    setRuntimeBusy(true);
    try {
      const [doctor, release, snapshot, workflows] = await Promise.all([
        window.qnector.callTool("system", { action: "doctor" }),
        window.qnector.callTool("system", { action: "release_status" }),
        window.qnector.callTool("system", { action: "context_snapshot" }),
        window.qnector.callTool("process", {
          action: "workflow_runs",
          maxResults: 10,
        }),
      ]);
      const unwrap = <T,>(result: ToolResult): T | undefined => {
        if (!result.ok) return undefined;
        const outer = result.data as { data?: unknown } | undefined;
        return (outer?.data ?? outer) as T | undefined;
      };
      const workflowData = unwrap<{
        runs: RuntimeDashboardView["workflowRuns"];
      }>(workflows);
      setRuntimeDashboard({
        doctor: unwrap<RuntimeDashboardView["doctor"]>(doctor),
        release: unwrap<RuntimeDashboardView["release"]>(release),
        snapshot: unwrap<RuntimeDashboardView["snapshot"]>(snapshot),
        workflowRuns: workflowData?.runs ?? [],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const refreshMemory = async (): Promise<void> => {
    try {
      const result = await window.qnector.callMemory({
        action: "recall",
        checkpointLimit: 10,
        factLimit: 50,
        changeLimit: 20,
      });
      if (result.ok) {
        const wrapped = result.data as { data?: unknown } | undefined;
        const next = (wrapped?.data ?? wrapped) as MemoryRecallView;
        setMemory(next);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      window.qnector.getStatus(),
      window.qnector.getActivity(),
      window.qnector.getProcesses(),
      window.qnector.getConfig(),
    ])
      .then(([nextStatus, nextActivity, nextProcesses, nextConfig]) => {
        if (!mounted) return;
        setStatus(nextStatus);
        setBridge(nextStatus.bridge);
        if (nextStatus.bridge.state !== "error") setError(undefined);
        setActivity(nextActivity);
        setProcesses(nextProcesses);
        setConfig(nextConfig);
      })
      .catch((reason: unknown) => setError(String(reason)));

    const offStatus = window.qnector.onStatus((next) => {
      setStatus(next);
      setBridge(next.bridge);
      if (next.bridge.state !== "error") setError(undefined);
    });
    const offActivity = window.qnector.onActivity((entry) =>
      setActivity((items) => [entry, ...items].slice(0, 50)),
    );
    const offProcess = window.qnector.onProcess((entry) =>
      setProcesses((items) => [
        entry,
        ...items.filter((item) => item.id !== entry.id),
      ]),
    );

    return () => {
      mounted = false;
      offStatus();
      offActivity();
      offProcess();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await window.qnector.connect();
      setBridge(next);
      await refreshMemory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.qnector.disconnect();
      setBridge(fallbackBridge);
    } finally {
      setBusy(false);
    }
  };

  const startHold = () => {
    if (bridge.state !== "connected" || busy) return;
    setIsHolding(true);
    holdStartRef.current = performance.now();

    const tick = (now: number) => {
      if (!holdStartRef.current) return;
      const elapsed = now - holdStartRef.current;
      const p = Math.min(elapsed / 3000, 1);
      setHoldProgress(p);

      if (p < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        didLongPressRef.current = true;
        setIsHolding(false);
        setHoldProgress(0);
        holdStartRef.current = null;
        setBurstFlash(true);
        window.setTimeout(() => setBurstFlash(false), 700);
        window.setTimeout(() => {
          didLongPressRef.current = false;
        }, 1000);
        void disconnect();
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const cancelHold = () => {
    if (!isHolding && holdProgress === 0) return;
    setIsHolding(false);
    setHoldProgress(0);
    holdStartRef.current = null;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const handleOrbClick = () => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    if (busy || isConnecting) return;
    if (!isConnected) {
      void connect();
    }
  };

  const chooseWorkspace = async (): Promise<void> => {
    const next = await window.qnector.chooseWorkspace();
    setStatus((current) => (current ? { ...current, ...next } : current));
    setConfig(await window.qnector.getConfig());
    await refreshMemory();
  };

  const clearMemory = async (): Promise<void> => {
    if (!window.confirm("Wipe all memory for the active workspace?")) return;
    setMemoryBusy(true);
    try {
      const result = await window.qnector.callMemory({
        action: "clear",
        scope: "all",
      });
      if (!result.ok) throw new Error(result.error?.message ?? result.summary);
      await refreshMemory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMemoryBusy(false);
    }
  };

  const openMemoryFile = async (): Promise<void> => {
    if (!status?.activeWorkspace) return;
    try {
      await window.qnector.exportMemory("markdown");
      const memoryMdPath = `${status.activeWorkspace}/.qnector/MEMORY.md`;
      await window.qnector.openPath(memoryMdPath);
    } catch {
      await window.qnector.exportMemory("markdown");
    }
  };

  const copyLink = async (): Promise<void> => {
    await window.qnector.copyMcpUrl();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const openChatGPT = async (): Promise<void> => {
    await window.qnector.openChatGpt();
  };

  const updateTransportMode = async (mode: TransportMode): Promise<void> => {
    if (!config) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await window.qnector.updateConfig({
        transport: { ...config.transport, mode },
      });
      setConfig(saved);
      const latest = await window.qnector.getStatus();
      setStatus(latest);
      setBridge(latest.bridge);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggleSetting = async (
    key: "minimizeToTray" | "startAtLogin" | "globalShortcutEnabled",
    value: boolean,
  ): Promise<void> => {
    if (!config) return;
    try {
      const saved = await window.qnector.updateConfig({
        ui: { ...config.ui, [key]: value },
      });
      setConfig(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const isConnected = bridge.state === "connected";
  const isConnecting = bridge.state === "connecting";

  const effectiveUrl =
    bridge.publicUrl ?? (isConnected ? status?.localUrl : undefined);

  const displayUrl =
    bridge.publicUrl ??
    (isConnecting
      ? "https://tunnel.mcp.local/connecting…"
      : isConnected
        ? (status?.localUrl ?? "http://127.0.0.1:8787/mcp")
        : "Connect to generate MCP link");

  return (
    <div className="app-container">
      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <button
            style={{
              background: "transparent",
              border: 0,
              color: "#ffffff",
              cursor: "pointer",
            }}
            onClick={() => setError(undefined)}
          >
            ✕
          </button>
        </div>
      )}

      <header className="app-header">
        <div className="brand-section">
          <div className="brand-crest">
            <span className="crest-symbol">⚜</span>
          </div>
          <div>
            <h1 className="brand-title">MCP BRIDGE</h1>
            <div className="brand-tag">Qnector Desktop</div>
          </div>
        </div>
        <div className={`status-pill ${bridge.state}`}>
          <span className="status-dot" />
          <span>
            {isConnected ? "Active" : isConnecting ? "Connecting" : "Idle"}
          </span>
        </div>
      </header>

      <main className="app-main">
        <section className="glass-card hero-glass-section">
          <div className="orb-stage">
            <svg className="charge-svg-ring" viewBox="0 0 130 130">
              <defs>
                <linearGradient
                  id="goldFireGrad"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#ffe270" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
              </defs>
              <circle cx="65" cy="65" r="58" className="charge-track" />
              <circle
                cx="65"
                cy="65"
                r="58"
                className="charge-meter"
                style={{
                  strokeDasharray: 364.42,
                  strokeDashoffset: 364.42 * (1 - holdProgress),
                }}
              />
            </svg>

            <div className={`plasma-aura ${isConnected ? "active" : ""}`} />

            {burstFlash && <div className="burst-flash-ring" />}

            <div
              className={`glass-sphere-enclosure ${isHolding ? "holding" : ""}`}
              title={
                isConnected
                  ? "Hold for 3 seconds to disconnect"
                  : "Click to connect"
              }
              onClick={handleOrbClick}
              onMouseDown={startHold}
              onMouseUp={cancelHold}
              onMouseLeave={cancelHold}
              onTouchStart={startHold}
              onTouchEnd={cancelHold}
              onTouchCancel={cancelHold}
            >
              <div
                className={`liquid-gold-core ${
                  isHolding
                    ? "charging"
                    : isConnecting
                      ? "connecting"
                      : isConnected
                        ? "connected"
                        : "disconnected"
                }`}
              />
              <div className="glass-glare" />
              {isConnected && !isHolding && (
                <>
                  <div className="orbit-spark spark-1" />
                  <div className="orbit-spark spark-2" />
                </>
              )}
            </div>
          </div>

          <h2 className="hero-state-title">
            {isHolding
              ? `DISCONNECTING (${((1 - holdProgress) * 3).toFixed(1)}s)`
              : isConnected
                ? "BRIDGE: ACTIVE"
                : isConnecting
                  ? "ESTABLISHING BRIDGE…"
                  : "BRIDGE: DORMANT"}
          </h2>
          <p className="hero-state-sub">
            {isHolding
              ? "Keep holding the orb to confirm disconnection…"
              : isConnected
                ? "Connected to ChatGPT · Full System Access"
                : "Expose local computer & workspace to ChatGPT"}
          </p>

          <div className="endpoint-glass-box">
            <span className="endpoint-link-icon">🔗</span>
            <span
              className={`endpoint-url-text ${!effectiveUrl ? "placeholder" : ""}`}
              title={effectiveUrl}
            >
              {displayUrl}
            </span>
            <button
              className={`btn-gold-copy ${copied ? "copied" : ""}`}
              disabled={!effectiveUrl}
              onClick={() => void copyLink()}
            >
              <span>{copied ? "COPIED ✓" : "COPY"}</span>
            </button>
          </div>

          {isConnected ? (
            <button
              className="btn-liquid-action"
              onClick={() => void openChatGPT()}
            >
              <span>↗ Open in ChatGPT</span>
            </button>
          ) : (
            <button
              className="btn-liquid-action"
              disabled={busy || isConnecting}
              onClick={() => void connect()}
            >
              {busy || isConnecting ? (
                <span>Connecting Bridge…</span>
              ) : (
                <span>⚡ Connect to Bridge</span>
              )}
            </button>
          )}

          <div className={`hold-hint-pill ${isHolding ? "active" : ""}`}>
            {isHolding ? (
              <span>
                ⚡ Disconnecting in {((1 - holdProgress) * 3).toFixed(1)}s
              </span>
            ) : isConnected ? (
              <span>⏳ Hold orb 3s to Disconnect</span>
            ) : (
              <span>✨ Tap orb or button to Connect</span>
            )}
          </div>
        </section>

        <section className="glass-card activity-glass-card">
          <div className="card-eyebrow-row">
            <span className="card-eyebrow">Live Activity Feed</span>
            <span className="live-badge">
              <span className="live-beacon" />
              <span>LIVE</span>
            </span>
          </div>

          <div className="activity-stream">
            {activity.slice(0, 15).map((item) => (
              <div className="activity-item" key={item.id}>
                <div className="item-left">
                  <div className="item-title">
                    {item.tool}.{item.action}
                  </div>
                  <div className="item-args">{item.argsSummary || "—"}</div>
                </div>
                <div className="item-right">
                  {item.durationMs !== undefined && (
                    <span>{item.durationMs}ms</span>
                  )}
                  <span>{formatTime(item.timestamp)}</span>
                  <span className={`item-bead ${item.status}`} />
                </div>
              </div>
            ))}

            {activity.length === 0 && (
              <div className="empty-activity">
                <span className="empty-spark">✦</span>
                <span>Ready for incoming tool calls</span>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="floating-glass-dock">
        <button
          className={`dock-pill-btn ${activeDrawer === "workspace" ? "active" : ""}`}
          onClick={() => toggleDrawer("workspace")}
        >
          <span>📁</span>
          <span>Workspace</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "memory" ? "active" : ""}`}
          onClick={() => toggleDrawer("memory")}
        >
          <span>🧠</span>
          <span>Memory</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "runtime" ? "active" : ""}`}
          onClick={() => toggleDrawer("runtime")}
        >
          <span>◈</span>
          <span>Runtime</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "settings" ? "active" : ""}`}
          onClick={() => toggleDrawer("settings")}
        >
          <span>⚙</span>
          <span>Settings</span>
        </button>
      </footer>

      {activeDrawer === "workspace" && (
        <div
          className={`drawer-backdrop ${isClosingDrawer ? "closing" : ""}`}
          onClick={closeDrawer}
        >
          <div
            className={`drawer-card ${isClosingDrawer ? "closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">📁 ACTIVE WORKSPACE</span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>
            <div className="drawer-content">
              <div className="drawer-row">
                <span className="drawer-label">Current Folder</span>
                <span style={{ fontSize: "10px", color: "var(--text-gold)" }}>
                  {status?.machineName}
                </span>
              </div>
              <div className="workspace-path-box">
                {status?.activeWorkspace ?? "—"}
              </div>
              <div className="drawer-actions">
                <button
                  className="btn-drawer-action"
                  onClick={() => void chooseWorkspace()}
                >
                  📁 Choose Folder
                </button>
                <button
                  className="btn-drawer-action"
                  disabled={!status?.activeWorkspace}
                  onClick={() =>
                    status?.activeWorkspace &&
                    void window.qnector.openPath(status.activeWorkspace)
                  }
                >
                  ↗ Explorer
                </button>
                <button
                  className="btn-drawer-action"
                  disabled={!status?.activeWorkspace}
                  onClick={() =>
                    status?.activeWorkspace &&
                    void window.qnector.openTerminal(status.activeWorkspace)
                  }
                >
                  💻 Terminal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeDrawer === "memory" && (
        <div
          className={`drawer-backdrop ${isClosingDrawer ? "closing" : ""}`}
          onClick={closeDrawer}
        >
          <div
            className={`drawer-card ${isClosingDrawer ? "closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">🧠 AI PROJECT MEMORY</span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>
            <div className="drawer-content">
              {memory?.warning && (
                <div
                  className="error-toast"
                  style={{ position: "static", marginBottom: "6px" }}
                >
                  {memory.warning}
                </div>
              )}

              <div className="memory-summary-container">
                <div className="memory-summary-box highlight">
                  <div className="memory-box-header">
                    <span>🎯 CURRENT ACTIVE GOAL</span>
                    <span
                      style={{ fontSize: "9px", color: "var(--text-muted)" }}
                    >
                      {memory?.counts.checkpoints ?? 0} Checkpoints
                    </span>
                  </div>
                  <div className="memory-box-text">
                    {memory?.state.active?.currentTask ||
                      "No active task goal saved. ChatGPT will automatically record ongoing goals here."}
                  </div>
                  {memory?.state.active?.criticalContext && (
                    <div className="memory-box-subtext">
                      <strong>Context:</strong>{" "}
                      {memory.state.active.criticalContext}
                    </div>
                  )}
                </div>

                {((memory?.state.active?.pendingSteps?.length ?? 0) > 0 ||
                  (memory?.state.active?.completedSteps?.length ?? 0) > 0) && (
                  <div className="memory-summary-box">
                    <div className="memory-box-header">
                      <span>📋 TASK PROGRESS & STEPS</span>
                    </div>
                    <div className="memory-checklist">
                      {memory?.state.active?.completedSteps?.map(
                        (step, idx) => (
                          <div
                            className="memory-checklist-item done"
                            key={`done-${idx}`}
                          >
                            <span className="check-icon">✓</span>
                            <span>{step}</span>
                          </div>
                        ),
                      )}
                      {memory?.state.active?.pendingSteps?.map((step, idx) => (
                        <div
                          className="memory-checklist-item pending"
                          key={`pend-${idx}`}
                        >
                          <span className="check-icon">⏳</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(memory?.state.facts?.length ?? 0) > 0 && (
                  <div className="memory-summary-box">
                    <div className="memory-box-header">
                      <span>💡 PROJECT RULES & KNOWLEDGE</span>
                      <span
                        style={{ fontSize: "9px", color: "var(--text-muted)" }}
                      >
                        {memory?.state.facts.length} facts
                      </span>
                    </div>
                    <div className="memory-facts-tags">
                      {memory?.state.facts.map((fact) => (
                        <div className="memory-fact-chip" key={fact.id}>
                          <strong>{fact.key}:</strong>
                          <span>{fact.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!memory?.state.active?.currentTask &&
                  (!memory?.state.facts || memory.state.facts.length === 0) && (
                    <div className="memory-empty-state">
                      <span className="memory-empty-icon">⟡</span>
                      <span>No persistent memory recorded yet</span>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "var(--text-subtle)",
                        }}
                      >
                        As you chat with ChatGPT, project decisions and goals
                        will appear here automatically.
                      </span>
                    </div>
                  )}
              </div>

              <div className="drawer-actions" style={{ marginTop: "6px" }}>
                <button
                  className="btn-drawer-action"
                  disabled={memoryBusy}
                  onClick={() => void openMemoryFile()}
                  title="Open or export MEMORY.md file"
                >
                  📄 View MEMORY.md
                </button>
                <button
                  className="btn-drawer-action danger"
                  disabled={memoryBusy}
                  onClick={() => void clearMemory()}
                  title="Wipe memory for this workspace"
                >
                  🧹 Wipe Memory
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeDrawer === "runtime" && (
        <div
          className={`drawer-backdrop ${isClosingDrawer ? "closing" : ""}`}
          onClick={closeDrawer}
        >
          <div
            className={`drawer-card ${isClosingDrawer ? "closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">◈ RUNTIME & DIAGNOSTICS</span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>
            <div className="drawer-content">
              <div className="setting-toggle-card">
                <div style={{ minWidth: 0 }}>
                  <span className="drawer-label">Release Identity</span>
                  <div
                    style={{
                      fontSize: "12px",
                      marginTop: "4px",
                      textTransform: "uppercase",
                    }}
                  >
                    {runtimeDashboard.release?.status ??
                      (runtimeBusy ? "checking…" : "unknown")}
                  </div>
                  <div
                    style={{
                      fontSize: "9px",
                      color: "var(--text-muted)",
                      marginTop: "3px",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {runtimeDashboard.release?.recommendation ??
                      "Refresh to compare running, packaged, and source state."}
                  </div>
                </div>
                <span
                  className={`item-bead ${runtimeDashboard.release?.status === "latest" ? "success" : runtimeDashboard.release?.status === "outdated" || runtimeDashboard.release?.status === "source-newer" ? "error" : "running"}`}
                />
              </div>

              <div className="memory-summary-box">
                <div className="memory-box-header">
                  <span>RUNTIME HEALTH</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                    {runtimeDashboard.doctor?.checks.length ?? 0} checks
                  </span>
                </div>
                <div className="memory-checklist">
                  {runtimeDashboard.doctor?.checks.map((check) => (
                    <div
                      className="memory-checklist-item"
                      key={check.name}
                      title={check.detail}
                    >
                      <span
                        className={`item-bead ${check.status === "pass" ? "success" : check.status === "warn" ? "running" : "error"}`}
                      />
                      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <strong>{check.name}</strong> — {check.detail}
                      </span>
                    </div>
                  ))}
                  {!runtimeDashboard.doctor && (
                    <div className="memory-checklist-item pending">
                      <span>Runtime diagnostics have not been loaded yet.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="memory-summary-box">
                <div className="memory-box-header">
                  <span>ACTIVE PROCESS CONTEXT</span>
                </div>
                <div className="memory-checklist">
                  {(runtimeDashboard.snapshot?.nativeQnectorProcesses ?? [])
                    .slice(0, 8)
                    .map((proc) => (
                      <div
                        className="memory-checklist-item"
                        key={`native-${proc.pid}`}
                      >
                        <span className="check-icon">●</span>
                        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                          {proc.name} · PID {proc.pid}
                          {proc.executablePath
                            ? ` · ${proc.executablePath}`
                            : ""}
                        </span>
                      </div>
                    ))}
                  {(runtimeDashboard.snapshot?.managedProcesses ?? [])
                    .filter((proc) => proc.state === "running")
                    .slice(0, 8)
                    .map((proc) => (
                      <div
                        className="memory-checklist-item"
                        key={`managed-${proc.id}`}
                      >
                        <span className="check-icon">▶</span>
                        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                          {proc.command}
                        </span>
                      </div>
                    ))}
                  {(runtimeDashboard.snapshot?.nativeQnectorProcesses.length ??
                    0) === 0 &&
                    !runtimeDashboard.snapshot?.managedProcesses.some(
                      (proc) => proc.state === "running",
                    ) && (
                      <div className="memory-checklist-item pending">
                        <span>No active process context loaded.</span>
                      </div>
                    )}
                </div>
              </div>

              <div className="memory-summary-box">
                <div className="memory-box-header">
                  <span>WORKFLOWS</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                    {runtimeDashboard.workflowRuns.length} recent
                  </span>
                </div>
                <div className="memory-checklist">
                  {runtimeDashboard.workflowRuns.slice(0, 8).map((run) => (
                    <div className="memory-checklist-item" key={run.runId}>
                      <span
                        className={`item-bead ${run.state === "succeeded" ? "success" : run.state === "failed" ? "error" : "running"}`}
                      />
                      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        {run.workflow} — {run.state}
                      </span>
                    </div>
                  ))}
                  {runtimeDashboard.workflowRuns.length === 0 && (
                    <div className="memory-checklist-item pending">
                      <span>No workflow runs recorded.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="drawer-actions" style={{ marginTop: "6px" }}>
                <button
                  className="btn-drawer-action"
                  disabled={runtimeBusy}
                  onClick={() => void refreshRuntime()}
                >
                  {runtimeBusy ? "↻ Refreshing…" : "↻ Refresh Runtime"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Up Settings Drawer */}
      {activeDrawer === "settings" && (
        <div
          className={`drawer-backdrop ${isClosingDrawer ? "closing" : ""}`}
          onClick={closeDrawer}
        >
          <div
            className={`drawer-card ${isClosingDrawer ? "closing" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">⚙ BRIDGE SETTINGS</span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>
            <div className="drawer-content">
              {/* Tunnel Mode Card */}
              <div className="setting-toggle-card">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <span className="drawer-label">Tunnel Mode</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                    Internet transport for ChatGPT
                  </span>
                </div>
                <select
                  className="drawer-select"
                  value={config?.transport.mode ?? "cloudflare-quick"}
                  disabled={busy}
                  onChange={(e) =>
                    void updateTransportMode(e.target.value as TransportMode)
                  }
                >
                  {transportOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Global Hotkey Card */}
              <div className="setting-toggle-card">
                <label className="drawer-toggle">
                  <input
                    type="checkbox"
                    checked={config?.ui.globalShortcutEnabled ?? true}
                    onChange={(e) =>
                      void toggleSetting(
                        "globalShortcutEnabled",
                        e.target.checked,
                      )
                    }
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <span>Global Hotkey</span>
                    <span
                      style={{ fontSize: "9px", color: "var(--text-muted)" }}
                    >
                      Show / hide window from anywhere
                    </span>
                  </div>
                </label>
                <div className="hotkey-badge">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>Shift</kbd>
                  <span>+</span>
                  <kbd>Q</kbd>
                </div>
              </div>

              {/* Minimize to Tray */}
              <div className="setting-toggle-card">
                <label className="drawer-toggle">
                  <input
                    type="checkbox"
                    checked={config?.ui.minimizeToTray ?? true}
                    onChange={(e) =>
                      void toggleSetting("minimizeToTray", e.target.checked)
                    }
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <span>Minimize to Tray</span>
                    <span
                      style={{ fontSize: "9px", color: "var(--text-muted)" }}
                    >
                      Keep bridge running in background on close
                    </span>
                  </div>
                </label>
              </div>

              {/* Launch on Startup */}
              <div className="setting-toggle-card">
                <label className="drawer-toggle">
                  <input
                    type="checkbox"
                    checked={config?.ui.startAtLogin ?? false}
                    onChange={(e) =>
                      void toggleSetting("startAtLogin", e.target.checked)
                    }
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <span>Auto Start</span>
                    <span
                      style={{ fontSize: "9px", color: "var(--text-muted)" }}
                    >
                      Launch Qnector on Windows startup
                    </span>
                  </div>
                </label>
              </div>

              {/* Mirror MEMORY.md */}
              <div className="setting-toggle-card">
                <label className="drawer-toggle">
                  <input
                    type="checkbox"
                    checked={config?.memory?.workspaceMirror === "memory-md"}
                    onChange={(e) =>
                      void window.qnector
                        .updateConfig({
                          memory: {
                            ...(config?.memory ?? {}),
                            workspaceMirror: e.target.checked
                              ? "memory-md"
                              : "off",
                          },
                        })
                        .then((saved) => setConfig(saved))
                        .catch((reason: unknown) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : String(reason),
                          ),
                        )
                    }
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <span>Save .qnector/MEMORY.md</span>
                    <span
                      style={{ fontSize: "9px", color: "var(--text-muted)" }}
                    >
                      Write living markdown docs in workspace
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

createRoot(document.getElementById("root")!).render(<App />);
