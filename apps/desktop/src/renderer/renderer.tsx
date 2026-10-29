import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
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
import { inspectWindowsMcp } from "./windows-mcp-status.js";
import "./royal-effects.css";
import { RoyalSilkBackground } from "./royal-silk-background.js";
import { QueenLiquidOrb } from "./queen-liquid-orb.js";
import { RoyalIcon } from "./royal-icons.js";
import "./liquid-motion.css";
import "./royal-motion-system.css";
import "./mockup-parity.css";
import "./activity-orb-compact.css";
import "./inline-route.css";
import "./translucent-controls.css";
import { QUALITY_OPTIONS, useMotionPreferences } from "./motion-policy.js";
import { crispCrestBounds } from "./orb-crest-geometry.js";

const QUEEN_IMAGE_URL = new URL("./assets/queen-portrait.png", import.meta.url)
  .href;

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

type DrawerName = "memory" | "skills" | "runtime" | "settings";
type UpdateUxPhase =
  "idle" | "checking" | "downloading" | "preparing-restart" | "restarting";

const drawerTitles: Record<DrawerName, string> = {
  memory: "AI PROJECT MEMORY",
  skills: "SKILL MANAGER",
  runtime: "RUNTIME & DIAGNOSTICS",
  settings: "BRIDGE SETTINGS",
};

const drawerOrder: DrawerName[] = ["memory", "skills", "settings"];

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
      setVisibleRows(Math.max(1, Math.min(15, Math.ceil(usableHeight / 64))));
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
        }, 300);
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

  const rowHeight = 64;
  const overscan = 3;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    activity.length,
    startIndex + visibleRows + overscan * 2,
  );
  const visibleActivity = activity.slice(startIndex, endIndex);
  // FLIP-style list stack: shift surviving visible items downward when a new
  // activity arrives at the head. Animate the inner button, not the virtual row
  // whose transform owns the scroll position.
  const previousActivityOrder = useRef<string[]>(
    activity.map((entry) => entry.id),
  );
  useLayoutEffect(() => {
    const oldOrder = previousActivityOrder.current;
    previousActivityOrder.current = activity.map((entry) => entry.id);
    const stream = streamRef.current;
    if (
      !stream ||
      stream.scrollTop > 2 ||
      document.documentElement.dataset.motion !== "on" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motionQuality === "off"
    )
      return;
    const addedAtHead =
      activity[0] &&
      oldOrder.length > 0 &&
      oldOrder[0] !== activity[0].id &&
      !oldOrder.includes(activity[0].id);
    if (!addedAtHead) return;
    const previousPositions = new Map(oldOrder.map((id, index) => [id, index]));
    for (const [index, entry] of activity
      .slice(0, Math.min(visibleRows + 2, 12))
      .entries()) {
      const previousIndex = previousPositions.get(entry.id);
      if (
        previousIndex === undefined ||
        previousIndex >= index ||
        index - previousIndex > 3
      )
        continue;
      const button = Array.from(
        stream.querySelectorAll<HTMLElement>(
          ".activity-item[data-activity-id]",
        ),
      ).find((element) => element.dataset.activityId === entry.id);
      button?.animate(
        [
          {
            transform: `translate3d(0, ${-(index - previousIndex) * rowHeight}px, 0)`,
          },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 265, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }, [activity, visibleRows]);

  return (
    <>
      <section className="glass-card activity-glass-card">
        <div className="card-eyebrow-row">
          <span className="card-eyebrow">
            <RoyalIcon name="runtime" size={17} />
            Live Activity Feed
          </span>
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
                <div
                  className="activity-virtual-row"
                  key={item.id}
                  style={{
                    transform: `translate3d(0, ${index * rowHeight}px, 0)`,
                  }}
                >
                  <button
                    type="button"
                    className={`activity-item ${item.status} ${enteringActivityId === item.id ? "entering" : ""}`}
                    data-activity-id={item.id}
                    onClick={() => setSelectedActivity(item)}
                    aria-label={`View details for ${item.tool}.${item.action}, ${item.status}, ${item.skillTrace?.skills.length ? `Skills: ${item.skillTrace.skills.join(", ")}` : "direct tool call"}`}
                  >
                    <time
                      className="activity-entry-time"
                      dateTime={item.timestamp}
                    >
                      {formatTime(item.timestamp)}
                    </time>
                    <span
                      className={`activity-entry-rail ${item.status}`}
                      aria-hidden="true"
                    >
                      <span className={`item-bead ${item.status}`} />
                    </span>
                    <div className="item-left">
                      <div className="item-title">
                        {item.tool}.{item.action}
                      </div>
                      <div className="item-args">{item.argsSummary || "—"}</div>
                    </div>
                    <div className="item-right">
                      <span className={`activity-result-pill ${item.status}`}>
                        {item.status === "running"
                          ? "RUNNING"
                          : item.status.toUpperCase()}
                      </span>
                      {item.durationMs !== undefined &&
                        item.status !== "running" && (
                          <span className="activity-duration">
                            {item.durationMs}ms
                          </span>
                        )}
                      <span className="activity-open-glyph">›</span>
                    </div>
                    <div className="activity-skill-inline">
                      {item.skillTrace?.skills.length ? (
                        <>
                          <span className="activity-skill-badge">SKILL</span>
                          <span
                            className="activity-skill-names"
                            title={item.skillTrace.skills.join(", ")}
                          >
                            {item.skillTrace.skills.join(" · ")}
                          </span>
                        </>
                      ) : (
                        <span className="activity-direct-badge">
                          DIRECT TOOL
                        </span>
                      )}
                    </div>
                  </button>
                </div>
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
                      "None (direct tool)"}
                  </div>
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
  const activeDrawerRef = useRef<DrawerName | null>(null);
  const routeTransitionId = useRef(0);
  const currentRouteTransition = useRef<ViewTransition | null>(null);
  activeDrawerRef.current = activeDrawer;
  const memoryRefreshTimerRef = useRef<number | null>(null);
  const memoryRefreshInFlightRef = useRef(false);
  const memoryRefreshPendingRef = useRef(false);
  const memoryRequestSeqRef = useRef(0);
  const memoryWorkspaceRef = useRef<string | undefined>(undefined);
  memoryWorkspaceRef.current = status?.activeWorkspace;
  const [busy, setBusy] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [matrixFrozenAfterDisconnect, setMatrixFrozenAfterDisconnect] =
    useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState<string>();

  // A single canvas-backed orb moves between its hero and header anchors.
  const orbTravelRef = useRef<HTMLDivElement | null>(null);
  const orbSharpCrestRef = useRef<HTMLImageElement | null>(null);
  const orbHomeRef = useRef<HTMLDivElement | null>(null);
  const heroLayoutRef = useRef<HTMLElement | null>(null);
  const dashboardLayoutRef = useRef<HTMLDivElement | null>(null);
  const heroExpandedHeightRef = useRef(0);
  const orbHeaderRef = useRef<HTMLDivElement | null>(null);
  const orbPositionedRef = useRef(false);
  const orbWasDockedRef = useRef<boolean | null>(null);
  const orbMorphTimeoutRef = useRef<number | null>(null);
  const orbFlightRef = useRef<Animation | null>(null);
  const orbFlightDuration = 940;

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
  const animationsEnabled = config?.ui.animationsEnabled ?? true;
  const motionPreferences = useMotionPreferences(animationsEnabled);
  const drawerScrollRef = useRef<Partial<Record<DrawerName, number>>>({});

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

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = animationsEnabled ? "on" : "off";
    return () => {
      delete root.dataset.motion;
    };
  }, [animationsEnabled]);

  // Live Activity owns its own subscription/render state to avoid rerendering App.

  useModalFocusTrap(
    setupOpen,
    setupDialogRef,
    () => {
      if (!setupBusy) setSetupOpen(false);
    },
    !setupBusy,
  );

  const refreshDrawerData = (drawer: DrawerName): void => {
    if (drawer === "memory") void refreshMemory();
    if (drawer === "runtime") void refreshRuntime();
  };

  // View transitions slide whole routes within the app's main viewport.
  // There is no modal, backdrop or bottom-sheet opening animation.
  const changeRoute = (
    next: DrawerName | null,
    direction: "left" | "right",
  ): void => {
    if (activeDrawerRef.current === next) return;
    activeDrawerRef.current = next;
    const transitionId = ++routeTransitionId.current;
    const root = document.documentElement;
    // Interrupt the previous slide; the latest dock click must take effect now.
    if (currentRouteTransition.current) {
      currentRouteTransition.current.skipTransition();
      currentRouteTransition.current = null;
      delete root.dataset.routeDirection;
      flushSync(() => setActiveDrawer(next));
      return;
    }
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (
      !animationsEnabled ||
      root.dataset.motionQuality === "off" ||
      reduced ||
      !document.startViewTransition
    ) {
      setActiveDrawer(next);
      return;
    }
    root.dataset.routeDirection = direction;
    const transition = document.startViewTransition(() => {
      if (routeTransitionId.current !== transitionId) return;
      flushSync(() => setActiveDrawer(next));
    });
    currentRouteTransition.current = transition;
    // skipTransition rejects ready when the slide is interrupted; consume it.
    void transition.ready.catch(() => undefined);
    void transition.finished
      .finally(() => {
        if (routeTransitionId.current === transitionId) {
          currentRouteTransition.current = null;
          delete root.dataset.routeDirection;
        }
      })
      .catch(() => undefined);
  };

  const closeDrawer = (): void => changeRoute(null, "right");

  const switchDrawer = (drawer: DrawerName): void => {
    const previous = activeDrawerRef.current;
    if (previous === drawer) return;
    const scroll = drawerDialogRef.current?.querySelector<HTMLElement>(
      ".drawer-page > .drawer-content, .drawer-page > .runtime-scroll",
    );
    if (previous && scroll)
      drawerScrollRef.current[previous] = scroll.scrollTop;
    const previousIndex = previous
      ? drawerOrder.indexOf(previous === "runtime" ? "settings" : previous)
      : -1;
    const nextIndex = drawerOrder.indexOf(
      drawer === "runtime" ? "settings" : drawer,
    );
    refreshDrawerData(drawer);
    changeRoute(drawer, nextIndex < previousIndex ? "right" : "left");
  };

  const toggleDrawer = (drawer: DrawerName): void => {
    if (activeDrawerRef.current === drawer) closeDrawer();
    else switchDrawer(drawer);
  };

  useEffect(() => {
    if (!activeDrawer) return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || setupOpen) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]')
      )
        return;
      event.preventDefault();
      closeDrawer();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [activeDrawer, setupOpen, animationsEnabled]);

  // Restore each route scroll position when its inline page mounts.
  // The bottom dock and window header stay mounted.
  useLayoutEffect(() => {
    if (!activeDrawer) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = drawerDialogRef.current?.querySelector<HTMLElement>(
        ".drawer-page > .drawer-content, .drawer-page > .runtime-scroll",
      );
      if (scroller)
        scroller.scrollTop = drawerScrollRef.current[activeDrawer] ?? 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDrawer]);

  const refreshRuntime = async (force = false): Promise<void> => {
    if (!force && Date.now() - runtimeLastRefreshRef.current < 15_000) return;
    setRuntimeBusy(true);
    try {
      const [doctor, release, snapshot, workflows, performance, windowsMcp] =
        await Promise.all([
          window.qnector.callTool("system", { action: "doctor" }),
          window.qnector.callTool("system", { action: "release_status" }),
          window.qnector.callTool("system", { action: "context_snapshot" }),
          window.qnector.callTool("process", {
            action: "workflow_runs",
            maxResults: 10,
          }),
          window.qnector.callTool("system", { action: "performance" }),
          inspectWindowsMcp(window.qnector.callTool),
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
        windowsMcp,
      });
      runtimeLastRefreshRef.current = Date.now();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRuntimeBusy(false);
    }
  };

  const refreshMemory = async (): Promise<void> => {
    if (memoryRefreshInFlightRef.current) {
      memoryRefreshPendingRef.current = true;
      return;
    }
    memoryRefreshInFlightRef.current = true;
    const requestSeq = ++memoryRequestSeqRef.current;
    const requestedWorkspace = memoryWorkspaceRef.current;
    try {
      const result = await window.qnector.callMemory({
        action: "recall",
        checkpointLimit: 10,
        factLimit: 30,
        taskLimit: 12,
        eventLimit: 12,
        changeLimit: 20,
      });
      if (result.ok) {
        const wrapped = result.data as { data?: unknown } | undefined;
        const next = (wrapped?.data ?? wrapped) as MemoryRecallView & {
          workspacePath?: string;
        };
        if (
          requestSeq !== memoryRequestSeqRef.current ||
          requestedWorkspace !== memoryWorkspaceRef.current ||
          (requestedWorkspace &&
            next.workspacePath &&
            next.workspacePath.toLocaleLowerCase() !==
              requestedWorkspace.toLocaleLowerCase())
        )
          return;
        setMemory(next);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      memoryRefreshInFlightRef.current = false;
      if (memoryRefreshPendingRef.current) {
        memoryRefreshPendingRef.current = false;
        if (activeDrawerRef.current === "memory") void refreshMemory();
      }
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
      // Coalesce bursts into at most one refresh every 500 ms, without starvation.
      if (memoryRefreshTimerRef.current !== null) return;
      memoryRefreshTimerRef.current = window.setTimeout(() => {
        memoryRefreshTimerRef.current = null;
        void refreshMemory();
      }, 500);
    });
    const offUpdate = window.qnector.onUpdate((next) => setUpdateState(next));

    return () => {
      mounted = false;
      offRuntimeReady();
      offStatus();
      offMemory();
      offUpdate();
      memoryRefreshPendingRef.current = false;
      memoryRequestSeqRef.current += 1;
      if (memoryRefreshTimerRef.current !== null)
        window.clearTimeout(memoryRefreshTimerRef.current);
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
    closeDrawer();
    setError(undefined);
    try {
      await window.qnector.disconnect();
      setMatrixFrozenAfterDisconnect(true);
      setBridge(fallbackBridge);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsDisconnecting(false);
      setBusy(false);
    }
  };

  // The orb is no longer a long-press disconnect control. Offline it acts
  // as a normal keyboard-accessible Connect button; connected it is decorative.
  const handleOrbConnect = (): void => {
    if (bridge.state !== "connected" && !busy && !isDisconnecting)
      void connect();
  };

  const handleOrbConnectKey = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) handleOrbConnect();
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
    if (
      !status?.activeWorkspace ||
      !window.confirm(
        `ลบความจำทั้งหมดของ Workspace ${status.activeWorkspace} ทั้ง Memory รุ่นเดิมและ v2 รวมงานและประวัติที่บันทึกไว้? การกระทำนี้ย้อนกลับไม่ได้`,
      )
    )
      return;
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
    key:
      | "minimizeToTray"
      | "startAtLogin"
      | "globalShortcutEnabled"
      | "animationsEnabled",
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
  const orbDocked = isConnected && !isDisconnecting;
  // The Hero retains its natural content height as a CSS variable.
  // When docking, the height transitions to zero so Activity physically
  // slides upward with the layout instead of teleporting on connect.
  // Keep measuring while expanded; the collapsed Hero must use the last
  // known full height until it becomes visible again.
  useLayoutEffect(() => {
    const page = dashboardLayoutRef.current;
    const hero = heroLayoutRef.current;
    const home = orbHomeRef.current;
    if (!page || !hero || !home) return;
    let frame = 0;
    const measure = () => {
      if (orbDocked) return;
      const next = Math.ceil(hero.scrollHeight);
      if (
        next > 100 &&
        next < 1000 &&
        Math.abs(next - heroExpandedHeightRef.current) >= 1
      ) {
        heroExpandedHeightRef.current = next;
        page.style.setProperty("--qn-hero-expanded-height", `${next}px`);
      }
    };
    measure();
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(home);
    const title = hero.querySelector(".hero-state-title");
    if (title) observer.observe(title);
    const prompt = hero.querySelector(".orb-connect-prompt");
    if (prompt) observer.observe(prompt);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [orbDocked]);

  // FLIP/shared element: animate the SAME Orb between two measured targets.
  // Do not depend on CSS transforms from the old compact-orb stylesheet.
  // The animation's middle frames are sampled in the renderer acceptance test.
  useLayoutEffect(() => {
    const stage = orbTravelRef.current;
    const header = orbHeaderRef.current;
    const home = orbHomeRef.current;
    const sharpCrest = orbSharpCrestRef.current;
    const sourceCrest = stage?.querySelector<HTMLImageElement>(
      ".queen-orb-emblem-layer > .queen-orb-portrait",
    );
    if (!stage || !header || !home || !sharpCrest || !sourceCrest) return;
    let frame = 0;
    let crestFrame = 0;
    // Measure the original crest (including its travelling parent transform)
    // but paint the visible PNG at the final, pixel-snapped output size.
    const syncSharpCrest = (): void => {
      const rect = sourceCrest.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const bounds = crispCrestBounds(rect, window.devicePixelRatio);
      sharpCrest.style.left = `${bounds.left}px`;
      sharpCrest.style.top = `${bounds.top}px`;
      sharpCrest.style.width = `${bounds.width}px`;
      sharpCrest.style.height = `${bounds.height}px`;
      sharpCrest.dataset.positioned = "true";
    };
    const followCrestFlight = (): void => {
      crestFrame = 0;
      syncSharpCrest();
      if (orbFlightRef.current) {
        crestFrame = requestAnimationFrame(followCrestFlight);
      }
    };
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const enabled =
      animationsEnabled &&
      !reduced &&
      document.documentElement.dataset.motion !== "off" &&
      document.documentElement.dataset.motionQuality !== "off";
    const targetTransform = (): {
      x: number;
      y: number;
      scale: number;
    } | null => {
      const mainWidth =
        document.querySelector(".app-main")?.getBoundingClientRect().width ??
        380;
      stage.style.width = `${Math.min(380, mainWidth)}px`;
      const w = stage.offsetWidth,
        h = stage.offsetHeight;
      if (w < 1 || h < 1) return null;
      if (orbDocked) {
        const brand = header.getBoundingClientRect();
        const headerElement =
          document.querySelector<HTMLElement>(".app-header");
        const expandedHeader = headerElement?.getBoundingClientRect();
        // The header has a one-time translateY(7px) entrance animation.
        // Remove that transient translation when calculating the destination
        // so auto-connect at startup cannot leave the icon 7px too low.
        const headerTransform = headerElement
          ? getComputedStyle(headerElement).transform
          : "none";
        const headerTranslateY =
          headerTransform === "none" ? 0 : new DOMMatrix(headerTransform).m42;
        // Anchor top moves while the header grows from 70px to 116px.
        // Use the FINAL header center as the fixed destination. Measuring
        // brand.top mid-transition previously left the Orb 16px too high.
        const visual = stage.querySelector<HTMLElement>(
          ".glass-sphere-enclosure",
        );
        const sphereSize = visual?.offsetWidth ?? 190;
        const scale = Math.min(0.52, 64 / Math.max(1, sphereSize));
        // CSS grid placement, margins and transforms make offsetTop differ
        // from the painted sphere's position. Invert its CURRENT composed
        // transform to find its local visual center, then map that point to
        // the finished 64px header anchor (no endpoint snap).
        const transform = getComputedStyle(stage).transform;
        const matrix =
          transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
        const currentScale = matrix.a || 1;
        const painted = visual?.getBoundingClientRect();
        const localCenterX = painted
          ? (painted.left + painted.width / 2 - matrix.m41) / currentScale
          : w / 2;
        const localCenterY = painted
          ? (painted.top + painted.height / 2 - matrix.m42) / currentScale
          : h / 2;
        return {
          x: brand.left + 32 - localCenterX * scale,
          y:
            (expandedHeader?.top ?? brand.top) -
            headerTranslateY +
            58 -
            localCenterY * scale,
          scale,
        };
      }
      const rect = home.getBoundingClientRect();
      const hero = home.closest<HTMLElement>(".hero-glass-section");
      const title = hero?.querySelector<HTMLElement>(".hero-state-title");
      const main = document.querySelector<HTMLElement>(".app-main");
      if (rect.width < 1 || rect.height < 1 || !hero || !title || !main)
        return null;
      // The old code centered the 380x210 STAGE inside the anchor, not the
      // painted Orb within the visual hero. This left the sphere visibly high
      // relative to the space between Header and the Live Activity panel.
      // Invert the current transform to center the painted sphere itself.
      const visual = stage.querySelector<HTMLElement>(
        ".glass-sphere-enclosure",
      );
      const currentTransform = getComputedStyle(stage).transform;
      const matrix =
        currentTransform === "none"
          ? new DOMMatrix()
          : new DOMMatrix(currentTransform);
      const currentScale = matrix.a || 1;
      const painted = visual?.getBoundingClientRect();
      const localCenterX = painted
        ? (painted.left + painted.width / 2 - matrix.m41) / currentScale
        : w / 2;
      const localCenterY = painted
        ? (painted.top + painted.height / 2 - matrix.m42) / currentScale
        : h / 2;
      const mainRect = main.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      // The entire hero also contains the heading/prompt, so centering
      // inside its full height puts the Orb visually too low. Center the
      // PAINTED sphere within the space ABOVE the heading instead.
      // At scale 1 the portrait retains native raster sharpness, while the
      // safety clamp keeps outer orbit trails clear of the heading.
      const offlineScale = 1;
      const sphereRadius = (visual?.offsetHeight ?? 168) / 2;
      const opticalCenterY = Math.min(
        (heroRect.top + titleRect.top) / 2,
        titleRect.top - sphereRadius - 40,
      );
      // On Disconnect the header animates from 116px to 70px. The main,
      // hero and title are all translated by its *current* extra height.
      // If that displacement is baked into the destination, the Orb lands
      // exactly 46px too low and stays there after the animation finishes.
      // Predict the FINAL idle-layout coordinate instead of measuring the
      // in-flight header geometry as the destination.
      const headerContainer =
        document.querySelector<HTMLElement>(".app-header");
      const headerExtraHeight = Math.max(
        0,
        (headerContainer?.getBoundingClientRect().height ?? 70) - 70,
      );
      return {
        x: mainRect.left + mainRect.width / 2 - localCenterX * offlineScale,
        y: opticalCenterY - headerExtraHeight - localCenterY * offlineScale,
        scale: offlineScale,
      };
    };
    const serialize = (p: { x: number; y: number; scale: number }) =>
      `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) scale(${p.scale.toFixed(5)})`;
    const destination = targetTransform();
    if (!destination) return;
    const next = serialize(destination);
    const previous = orbWasDockedRef.current;
    const changing = previous !== null && previous !== orbDocked;
    orbWasDockedRef.current = orbDocked;

    if (changing && enabled && orbPositionedRef.current) {
      // Cancel while preserving the computed mid-flight transform; interrupted
      // connect/disconnect actions therefore never teleport the Orb.
      const computed = getComputedStyle(stage).transform;
      orbFlightRef.current?.cancel();
      orbFlightRef.current = null;
      const matrix =
        computed === "none"
          ? new DOMMatrix(stage.style.transform)
          : new DOMMatrix(computed);
      const from = { x: matrix.m41, y: matrix.m42, scale: matrix.a || 1 };
      const dx = destination.x - from.x,
        dy = destination.y - from.y;
      const direction = orbDocked ? 1 : -1;
      const c1 = {
        x: from.x + dx * 0.32 + 9 * direction,
        y: from.y + dy * 0.32 - 15,
        scale: from.scale + (destination.scale - from.scale) * 0.3,
      };
      const c2 = {
        x: from.x + dx * 0.76 + 7 * direction,
        y: from.y + dy * 0.76 + 10,
        scale: from.scale + (destination.scale - from.scale) * 0.78,
      };
      stage.style.transform = serialize(from);
      stage.dataset.travelling = "true";
      stage.classList.add("orb-morphing");
      const animation = stage.animate(
        [
          { transform: serialize(from), offset: 0 },
          { transform: serialize(c1), offset: 0.32 },
          { transform: serialize(c2), offset: 0.76 },
          { transform: next, offset: 1 },
        ],
        {
          duration: orbFlightDuration,
          easing: "cubic-bezier(.18,.82,.22,1)",
          fill: "forwards",
        },
      );
      orbFlightRef.current = animation;
      crestFrame = requestAnimationFrame(followCrestFlight);
      animation.onfinish = () => {
        if (orbFlightRef.current !== animation) return;
        stage.style.transform = next;
        animation.cancel();
        orbFlightRef.current = null;
        stage.dataset.travelling = "false";
        stage.classList.remove("orb-morphing");
        syncSharpCrest();
        // Resolve any final header/layout movement after the flight:
        // ResizeObserver callbacks during the flight were intentionally
        // deferred, so do not leave the Orb at a stale endpoint.
        requestAnimationFrame(() => {
          if (orbFlightRef.current || orbWasDockedRef.current !== orbDocked)
            return;
          const settled = targetTransform();
          if (settled) {
            stage.style.transform = serialize(settled);
            syncSharpCrest();
          }
        });
      };
    } else if (!orbFlightRef.current) {
      stage.style.transform = next;
      stage.dataset.travelling = "false";
      orbPositionedRef.current = true;
      syncSharpCrest();
    }
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (orbFlightRef.current) return;
        const target = targetTransform();
        if (target) {
          stage.style.transform = serialize(target);
          syncSharpCrest();
        }
      });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(header);
    observer.observe(home);
    const main = document.querySelector(".app-main");
    if (main) observer.observe(main);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(crestFrame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [orbDocked, activeDrawer, animationsEnabled]);

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
      <RoyalSilkBackground
        isConnected={isConnected}
        frozen={matrixFrozenAfterDisconnect}
        motionEnabled={animationsEnabled}
      />
      {error && (
        <div className="error-toast" role="alert" aria-live="assertive">
          <span>{error}</span>
          <button
            style={{
              background: "transparent",
              border: 0,
              color: "#ffffff",
              cursor: "pointer",
            }}
            type="button"
            aria-label="Dismiss error"
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

      <div
        ref={orbTravelRef}
        className={`orb-stage orb-travel-stage ${orbDocked ? "orb-compact" : "orb-expanded"} ${activeDrawer ? "orb-route-open" : ""}`}
      >
        <div className="orb-astral-orbit" aria-hidden="true" />
        <div className="orb-astral-orbit inner" aria-hidden="true" />
        <div className="orb-eclipse-plane" aria-hidden="true" />
        <div className="orb-eclipse-plane alternate" aria-hidden="true" />
        <div className="orb-comet-track" aria-hidden="true" />
        <div className={`plasma-aura ${isConnected ? "active" : ""}`} />

        <div
          className={`glass-sphere-enclosure ${isDisconnecting ? "disconnecting" : ""}`}
          role={orbDocked ? "img" : "button"}
          tabIndex={orbDocked || activeDrawer !== null ? -1 : 0}
          aria-label={
            orbDocked
              ? "QNECTOR active animated logo"
              : isDisconnecting
                ? "Disconnecting bridge"
                : "Press QNECTOR orb to connect"
          }
          title={
            orbDocked ? "QNECTOR connected" : "Press QNECTOR orb to connect"
          }
          onClick={handleOrbConnect}
          onKeyDown={handleOrbConnectKey}
        >
          <QueenLiquidOrb
            connected={isConnected}
            holding={false}
            disconnecting={isDisconnecting}
            motionEnabled={animationsEnabled}
            compact={orbDocked}
          />
        </div>
      </div>

      {/* The glass animation uses a compositor transform; its crest must not.
          The independent bitmap is drawn at pixel-aligned final output size. */}
      <img
        ref={orbSharpCrestRef}
        src={QUEEN_IMAGE_URL}
        className={`orb-sharp-crest ${orbDocked ? "orb-compact" : "orb-expanded"} ${activeDrawer ? "orb-route-open" : ""}`}
        alt=""
        aria-hidden="true"
        draggable={false}
      />

      <header className={`app-header ${orbDocked ? "orb-in-header" : ""}`}>
        <div className="brand-section">
          <div className="brand-crest" ref={orbHeaderRef} aria-hidden="true" />
          <div className="brand-copy">
            <h1 className="brand-title">QNECTOR</h1>
            <div className="brand-tag">Royal MCP Bridge</div>
            <div className="bridge-active-caption" aria-live="polite">
              <span className="bridge-active-light" aria-hidden="true" />
              <span>Your bridge is active</span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          {updateAttention && (
            <button
              type="button"
              className={`update-header-pill ${updateState?.phase ?? "available"}`}
              onClick={() => {
                switchDrawer("settings");
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
          <button
            className="header-disconnect-btn"
            type="button"
            aria-label={orbDocked ? "Disconnect QNECTOR bridge" : "Bridge idle"}
            title={orbDocked ? "Disconnect bridge" : "Bridge idle"}
            disabled={!orbDocked || busy || isDisconnecting}
            onClick={() => void disconnect()}
          >
            {orbDocked ? "Disconnect" : "IDLE"}
          </button>
        </div>
      </header>

      <main className={"app-main" + (activeDrawer ? " route-active" : "")}>
        <div
          ref={dashboardLayoutRef}
          className={
            "dashboard-page" +
            (activeDrawer ? " offstage" : " current") +
            (orbDocked ? " orb-docked" : "")
          }
          aria-hidden={Boolean(activeDrawer)}
          inert={Boolean(activeDrawer)}
        >
          <section
            ref={heroLayoutRef}
            className="glass-card hero-glass-section"
            aria-hidden={orbDocked}
          >
            <div
              className="orb-home-anchor"
              ref={orbHomeRef}
              aria-hidden="true"
            />
            {/* Connection status is already shown by the header ACTIVE indicator. */}
            <h2 className="hero-state-title">
              {isDisconnecting
                ? "DISCONNECTING…"
                : isConnected
                  ? "Your bridge is online."
                  : isConnecting
                    ? "ESTABLISHING BRIDGE…"
                    : "Your bridge is offline."}
            </h2>
            {!isConnected && (
              <div className="orb-connect-prompt">
                {isConnecting
                  ? "Connecting bridge…"
                  : isDisconnecting
                    ? "Disconnecting bridge…"
                    : "Press QNECTOR orb to connect"}
              </div>
            )}
          </section>

          <ActivityPanel initialActivity={initialActivity} />
        </div>
        {activeDrawer && (
          <div
            className="inline-route-view"
            data-testid="inline-route-view"
            role="region"
            aria-label={drawerTitles[activeDrawer]}
          >
            <div
              ref={drawerDialogRef}
              id="unified-drawer-panel"
              className="inline-route-shell"
              tabIndex={-1}
            >
              <div className="drawer-header">
                <h2 className="drawer-title">
                  <RoyalIcon name={activeDrawer} size={18} />
                  {drawerTitles[activeDrawer]}
                </h2>
              </div>
              <div className="drawer-page" key={activeDrawer}>
                {activeDrawer === "memory" && (
                  <div className="drawer-content">
                    <MemoryCenter
                      key={status?.activeWorkspace}
                      memory={memory}
                      workspace={status?.activeWorkspace}
                      busy={memoryBusy}
                      onOpen={() => void openMemoryFile()}
                      onExport={() => void exportMemoryFile()}
                      onClear={() => void clearMemory()}
                    />
                  </div>
                )}
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
                        className="btn-drawer-action"
                        type="button"
                        onClick={() => void openChatGPT()}
                      >
                        OPEN CHATGPT
                      </button>
                      <section
                        className="workspace-settings-section"
                        aria-labelledby="workspace-settings-title"
                      >
                        <div className="workspace-settings-heading">
                          <RoyalIcon name="folder" size={18} />
                          <div>
                            <h3 id="workspace-settings-title">Workspace</h3>
                            <p>
                              Choose the folder QNECTOR uses for local tools and
                              memory.
                            </p>
                          </div>
                        </div>
                        <div
                          className="workspace-settings-path"
                          title={
                            status?.activeWorkspace ?? "No workspace selected"
                          }
                        >
                          <span className="workspace-settings-machine">
                            {status?.machineName ?? "This PC"}
                          </span>
                          <span className="workspace-settings-directory">
                            {status?.activeWorkspace ?? "No workspace selected"}
                          </span>
                        </div>
                        <div className="workspace-settings-actions">
                          <button
                            type="button"
                            className="btn-drawer-action"
                            onClick={() => void chooseWorkspace()}
                          >
                            <RoyalIcon name="folder" size={15} /> Choose Folder
                          </button>
                          <button
                            type="button"
                            className="btn-drawer-action"
                            disabled={!status?.activeWorkspace}
                            onClick={() =>
                              status?.activeWorkspace &&
                              void window.qnector.openPath(
                                status.activeWorkspace,
                              )
                            }
                          >
                            Explorer
                          </button>
                          <button
                            type="button"
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
                            Terminal
                          </button>
                        </div>
                      </section>

                      <button
                        className="setup-launch-card"
                        type="button"
                        onClick={() => void openSetupWizard()}
                      >
                        <span className="setup-launch-icon">✦</span>
                        <span className="setup-launch-copy">
                          <strong>Connection Setup</strong>
                          <small>
                            Guided OpenAI Tunnel setup from first run to
                            connected
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
                            Performance, health checks, processes and build
                            state
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
                            <strong>
                              v{updateState?.currentVersion ?? "…"}
                            </strong>
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
                                    style={{
                                      width: `${updateProgressPercent}%`,
                                    }}
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

                      {/* Royal Motion Quality: local UI-only preference.
                        The persisted legacy animationsEnabled=false always wins. */}
                      <div className="setting-toggle-card motion-settings-card">
                        <div className="motion-settings-header">
                          <strong>Motion Quality</strong>
                          <small>Liquid Glass, Queen Orb and Silk Aurora</small>
                        </div>
                        <div
                          className="motion-quality-segments"
                          role="group"
                          aria-label="Motion quality"
                        >
                          {QUALITY_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className={
                                motionPreferences.quality === option
                                  ? "active"
                                  : ""
                              }
                              aria-pressed={
                                motionPreferences.quality === option
                              }
                              disabled={!animationsEnabled}
                              onClick={() =>
                                motionPreferences.setQuality(option)
                              }
                            >
                              {option[0]!.toUpperCase() + option.slice(1)}
                            </button>
                          ))}
                        </div>
                        <p className="motion-quality-help" role="status">
                          {motionPreferences.effective === "reduced"
                            ? "OS Reduced Motion active: decorative loops are paused."
                            : !animationsEnabled
                              ? "Animations disabled by the existing QNECTOR setting."
                              : motionPreferences.effective === "off"
                                ? "Ambient effects are static; controls still work."
                                : "Animation follows the display refresh rate, targeting 60+ FPS when hardware permits."}
                        </p>
                        <label className="motion-telemetry-toggle">
                          <input
                            type="checkbox"
                            checked={motionPreferences.telemetryEnabled}
                            onChange={(event) =>
                              motionPreferences.setTelemetryEnabled(
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            Show local frame-time diagnostics (opt-in)
                          </span>
                        </label>
                        {motionPreferences.telemetryEnabled && (
                          <div
                            className="motion-telemetry-result"
                            aria-live="off"
                          >
                            {motionPreferences.stats
                              ? `${motionPreferences.stats.fps.toFixed(1)} FPS · P95 ${motionPreferences.stats.p95FrameMs.toFixed(1)} ms · Over 17 ms: ${motionPreferences.stats.missed60HzFrames}`
                              : "Measuring visible frames…"}
                          </div>
                        )}
                      </div>
                      {/* Interface Animations */}
                      <div className="setting-toggle-card">
                        <label className="drawer-toggle">
                          <input
                            type="checkbox"
                            checked={config?.ui.animationsEnabled ?? true}
                            onChange={(e) =>
                              void toggleSetting(
                                "animationsEnabled",
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
                            <span>Interface Animations</span>
                            <span
                              style={{
                                fontSize: "10px",
                                color: "var(--text-muted)",
                              }}
                            >
                              Liquid Glass, Silk Aurora and responsive motion
                            </span>
                          </div>
                        </label>
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
                              void toggleSetting(
                                "startAtLogin",
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
      </main>

      <footer
        className={`floating-glass-dock ${activeDrawer ? "" : "dashboard-dock"}`}
      >
        <button
          className={`dock-pill-btn ${activeDrawer === null ? "active" : ""}`}
          aria-current={activeDrawer === null ? "page" : undefined}
          onClick={closeDrawer}
        >
          <span>
            <RoyalIcon name="home" size={18} />
          </span>
          <span>Home</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "memory" ? "active" : ""}`}
          aria-current={activeDrawer === "memory" ? "page" : undefined}
          onClick={() => toggleDrawer("memory")}
        >
          <span>
            <RoyalIcon name="memory" size={18} />
          </span>
          <span>Memory</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "skills" ? "active" : ""}`}
          aria-current={activeDrawer === "skills" ? "page" : undefined}
          onClick={() => toggleDrawer("skills")}
        >
          <span>
            <RoyalIcon name="skills" size={18} />
          </span>
          <span>Skills</span>
        </button>
        <button
          className={`dock-pill-btn ${activeDrawer === "settings" ? "active" : ""}`}
          aria-current={activeDrawer === "settings" ? "page" : undefined}
          onClick={() => toggleDrawer("settings")}
        >
          <span>
            <RoyalIcon name="settings" size={18} />
          </span>
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
