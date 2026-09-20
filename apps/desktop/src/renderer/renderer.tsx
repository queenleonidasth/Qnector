import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { MemoryCenter } from "./memory-center.js";
import type {
  MemoryV2Snapshot,
  QnectorConfig,
  TransportMode,
} from "@qnector/shared";
import type { DesktopUpdateState } from "../updater-types.js";
import type {
  ActivityEntry,
  ConnectionSetupStatus,
  DesktopBootstrapSnapshot,
  ProcessSnapshot,
  ServerStatus,
  ToolResult,
  TransportSnapshot,
} from "../preload/api.js";
import {
  coalesceActivity,
  mergeActivityEntry,
  sameActivityCall,
} from "./activity-feed.js";
import { useModalFocusTrap } from "./modal-accessibility.js";
import { SkillManager } from "./skill-manager.js";
import {
  RuntimeDiagnostics,
  formatTime,
  type RuntimeDashboardView,
} from "./runtime-diagnostics.js";
import "./royal-effects.css";
import { GoldMatrixRain } from "./gold-matrix-rain.js";

const fallbackBridge: TransportSnapshot = {
  state: "disconnected",
  mode: "openai-tunnel",
};

const OPENAI_TUNNELS_URL =
  "https://platform.openai.com/settings/organization/tunnels";
const OPENAI_RUNTIME_KEYS_URL =
  "https://platform.openai.com/settings/organization/api-keys";
const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/#settings/Connectors";

const setupSteps = [
  { label: "Check", title: "Check this PC" },
  { label: "Tunnel", title: "Create tunnel credentials" },
  { label: "ChatGPT", title: "Add Qnector to ChatGPT" },
  { label: "Done", title: "Finish and test" },
] as const;

const transportOptions: Array<{ value: TransportMode; label: string }> = [
  { value: "cloudflare-quick", label: "Cloudflare Quick (Auto)" },
  { value: "openai-tunnel", label: "OpenAI Tunnel Client" },
  { value: "relay", label: "Qnector Relay" },
  { value: "cloudflare-named", label: "Cloudflare Named" },
  { value: "ngrok", label: "ngrok" },
  { value: "local-only", label: "Local Only" },
];

type DrawerName = "workspace" | "memory" | "skills" | "runtime" | "settings";
type DrawerTransition = "left" | "right" | null;
type UpdateUxPhase =
  "idle" | "checking" | "downloading" | "preparing-restart" | "restarting";

type PrimaryDrawerName = Exclude<DrawerName, "runtime">;

const drawerMenuItems: Array<{ key: PrimaryDrawerName; label: string }> = [
  { key: "workspace", label: "Workspace" },
  { key: "memory", label: "Memory" },
  { key: "skills", label: "Skills" },
  { key: "settings", label: "Settings" },
];

const drawerTitles: Record<DrawerName, string> = {
  workspace: "📁 ACTIVE WORKSPACE",
  memory: "🧠 AI PROJECT MEMORY",
  skills: "◇ SKILL MANAGER",
  runtime: "◈ RUNTIME & DIAGNOSTICS",
  settings: "⚙ BRIDGE SETTINGS",
};

const drawerOrder: PrimaryDrawerName[] = [
  "workspace",
  "memory",
  "skills",
  "settings",
];

// Older releases auto-promoted tool logs to completion. Show those entries as
// unverified instead of presenting a misleading green checkmark.
function isLegacyAutoCompletion(step: string): boolean {
  return /^(?:(?:files|git|manual): |(?:files|git|process|browser|computer)\.[a-z_]+: )/i.test(
    step,
  );
}

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
  v2?: MemoryV2Snapshot;
  warning?: string;
}

const ActivityPanel = React.memo(function ActivityPanel({
  initialActivity,
}: {
  initialActivity: ActivityEntry[];
}): React.ReactElement {
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity);
  const [selectedActivity, setSelectedActivity] = useState<ActivityEntry>();
  const [enteringActivityId, setEnteringActivityId] = useState<string>();
  const [visibleRows, setVisibleRows] = useState(4);
  const [scrollTop, setScrollTop] = useState(0);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const detailDialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setActivity((current) =>
      coalesceActivity([...initialActivity, ...current]).slice(0, 50),
    );
  }, [initialActivity]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const updateVisibleRows = (): void => {
      const usableHeight = Math.max(44, stream.clientHeight - 8);
      setVisibleRows(Math.max(1, Math.min(15, Math.ceil(usableHeight / 50))));
    };
    updateVisibleRows();
    const observer = new ResizeObserver(updateVisibleRows);
    observer.observe(stream);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let mounted = true;
    let activityDrainTimer: number | undefined;
    const activityQueue: ActivityEntry[] = [];
    const drainActivityQueue = (): void => {
      activityDrainTimer = undefined;
      if (!mounted) return;
      const entry = activityQueue.shift();
      if (!entry) return;
      if (entry.status === "running") {
        setEnteringActivityId(entry.id);
        window.setTimeout(() => {
          if (!mounted) return;
          setEnteringActivityId((current) =>
            current === entry.id ? undefined : current,
          );
        }, 240);
      }
      setActivity((items) => mergeActivityEntry(items, entry).slice(0, 50));
      if (entry.status !== "running") {
        setSelectedActivity((current) =>
          current?.status === "running" && sameActivityCall(current, entry)
            ? { ...entry, id: current.id }
            : current,
        );
      }
      if (activityQueue.length > 0) {
        const delay =
          entry.status === "running"
            ? activityQueue.length > 24
              ? 95
              : activityQueue.length > 8
                ? 110
                : 125
            : 28;
        activityDrainTimer = window.setTimeout(drainActivityQueue, delay);
      }
    };
    const enqueueActivity = (entry: ActivityEntry): void => {
      activityQueue.push(entry);
      if (activityQueue.length > 120)
        activityQueue.splice(0, activityQueue.length - 120);
      if (activityDrainTimer === undefined)
        activityDrainTimer = window.setTimeout(drainActivityQueue, 0);
    };
    const offActivity = window.qnector.onActivity(enqueueActivity);
    return () => {
      mounted = false;
      offActivity();
      if (activityDrainTimer !== undefined) clearTimeout(activityDrainTimer);
    };
  }, []);

  useModalFocusTrap(
    Boolean(selectedActivity),
    detailDialogRef,
    () => setSelectedActivity(undefined),
    true,
  );

  const rowHeight = 50;
  const overscan = 3;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    activity.length,
    startIndex + visibleRows + overscan * 2,
  );
  const visibleActivity = activity.slice(startIndex, endIndex);

  return (
    <>
      <section className="glass-card activity-glass-card">
        <div className="card-eyebrow-row">
          <span className="card-eyebrow">Live Activity Feed</span>
          <span className="live-badge">
            <span className="live-beacon" />
            <span>LIVE</span>
          </span>
        </div>
        <div
          className="activity-stream"
          ref={streamRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div
            className="activity-track"
            style={{
              height: `${Math.max(activity.length, visibleRows) * rowHeight + 8}px`,
            }}
          >
            {visibleActivity.map((item, localIndex) => {
              const index = startIndex + localIndex;
              return (
                <button
                  type="button"
                  className={`activity-item ${item.status} ${enteringActivityId === item.id ? "entering" : ""}`}
                  data-activity-id={item.id}
                  key={item.id}
                  style={{
                    transform: `translate3d(0, ${index * rowHeight}px, 0)`,
                  }}
                  onClick={() => setSelectedActivity(item)}
                  aria-label={`View details for ${item.tool}.${item.action}`}
                >
                  <div className="item-left">
                    <div className="item-title">
                      {item.tool}.{item.action}
                    </div>
                    <div className="item-args">{item.argsSummary || "—"}</div>
                  </div>
                  <div className="item-right">
                    {item.skillTrace && item.skillTrace.skills.length > 0 && (
                      <span
                        className="activity-skill-badge"
                        title={`Skill context: ${item.skillTrace.skills.join(", ")}`}
                      >
                        SKILL {item.skillTrace.skills.length}
                      </span>
                    )}
                    {item.skillRoutingWarning && (
                      <span
                        className="activity-routing-missing-badge"
                        title={item.skillRoutingWarning.message}
                      >
                        ROUTE UNVERIFIED
                      </span>
                    )}
                    {item.status === "running" ? (
                      <span className="activity-processing-label">
                        PROCESSING…
                      </span>
                    ) : item.durationMs !== undefined ? (
                      <span>{item.durationMs}ms</span>
                    ) : null}
                    <span>{formatTime(item.timestamp)}</span>
                    <span className={`item-bead ${item.status}`} />
                    <span className="activity-open-glyph">›</span>
                  </div>
                </button>
              );
            })}
            {activity.length === 0 && (
              <div className="empty-activity">
                <span className="empty-spark">✦</span>
                <span>Ready for incoming tool calls</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedActivity && (
        <div
          className="activity-detail-backdrop"
          onClick={() => setSelectedActivity(undefined)}
        >
          <section
            ref={detailDialogRef}
            className="activity-detail-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedActivity.tool}.${selectedActivity.action} tool call details`}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="activity-detail-header">
              <div className="activity-detail-title-wrap">
                <span
                  className={`activity-detail-status ${selectedActivity.status}`}
                >
                  {selectedActivity.status}
                </span>
                <div className="activity-detail-title">
                  {selectedActivity.tool}.{selectedActivity.action}
                </div>
              </div>
              <button
                type="button"
                className="btn-drawer-close"
                onClick={() => setSelectedActivity(undefined)}
                aria-label="Close tool call details"
              >
                ✕
              </button>
            </div>
            <div className="activity-detail-meta-grid">
              <div className="activity-detail-meta">
                <span>Started / Updated</span>
                <strong>{formatDateTime(selectedActivity.timestamp)}</strong>
              </div>
              <div className="activity-detail-meta">
                <span>Duration</span>
                <strong>
                  {selectedActivity.durationMs === undefined
                    ? "Running"
                    : `${selectedActivity.durationMs} ms`}
                </strong>
              </div>
              <div className="activity-detail-meta">
                <span>Output</span>
                <strong>{formatBytes(selectedActivity.outputSize)}</strong>
              </div>
              <div className="activity-detail-meta">
                <span>Call ID</span>
                <strong title={selectedActivity.id}>
                  {shortActivityId(selectedActivity.id)}
                </strong>
              </div>
            </div>
            {(selectedActivity.taskId || selectedActivity.workflowRunId) && (
              <div className="activity-detail-section">
                <span className="activity-detail-label">
                  TASK → TOOL → SKILL
                </span>
                <div className="activity-detail-summary">
                  {selectedActivity.taskId && (
                    <div>
                      Task: <code>{selectedActivity.taskId}</code>
                    </div>
                  )}
                  {selectedActivity.workflowRunId && (
                    <div>
                      Workflow: <code>{selectedActivity.workflowRunId}</code>
                    </div>
                  )}
                  <div>
                    Tool: {selectedActivity.tool}.{selectedActivity.action}
                  </div>
                  <div>
                    Skills:{" "}
                    {selectedActivity.skillTrace?.skills.join(", ") ||
                      "No correlated Skill evidence"}
                  </div>
                </div>
              </div>
            )}
            {selectedActivity.skillRoutingWarning && (
              <div className="activity-detail-section activity-routing-warning">
                <span className="activity-detail-label">SKILL ROUTING</span>
                <div className="activity-detail-summary">
                  <strong>ROUTE UNVERIFIED</strong> ·{" "}
                  {selectedActivity.skillRoutingWarning.message}
                </div>
              </div>
            )}
            {selectedActivity.skillTrace &&
              selectedActivity.skillTrace.skills.length > 0 && (
                <div className="activity-detail-section activity-skill-trace">
                  <span className="activity-detail-label">
                    {selectedActivity.skillTrace.evidence === "activated"
                      ? "SKILLS ACTIVATED"
                      : "SKILL CONTEXT"}
                  </span>
                  <div className="activity-skill-chips">
                    {selectedActivity.skillTrace.skills.map((skill) => (
                      <span className="activity-skill-chip" key={skill}>
                        ◇ {skill}
                      </span>
                    ))}
                  </div>
                  <div className="activity-skill-proof">
                    {selectedActivity.skillTrace.evidence === "activated"
                      ? "Runtime evidence: this routing call loaded these Skill documents into the model context."
                      : "Runtime evidence: these Skill documents were activated before this tool call, and their allowed-tools scope includes or does not restrict this tool."}
                  </div>
                  <div className="activity-skill-route">
                    Route {shortActivityId(selectedActivity.skillTrace.routeId)}{" "}
                    · {selectedActivity.skillTrace.query}
                  </div>
                  {selectedActivity.skillTrace.evidence === "activated" &&
                    selectedActivity.skillTrace.routingDecisions &&
                    selectedActivity.skillTrace.routingDecisions.length > 0 && (
                      <div className="activity-routing-decisions">
                        <span className="activity-detail-label">
                          ROUTING DECISION
                        </span>
                        {selectedActivity.skillTrace.routingDecisions
                          .slice(0, 8)
                          .map((decision) => (
                            <div
                              className={`activity-routing-row ${decision.selected ? "selected" : "rejected"}`}
                              key={decision.name}
                            >
                              <strong>{decision.name}</strong>
                              <span>
                                {decision.score} ·{" "}
                                {decision.confidence.toUpperCase()} ·{" "}
                                {decision.outcome.toUpperCase()}
                              </span>
                              <small>
                                {decision.reasons[0] ??
                                  "No routing reason recorded"}
                              </small>
                            </div>
                          ))}
                      </div>
                    )}
                </div>
              )}
            <div className="activity-detail-section">
              <span className="activity-detail-label">REQUEST / ARGUMENTS</span>
              <pre className="activity-detail-code">
                {selectedActivity.argsSummary || "No arguments"}
              </pre>
            </div>
            <div className="activity-detail-section">
              <span className="activity-detail-label">WHAT IT DID</span>
              <div className="activity-detail-summary">
                {selectedActivity.summary ??
                  (selectedActivity.status === "running"
                    ? "This tool call is still running. Result details will update when it completes."
                    : "No result summary was recorded.")}
              </div>
            </div>
            {selectedActivity.error && (
              <div className="activity-detail-section error">
                <span className="activity-detail-label">ERROR</span>
                <div className="activity-detail-error-title">
                  {selectedActivity.error.code}:{" "}
                  {selectedActivity.error.message}
                </div>
                {selectedActivity.error.hint && (
                  <div className="activity-detail-summary">
                    Hint: {selectedActivity.error.hint}
                  </div>
                )}
                {selectedActivity.error.details !== undefined && (
                  <pre className="activity-detail-code error">
                    {formatActivityDetails(selectedActivity.error.details)}
                  </pre>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
});

function App(): React.ReactElement {
  const [status, setStatus] = useState<
    | (ServerStatus & { publicUrl?: string; bridge: TransportSnapshot })
    | undefined
  >();
  const [bridge, setBridge] = useState<TransportSnapshot>(fallbackBridge);
  const [initialActivity, setInitialActivity] = useState<ActivityEntry[]>([]);
  const [config, setConfig] = useState<QnectorConfig>();
  const [memory, setMemory] = useState<MemoryRecallView>();
  const [runtimeDashboard, setRuntimeDashboard] =
    useState<RuntimeDashboardView>({ workflowRuns: [] });
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const runtimeLastRefreshRef = useRef(0);
  const [activeDrawer, setActiveDrawer] = useState<DrawerName | null>(null);
  const [drawerTransition, setDrawerTransition] =
    useState<DrawerTransition>(null);
  const [isClosingDrawer, setIsClosingDrawer] = useState(false);
  const drawerCloseFallbackRef = useRef<number | null>(null);
  const drawerSwitchTimeoutRef = useRef<number | null>(null);
  const activeDrawerRef = useRef<DrawerName | null>(null);
  activeDrawerRef.current = activeDrawer;
  const memoryRefreshTimerRef = useRef<number | null>(null);
  const memoryRequestSeqRef = useRef(0);
  const memoryWorkspaceRef = useRef<string | undefined>(undefined);
  memoryWorkspaceRef.current = status?.activeWorkspace;
  const [busy, setBusy] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [matrixFrozenAfterDisconnect, setMatrixFrozenAfterDisconnect] =
    useState(false);
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
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [setupInfo, setSetupInfo] = useState<ConnectionSetupStatus>();
  const [setupProfile, setSetupProfile] = useState("qnector");
  const [setupTunnelId, setSetupTunnelId] = useState("");
  const [setupRuntimeApiKey, setSetupRuntimeApiKey] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string>();
  const [updateState, setUpdateState] = useState<DesktopUpdateState>();
  const [updateUxPhase, setUpdateUxPhase] = useState<UpdateUxPhase>("idle");
  const setupDialogRef = useRef<HTMLElement | null>(null);
  const drawerDialogRef = useRef<HTMLDivElement | null>(null);

  // Pausing CSS preserves animation progress when Qnector is hidden or minimized.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("qnector-window-paused");
    const updateVisibility = (visible: boolean): void => {
      root.classList.toggle("qnector-window-paused", !visible);
    };
    let receivedEvent = false;
    const unsubscribe = window.qnector.onWindowVisible((visible) => {
      receivedEvent = true;
      updateVisibility(visible);
    });
    void window.qnector
      .getWindowVisible()
      .then((visible) => {
        if (!receivedEvent) updateVisibility(visible);
      })
      .catch(() => undefined);
    return () => {
      unsubscribe();
      root.classList.remove("qnector-window-paused");
    };
  }, []);

  // Live Activity owns its own subscription/render state to avoid rerendering App.

  useModalFocusTrap(
    setupOpen,
    setupDialogRef,
    () => {
      if (!setupBusy) setSetupOpen(false);
    },
    !setupBusy,
  );

  const clearDrawerSwitchTimer = (): void => {
    if (drawerSwitchTimeoutRef.current !== null) {
      window.clearTimeout(drawerSwitchTimeoutRef.current);
      drawerSwitchTimeoutRef.current = null;
    }
  };

  const finishDrawerClose = (): void => {
    if (drawerCloseFallbackRef.current !== null) {
      window.clearTimeout(drawerCloseFallbackRef.current);
      drawerCloseFallbackRef.current = null;
    }
    clearDrawerSwitchTimer();
    setDrawerTransition(null);
    setActiveDrawer(null);
    setIsClosingDrawer(false);
  };

  const closeDrawer = (): void => {
    if (!activeDrawer || isClosingDrawer) return;
    clearDrawerSwitchTimer();
    setDrawerTransition(null);
    setIsClosingDrawer(true);
    if (drawerCloseFallbackRef.current !== null) {
      window.clearTimeout(drawerCloseFallbackRef.current);
    }
    // The DOM should normally be removed by drawerSlideDown's animationend.
    // Keep a generous fallback for reduced-motion / renderer edge cases.
    drawerCloseFallbackRef.current = window.setTimeout(finishDrawerClose, 600);
  };

  useModalFocusTrap(Boolean(activeDrawer), drawerDialogRef, closeDrawer, true);

  const onDrawerAnimationEnd = (
    event: React.AnimationEvent<HTMLDivElement>,
  ): void => {
    if (
      isClosingDrawer &&
      event.target === event.currentTarget &&
      event.animationName === "drawerSlideDown"
    ) {
      finishDrawerClose();
    }
  };

  const refreshDrawerData = (drawer: DrawerName): void => {
    if (drawer === "memory") void refreshMemory();
    if (drawer === "runtime") void refreshRuntime();
  };

  const switchDrawer = (drawer: DrawerName): void => {
    if (isClosingDrawer || drawerTransition || activeDrawer === drawer) return;
    if (!activeDrawer) {
      refreshDrawerData(drawer);
      setActiveDrawer(drawer);
      return;
    }

    const currentIndex = drawerOrder.indexOf(
      activeDrawer === "runtime" ? "settings" : activeDrawer,
    );
    const nextIndex = drawerOrder.indexOf(
      drawer === "runtime" ? "settings" : drawer,
    );
    const direction: Exclude<DrawerTransition, null> =
      nextIndex > currentIndex ? "left" : "right";

    clearDrawerSwitchTimer();
    refreshDrawerData(drawer);
    setDrawerTransition(direction);
    setActiveDrawer(drawer);
    drawerSwitchTimeoutRef.current = window.setTimeout(() => {
      setDrawerTransition(null);
      drawerSwitchTimeoutRef.current = null;
    }, 200);
  };

  const toggleDrawer = (drawer: DrawerName): void => {
    if (isClosingDrawer || drawerTransition) return;
    if (activeDrawer === drawer) {
      closeDrawer();
      return;
    }
    switchDrawer(drawer);
  };

  const renderDrawerMenuTabs = (current: DrawerName): React.ReactElement => (
    <nav className="drawer-menu-tabs" aria-label="Qnector menu sections">
      {drawerMenuItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={item.key === current ? "active" : ""}
          aria-current={item.key === current ? "page" : undefined}
          disabled={drawerTransition !== null}
          onClick={() => switchDrawer(item.key)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );

  const refreshRuntime = async (force = false): Promise<void> => {
    if (!force && Date.now() - runtimeLastRefreshRef.current < 15_000) return;
    setRuntimeBusy(true);
    try {
      const [doctor, release, snapshot, workflows, performance] =
        await Promise.all([
          window.qnector.callTool("system", { action: "doctor" }),
          window.qnector.callTool("system", { action: "release_status" }),
          window.qnector.callTool("system", { action: "context_snapshot" }),
          window.qnector.callTool("process", {
            action: "workflow_runs",
            maxResults: 10,
          }),
          window.qnector.callTool("system", { action: "performance" }),
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
        performance: unwrap<RuntimeDashboardView["performance"]>(performance),
        doctor: unwrap<RuntimeDashboardView["doctor"]>(doctor),
        release: unwrap<RuntimeDashboardView["release"]>(release),
        snapshot: unwrap<RuntimeDashboardView["snapshot"]>(snapshot),
        workflowRuns: workflowData?.runs ?? [],
      });
      runtimeLastRefreshRef.current = Date.now();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const refreshMemory = async (): Promise<void> => {
    const requestSeq = ++memoryRequestSeqRef.current;
    const requestedWorkspace = memoryWorkspaceRef.current;
    try {
      const result = await window.qnector.callMemory({
        action: "recall",
        checkpointLimit: 10,
        factLimit: 100,
        taskLimit: 100,
        eventLimit: 12,
        changeLimit: 20,
      });
      if (result.ok) {
        const wrapped = result.data as { data?: unknown } | undefined;
        const next = (wrapped?.data ?? wrapped) as MemoryRecallView & { workspacePath?: string };
        if (requestSeq !== memoryRequestSeqRef.current || requestedWorkspace !== memoryWorkspaceRef.current || (requestedWorkspace && next.workspacePath && next.workspacePath.toLocaleLowerCase() !== requestedWorkspace.toLocaleLowerCase())) return;
        setMemory(next);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    let mounted = true;
    // Activity feed subscribes independently so frequent tool events do not
    // rerender the full application shell or active drawer.

    const applyBootstrap = (snapshot: DesktopBootstrapSnapshot): void => {
      if (!mounted) return;
      const nextStatus = snapshot.status;
      const nextConfig = snapshot.config;
      setStatus(nextStatus);
      setBridge(nextStatus.bridge);
      if (nextStatus.bridge.state !== "error") setError(undefined);
      setInitialActivity(coalesceActivity(snapshot.activity).slice(0, 50));
      setConfig(nextConfig);
      if (snapshot.update) setUpdateState(snapshot.update);
      setSetupProfile(nextConfig.transport.openaiProfile?.trim() || "qnector");
      setSetupTunnelId(nextConfig.transport.openaiTunnelId ?? "");
      setSetupRuntimeApiKey(nextConfig.transport.openaiRuntimeApiKey ?? "");
      if (nextConfig.ui.setupCompleted !== true) {
        setSetupOpen(true);
        setSetupStep(0);
      }
      void window.qnector
        .getConnectionSetup()
        .then((info) => mounted && setSetupInfo(info))
        .catch(() => undefined);
    };

    void window.qnector
      .getBootstrap()
      .then(applyBootstrap)
      .catch((reason: unknown) => setError(String(reason)));

    const offRuntimeReady = window.qnector.onRuntimeReady(applyBootstrap);
    const offStatus = window.qnector.onStatus((next) => {
      setStatus(next);
      setBridge(next.bridge);
      if (next.bridge.state !== "error") setError(undefined);
    });
    const offMemory = window.qnector.onMemory(() => {
      if (activeDrawerRef.current !== "memory") return;
      if (memoryRefreshTimerRef.current !== null)
        window.clearTimeout(memoryRefreshTimerRef.current);
      memoryRefreshTimerRef.current = window.setTimeout(() => {
        memoryRefreshTimerRef.current = null;
        void refreshMemory();
      }, 120);
    });
    const offUpdate = window.qnector.onUpdate((next) => setUpdateState(next));

    return () => {
      mounted = false;
      offRuntimeReady();
      offStatus();
      offMemory();
      offUpdate();
      if (memoryRefreshTimerRef.current !== null)
        window.clearTimeout(memoryRefreshTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (bridge.state === "connected" || bridge.state === "connecting") {
      setMatrixFrozenAfterDisconnect(false);
    }
  }, [bridge.state]);

  const connect = async (): Promise<void> => {
    setMatrixFrozenAfterDisconnect(false);
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
    setIsDisconnecting(true);
    setError(undefined);
    try {
      await window.qnector.disconnect();
      setMatrixFrozenAfterDisconnect(true);
      setBridge(fallbackBridge);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setHoldProgress(0);
      setIsDisconnecting(false);
      setBusy(false);
    }
  };

  const startHold = () => {
    if (bridge.state !== "connected" || busy || isDisconnecting) return;
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
        // Keep the ring full while the async disconnect is in progress.
        setHoldProgress(1);
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
    if (isDisconnecting) return;
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

  const handleOrbKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.repeat || busy || isConnecting || isDisconnecting) return;
    if (isConnected) startHold();
    else void connect();
  };

  const handleOrbKeyUp = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (isConnected) cancelHold();
  };

  const chooseWorkspace = async (): Promise<void> => {
    const next = await window.qnector.chooseWorkspace();
    memoryRequestSeqRef.current += 1;
    memoryWorkspaceRef.current = next.activeWorkspace;
    setMemory(undefined);
    setStatus((current) => (current ? { ...current, ...next } : current));
    setConfig(await window.qnector.getConfig());
    await refreshMemory();
  };

  const clearMemory = async (): Promise<void> => {
    if (!status?.activeWorkspace || !window.confirm(`ลบความจำทั้งหมดของ Workspace ${status.activeWorkspace} ทั้ง Memory รุ่นเดิมและ v2 รวมงานและประวัติที่บันทึกไว้? การกระทำนี้ย้อนกลับไม่ได้`)) return;
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
    setMemoryBusy(true);
    setError(undefined);
    try {
      const memoryMdPath = `${status.activeWorkspace}/.qnector/MEMORY.md`;
      await window.qnector.openPath(memoryMdPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMemoryBusy(false);
    }
  };

  const exportMemoryFile = async (): Promise<void> => {
    setMemoryBusy(true);
    setError(undefined);
    try {
      const exportedPath = await window.qnector.exportMemory("markdown");
      if (!exportedPath) return;
      await window.qnector.openPath(exportedPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMemoryBusy(false);
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

  const checkForUpdates = async (): Promise<void> => {
    const startedAt = performance.now();
    setUpdateUxPhase("checking");
    try {
      const next = await window.qnector.checkForUpdates();
      await waitForMinimumUiTime(startedAt, 1000);
      setUpdateState(next);
    } catch (reason) {
      await waitForMinimumUiTime(startedAt, 1000);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdateUxPhase("idle");
    }
  };

  const downloadUpdate = async (): Promise<void> => {
    setUpdateUxPhase("downloading");
    try {
      setUpdateState(await window.qnector.downloadUpdate());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdateUxPhase("idle");
    }
  };

  const installUpdate = async (): Promise<void> => {
    setUpdateUxPhase("preparing-restart");
    try {
      await sleep(650);
      setUpdateUxPhase("restarting");
      await sleep(500);
      const next = await window.qnector.installUpdate();
      setUpdateState(next);
      await sleep(800);
      setUpdateUxPhase("idle");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setUpdateUxPhase("idle");
    }
  };

  const runPrimaryUpdateAction = (): void => {
    if (updateState?.canInstall) {
      void installUpdate();
      return;
    }
    if (updateState?.canDownload) {
      void downloadUpdate();
      return;
    }
    void checkForUpdates();
  };

  const openSetupWizard = async (): Promise<void> => {
    setSetupError(undefined);
    setSetupStep(0);
    setSetupOpen(true);
    if (config) {
      setSetupProfile(config.transport.openaiProfile?.trim() || "qnector");
      setSetupTunnelId(config.transport.openaiTunnelId ?? "");
      setSetupRuntimeApiKey(config.transport.openaiRuntimeApiKey ?? "");
    }
    try {
      setSetupInfo(await window.qnector.getConnectionSetup());
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const saveAndConnectOpenAi = async (): Promise<void> => {
    if (!config) return;
    const profile = setupProfile.trim() || "qnector";
    const tunnelId = setupTunnelId.trim();
    const runtimeApiKey = setupRuntimeApiKey.trim();
    if (!setupInfo?.clientAvailable) {
      setSetupError(
        "Bundled OpenAI tunnel-client is missing. Reinstall or use a complete Qnector package.",
      );
      return;
    }
    if (!tunnelId) {
      setSetupError(
        "Enter the Tunnel ID created in OpenAI Tunnels management.",
      );
      return;
    }
    if (!runtimeApiKey) {
      setSetupError(
        "Enter a Runtime API key with Tunnels Read + Use permission.",
      );
      return;
    }

    setSetupBusy(true);
    setSetupError(undefined);
    try {
      const saved = await window.qnector.updateConfig({
        transport: {
          ...config.transport,
          mode: "openai-tunnel",
          openaiTunnelClientPath: undefined,
          openaiProfile: profile,
          openaiTunnelId: tunnelId,
          openaiRuntimeApiKey: runtimeApiKey,
        },
        ui: { ...config.ui, setupCompleted: false },
      });
      setConfig(saved);
      const snapshot = await window.qnector.connect();
      if (snapshot.state !== "connected")
        throw new Error(
          snapshot.message || "OpenAI tunnel did not reach connected state.",
        );
      setBridge(snapshot);
      const latest = await window.qnector.getStatus();
      setStatus(latest);
      setSetupInfo(await window.qnector.getConnectionSetup());
      setSetupStep(2);
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSetupBusy(false);
    }
  };

  const completeChatGptSetup = async (): Promise<void> => {
    if (!config) return;
    setSetupBusy(true);
    setSetupError(undefined);
    try {
      const completed = await window.qnector.updateConfig({
        ui: { ...config.ui, setupCompleted: true },
      });
      setConfig(completed);
      setSetupStep(3);
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSetupBusy(false);
    }
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
  const disconnectRingActive = isHolding || isDisconnecting;
  const disconnectRingProgress = isDisconnecting ? 1 : holdProgress;
  const matrixDisconnectProgress = disconnectRingProgress;

  const effectiveUrl =
    bridge.publicUrl ?? (isConnected ? status?.localUrl : undefined);

  const displayUrl =
    bridge.publicUrl ??
    (isConnecting
      ? "https://tunnel.mcp.local/connecting…"
      : isConnected
        ? (status?.localUrl ?? "http://127.0.0.1:8787/mcp")
        : "Connect to generate MCP link");

  const updateAttention =
    updateState?.phase === "available" ||
    updateState?.phase === "downloading" ||
    updateState?.phase === "downloaded" ||
    updateState?.phase === "installing";
  const updateBusy =
    updateUxPhase !== "idle" ||
    updateState?.phase === "checking" ||
    updateState?.phase === "downloading" ||
    updateState?.phase === "installing";
  const updateProgressPercent = Math.round((updateState?.progress ?? 0) * 100);
  const updateHasNewVersion = Boolean(
    updateState?.latestVersion &&
    updateState.latestVersion !== updateState.currentVersion,
  );
  const updatePhaseLabel =
    updateUxPhase === "preparing-restart"
      ? "Preparing restart"
      : updateUxPhase === "restarting"
        ? "Restarting Qnector"
        : updateUxPhase === "checking"
          ? "Checking"
          : updateUxPhase === "downloading"
            ? "Downloading"
            : updateState?.phase === "checking"
              ? "Checking"
              : updateState?.phase === "available"
                ? "Update available"
                : updateState?.phase === "downloading"
                  ? "Downloading"
                  : updateState?.phase === "downloaded"
                    ? "Ready to install"
                    : updateState?.phase === "installing"
                      ? "Installing"
                      : updateState?.phase === "up-to-date"
                        ? "Up to date"
                        : updateState?.phase === "error"
                          ? "Needs attention"
                          : "Ready";
  const updatePhaseIcon =
    updateUxPhase !== "idle"
      ? "↻"
      : updateState?.phase === "error"
        ? "!"
        : updateState?.phase === "up-to-date"
          ? "✓"
          : updateState?.phase === "downloaded"
            ? "↓"
            : updateState?.phase === "installing"
              ? "↻"
              : "↑";
  const updateUxMessage =
    updateUxPhase === "checking"
      ? "Checking GitHub Releases for the latest Qnector build…"
      : updateUxPhase === "downloading"
        ? "Downloading and verifying the update package…"
        : updateUxPhase === "preparing-restart"
          ? "Update is ready. Preparing a safe restart…"
          : updateUxPhase === "restarting"
            ? "Restarting Qnector now. The window will close and reopen automatically."
            : undefined;

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

      {(updateUxPhase === "preparing-restart" ||
        updateUxPhase === "restarting") && (
        <div
          className="update-restart-overlay"
          role="status"
          aria-live="assertive"
        >
          <div className="update-restart-card">
            <span className="update-restart-spinner" aria-hidden="true" />
            <strong>{updatePhaseLabel}</strong>
            <p>{updateUxMessage}</p>
            <div className="update-restart-track">
              <span />
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="brand-section">
          <div className="brand-crest">
            <span className="crest-symbol">⚜</span>
          </div>
          <div>
            <h1 className="brand-title">QNECTOR</h1>
            <div className="brand-tag">Royal MCP Bridge</div>
          </div>
        </div>
        <div className="header-actions">
          {updateAttention && (
            <button
              type="button"
              className={`update-header-pill ${updateState?.phase ?? "available"}`}
              onClick={() => {
                if (isClosingDrawer) return;
                setActiveDrawer("settings");
              }}
              title={updateState?.message}
            >
              <span>↑</span>
              <span>
                {updateState?.phase === "downloading"
                  ? `${updateProgressPercent}%`
                  : updateState?.phase === "downloaded"
                    ? "Restart"
                    : updateState?.latestVersion
                      ? `v${updateState.latestVersion}`
                      : "Update"}
              </span>
            </button>
          )}
          <div className={`status-pill ${bridge.state}`}>
            <span className="status-dot" />
            <span>
              {isConnected ? "Active" : isConnecting ? "Connecting" : "Idle"}
            </span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="glass-card hero-glass-section">
          <GoldMatrixRain
            isConnected={isConnected}
            disconnectProgress={matrixDisconnectProgress}
            frozen={matrixFrozenAfterDisconnect}
          />
          <div className="orb-stage">
            <svg
              className={`charge-svg-ring ${disconnectRingActive ? "active" : ""}`}
              viewBox="0 0 130 130"
            >
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
                  strokeDashoffset: 364.42 * (1 - disconnectRingProgress),
                }}
              />
            </svg>

            <div className={`plasma-aura ${isConnected ? "active" : ""}`} />

            {burstFlash && <div className="burst-flash-ring" />}

            <div
              className={`glass-sphere-enclosure ${isHolding ? "holding" : ""} ${isDisconnecting ? "disconnecting" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={
                isDisconnecting
                  ? "Disconnecting from ChatGPT"
                  : isConnected
                    ? "Hold for 3 seconds to disconnect"
                    : "Connect to ChatGPT"
              }
              title={
                isDisconnecting
                  ? "Disconnecting from ChatGPT"
                  : isConnected
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
              onKeyDown={handleOrbKeyDown}
              onKeyUp={handleOrbKeyUp}
            >
              <div
                className={`liquid-gold-core ${
                  isHolding
                    ? "charging"
                    : isDisconnecting
                      ? "disconnecting"
                      : isConnecting
                        ? "connecting"
                        : isConnected
                          ? "connected"
                          : "disconnected"
                }`}
              />
              <div className="glass-glare" />
              {isConnected && !isHolding && !isDisconnecting && (
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
              : isDisconnecting
                ? "DISCONNECTING…"
                : isConnected
                  ? "BRIDGE: ACTIVE"
                  : isConnecting
                    ? "ESTABLISHING BRIDGE…"
                    : "BRIDGE: DORMANT"}
          </h2>
          <p className="hero-state-sub">
            {isHolding
              ? "Keep holding the orb to confirm disconnection…"
              : isDisconnecting
                ? "Closing the tunnel and local bridge cleanly…"
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
              type="button"
              disabled={isDisconnecting}
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

          <div
            className={`hold-hint-pill ${disconnectRingActive ? "active" : ""}`}
          >
            {isHolding ? (
              <span>
                ⚡ Disconnecting in {((1 - holdProgress) * 3).toFixed(1)}s
              </span>
            ) : isDisconnecting ? (
              <span>⚡ Disconnecting Bridge…</span>
            ) : isConnected ? (
              <span>⏳ Hold orb 3s to Disconnect</span>
            ) : (
              <span>✨ Tap orb or button to Connect</span>
            )}
          </div>
        </section>

        <ActivityPanel initialActivity={initialActivity} />
      </main>

      <footer
        className={`floating-glass-dock ${activeDrawer ? "" : "dashboard-dock"}`}
      >
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
          className={`dock-pill-btn ${activeDrawer === "skills" ? "active" : ""}`}
          onClick={() => toggleDrawer("skills")}
        >
          <span>◇</span>
          <span>Skills</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "settings" ? "active" : ""}`}
          onClick={() => toggleDrawer("settings")}
        >
          <span>⚙</span>
          <span>Settings</span>
        </button>
      </footer>

      {setupOpen && (
        <div className="setup-backdrop" onClick={() => setSetupOpen(false)}>
          <section
            ref={setupDialogRef}
            className="setup-card"
            role="dialog"
            aria-modal="true"
            aria-label="Qnector OpenAI Tunnel connection setup"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="setup-header">
              <div className="setup-header-copy">
                <span className="setup-kicker">QNECTOR SETUP ASSISTANT</span>
                <h2>Connect Qnector to ChatGPT</h2>
                <p>{setupSteps[setupStep]?.title}</p>
              </div>
              <div className="setup-header-actions">
                <div className="setup-step-badge">
                  Step {setupStep + 1} of 4
                </div>
                <button
                  className="setup-close"
                  type="button"
                  aria-label="Close setup"
                  disabled={setupBusy}
                  onClick={() => setSetupOpen(false)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="setup-progress" aria-label="Setup progress">
              {[0, 1, 2, 3].map((step) => (
                <div
                  key={step}
                  className={`setup-progress-step ${step <= setupStep ? "active" : ""} ${step === setupStep ? "current" : ""}`}
                >
                  <span className="setup-progress-bar" />
                  <small>{setupSteps[step]?.label}</small>
                </div>
              ))}
            </div>

            {setupStep === 0 && (
              <div className="setup-body">
                <div className="setup-hero-mark">Q</div>
                <div className="setup-copy-block">
                  <h3>First, check this PC</h3>
                  <p>
                    Qnector already includes the OpenAI tunnel client and runs
                    the local MCP server for you. Both items below should show
                    as ready before you continue.
                  </p>
                </div>
                <div className="setup-checklist">
                  <div
                    className={setupInfo?.clientAvailable ? "ready" : "missing"}
                  >
                    <span>{setupInfo?.clientAvailable ? "✓" : "!"}</span>
                    <div>
                      <strong>Bundled tunnel-client</strong>
                      <small>
                        {setupInfo?.clientAvailable
                          ? setupInfo.clientPath
                          : "Client not found in this package"}
                      </small>
                    </div>
                  </div>
                  <div className="ready">
                    <span>✓</span>
                    <div>
                      <strong>Local MCP server</strong>
                      <small>
                        {status?.localUrl ?? "http://127.0.0.1:8787/mcp"}
                      </small>
                    </div>
                  </div>
                </div>
                <div className="setup-note">
                  <b>Next:</b> create a Tunnel ID and a Runtime API key. Qnector
                  will save them and start the tunnel automatically.
                </div>
              </div>
            )}

            {setupStep === 1 && (
              <div className="setup-body">
                <div className="setup-copy-block">
                  <h3>Create your OpenAI tunnel credentials</h3>
                  <p>
                    Open the two pages below in order. Create or copy a Tunnel
                    ID, then create a Runtime API key with Tunnels Read + Use
                    permission and paste both values here.
                  </p>
                </div>
                <div className="setup-link-grid">
                  <button
                    type="button"
                    onClick={() =>
                      void window.qnector.openUrl(OPENAI_TUNNELS_URL)
                    }
                  >
                    <span>①</span>
                    <div>
                      <strong>Open Tunnels</strong>
                      <small>Create / copy Tunnel ID</small>
                    </div>
                    <b>↗</b>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.qnector.openUrl(OPENAI_RUNTIME_KEYS_URL)
                    }
                  >
                    <span>②</span>
                    <div>
                      <strong>Runtime API Keys</strong>
                      <small>Create daemon credential</small>
                    </div>
                    <b>↗</b>
                  </button>
                </div>
                <label className="setup-field">
                  <span>Tunnel ID · starts with tunnel_</span>
                  <input
                    value={setupTunnelId}
                    onChange={(event) => setSetupTunnelId(event.target.value)}
                    placeholder="tunnel_..."
                    autoComplete="off"
                  />
                </label>
                <label className="setup-field">
                  <span>Runtime API Key · Tunnels Read + Use</span>
                  <input
                    type="password"
                    value={setupRuntimeApiKey}
                    onChange={(event) =>
                      setSetupRuntimeApiKey(event.target.value)
                    }
                    placeholder="Paste the runtime key"
                    autoComplete="off"
                  />
                </label>
                <label className="setup-field compact">
                  <span>Profile name · optional</span>
                  <input
                    value={setupProfile}
                    onChange={(event) => setSetupProfile(event.target.value)}
                    placeholder="qnector"
                    autoComplete="off"
                  />
                </label>
                <div className="setup-note">
                  Qnector will initialize the <b>sample_mcp_remote_no_auth</b>{" "}
                  profile against its local MCP URL, then launch tunnel-client
                  for you.
                </div>
              </div>
            )}

            {setupStep === 2 && (
              <div className="setup-body">
                <div className="setup-copy-block">
                  <h3>Finish setup in ChatGPT Web</h3>
                  <p>
                    The tunnel is connected. Complete these four steps in
                    ChatGPT so it can discover and use Qnector tools on this PC.
                  </p>
                </div>
                <div className="setup-connected-card">
                  <span className="item-bead success" />
                  <div>
                    <strong>OpenAI Tunnel connected</strong>
                    <small>
                      {setupTunnelId || setupInfo?.profile || setupProfile}
                    </small>
                  </div>
                </div>
                <ol className="setup-instruction-list">
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Open ChatGPT Connector Settings</strong>
                      <small>
                        In newer UI versions this may appear under Settings →
                        Apps → Create / Developer mode.
                      </small>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Create a Qnector connector</strong>
                      <small>
                        Choose <b>Connection: Tunnel</b>, then select your
                        tunnel or paste the Tunnel ID shown above.
                      </small>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Scan / refresh tools and save</strong>
                      <small>
                        Confirm Qnector exposes system, workspace, files,
                        process, git, memory, browser and computer.
                      </small>
                    </div>
                  </li>
                  <li>
                    <span>4</span>
                    <div>
                      <strong>Enable Qnector in a chat</strong>
                      <small>
                        Start a new chat, select Qnector from Apps / tools, or
                        @mention Qnector when you want GPT to use this PC.
                      </small>
                    </div>
                  </li>
                </ol>
                <button
                  className="setup-primary wide"
                  type="button"
                  onClick={() =>
                    void window.qnector.openUrl(CHATGPT_CONNECTORS_URL)
                  }
                >
                  Open ChatGPT Connector Settings ↗
                </button>
                <div className="setup-note">
                  Keep Qnector running while you create the connector, scan
                  tools, and use it later. The tunnel daemon is the bridge
                  between ChatGPT and this local MCP server.
                </div>
              </div>
            )}

            {setupStep === 3 && (
              <div className="setup-body setup-success">
                <div className="setup-success-ring">✓</div>
                <div className="setup-copy-block">
                  <h3>Qnector is ready for ChatGPT</h3>
                  <p>
                    First-run setup is complete. Keep Qnector connected, then
                    select or @mention Qnector whenever a chat needs local
                    tools.
                  </p>
                </div>
                <div className="setup-note">
                  Quick test: ask GPT to use Qnector, call <b>system info</b>,
                  inspect the active workspace, and report Git status without
                  changing files.
                </div>
                <button
                  className="setup-primary wide"
                  type="button"
                  onClick={() => void openChatGPT()}
                >
                  Open ChatGPT ↗
                </button>
              </div>
            )}

            {setupError && <div className="setup-error">{setupError}</div>}

            <div className="setup-footer">
              {setupStep > 0 && setupStep < 3 ? (
                <button
                  className="setup-secondary"
                  type="button"
                  disabled={setupBusy}
                  onClick={() => {
                    setSetupError(undefined);
                    setSetupStep((step) => Math.max(0, step - 1));
                  }}
                >
                  Back
                </button>
              ) : (
                <button
                  className="setup-secondary"
                  type="button"
                  onClick={() => setSetupOpen(false)}
                >
                  {setupStep === 3 ? "Close" : "Not now"}
                </button>
              )}

              {setupStep === 0 && (
                <button
                  className="setup-primary"
                  type="button"
                  disabled={!setupInfo?.clientAvailable}
                  onClick={() => {
                    setSetupError(undefined);
                    setSetupStep(1);
                  }}
                >
                  Continue
                </button>
              )}
              {setupStep === 1 && (
                <button
                  className="setup-primary"
                  type="button"
                  disabled={setupBusy}
                  onClick={() => void saveAndConnectOpenAi()}
                >
                  {setupBusy ? "Connecting…" : "Save & Connect"}
                </button>
              )}
              {setupStep === 2 && (
                <button
                  className="setup-primary"
                  type="button"
                  disabled={setupBusy}
                  onClick={() => void completeChatGptSetup()}
                >
                  {setupBusy ? "Saving…" : "I've added Qnector"}
                </button>
              )}
              {setupStep === 3 && (
                <button
                  className="setup-primary"
                  type="button"
                  onClick={() => setSetupOpen(false)}
                >
                  Finish
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Activity detail dialog is isolated inside ActivityPanel. */}

      {activeDrawer && (
        <div
          className={`drawer-backdrop ${isClosingDrawer ? "closing" : ""}`}
          onClick={closeDrawer}
        >
          <div
            ref={drawerDialogRef}
            className={`drawer-card unified-drawer-card ${isClosingDrawer ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={drawerTitles[activeDrawer]}
            tabIndex={-1}
            onAnimationEnd={onDrawerAnimationEnd}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">{drawerTitles[activeDrawer]}</span>
              <button
                className="btn-drawer-close"
                type="button"
                aria-label="Close drawer"
                onClick={closeDrawer}
              >
                ✕
              </button>
            </div>
            {renderDrawerMenuTabs(activeDrawer)}
            <div
              className={`drawer-page ${drawerTransition ? `drawer-page-${drawerTransition}` : ""}`}
              key={activeDrawer}
            >
              {activeDrawer === "workspace" && (
                <>
                  <div className="drawer-content">
                    <div className="drawer-row">
                      <span className="drawer-label">Current Folder</span>
                      <span
                        style={{ fontSize: "10px", color: "var(--text-gold)" }}
                      >
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
                        onClick={() => {
                          if (!status?.activeWorkspace) return;
                          setError(undefined);
                          void window.qnector
                            .openTerminal(status.activeWorkspace)
                            .catch((reason: unknown) =>
                              setError(
                                reason instanceof Error
                                  ? reason.message
                                  : String(reason),
                              ),
                            );
                        }}
                      >
                        💻 Terminal
                      </button>
                    </div>
                  </div>
                </>
              )}
              {activeDrawer === "memory" && (<div className="drawer-content"><MemoryCenter memory={memory} workspace={status?.activeWorkspace} busy={memoryBusy} onOpen={() => void openMemoryFile()} onExport={() => void exportMemoryFile()} onClear={() => void clearMemory()} /></div>)}
              {activeDrawer === "skills" && (
                <SkillManager workspaceKey={status?.activeWorkspace} />
              )}
              {activeDrawer === "runtime" && (
                <RuntimeDiagnostics
                  runtimeDashboard={runtimeDashboard}
                  runtimeBusy={runtimeBusy}
                  onRefresh={() => void refreshRuntime(true)}
                />
              )}
              {activeDrawer === "settings" && (
                <>
                  <div className="drawer-content">
                    <button
                      className="setup-launch-card"
                      type="button"
                      onClick={() => void openSetupWizard()}
                    >
                      <span className="setup-launch-icon">✦</span>
                      <span className="setup-launch-copy">
                        <strong>Connection Setup</strong>
                        <small>
                          Guided OpenAI Tunnel setup from first run to connected
                        </small>
                      </span>
                      <span className="activity-open-glyph">›</span>
                    </button>

                    <button
                      className="setup-launch-card runtime-settings-launch"
                      type="button"
                      onClick={() => {
                        void refreshRuntime(true);
                        setActiveDrawer("runtime");
                      }}
                    >
                      <span className="setup-launch-icon">◈</span>
                      <span className="setup-launch-copy">
                        <strong>Runtime & Diagnostics</strong>
                        <small>
                          Performance, health checks, processes and build state
                        </small>
                      </span>
                      <span className="activity-open-glyph">›</span>
                    </button>

                    <div
                      className={`update-settings-card ${updateState?.phase ?? "idle"} ${updateUxPhase !== "idle" ? "ux-busy" : ""}`}
                    >
                      <div className="update-card-header">
                        <span className="update-card-icon">
                          {updatePhaseIcon}
                        </span>
                        <div className="update-card-copy">
                          <span className="update-card-eyebrow">
                            App Updates
                          </span>
                          <strong>Keep Qnector up to date</strong>
                          <small>
                            Download verified releases and restart safely.
                          </small>
                        </div>
                        <span
                          className={`update-status-badge ${updateState?.phase ?? "idle"}`}
                        >
                          {updatePhaseLabel}
                        </span>
                      </div>

                      <div className="update-version-grid">
                        <div className="update-version-panel current">
                          <span>Current version</span>
                          <strong>v{updateState?.currentVersion ?? "…"}</strong>
                          <small>{updateState?.mode ?? "…"} build</small>
                        </div>
                        <span
                          className="update-version-arrow"
                          aria-hidden="true"
                        >
                          →
                        </span>
                        <div
                          className={`update-version-panel latest ${
                            updateHasNewVersion ? "has-update" : ""
                          }`}
                        >
                          <span>Latest release</span>
                          <strong>
                            v
                            {updateState?.latestVersion ??
                              updateState?.currentVersion ??
                              "…"}
                          </strong>
                          <small>
                            {updateHasNewVersion
                              ? "Available now"
                              : "GitHub Releases"}
                          </small>
                        </div>
                      </div>

                      <div className="update-card-actions update-card-actions-prominent">
                        <button
                          type="button"
                          className="btn-update-primary"
                          disabled={updateBusy}
                          onClick={runPrimaryUpdateAction}
                        >
                          {updateUxPhase === "checking"
                            ? "↻ Checking…"
                            : updateUxPhase === "downloading"
                              ? `↻ Downloading ${updateProgressPercent}%`
                              : updateUxPhase === "preparing-restart"
                                ? "↻ Preparing restart…"
                                : updateUxPhase === "restarting"
                                  ? "↻ Restarting Qnector…"
                                  : updateState?.phase === "checking"
                                    ? "↻ Checking…"
                                    : updateState?.phase === "downloading"
                                      ? `Downloading ${updateProgressPercent}%`
                                      : updateState?.phase === "installing"
                                        ? "Updating…"
                                        : updateState?.canInstall
                                          ? "Restart & Update"
                                          : updateState?.canDownload
                                            ? `Download v${updateState.latestVersion ?? "new"}`
                                            : updateState?.phase ===
                                                "up-to-date"
                                              ? "Check Again"
                                              : updateState?.phase === "error"
                                                ? "Retry"
                                                : "Check for Updates"}
                        </button>
                        {updateState?.releaseUrl && (
                          <button
                            type="button"
                            className="btn-update-secondary"
                            onClick={() =>
                              void window.qnector.openUpdateRelease()
                            }
                          >
                            View Release Notes ↗
                          </button>
                        )}
                      </div>

                      <div
                        className={`update-status-panel ${
                          updateState?.phase === "downloading"
                            ? "downloading"
                            : ""
                        } ${updateUxPhase !== "idle" ? "ux-busy" : ""}`}
                      >
                        <span className="update-status-panel-icon">
                          {updatePhaseIcon}
                        </span>
                        <div className="update-status-panel-copy">
                          {updateState?.phase === "downloading" ? (
                            <div className="update-progress-inline">
                              <div className="update-progress-inline-heading">
                                <strong>Downloading update</strong>
                                <span>{updateProgressPercent}%</span>
                              </div>
                              <div className="update-progress-track">
                                <span
                                  style={{ width: `${updateProgressPercent}%` }}
                                />
                              </div>
                              <div className="update-progress-inline-meta">
                                <span>
                                  {formatBytes(updateState.bytesDownloaded)} /{" "}
                                  {formatBytes(updateState.totalBytes)}
                                </span>
                                <span>Verify after download</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <strong>{updatePhaseLabel}</strong>
                              <p>
                                {updateUxMessage ??
                                  updateState?.message ??
                                  "Qnector checks GitHub Releases for new versions."}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

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
                        <span
                          style={{
                            fontSize: "10px",
                            color: "var(--text-muted)",
                          }}
                        >
                          Internet transport for ChatGPT
                        </span>
                      </div>
                      <select
                        className="drawer-select"
                        value={config?.transport.mode ?? "openai-tunnel"}
                        disabled={busy}
                        onChange={(e) =>
                          void updateTransportMode(
                            e.target.value as TransportMode,
                          )
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
                            style={{
                              fontSize: "10px",
                              color: "var(--text-muted)",
                            }}
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
                            void toggleSetting(
                              "minimizeToTray",
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
                          <span>Minimize to Tray</span>
                          <span
                            style={{
                              fontSize: "10px",
                              color: "var(--text-muted)",
                            }}
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
                            style={{
                              fontSize: "10px",
                              color: "var(--text-muted)",
                            }}
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
                          checked={
                            config?.memory?.workspaceMirror === "memory-md"
                          }
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
                            style={{
                              fontSize: "10px",
                              color: "var(--text-muted)",
                            }}
                          >
                            Write living markdown docs in workspace
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForMinimumUiTime(
  startedAt: number,
  minimumMs: number,
): Promise<void> {
  const remaining = minimumMs - (performance.now() - startedAt);
  if (remaining > 0) await sleep(remaining);
}

function formatDateTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(2)} MB`;
}

function shortActivityId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function formatActivityDetails(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

createRoot(document.getElementById("root")!).render(<App />);
