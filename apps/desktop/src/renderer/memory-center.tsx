import React, { useMemo, useState } from "react";
import type { MemoryV2Snapshot, MemoryFact, MemoryTask } from "@qnector/shared";
import {
  currentSavedTask,
  filterMemories,
  latestSavedActivityTask,
  latestLinkedSessionTask,
  presentMemories,
  recentSavedLog,
} from "./memory-center-model.js";
import "./memory-center.css";

type LegacyFact = Omit<
  Pick<MemoryFact, "id" | "key" | "value" | "category" | "updatedAt">,
  "category"
> & { category: string };
type V2MemoryRecord = MemoryFact & {
  scope: "workspace" | "task";
  taskId: string | null;
  taskTitle: string | null;
};
interface InventoryPage<T> {
  items: T[];
  total: number;
  nextCursor: number | null;
  workspaceId: string;
}
export interface MemoryCenterData {
  workspaceId?: string;
  available: boolean;
  updatedAt: string;
  warning?: string;
  state: {
    active: {
      currentTask: string;
      pendingSteps: string[];
      completedSteps: string[];
      criticalContext: string;
    } | null;
    facts: LegacyFact[];
    recentChanges?: Array<{ timestamp: string; summary: string }>;
  };
  v2?: MemoryV2Snapshot;
  counts: { facts: number; checkpoints: number; recentChanges: number };
}

const INITIAL_VISIBLE = 12;
const LOG_VISIBLE = 6;
function formatTime(timestamp?: string): string {
  if (!timestamp) return "Unknown time";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
function taskStatus(status: MemoryTask["status"]): string {
  return {
    active: "In progress",
    blocked: "Blocked",
    idle: "Paused",
    completed: "Completed",
  }[status];
}

export function MemoryCenter({
  memory,
  workspace,
  busy,
  onOpen,
  onExport,
  onClear,
}: {
  memory?: MemoryCenterData;
  workspace?: string;
  busy: boolean;
  onOpen: () => void;
  onExport: () => void;
  onClear: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [visibleMemories, setVisibleMemories] = useState(INITIAL_VISIBLE);
  const [showTasks, setShowTasks] = useState(false);
  const [showAllLog, setShowAllLog] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [v2Page, setV2Page] = useState<InventoryPage<V2MemoryRecord> | null>(
    null,
  );
  const [legacyPage, setLegacyPage] =
    useState<InventoryPage<LegacyFact> | null>(null);
  const [taskPage, setTaskPage] = useState<InventoryPage<MemoryTask> | null>(
    null,
  );
  const [loadingPage, setLoadingPage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const v2Records = useMemo(() => {
    const byId = new Map<string, MemoryFact | V2MemoryRecord>();
    // Favor the fresh snapshot when a saved page contains an older copy.
    for (const item of memory?.v2?.memories ?? []) byId.set(item.id, item);
    for (const item of v2Page?.items ?? [])
      if (!byId.has(item.id)) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [memory, v2Page]);
  const legacyRecords = useMemo(() => {
    const byId = new Map<string, LegacyFact>();
    for (const item of legacyPage?.items ?? []) byId.set(item.id, item);
    for (const item of memory?.state.facts ?? []) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [memory, legacyPage]);
  const records = useMemo(
    () => presentMemories(v2Records, legacyRecords),
    [v2Records, legacyRecords],
  );
  const filtered = filterMemories(records, query);
  const tasks = useMemo(() => {
    const byId = new Map<string, MemoryTask>();
    for (const item of taskPage?.items ?? []) byId.set(item.id, item);
    for (const item of memory?.v2?.tasks ?? []) byId.set(item.id, item);
    return Array.from(byId.values()).sort((a, b) =>
      (b.lastEventAt ?? b.updatedAt).localeCompare(
        a.lastEventAt ?? a.updatedAt,
      ),
    );
  }, [memory, taskPage]);
  const lastSessionTask = latestLinkedSessionTask(tasks);
  const savedSession = memory?.v2?.lastSession;
  const latestActivity = latestSavedActivityTask(tasks);
  const latestTopic = savedSession
    ? lastSessionTask
    : (lastSessionTask ?? latestActivity);
  const hasLinkedSession = Boolean(savedSession || lastSessionTask);
  const currentTask = currentSavedTask(tasks);
  const otherTasks = tasks.filter(
    (task) =>
      task.id !== currentTask?.id &&
      (task.title !== "General workspace activity" ||
        task.sessionCount > 0 ||
        task.status !== "idle"),
  );
  const log = useMemo(
    () =>
      recentSavedLog(
        memory?.v2?.events ?? [],
        memory?.state.recentChanges ?? [],
      ),
    [memory],
  );

  const requestPage = async <T,>(
    input: Record<string, unknown>,
  ): Promise<InventoryPage<T>> => {
    const result = await window.qnector.callMemory(input);
    if (!result.ok) throw new Error(result.error?.message ?? result.summary);
    const wrapped = result.data as { data?: unknown } | undefined;
    const raw = (wrapped?.data ?? wrapped) as
      (InventoryPage<T> & { facts?: T[] }) | undefined;
    const items = Array.isArray(raw?.items) ? raw.items : raw?.facts;
    if (!raw || !Array.isArray(items) || !Number.isFinite(raw.total))
      throw new Error("Invalid memory inventory response");
    return { ...raw, items };
  };
  const loadPage = async (
    kind: "memories" | "tasks" | "legacy",
  ): Promise<void> => {
    if (loadingPage || !memory) return;
    setLoadingPage(kind);
    setPageError(null);
    try {
      if (kind === "legacy") {
        const page = await requestPage<LegacyFact>({
          action: "list",
          cursor: legacyPage?.nextCursor ?? 0,
          limit: 100,
        });
        if (memory.workspaceId && page.workspaceId !== memory.workspaceId)
          return;
        setLegacyPage((current) => ({
          ...page,
          items: [...(current?.items ?? []), ...page.items],
        }));
      } else if (kind === "memories") {
        const page = await requestPage<V2MemoryRecord>({
          action: "v2_inventory",
          inventoryType: "memories",
          cursor: v2Page?.nextCursor ?? 0,
          limit: 100,
        });
        if (page.workspaceId !== memory.v2?.workspaceId) return;
        setV2Page((current) => ({
          ...page,
          items: [...(current?.items ?? []), ...page.items],
        }));
      } else {
        const page = await requestPage<MemoryTask>({
          action: "v2_inventory",
          inventoryType: "tasks",
          cursor: taskPage?.nextCursor ?? 0,
          limit: 100,
        });
        if (page.workspaceId !== memory.v2?.workspaceId) return;
        setTaskPage((current) => ({
          ...page,
          items: [...(current?.items ?? []), ...page.items],
        }));
      }
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingPage(null);
    }
  };
  const workspaceName =
    workspace
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  const hasMoreV2 = Boolean(
    memory?.v2 &&
    (v2Page === null
      ? memory.v2.counts.memories > memory.v2.memories.length
      : v2Page.nextCursor !== null),
  );
  const hasMoreTasks = Boolean(
    memory?.v2 &&
    (taskPage === null
      ? memory.v2.tasks.length >= 12
      : taskPage.nextCursor !== null),
  );
  const hasMoreLegacy = Boolean(
    memory &&
    memory.counts.facts > legacyRecords.length &&
    (legacyPage === null || legacyPage.nextCursor !== null),
  );

  return (
    <div className="memory-center">
      <header className="memory-center-intro">
        <strong>Memory at a glance</strong>
        <span title={workspace}>
          Workspace: {workspaceName || "Not selected"}
        </span>
        <small>
          Saved locally by QNECTOR · Not ChatGPT's complete chat history
        </small>
      </header>
      {memory?.warning && (
        <p role="alert" className="memory-center-warning">
          {memory.warning}
        </p>
      )}
      {pageError && (
        <p role="alert" className="memory-center-warning">
          Could not load more: {pageError}
        </p>
      )}

      <section
        className="memory-center-panel"
        aria-labelledby="memory-last-session"
      >
        <div className="memory-center-panel-heading">
          <span className="memory-center-panel-number">01</span>
          <h3 id="memory-last-session">
            {hasLinkedSession ? "Last Session" : "Latest Activity"}
          </h3>
        </div>
        {!memory ? (
          <p className="memory-center-note" role="status">
            Loading saved context…
          </p>
        ) : savedSession || latestTopic ? (
          <>
            <strong className="memory-center-primary">
              {savedSession?.title ?? latestTopic?.title}
            </strong>
            {(savedSession?.currentTask || latestTopic?.currentTask) &&
              (savedSession?.currentTask ?? latestTopic?.currentTask) !==
                (savedSession?.title ?? latestTopic?.title) && (
                <p className="memory-center-main-text">
                  Saved task context:{" "}
                  {savedSession?.currentTask ?? latestTopic?.currentTask}
                </p>
              )}
            <p className="memory-center-note">
              {savedSession
                ? "Most recently linked session (saved topic only)."
                : lastSessionTask
                  ? "Latest session-linked task (session timestamp unavailable)."
                  : "No linked chat session was recorded. Showing the newest saved Qnector activity instead."}
            </p>
            <small className="memory-center-time">
              {savedSession
                ? "Session linked: "
                : hasLinkedSession
                  ? "Task last updated: "
                  : "Activity updated: "}
              {formatTime(
                savedSession?.linkedAt ??
                  latestTopic?.lastEventAt ??
                  latestTopic?.updatedAt,
              )}
            </small>
          </>
        ) : (
          <p className="memory-center-note">
            No saved session topic for this workspace yet.
          </p>
        )}
        <p className="memory-center-disclaimer">
          QNECTOR stores task context, not the words spoken in ChatGPT.
        </p>
        {memory && (
          <details className="memory-center-optional">
            <summary>Saved context · {records.length} loaded</summary>
            <p className="memory-center-note">
              Saved notes from both memory systems are shown separately. Some
              may overlap. Search covers loaded items only.
            </p>
            <label className="memory-center-search">
              Search saved notes
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleMemories(INITIAL_VISIBLE);
                }}
                placeholder="Search saved notes"
              />
            </label>
            {filtered.length === 0 ? (
              <p className="memory-center-note" role="status">
                {records.length
                  ? "No matching saved notes."
                  : "No saved notes loaded."}
              </p>
            ) : (
              <div className="memory-center-saved-list">
                {filtered.slice(0, visibleMemories).map((item) => (
                  <details
                    className="memory-center-record"
                    key={`${item.source}-${item.id}`}
                  >
                    <summary>
                      <strong>{item.key}</strong> <span>{item.source}</span>
                    </summary>
                    <p>{item.value}</p>
                    {item.scope === "task" && (
                      <p className="memory-center-note">
                        Task: {item.taskTitle || "Unnamed task"}
                      </p>
                    )}
                    <small>
                      {item.category} · {formatTime(item.updatedAt)}
                    </small>
                  </details>
                ))}
              </div>
            )}
            {filtered.length > visibleMemories && (
              <button
                type="button"
                onClick={() =>
                  setVisibleMemories((count) => count + INITIAL_VISIBLE)
                }
              >
                Show 12 more notes
              </button>
            )}
            <p className="memory-center-note">
              Loaded: {v2Records.length} Memory v2 /{" "}
              {v2Page?.total ?? memory.v2?.counts.memories ?? 0};{" "}
              {legacyRecords.length} legacy / {memory.counts.facts}.
            </p>
            {hasMoreV2 && (
              <button
                type="button"
                disabled={loadingPage !== null}
                onClick={() => void loadPage("memories")}
              >
                {loadingPage === "memories"
                  ? "Loading…"
                  : "Load more saved notes"}
              </button>
            )}
            {hasMoreLegacy && (
              <button
                type="button"
                disabled={loadingPage !== null}
                onClick={() => void loadPage("legacy")}
              >
                {loadingPage === "legacy"
                  ? "Loading…"
                  : "Load more legacy notes"}
              </button>
            )}
          </details>
        )}
      </section>

      <section
        className="memory-center-panel"
        aria-labelledby="memory-current-task"
      >
        <div className="memory-center-panel-heading">
          <span className="memory-center-panel-number">02</span>
          <h3 id="memory-current-task">Current Task</h3>
        </div>
        {!memory ? (
          <p className="memory-center-note" role="status">
            Loading task status…
          </p>
        ) : currentTask ? (
          <>
            <span className="memory-center-status">
              {taskStatus(currentTask.status)}
            </span>
            <strong className="memory-center-primary">
              {currentTask.title}
            </strong>
            <p className="memory-center-main-text">
              {currentTask.currentTask || "No current task description saved."}
            </p>
            {currentTask.pendingSteps.length > 0 && (
              <p className="memory-center-next">
                <span>Next step</span>
                {currentTask.pendingSteps[0]}
              </p>
            )}
            {(currentTask.pendingSteps.length > 1 ||
              currentTask.criticalContext ||
              currentTask.completedSteps.length > 0) && (
              <details className="memory-center-optional">
                <summary>Task details</summary>
                {currentTask.pendingSteps.length > 1 && (
                  <ul>
                    {currentTask.pendingSteps.slice(1).map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ul>
                )}
                {currentTask.criticalContext && (
                  <p>{currentTask.criticalContext}</p>
                )}
                {currentTask.completedSteps.length > 0 && (
                  <details>
                    <summary>
                      Saved completed steps (verify before relying on them)
                    </summary>
                    <ul>
                      {currentTask.completedSteps.map((step, index) => (
                        <li key={index}>
                          {step} —{" "}
                          {/^(?:(?:files|git|manual): |(?:files|git|process|browser|computer)\.[a-z_]+: )/i.test(
                            step,
                          )
                            ? "Unverified historical tool log"
                            : "Marked completed in memory"}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </details>
            )}
          </>
        ) : memory.state.active?.currentTask ? (
          <>
            <span className="memory-center-status">
              Legacy saved context · Not live status
            </span>
            <strong className="memory-center-primary">
              {memory.state.active.currentTask}
            </strong>
            {memory.state.active.pendingSteps[0] && (
              <p className="memory-center-next">
                <span>Next saved step</span>
                {memory.state.active.pendingSteps[0]}
              </p>
            )}
          </>
        ) : (
          <p className="memory-center-note">
            No active task is recorded. This does not confirm that work has
            stopped.
          </p>
        )}
        {memory?.v2?.conflicts && memory.v2.conflicts.length > 0 && (
          <details className="memory-center-optional memory-center-warning">
            <summary>
              {memory.v2.conflicts.length} potential file conflict(s)
            </summary>
            {memory.v2.conflicts.map((conflict) => (
              <p key={conflict.id}>
                {conflict.taskTitles.join(" / ")} — {conflict.path}
              </p>
            ))}
          </details>
        )}
        {memory && (otherTasks.length > 0 || hasMoreTasks) && (
          <details
            className="memory-center-optional"
            open={showTasks}
            onToggle={(event) => setShowTasks(event.currentTarget.open)}
          >
            <summary>Other saved tasks · {otherTasks.length} loaded</summary>
            {otherTasks.map((task) => (
              <p key={task.id} className="memory-center-other-task">
                <strong>{task.title}</strong>
                <small>
                  {taskStatus(task.status)} ·{" "}
                  {formatTime(task.lastEventAt ?? task.updatedAt)}
                </small>
              </p>
            ))}
            {hasMoreTasks && (
              <button
                type="button"
                disabled={loadingPage !== null}
                onClick={() => void loadPage("tasks")}
              >
                {loadingPage === "tasks" ? "Loading…" : "Load more tasks"}
              </button>
            )}
            {taskPage && (
              <p className="memory-center-note">
                Loaded {tasks.length} of {taskPage.total} tasks.
              </p>
            )}
          </details>
        )}
      </section>

      <section
        className="memory-center-panel"
        aria-labelledby="memory-activity-log"
      >
        <div className="memory-center-panel-heading">
          <span className="memory-center-panel-number">03</span>
          <h3 id="memory-activity-log">Activity Log</h3>
        </div>
        <p className="memory-center-note">
          Recent saved tool events and file changes, not a chat transcript or
          proof of task completion.
        </p>
        {!memory ? (
          <p className="memory-center-note" role="status">
            Loading recent activity…
          </p>
        ) : log.length === 0 ? (
          <p className="memory-center-note">
            No recorded activity in this workspace yet.
          </p>
        ) : (
          <ol className="memory-center-log">
            {log.slice(0, showAllLog ? 12 : LOG_VISIBLE).map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.timestamp}>
                  {formatTime(entry.timestamp)}
                </time>
                <span className="memory-center-log-text">{entry.summary}</span>
                <small>
                  {entry.source === "Legacy"
                    ? "Legacy saved change"
                    : entry.status === "error"
                      ? "Tool error"
                      : "Tool succeeded · task completion not verified"}
                </small>
              </li>
            ))}
          </ol>
        )}
        {log.length > LOG_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAllLog((value) => !value)}
          >
            {showAllLog ? "Show fewer events" : "Show all recent events"}
          </button>
        )}
        {memory && (
          <details className="memory-center-optional memory-center-data-tools">
            <summary>Data tools</summary>
            <p className="memory-center-note">
              Only this workspace. Deleting memory cannot be undone.
            </p>
            <div className="memory-center-actions">
              <button type="button" disabled={busy} onClick={onOpen}>
                Open MEMORY.md
              </button>
              <button type="button" disabled={busy} onClick={onExport}>
                Export memory
              </button>
            </div>
            <details
              className="memory-center-danger"
              open={dangerOpen}
              onToggle={(event) => setDangerOpen(event.currentTarget.open)}
            >
              <summary>Delete workspace memory</summary>
              <p>
                This deletes legacy and Memory v2 data for{" "}
                {workspaceName || "this workspace"}. This action cannot be
                undone.
              </p>
              <label>
                Type the workspace name to confirm
                <input
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  aria-label="Workspace name confirmation"
                />
              </label>
              <button
                type="button"
                className="memory-center-delete"
                disabled={
                  busy || !workspaceName || confirmName !== workspaceName
                }
                onClick={() => {
                  onClear();
                  setV2Page(null);
                  setLegacyPage(null);
                  setTaskPage(null);
                  setVisibleMemories(INITIAL_VISIBLE);
                  setConfirmName("");
                }}
              >
                Delete this workspace's memory
              </button>
            </details>
          </details>
        )}
      </section>
    </div>
  );
}
