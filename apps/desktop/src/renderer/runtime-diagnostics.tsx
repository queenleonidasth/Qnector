import type { ProcessSnapshot } from "../preload/api.js";

export interface RuntimeDashboardView {
  performance?: {
    uptimeMs: number;
    portableCache: { enabled: boolean; hit: boolean | null };
    milestones: Array<{
      name: string;
      elapsedMs: number;
      details?: Record<string, string | number | boolean | null>;
    }>;
    aggregates: Array<{
      category: string;
      name: string;
      count: number;
      averageMs: number;
      maxMs: number;
      lastMs: number;
    }>;
  };
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

export function RuntimeDiagnostics({
  runtimeDashboard,
  runtimeBusy,
  onRefresh,
}: {
  runtimeDashboard: RuntimeDashboardView;
  runtimeBusy: boolean;
  onRefresh: () => void;
}): React.ReactElement {
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
  const runtimePerformance = runtimeDashboard.performance;
  const startupMilestone = runtimePerformance?.milestones.find(
    (entry) => entry.name === "window-created",
  );
  const runtimeReadyMilestone = runtimePerformance?.milestones.find(
    (entry) => entry.name === "mcp-runtime-ready",
  );
  const bridgeMilestone = runtimePerformance?.milestones.find(
    (entry) => entry.name === "bridge-connected",
  );
  const topPerformanceOperations =
    runtimePerformance?.aggregates.slice(0, 8) ?? [];
  const portableCacheLabel = !runtimePerformance?.portableCache.enabled
    ? "installed / development"
    : runtimePerformance.portableCache.hit === true
      ? "portable cache hit"
      : runtimePerformance.portableCache.hit === false
        ? "portable cache miss"
        : "portable cache pending";

  return (
    <>
      <div className="runtime-scroll" data-testid="runtime-scroll">
        <p className="runtime-intro">
          Health, release state, active processes and workflow history. Start
          with the summary, then expand only the section you need.
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
          <div className="runtime-summary-card">
            <span className="runtime-summary-label">Startup</span>
            <strong>
              {startupMilestone
                ? `${Math.round(startupMilestone.elapsedMs)} ms`
                : runtimeBusy
                  ? "Measuring…"
                  : "Not measured"}
            </strong>
            <small>{portableCacheLabel}</small>
          </div>
        </div>

        <details className="runtime-section">
          <summary>
            <span>Performance timeline</span>
            <span className="runtime-section-count">
              {runtimePerformance?.milestones.length ?? 0} marks
            </span>
          </summary>
          <div className="runtime-section-body runtime-list">
            {startupMilestone && (
              <div className="runtime-list-row">
                <span className="check-icon">⚡</span>
                <div>
                  <strong>
                    Window created · {Math.round(startupMilestone.elapsedMs)} ms
                  </strong>
                  <span>{portableCacheLabel}</span>
                </div>
              </div>
            )}
            {runtimeReadyMilestone && (
              <div className="runtime-list-row">
                <span className="check-icon">◆</span>
                <div>
                  <strong>
                    MCP runtime ready ·{" "}
                    {Math.round(runtimeReadyMilestone.elapsedMs)} ms
                  </strong>
                  <span>Heavy runtime loads after the desktop shell.</span>
                </div>
              </div>
            )}
            {bridgeMilestone && (
              <div className="runtime-list-row">
                <span className="check-icon">↗</span>
                <div>
                  <strong>
                    Bridge connected · {Math.round(bridgeMilestone.elapsedMs)}{" "}
                    ms
                  </strong>
                  <span>Measured from desktop process start.</span>
                </div>
              </div>
            )}
            {topPerformanceOperations.map((entry) => (
              <div
                className="runtime-list-row"
                key={`${entry.category}-${entry.name}`}
              >
                <span className="item-bead running" />
                <div>
                  <strong>
                    {entry.category}.{entry.name} · {Math.round(entry.lastMs)}{" "}
                    ms
                  </strong>
                  <span>
                    avg {Math.round(entry.averageMs)} ms · max{" "}
                    {Math.round(entry.maxMs)} ms · {entry.count} call(s)
                  </span>
                </div>
              </div>
            ))}
            {!runtimePerformance && (
              <div className="runtime-empty">
                Performance data has not been loaded yet.
              </div>
            )}
          </div>
        </details>

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
              <div className="runtime-list-row" key={`native-${process.pid}`}>
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
              <div className="runtime-list-row" key={`managed-${process.id}`}>
                <span className="check-icon">▶</span>
                <div>
                  <strong>Managed process</strong>
                  <span>{process.command}</span>
                </div>
              </div>
            ))}
            {runtimeProcessCount === 0 && (
              <div className="runtime-empty">No active processes loaded.</div>
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
              <div className="runtime-empty">No workflow runs recorded.</div>
            )}
          </div>
        </details>

        <details className="runtime-section">
          <summary>
            <span>Recent runtime activity</span>
            <span className="runtime-section-count">
              {runtimeDashboard.snapshot?.recentActivity.length ?? 0} entries
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
            {(runtimeDashboard.snapshot?.recentActivity.length ?? 0) === 0 && (
              <div className="runtime-empty">No recent runtime activity.</div>
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
          onClick={onRefresh}
        >
          {runtimeBusy ? "↻ Refreshing…" : "↻ Refresh"}
        </button>
      </div>
    </>
  );
}

export function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
