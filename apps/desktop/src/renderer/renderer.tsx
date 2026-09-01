import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./luxury-theme.css";
import type { QnectorConfig, TransportMode } from "@qnector/shared";
import type { DesktopUpdateState } from "../updater-types.js";
import type {
  ActivityEntry,
  ConnectionSetupStatus,
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

const fallbackBridge: TransportSnapshot = {
  state: "disconnected",
  mode: "openai-tunnel",
};

const OPENAI_TUNNELS_URL =
  "https://platform.openai.com/settings/organization/tunnels";
const OPENAI_RUNTIME_KEYS_URL =
  "https://platform.openai.com/settings/organization/api-keys";
const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/#settings/Connectors";
const DISCONNECT_HOLD_MS = 2000;
const HOLD_EXIT_GRACE_MS = 250;

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

type UiIconName =
  | "activity"
  | "bridge"
  | "check"
  | "close"
  | "copy"
  | "external"
  | "memory"
  | "runtime"
  | "settings"
  | "update"
  | "workspace";

function UiIcon({
  name,
  size = 18,
}: {
  name: UiIconName;
  size?: number;
}): React.ReactElement {
  const paths: Record<UiIconName, React.ReactNode> = {
    activity: <path d="M4 16h3l2-5 3 8 3-10 2 5h3" />,
    bridge: (
      <>
        <circle cx="7" cy="12" r="2.5" />
        <circle cx="17" cy="7" r="2.5" />
        <circle cx="17" cy="17" r="2.5" />
        <path d="m9.2 10.8 5.6-2.6M9.2 13.2l5.6 2.6" />
      </>
    ),
    check: <path d="m5 12.5 4.2 4.2L19 7" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    external: (
      <path d="M14 5h5v5M19 5l-8 8M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    ),
    memory: (
      <>
        <path d="M9 4.5a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.83" />
        <path d="M15 4.5a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.83M12 4v16" />
      </>
    ),
    runtime: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" opacity=".35" />
        <circle cx="8" cy="7" r="1.8" />
        <circle cx="15" cy="12" r="1.8" />
        <circle cx="10" cy="17" r="1.8" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.5 1.5M7.5 16.5 6 18M18 18l-1.5-1.5M7.5 7.5 6 6" />
      </>
    ),
    update: <path d="M12 20V6m0 0L7.5 10.5M12 6l4.5 4.5M5 4h14" />,
    workspace: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
        <path d="M3.5 9h17M8 5v4" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
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
  const [selectedActivity, setSelectedActivity] = useState<ActivityEntry>();
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
  const drawerCloseFallbackRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
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
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const holdCancelGraceRef = useRef<number | null>(null);
  const [enteringActivityId, setEnteringActivityId] = useState<string>();
  const activityStreamRef = useRef<HTMLDivElement | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [setupInfo, setSetupInfo] = useState<ConnectionSetupStatus>();
  const [setupProfile, setSetupProfile] = useState("qnector");
  const [setupTunnelId, setSetupTunnelId] = useState("");
  const [setupRuntimeApiKey, setSetupRuntimeApiKey] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string>();
  const [updateState, setUpdateState] = useState<DesktopUpdateState>();

  useEffect(() => {
    if (!selectedActivity) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedActivity(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedActivity]);

  useEffect(() => {
    if (!setupOpen || setupBusy) return;
    const closeSetupOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSetupOpen(false);
    };
    window.addEventListener("keydown", closeSetupOnEscape);
    return () => window.removeEventListener("keydown", closeSetupOnEscape);
  }, [setupOpen, setupBusy]);

  useEffect(() => {
    if (!disconnectConfirmOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(".btn-confirm-secondary")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [disconnectConfirmOpen]);

  useEffect(() => {
    if (!activeDrawer || isClosingDrawer) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.drawer-card[role="dialog"]')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDrawer, isClosingDrawer]);

  const finishDrawerClose = (): void => {
    if (drawerCloseFallbackRef.current !== null) {
      window.clearTimeout(drawerCloseFallbackRef.current);
      drawerCloseFallbackRef.current = null;
    }
    setActiveDrawer(null);
    setIsClosingDrawer(false);
  };

  const closeDrawer = (): void => {
    if (!activeDrawer || isClosingDrawer) return;
    setIsClosingDrawer(true);
    if (drawerCloseFallbackRef.current !== null) {
      window.clearTimeout(drawerCloseFallbackRef.current);
    }
    // The DOM should normally be removed by drawerSlideDown's animationend.
    // Keep a generous fallback for reduced-motion / renderer edge cases.
    drawerCloseFallbackRef.current = window.setTimeout(finishDrawerClose, 600);
  };

  useEffect(() => {
    if (!activeDrawer && !disconnectConfirmOpen) return;
    const closeOverlayOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (disconnectConfirmOpen) {
        setDisconnectConfirmOpen(false);
        return;
      }
      closeDrawer();
    };
    window.addEventListener("keydown", closeOverlayOnEscape);
    return () => window.removeEventListener("keydown", closeOverlayOnEscape);
  }, [activeDrawer, disconnectConfirmOpen, isClosingDrawer]);

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
      if (activityQueue.length > 120) {
        activityQueue.splice(0, activityQueue.length - 120);
      }
      if (activityDrainTimer === undefined) {
        activityDrainTimer = window.setTimeout(drainActivityQueue, 0);
      }
    };

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
        setActivity(coalesceActivity(nextActivity).slice(0, 50));
        setProcesses(nextProcesses);
        setConfig(nextConfig);
        setSetupProfile(
          nextConfig.transport.openaiProfile?.trim() || "qnector",
        );
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
      })
      .catch((reason: unknown) => setError(String(reason)));
    void window.qnector
      .getUpdateState()
      .then((next) => mounted && setUpdateState(next))
      .catch(() => undefined);

    const offStatus = window.qnector.onStatus((next) => {
      setStatus(next);
      setBridge(next.bridge);
      if (next.bridge.state !== "error") setError(undefined);
    });
    const offActivity = window.qnector.onActivity(enqueueActivity);
    const offProcess = window.qnector.onProcess((entry) =>
      setProcesses((items) => [
        entry,
        ...items.filter((item) => item.id !== entry.id),
      ]),
    );
    const offUpdate = window.qnector.onUpdate((next) => setUpdateState(next));

    return () => {
      mounted = false;
      offStatus();
      offActivity();
      offProcess();
      offUpdate();
      if (activityDrainTimer !== undefined) clearTimeout(activityDrainTimer);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (holdCancelGraceRef.current !== null) {
        window.clearTimeout(holdCancelGraceRef.current);
      }
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
    setIsDisconnecting(true);
    setError(undefined);
    try {
      await window.qnector.disconnect();
      setBridge(fallbackBridge);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setHoldProgress(0);
      setIsDisconnecting(false);
      setBusy(false);
    }
  };

  const clearHoldExitGrace = (): void => {
    if (holdCancelGraceRef.current !== null) {
      window.clearTimeout(holdCancelGraceRef.current);
      holdCancelGraceRef.current = null;
    }
  };

  const startHold = (): void => {
    if (bridge.state !== "connected" || busy || isDisconnecting) return;
    clearHoldExitGrace();
    setIsHolding(true);
    holdStartRef.current = performance.now();

    const tick = (now: number): void => {
      if (!holdStartRef.current) return;
      const elapsed = now - holdStartRef.current;
      const progress = Math.min(elapsed / DISCONNECT_HOLD_MS, 1);
      setHoldProgress(progress);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      didLongPressRef.current = true;
      setIsHolding(false);
      setHoldProgress(1);
      holdStartRef.current = null;
      setBurstFlash(true);
      window.setTimeout(() => setBurstFlash(false), 520);
      window.setTimeout(() => {
        didLongPressRef.current = false;
      }, 800);
      void disconnect();
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const cancelHold = (): void => {
    clearHoldExitGrace();
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

  const scheduleHoldCancel = (): void => {
    clearHoldExitGrace();
    holdCancelGraceRef.current = window.setTimeout(
      cancelHold,
      HOLD_EXIT_GRACE_MS,
    );
  };

  const handleOrbClick = (): void => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    if (busy || isConnecting || isDisconnecting) return;
    if (isConnected) {
      setDisconnectConfirmOpen(true);
      return;
    }
    void connect();
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

  const checkForUpdates = async (): Promise<void> => {
    try {
      setUpdateState(await window.qnector.checkForUpdates());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const downloadUpdate = async (): Promise<void> => {
    try {
      setUpdateState(await window.qnector.downloadUpdate());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const installUpdate = async (): Promise<void> => {
    try {
      setUpdateState(await window.qnector.installUpdate());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
    setActiveDrawer(null);
    setIsClosingDrawer(false);
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

  const effectiveUrl =
    bridge.publicUrl ?? (isConnected ? status?.localUrl : undefined);

  const displayUrl =
    bridge.publicUrl ??
    (isConnecting
      ? "https://tunnel.mcp.local/connecting…"
      : isConnected
        ? (status?.localUrl ?? "http://127.0.0.1:8787/mcp")
        : "Connect to generate MCP link");

  const runtimeChecks = runtimeDashboard.doctor?.checks ?? [];
  const runtimePassCount = runtimeChecks.filter(
    (check) => check.status === "pass",
  ).length;
  const runtimeWarnCount = runtimeChecks.filter(
    (check) => check.status === "warn",
  ).length;
  const runtimeFailCount = runtimeChecks.filter(
    (check) => check.status === "fail",
  ).length;
  const runtimeManagedProcesses =
    runtimeDashboard.snapshot?.managedProcesses.filter(
      (process) => process.state === "running",
    ) ?? [];
  const runtimeNativeProcesses =
    runtimeDashboard.snapshot?.nativeQnectorProcesses ?? [];
  const runtimeProcessCount =
    runtimeManagedProcesses.length + runtimeNativeProcesses.length;
  const updateAttention =
    updateState?.phase === "available" ||
    updateState?.phase === "downloading" ||
    updateState?.phase === "downloaded" ||
    updateState?.phase === "installing";
  const updateBusy =
    updateState?.phase === "checking" ||
    updateState?.phase === "downloading" ||
    updateState?.phase === "installing";
  const updateProgressPercent = Math.round((updateState?.progress ?? 0) * 100);
  const updateHasNewVersion = Boolean(
    updateState?.latestVersion &&
    updateState.latestVersion !== updateState.currentVersion,
  );
  const updatePhaseLabel =
    updateState?.phase === "checking"
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
    updateState?.phase === "error"
      ? "!"
      : updateState?.phase === "up-to-date"
        ? "✓"
        : updateState?.phase === "downloaded"
          ? "↓"
          : updateState?.phase === "installing"
            ? "↻"
            : "↑";

  return (
    <div className="app-container">
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button
            className="error-toast-close"
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(undefined)}
          >
            <UiIcon name="close" size={15} />
          </button>
        </div>
      )}

      {disconnectConfirmOpen && (
        <div
          className="disconnect-confirm-backdrop"
          onClick={() => setDisconnectConfirmOpen(false)}
        >
          <section
            className="disconnect-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="disconnect-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="disconnect-confirm-icon" aria-hidden="true">
              <UiIcon name="bridge" size={20} />
            </div>
            <div className="disconnect-confirm-copy">
              <span className="section-kicker">Bridge control</span>
              <h2 id="disconnect-confirm-title">Disconnect Qnector?</h2>
              <p>
                ChatGPT will lose access to this computer until you connect the
                bridge again.
              </p>
            </div>
            <div className="disconnect-confirm-actions">
              <button
                type="button"
                className="btn-confirm-secondary"
                onClick={() => setDisconnectConfirmOpen(false)}
              >
                Keep connected
              </button>
              <button
                type="button"
                className="btn-confirm-danger"
                onClick={() => {
                  setDisconnectConfirmOpen(false);
                  void disconnect();
                }}
              >
                Disconnect
              </button>
            </div>
          </section>
        </div>
      )}

      <header className="app-header">
        <div className="brand-section">
          <div className="brand-crest" aria-hidden="true">
            <span className="crest-symbol">Q</span>
          </div>
          <div className="brand-copy">
            <span className="brand-tag">Local AI Interface</span>
            <h1 className="brand-title">QNECTOR</h1>
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
              aria-label={`Open updates: ${updateState?.message ?? "update status"}`}
            >
              <UiIcon name="update" size={13} />
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
            type="button"
            className={`status-pill interactive ${bridge.state}`}
            disabled={busy || isConnecting || isDisconnecting}
            onClick={() => {
              if (isConnected) {
                setDisconnectConfirmOpen(true);
              } else {
                void connect();
              }
            }}
            aria-label={`Bridge status: ${bridge.state}. ${isConnected ? "Open disconnect confirmation" : "Connect bridge"}`}
          >
            <span className="status-dot" />
            <span>
              {isConnected
                ? "Connected"
                : isConnecting
                  ? "Connecting"
                  : "Standby"}
            </span>
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="glass-card hero-glass-section">
          <div className="hero-command-row">
            <div className="hero-command-copy">
              <span className="section-kicker hero-kicker">Bridge control</span>
              <h2 className="hero-state-title">
                {isHolding
                  ? `DISCONNECTING (${(((1 - holdProgress) * DISCONNECT_HOLD_MS) / 1000).toFixed(1)}s)`
                  : isDisconnecting
                    ? "DISCONNECTING…"
                    : isConnected
                      ? "SYSTEM ONLINE"
                      : isConnecting
                        ? "ESTABLISHING…"
                        : "READY ON DEMAND"}
              </h2>
              <p className="hero-state-sub">
                {isHolding
                  ? "Keep holding to confirm. You can move away briefly without losing progress."
                  : isDisconnecting
                    ? "Closing the tunnel and local bridge cleanly…"
                    : isConnected
                      ? "Connected to ChatGPT · Full system access"
                      : "Expose this computer and workspace to ChatGPT when needed."}
              </p>
              <div
                className={`hold-hint-pill ${disconnectRingActive ? "active" : ""}`}
              >
                {isHolding ? (
                  <span>
                    Hold ·{" "}
                    {(((1 - holdProgress) * DISCONNECT_HOLD_MS) / 1000).toFixed(
                      1,
                    )}
                    s
                  </span>
                ) : isConnected ? (
                  <span>
                    Click for options · hold 2s for instant disconnect
                  </span>
                ) : (
                  <span>
                    {bridge.mode} · {status?.machineName ?? "this computer"}
                  </span>
                )}
              </div>
              <div className="endpoint-compact-pill">
                <UiIcon name="bridge" size={13} />
                <span
                  className={`endpoint-url-text ${!effectiveUrl ? "placeholder" : ""}`}
                  title={effectiveUrl}
                >
                  {displayUrl}
                </span>
                <button
                  type="button"
                  className={`btn-gold-copy ${copied ? "copied" : ""}`}
                  disabled={!effectiveUrl}
                  onClick={() => void copyLink()}
                  aria-label="Copy MCP endpoint URL"
                >
                  <UiIcon name={copied ? "check" : "copy"} size={12} />
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            </div>

            <div className="orb-stage">
              <svg
                className={`charge-svg-ring ${disconnectRingActive ? "active" : ""}`}
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient
                    id="goldFireGrad"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="50%" stopColor="#d6b45a" />
                    <stop offset="100%" stopColor="#aeb5c0" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="44" className="charge-track" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  className="charge-meter"
                  style={{
                    strokeDasharray: 276.46,
                    strokeDashoffset: 276.46 * (1 - disconnectRingProgress),
                  }}
                />
              </svg>

              <div className={`plasma-aura ${isConnected ? "active" : ""}`} />
              {burstFlash && <div className="burst-flash-ring" />}

              <button
                type="button"
                className={`glass-sphere-enclosure ${isHolding ? "holding" : ""} ${isDisconnecting ? "disconnecting" : ""}`}
                title={
                  isDisconnecting
                    ? "Disconnecting from ChatGPT"
                    : isConnected
                      ? "Click for disconnect options or hold for 2 seconds"
                      : "Click to connect"
                }
                aria-label={
                  isConnected
                    ? "Bridge connected. Click for disconnect options or hold for two seconds to disconnect."
                    : "Connect bridge"
                }
                onClick={handleOrbClick}
                onPointerDown={startHold}
                onPointerUp={cancelHold}
                onPointerEnter={clearHoldExitGrace}
                onPointerLeave={scheduleHoldCancel}
                onPointerCancel={cancelHold}
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
              </button>
            </div>
          </div>

          <div className="hero-action-row">
            {isConnected ? (
              <button
                type="button"
                className="btn-liquid-action"
                disabled={isDisconnecting}
                onClick={() => void openChatGPT()}
              >
                <UiIcon name="external" size={15} />
                <span>Open in ChatGPT</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-liquid-action"
                disabled={busy || isConnecting}
                onClick={() => void connect()}
              >
                <UiIcon name="bridge" size={15} />
                <span>
                  {busy || isConnecting ? "Connecting…" : "Connect bridge"}
                </span>
              </button>
            )}
            <button
              type="button"
              className="btn-hero-secondary"
              onClick={() => toggleDrawer("workspace")}
            >
              <UiIcon name="workspace" size={15} />
              <span>
                {status?.activeWorkspace ? "Workspace" : "Choose workspace"}
              </span>
            </button>
          </div>
        </section>

        <section className="glass-card activity-glass-card">
          <div className="card-eyebrow-row">
            <div className="activity-heading-copy">
              <span className="section-kicker">Telemetry</span>
              <div className="activity-heading-line">
                <UiIcon name="activity" size={17} />
                <h2>Live activity</h2>
              </div>
              <p>Recent tool calls from ChatGPT and local automation.</p>
            </div>
            <span className="live-badge">
              <span className="live-beacon" />
              <span>LIVE</span>
            </span>
          </div>
          <div className="activity-meta-strip">
            <span>{activity.length} recent calls</span>
            <span>Newest first</span>
          </div>

          <div className="activity-stream" ref={activityStreamRef}>
            <div className="activity-track flex-feed">
              {activity.map((item) => (
                <button
                  type="button"
                  className={`activity-item ${enteringActivityId === item.id ? "entering" : ""}`}
                  data-activity-id={item.id}
                  key={item.id}
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
                    {item.durationMs !== undefined && (
                      <span>{item.durationMs}ms</span>
                    )}
                    <span>{formatTime(item.timestamp)}</span>
                    <span className={`item-bead ${item.status}`} />
                    <span className="activity-open-glyph">›</span>
                  </div>
                </button>
              ))}

              {activity.length === 0 && (
                <div className="empty-activity">
                  <span className="empty-spark">
                    <UiIcon name="activity" size={18} />
                  </span>
                  <strong>Listening for activity</strong>
                  <span>Tool calls will appear here as they happen.</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <nav className="floating-glass-dock" aria-label="Qnector sections">
        <button
          type="button"
          className={`dock-pill-btn ${activeDrawer === "workspace" ? "active" : ""}`}
          onClick={() => toggleDrawer("workspace")}
          aria-pressed={activeDrawer === "workspace"}
        >
          <UiIcon name="workspace" size={17} />
          <span>Workspace</span>
        </button>
        <button
          type="button"
          className={`dock-pill-btn ${activeDrawer === "memory" ? "active" : ""}`}
          onClick={() => toggleDrawer("memory")}
          aria-pressed={activeDrawer === "memory"}
        >
          <UiIcon name="memory" size={17} />
          <span>Memory</span>
        </button>
        <button
          type="button"
          className={`dock-pill-btn ${activeDrawer === "runtime" ? "active" : ""}`}
          onClick={() => toggleDrawer("runtime")}
          aria-pressed={activeDrawer === "runtime"}
        >
          <UiIcon name="runtime" size={17} />
          <span>Runtime</span>
        </button>
        <button
          type="button"
          className={`dock-pill-btn ${activeDrawer === "settings" ? "active" : ""}`}
          onClick={() => toggleDrawer("settings")}
          aria-pressed={activeDrawer === "settings"}
        >
          <UiIcon name="settings" size={17} />
          <span>Settings</span>
        </button>
      </nav>

      {setupOpen && (
        <div className="setup-backdrop" onClick={() => setSetupOpen(false)}>
          <section
            className="setup-card"
            role="dialog"
            aria-modal="true"
            aria-label="Qnector OpenAI Tunnel connection setup"
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

      {selectedActivity && (
        <div
          className="activity-detail-backdrop"
          onClick={() => setSelectedActivity(undefined)}
        >
          <section
            className="activity-detail-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedActivity.tool}.${selectedActivity.action} tool call details`}
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

      {activeDrawer === "workspace" && (
        <div
          className={`drawer-backdrop ${isClosingDrawer ? "closing" : ""}`}
          onClick={closeDrawer}
        >
          <div
            className={`drawer-card ${isClosingDrawer ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onAnimationEnd={onDrawerAnimationEnd}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">
                <UiIcon name="workspace" size={17} /> Workspace
              </span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>
            <div className="drawer-content">
              <div className="drawer-row">
                <span className="drawer-label">Current Folder</span>
                <span className="meta-caption gold">{status?.machineName}</span>
              </div>
              <div className="workspace-path-box">
                {status?.activeWorkspace ?? "—"}
              </div>
              <div className="drawer-actions">
                <button
                  className="btn-drawer-action"
                  onClick={() => void chooseWorkspace()}
                >
                  Choose Folder
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
                  Terminal
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
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onAnimationEnd={onDrawerAnimationEnd}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">
                <UiIcon name="memory" size={17} /> Project Memory
              </span>
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
                    <span>CURRENT ACTIVE GOAL</span>
                    <span className="meta-caption">
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
                      <span>TASK PROGRESS & STEPS</span>
                    </div>
                    <div className="memory-checklist">
                      {memory?.state.active?.completedSteps?.map(
                        (step, idx) => (
                          <div
                            className="memory-checklist-item done"
                            key={`done-${idx}`}
                          >
                            <span className="check-icon done">
                              <UiIcon name="check" size={12} />
                            </span>
                            <span>{step}</span>
                          </div>
                        ),
                      )}
                      {memory?.state.active?.pendingSteps?.map((step, idx) => (
                        <div
                          className="memory-checklist-item pending"
                          key={`pend-${idx}`}
                        >
                          <span className="check-icon pending">○</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(memory?.state.facts?.length ?? 0) > 0 && (
                  <div className="memory-summary-box">
                    <div className="memory-box-header">
                      <span>PROJECT RULES & KNOWLEDGE</span>
                      <span className="meta-caption">
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
                      <span className="meta-caption subtle">
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
                  View MEMORY.md
                </button>
                <button
                  className="btn-drawer-action danger"
                  disabled={memoryBusy}
                  onClick={() => void clearMemory()}
                  title="Wipe memory for this workspace"
                >
                  Wipe Memory
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
            className={`drawer-card runtime-drawer-card ${isClosingDrawer ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onAnimationEnd={onDrawerAnimationEnd}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">
                <UiIcon name="runtime" size={17} /> Runtime & Diagnostics
              </span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>

            <div className="runtime-scroll" data-testid="runtime-scroll">
              <p className="runtime-intro">
                Health, release state, active processes and workflow history.
                Start with the summary, then expand only the section you need.
              </p>

              <div className="runtime-summary-grid">
                <div className="runtime-summary-card">
                  <span className="runtime-summary-label">Health</span>
                  <strong>
                    {runtimeBusy && runtimeChecks.length === 0
                      ? "Checking…"
                      : runtimeFailCount > 0
                        ? "Needs attention"
                        : runtimeWarnCount > 0
                          ? "Healthy · warnings"
                          : runtimeChecks.length > 0
                            ? "Healthy"
                            : "Not checked"}
                  </strong>
                  <small>
                    {runtimePassCount} pass · {runtimeWarnCount} warn ·{" "}
                    {runtimeFailCount} fail
                  </small>
                </div>
                <div className="runtime-summary-card">
                  <span className="runtime-summary-label">Release</span>
                  <strong className="runtime-summary-value">
                    {runtimeDashboard.release?.status ??
                      (runtimeBusy ? "Checking…" : "Unknown")}
                  </strong>
                  <small>running vs newest local build</small>
                </div>
                <div className="runtime-summary-card">
                  <span className="runtime-summary-label">Processes</span>
                  <strong>{runtimeProcessCount}</strong>
                  <small>currently running</small>
                </div>
                <div className="runtime-summary-card">
                  <span className="runtime-summary-label">Workflows</span>
                  <strong>{runtimeDashboard.workflowRuns.length}</strong>
                  <small>recent runs</small>
                </div>
              </div>

              <details className="runtime-section" open>
                <summary>
                  <span>Release & build</span>
                  <span
                    className={`item-bead ${runtimeDashboard.release?.status === "latest" ? "success" : runtimeDashboard.release?.status === "outdated" || runtimeDashboard.release?.status === "source-newer" ? "error" : "running"}`}
                  />
                </summary>
                <div className="runtime-section-body">
                  <strong className="runtime-release-status">
                    {runtimeDashboard.release?.status ??
                      (runtimeBusy ? "checking…" : "unknown")}
                  </strong>
                  <p>
                    {runtimeDashboard.release?.recommendation ??
                      "Refresh to compare the running executable, newest package, and source state."}
                  </p>
                </div>
              </details>

              <details className="runtime-section">
                <summary>
                  <span>Health checks</span>
                  <span className="runtime-section-count">
                    {runtimeChecks.length} checks
                  </span>
                </summary>
                <div className="runtime-section-body runtime-list">
                  {runtimeChecks.map((check) => (
                    <div className="runtime-list-row" key={check.name}>
                      <span
                        className={`item-bead ${check.status === "pass" ? "success" : check.status === "warn" ? "running" : "error"}`}
                      />
                      <div>
                        <strong>{check.name}</strong>
                        <span>{check.detail}</span>
                      </div>
                    </div>
                  ))}
                  {!runtimeDashboard.doctor && (
                    <div className="runtime-empty">
                      Diagnostics have not been loaded yet.
                    </div>
                  )}
                </div>
              </details>

              <details className="runtime-section">
                <summary>
                  <span>Active processes</span>
                  <span className="runtime-section-count">
                    {runtimeProcessCount} running
                  </span>
                </summary>
                <div className="runtime-section-body runtime-list">
                  {runtimeNativeProcesses.slice(0, 8).map((process) => (
                    <div
                      className="runtime-list-row"
                      key={`native-${process.pid}`}
                    >
                      <span className="check-icon">●</span>
                      <div>
                        <strong>
                          {process.name} · PID {process.pid}
                        </strong>
                        {process.executablePath && (
                          <span>{process.executablePath}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {runtimeManagedProcesses.slice(0, 8).map((process) => (
                    <div
                      className="runtime-list-row"
                      key={`managed-${process.id}`}
                    >
                      <span className="check-icon">▶</span>
                      <div>
                        <strong>Managed process</strong>
                        <span>{process.command}</span>
                      </div>
                    </div>
                  ))}
                  {runtimeProcessCount === 0 && (
                    <div className="runtime-empty">
                      No active processes loaded.
                    </div>
                  )}
                </div>
              </details>

              <details className="runtime-section">
                <summary>
                  <span>Recent workflows</span>
                  <span className="runtime-section-count">
                    {runtimeDashboard.workflowRuns.length} recent
                  </span>
                </summary>
                <div className="runtime-section-body runtime-list">
                  {runtimeDashboard.workflowRuns.slice(0, 10).map((run) => (
                    <div className="runtime-list-row" key={run.runId}>
                      <span
                        className={`item-bead ${run.state === "succeeded" ? "success" : run.state === "failed" ? "error" : "running"}`}
                      />
                      <div>
                        <strong>{run.workflow}</strong>
                        <span>
                          {run.state} · {formatTime(run.updatedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {runtimeDashboard.workflowRuns.length === 0 && (
                    <div className="runtime-empty">
                      No workflow runs recorded.
                    </div>
                  )}
                </div>
              </details>

              <details className="runtime-section">
                <summary>
                  <span>Recent runtime activity</span>
                  <span className="runtime-section-count">
                    {runtimeDashboard.snapshot?.recentActivity.length ?? 0}{" "}
                    entries
                  </span>
                </summary>
                <div className="runtime-section-body runtime-list">
                  {(runtimeDashboard.snapshot?.recentActivity ?? [])
                    .slice(0, 10)
                    .map((entry, index) => (
                      <div
                        className="runtime-list-row"
                        key={`${entry.timestamp}-${entry.tool}-${entry.action}-${index}`}
                      >
                        <span className={`item-bead ${entry.status}`} />
                        <div>
                          <strong>
                            {entry.tool}.{entry.action}
                          </strong>
                          <span>{entry.summary || entry.status}</span>
                        </div>
                      </div>
                    ))}
                  {(runtimeDashboard.snapshot?.recentActivity.length ?? 0) ===
                    0 && (
                    <div className="runtime-empty">
                      No recent runtime activity.
                    </div>
                  )}
                </div>
              </details>
            </div>

            <div className="runtime-footer">
              <span>
                {runtimeDashboard.snapshot?.capturedAt
                  ? `Updated ${formatTime(runtimeDashboard.snapshot.capturedAt)}`
                  : "Open Runtime to load diagnostics"}
              </span>
              <button
                className="btn-drawer-action"
                disabled={runtimeBusy}
                onClick={() => void refreshRuntime()}
              >
                {runtimeBusy ? "↻ Refreshing…" : "↻ Refresh"}
              </button>
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
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onAnimationEnd={onDrawerAnimationEnd}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <span className="drawer-title">
                <UiIcon name="settings" size={17} /> Settings & Updates
              </span>
              <button className="btn-drawer-close" onClick={closeDrawer}>
                ✕
              </button>
            </div>
            <div className="drawer-content">
              <div className="settings-section-heading">
                <span>Connection & updates</span>
                <small>Manage how Qnector connects and stays current.</small>
              </div>
              <button
                className="setup-launch-card"
                type="button"
                onClick={() => void openSetupWizard()}
              >
                <span className="setup-launch-icon">
                  <UiIcon name="bridge" size={18} />
                </span>
                <span className="setup-launch-copy">
                  <strong>Connection Setup</strong>
                  <small>
                    Guided OpenAI Tunnel setup from first run to connected
                  </small>
                </span>
                <span className="activity-open-glyph">›</span>
              </button>

              <div
                className={`update-settings-card ${updateState?.phase ?? "idle"}`}
              >
                <div className="update-card-header">
                  <span className="update-card-icon">{updatePhaseIcon}</span>
                  <div className="update-card-copy">
                    <span className="update-card-eyebrow">App Updates</span>
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
                  <span className="update-version-arrow" aria-hidden="true">
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

                <div className="update-status-panel">
                  <span className="update-status-panel-icon">
                    {updatePhaseIcon}
                  </span>
                  <div>
                    <strong>{updatePhaseLabel}</strong>
                    <p>
                      {updateState?.message ??
                        "Qnector checks GitHub Releases for new versions."}
                    </p>
                  </div>
                </div>

                {updateState?.phase === "downloading" && (
                  <div className="update-progress-wrap">
                    <div className="update-progress-heading">
                      <strong>Downloading update</strong>
                      <span>{updateProgressPercent}%</span>
                    </div>
                    <div className="update-progress-track">
                      <span style={{ width: `${updateProgressPercent}%` }} />
                    </div>
                    <div className="update-progress-meta">
                      <span>
                        {formatBytes(updateState.bytesDownloaded)} /{" "}
                        {formatBytes(updateState.totalBytes)}
                      </span>
                      <span>Verified after download</span>
                    </div>
                  </div>
                )}

                <div className="update-card-actions">
                  <button
                    type="button"
                    className="btn-update-primary"
                    disabled={updateBusy}
                    onClick={runPrimaryUpdateAction}
                  >
                    {updateState?.phase === "checking"
                      ? "Checking…"
                      : updateState?.phase === "downloading"
                        ? `Downloading ${updateProgressPercent}%`
                        : updateState?.phase === "installing"
                          ? "Updating…"
                          : updateState?.canInstall
                            ? "Restart & Update"
                            : updateState?.canDownload
                              ? `Download v${updateState.latestVersion ?? "new"}`
                              : updateState?.phase === "up-to-date"
                                ? "Check Again"
                                : updateState?.phase === "error"
                                  ? "Retry"
                                  : "Check for Updates"}
                  </button>
                  {updateState?.releaseUrl && (
                    <button
                      type="button"
                      className="btn-update-secondary"
                      onClick={() => void window.qnector.openUpdateRelease()}
                    >
                      View Release Notes ↗
                    </button>
                  )}
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
                  <span className="meta-caption">
                    Internet transport for ChatGPT
                  </span>
                </div>
                <select
                  className="drawer-select"
                  value={config?.transport.mode ?? "openai-tunnel"}
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

              <div className="settings-section-heading separated">
                <span>Application behavior</span>
                <small>Control shortcuts, background mode and startup.</small>
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
                    <span className="meta-caption">
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
                    <span className="meta-caption">
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
                    <span className="meta-caption">
                      Launch Qnector on Windows startup
                    </span>
                  </div>
                </label>
              </div>

              <div className="settings-section-heading separated">
                <span>Project memory</span>
                <small>
                  Choose how persistent workspace context is mirrored.
                </small>
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
                    <span className="meta-caption">
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
