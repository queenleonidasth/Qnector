import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  MemoryActiveState,
  MemoryCategory,
  MemoryFact,
  MemoryTask,
  MemoryTaskStatus,
  MemoryV2Event,
  MemoryV2LiveEvent,
  MemoryV2Snapshot,
} from "@qnector/shared";
import { configDirectory } from "./config.js";
import { sanitizeText, sanitizeValue } from "./secret-sanitizer.js";
import { localSemanticSimilarity } from "./semantic-search.js";

const DEFAULT_EVENT_LIMIT = 40;
const DEFAULT_TASK_LIMIT = 24;
const AUTO_CHECKPOINT_EVENT_COUNT = 4;
const AUTO_CHECKPOINT_MAX_AGE_MS = 10 * 60 * 1_000;

export interface MemoryV2StoreOptions {
  file?: string;
}

export interface MemoryV2RecordInput {
  taskId?: string;
  source: string;
  action: string;
  status: "success" | "error";
  summary: string;
  paths?: string[];
  metadata?: Record<string, unknown>;
  workspaceEvidence?: string[];
}

export interface MemoryTaskStartInput {
  title: string;
  currentTask?: string;
  criticalContext?: string;
  taskId?: string;
}

export interface MemoryTaskUpdateInput {
  taskId: string;
  title?: string;
  status?: MemoryTaskStatus;
  currentTask?: string;
  completedSteps?: string[];
  pendingSteps?: string[];
  criticalContext?: string;
}

export interface MemoryTaskResumeResult {
  task: MemoryTask | null;
  taskId: string | null;
  score: number;
}

export class MemoryV2Store {
  private readonly db: DatabaseSync;
  private workspacePath: string;
  private workspaceId = "";
  private revision = 0;
  private readonly listeners = new Set<(event: MemoryV2LiveEvent) => void>();

  public constructor(
    workspacePath: string,
    options: MemoryV2StoreOptions = {},
  ) {
    const file = path.resolve(
      options.file ?? path.join(configDirectory(), "memory-v2.sqlite"),
    );
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.initializeSchema();
    this.workspacePath = path.resolve(workspacePath);
    this.setWorkspace(this.workspacePath);
  }

  public get currentWorkspace(): string {
    return this.workspacePath;
  }

  public get currentWorkspaceId(): string {
    return this.workspaceId;
  }

  public get defaultTaskId(): string {
    return `task_default:${this.workspaceId}`;
  }

  public setWorkspace(workspacePath: string): void {
    this.workspacePath = path.resolve(workspacePath);
    const normalized = normalizeWorkspacePath(this.workspacePath);
    const existing = this.db
      .prepare("SELECT id FROM workspaces WHERE normalized_path = ?")
      .get(normalized) as { id?: string } | undefined;
    const now = new Date().toISOString();
    this.workspaceId = existing?.id ?? `workspace_${randomUUID()}`;
    if (existing?.id) {
      this.db
        .prepare("UPDATE workspaces SET path = ?, updated_at = ? WHERE id = ?")
        .run(this.workspacePath, now, this.workspaceId);
    } else {
      this.db
        .prepare(
          "INSERT INTO workspaces (id, path, normalized_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(this.workspaceId, this.workspacePath, normalized, now, now);
    }
    this.ensureDefaultTask();
  }

  public subscribe(listener: (event: MemoryV2LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public createTask(input: MemoryTaskStartInput): MemoryTask {
    const title = sanitizeText(input.title).value.trim();
    if (!title) throw new Error("INVALID_INPUT: task title is required");
    const taskId = sanitizeTaskId(input.taskId) ?? `task_${randomUUID()}`;
    const now = new Date().toISOString();
    const active: MemoryActiveState = sanitizeActive({
      currentTask: input.currentTask?.trim() || title,
      completedSteps: [],
      pendingSteps: [],
      criticalContext: input.criticalContext?.trim() || "",
    });
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, workspace_id, title, status, current_task, completed_json, pending_json, critical_context, created_at, updated_at, last_event_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title,
           status='active',
           current_task=excluded.current_task,
           critical_context=excluded.critical_context,
           updated_at=excluded.updated_at`,
      )
      .run(
        taskId,
        this.workspaceId,
        title,
        active.currentTask,
        JSON.stringify(active.completedSteps),
        JSON.stringify(active.pendingSteps),
        active.criticalContext,
        now,
        now,
        now,
      );
    const task = this.getTask(taskId);
    if (!task)
      throw new Error("MEMORY_TASK_CREATE_FAILED: task row was not created");
    this.emit("task.created", taskId, title);
    return task;
  }

  public updateTask(input: MemoryTaskUpdateInput): MemoryTask {
    const current = this.requireTask(input.taskId);
    const now = new Date().toISOString();
    const nextActive = sanitizeActive({
      currentTask: input.currentTask ?? current.currentTask,
      completedSteps: input.completedSteps ?? current.completedSteps,
      pendingSteps: input.pendingSteps ?? current.pendingSteps,
      criticalContext: input.criticalContext ?? current.criticalContext,
    });
    const title =
      sanitizeText(input.title ?? current.title).value.trim() || current.title;
    const status = input.status ?? current.status;
    this.db
      .prepare(
        `UPDATE tasks SET title=?, status=?, current_task=?, completed_json=?, pending_json=?, critical_context=?, updated_at=?
         WHERE id=? AND workspace_id=?`,
      )
      .run(
        title,
        status,
        nextActive.currentTask,
        JSON.stringify(nextActive.completedSteps),
        JSON.stringify(nextActive.pendingSteps),
        nextActive.criticalContext,
        now,
        current.id,
        this.workspaceId,
      );
    const task = this.requireTask(current.id);
    this.emit("task.updated", task.id, task.currentTask);
    return task;
  }

  public completeTask(taskId: string): MemoryTask {
    return this.updateTask({ taskId, status: "completed" });
  }

  public getTask(taskId: string): MemoryTask | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ?")
      .get(taskId, this.workspaceId) as TaskRow | undefined;
    return row
      ? taskFromRow(row, this.sessionCount(row.id), this.touchedPaths(row.id))
      : null;
  }

  public listTasks(limit = DEFAULT_TASK_LIMIT): MemoryTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE workspace_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 WHEN 'idle' THEN 2 ELSE 3 END,
                  COALESCE(last_event_at, updated_at) DESC
         LIMIT ?`,
      )
      .all(this.workspaceId, clamp(limit, 1, 100)) as unknown as TaskRow[];
    return rows.map((row) =>
      taskFromRow(row, this.sessionCount(row.id), this.touchedPaths(row.id)),
    );
  }

  public resumeTask(query?: string): MemoryTaskResumeResult {
    const tasks = this.listTasks(100).filter(
      (task) => task.status !== "completed",
    );
    if (tasks.length === 0) return { task: null, taskId: null, score: 0 };
    const normalizedQuery = normalizeSearch(query ?? "");
    if (!normalizedQuery) {
      const task = tasks[0]!;
      return { task, taskId: task.id, score: 1 };
    }
    const ranked = tasks
      .map((task) => ({ task, score: taskScore(task, normalizedQuery) }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          Date.parse(right.task.updatedAt) - Date.parse(left.task.updatedAt),
      );
    const best = ranked[0]!;
    return { task: best.task, taskId: best.task.id, score: best.score };
  }

  public bindSession(sessionId: string, taskId: string): void {
    const cleanSessionId = sanitizeText(sessionId).value.trim().slice(0, 240);
    if (!cleanSessionId)
      throw new Error("INVALID_INPUT: sessionId is required");
    this.requireTask(taskId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO task_sessions (session_id, workspace_id, task_id, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET workspace_id=excluded.workspace_id, task_id=excluded.task_id, last_seen_at=excluded.last_seen_at`,
      )
      .run(cleanSessionId, this.workspaceId, taskId, now, now);
    this.emit("session.bound", taskId, `Session bound to ${taskId}`);
  }

  public taskForSession(sessionId: string): string | null {
    const cleanSessionId = sanitizeText(sessionId).value.trim().slice(0, 240);
    if (!cleanSessionId) return null;
    const row = this.db
      .prepare(
        "SELECT task_id FROM task_sessions WHERE session_id=? AND workspace_id=?",
      )
      .get(cleanSessionId, this.workspaceId) as
      { task_id?: string } | undefined;
    return row?.task_id ?? null;
  }

  public recordToolEvent(input: MemoryV2RecordInput): MemoryV2Event | null {
    if (!this.belongsToWorkspace(input.workspaceEvidence ?? input.paths ?? []))
      return null;
    const taskId = this.resolveTaskId(input.taskId);
    const now = new Date().toISOString();
    const event: MemoryV2Event = {
      id: `event_${randomUUID()}`,
      workspaceId: this.workspaceId,
      taskId,
      timestamp: now,
      source: sanitizeText(input.source).value.slice(0, 80),
      action: sanitizeText(input.action).value.slice(0, 120),
      status: input.status,
      summary: sanitizeText(input.summary).value.slice(0, 2_000),
      paths: sanitizePaths(input.paths ?? [], this.workspacePath),
    };
    const metadata = sanitizeValue(input.metadata ?? {}).value;
    let automaticCheckpointId: string | undefined;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO events (id, workspace_id, task_id, timestamp, source, action, status, summary, paths_json, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.workspaceId,
          event.taskId,
          event.timestamp,
          event.source,
          event.action,
          event.status,
          event.summary,
          JSON.stringify(event.paths),
          JSON.stringify(metadata),
        );
      const taskRow = this.db
        .prepare(
          `SELECT current_task, completed_json, pending_json, critical_context
           FROM tasks WHERE id=? AND workspace_id=?`,
        )
        .get(taskId, this.workspaceId) as
        | {
            current_task: string;
            completed_json: string;
            pending_json: string;
            critical_context: string;
          }
        | undefined;
      if (!taskRow)
        throw new Error(`MEMORY_TASK_NOT_FOUND: task '${taskId}' disappeared`);
      const completed =
        event.status === "success"
          ? dedupe([
              ...parseStringArray(taskRow.completed_json),
              eventStep(event),
            ]).slice(-40)
          : parseStringArray(taskRow.completed_json);
      this.db
        .prepare(
          "UPDATE tasks SET completed_json=?, last_event_at=?, updated_at=? WHERE id=? AND workspace_id=?",
        )
        .run(JSON.stringify(completed), now, now, taskId, this.workspaceId);
      const touch = this.db.prepare(
        `INSERT INTO task_files (workspace_id, task_id, path, last_touched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, task_id, path) DO UPDATE SET last_touched_at=excluded.last_touched_at`,
      );
      for (const file of event.paths)
        touch.run(this.workspaceId, taskId, file, now);

      const lastCheckpoint = this.db
        .prepare(
          `SELECT created_at FROM task_checkpoints
           WHERE workspace_id=? AND task_id=? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(this.workspaceId, taskId) as { created_at?: string } | undefined;
      const after = lastCheckpoint?.created_at ?? "";
      const countRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM events
           WHERE workspace_id=? AND task_id=? AND timestamp>?`,
        )
        .get(this.workspaceId, taskId, after) as { count: number };
      const age = lastCheckpoint?.created_at
        ? Math.max(0, Date.parse(now) - Date.parse(lastCheckpoint.created_at))
        : Number.POSITIVE_INFINITY;
      const milestone = isCheckpointMilestone(event);
      if (
        Number(countRow.count ?? 0) >= AUTO_CHECKPOINT_EVENT_COUNT ||
        age >= AUTO_CHECKPOINT_MAX_AGE_MS ||
        milestone
      ) {
        automaticCheckpointId = `checkpoint_${randomUUID()}`;
        const active: MemoryActiveState = {
          currentTask: taskRow.current_task,
          completedSteps: completed,
          pendingSteps: parseStringArray(taskRow.pending_json),
          criticalContext: taskRow.critical_context,
        };
        this.db
          .prepare(
            `INSERT INTO task_checkpoints (id, workspace_id, task_id, created_at, label, active_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            automaticCheckpointId,
            this.workspaceId,
            taskId,
            now,
            "Auto checkpoint - Memory v2 progress",
            JSON.stringify(active),
          );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.emit("event.recorded", taskId, event.summary, event.id);
    if (automaticCheckpointId)
      this.emit(
        "checkpoint.created",
        taskId,
        "Auto checkpoint - Memory v2 progress",
        automaticCheckpointId,
      );
    return event;
  }

  public saveTaskCheckpoint(
    taskId: string,
    active: MemoryActiveState,
    label?: string,
  ): string {
    const task = this.requireTask(taskId);
    const safe = sanitizeActive(active);
    const now = new Date().toISOString();
    const id = `checkpoint_${randomUUID()}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO task_checkpoints (id, workspace_id, task_id, created_at, label, active_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.workspaceId,
          task.id,
          now,
          label ? sanitizeText(label).value : null,
          JSON.stringify(safe),
        );
      this.db
        .prepare(
          `UPDATE tasks SET current_task=?, completed_json=?, pending_json=?, critical_context=?, updated_at=?
           WHERE id=? AND workspace_id=?`,
        )
        .run(
          safe.currentTask,
          JSON.stringify(safe.completedSteps),
          JSON.stringify(safe.pendingSteps),
          safe.criticalContext,
          now,
          task.id,
          this.workspaceId,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.emit("checkpoint.created", task.id, label ?? safe.currentTask, id);
    return id;
  }

  public upsertMemory(input: {
    taskId?: string;
    scope?: "workspace" | "task";
    category: MemoryCategory;
    key: string;
    value: string;
    tags?: string[];
    importance?: number;
  }): MemoryFact {
    const scope = input.scope ?? (input.taskId ? "task" : "workspace");
    const taskId = scope === "task" ? this.resolveTaskId(input.taskId) : null;
    const key = sanitizeText(input.key).value.trim();
    if (!key) throw new Error("INVALID_INPUT: memory key is required");
    const value = sanitizeText(input.value).value;
    const tags = dedupe(
      (input.tags ?? []).map((tag) => sanitizeText(tag).value),
    ).slice(0, 32);
    const normalizedKey = normalizeSearch(key);
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        `SELECT id, created_at FROM memories
         WHERE workspace_id=? AND COALESCE(task_id, '')=COALESCE(?, '') AND normalized_key=?`,
      )
      .get(this.workspaceId, taskId, normalizedKey) as
      { id?: string; created_at?: string } | undefined;
    const id = existing?.id ?? `memory_${randomUUID()}`;
    const createdAt = existing?.created_at ?? now;
    this.db
      .prepare(
        `INSERT INTO memories
          (id, workspace_id, task_id, category, key, normalized_key, value, tags_json, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET category=excluded.category, key=excluded.key, normalized_key=excluded.normalized_key,
           value=excluded.value, tags_json=excluded.tags_json, importance=excluded.importance, updated_at=excluded.updated_at`,
      )
      .run(
        id,
        this.workspaceId,
        taskId,
        input.category,
        key,
        normalizedKey,
        value,
        JSON.stringify(tags),
        clamp(input.importance ?? 50, 0, 100),
        createdAt,
        now,
      );
    this.emit("memory.updated", taskId ?? undefined, key, id);
    return {
      id,
      key,
      category: input.category,
      value,
      tags,
      createdAt,
      updatedAt: now,
    };
  }

  public snapshot(
    options: { eventLimit?: number; taskLimit?: number; taskId?: string } = {},
  ): MemoryV2Snapshot {
    const tasks = this.listTasks(options.taskLimit ?? DEFAULT_TASK_LIMIT);
    const taskId =
      options.taskId && this.getTask(options.taskId)
        ? options.taskId
        : undefined;
    const eventRows = taskId
      ? (this.db
          .prepare(
            `SELECT * FROM events WHERE workspace_id=? AND task_id=? ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(
            this.workspaceId,
            taskId,
            clamp(options.eventLimit ?? DEFAULT_EVENT_LIMIT, 1, 200),
          ) as unknown as EventRow[])
      : (this.db
          .prepare(
            `SELECT * FROM events WHERE workspace_id=? ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(
            this.workspaceId,
            clamp(options.eventLimit ?? DEFAULT_EVENT_LIMIT, 1, 200),
          ) as unknown as EventRow[]);
    const events = eventRows.map(eventFromRow);
    const memories = this.listMemories(taskId, 100);
    const conflicts = detectConflicts(tasks);
    const updatedAt =
      [
        ...tasks.map((task) => task.updatedAt),
        ...events.map((event) => event.timestamp),
        ...memories.map((memory) => memory.updatedAt),
      ]
        .sort()
        .at(-1) ?? new Date().toISOString();
    return {
      version: 2,
      workspaceId: this.workspaceId,
      workspacePath: this.workspacePath,
      updatedAt,
      revision: this.revision,
      tasks,
      events,
      memories,
      conflicts,
      counts: {
        tasks: tasks.length,
        activeTasks: tasks.filter(
          (task) => task.status === "active" || task.status === "blocked",
        ).length,
        events: this.count("events"),
        memories: this.count("memories"),
        conflicts: conflicts.length,
      },
    };
  }

  public migrateLegacy(input: {
    active: MemoryActiveState | null;
    facts: MemoryFact[];
    recentChanges: Array<{
      timestamp: string;
      source: string;
      summary: string;
      paths: string[];
    }>;
  }): void {
    const marker = this.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get(`legacy_migrated:${this.workspaceId}`) as
      { value?: string } | undefined;
    if (marker?.value === "1") return;
    const defaultTask = this.ensureDefaultTask();
    if (input.active) {
      this.updateTask({
        taskId: defaultTask.id,
        currentTask: input.active.currentTask,
        completedSteps: input.active.completedSteps,
        pendingSteps: input.active.pendingSteps,
        criticalContext: input.active.criticalContext,
      });
    }
    for (const fact of input.facts) {
      this.upsertMemory({
        scope: "workspace",
        category: fact.category,
        key: fact.key,
        value: fact.value,
        tags: fact.tags,
      });
    }
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events (id, workspace_id, task_id, timestamp, source, action, status, summary, paths_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'legacy.change', 'success', ?, ?, '{}')`,
    );
    for (const change of [...input.recentChanges].reverse().slice(-100)) {
      const paths = sanitizePaths(change.paths, this.workspacePath);
      if (change.paths.length > 0 && paths.length === 0) continue;
      insert.run(
        `legacy_${randomUUID()}`,
        this.workspaceId,
        defaultTask.id,
        change.timestamp,
        change.source,
        sanitizeText(change.summary).value,
        JSON.stringify(paths),
      );
    }
    this.db
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, '1')")
      .run(`legacy_migrated:${this.workspaceId}`);
    this.emit(
      "migration.completed",
      defaultTask.id,
      "Legacy memory migrated into Memory v2",
    );
  }

  public clearWorkspace(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [
        "task_sessions",
        "task_files",
        "task_checkpoints",
        "events",
        "memories",
        "tasks",
      ]) {
        this.db
          .prepare(`DELETE FROM ${table} WHERE workspace_id=?`)
          .run(this.workspaceId);
      }
      this.db
        .prepare("DELETE FROM metadata WHERE key=?")
        .run(`legacy_migrated:${this.workspaceId}`);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const task = this.ensureDefaultTask();
    this.emit("workspace.cleared", task.id, "Cleared Memory v2 workspace data");
  }

  public close(): void {
    this.db.close();
    this.listeners.clear();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        normalized_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        current_task TEXT NOT NULL,
        completed_json TEXT NOT NULL,
        pending_json TEXT NOT NULL,
        critical_context TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_event_at TEXT,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace_updated ON tasks(workspace_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS task_sessions (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_task ON task_sessions(workspace_id, task_id);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        paths_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_events_workspace_time ON events(workspace_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_task_time ON events(workspace_id, task_id, timestamp DESC);
      CREATE TABLE IF NOT EXISTS task_checkpoints (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        label TEXT,
        active_json TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task_time ON task_checkpoints(workspace_id, task_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        value TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 50,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_scope_key ON memories(workspace_id, COALESCE(task_id, ''), normalized_key);
      CREATE INDEX IF NOT EXISTS idx_memory_updated ON memories(workspace_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS task_files (
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        path TEXT NOT NULL,
        last_touched_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, task_id, path),
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_task_files_path ON task_files(workspace_id, path, last_touched_at DESC);
    `);
  }

  private ensureDefaultTask(): MemoryTask {
    const taskId = this.defaultTaskId;
    const existing = this.getTask(taskId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO tasks
          (id, workspace_id, title, status, current_task, completed_json, pending_json, critical_context, created_at, updated_at, last_event_at)
         VALUES (?, ?, 'General workspace activity', 'idle', 'General workspace activity', '[]', '[]', '', ?, ?, ?)`,
      )
      .run(taskId, this.workspaceId, now, now, now);
    return this.requireTask(taskId);
  }

  private resolveTaskId(taskId?: string): string {
    const clean = sanitizeTaskId(taskId);
    if (clean) {
      const task = this.getTask(clean);
      if (!task)
        throw new Error(
          `MEMORY_TASK_NOT_FOUND: task '${clean}' does not belong to the active workspace`,
        );
      return clean;
    }
    return this.ensureDefaultTask().id;
  }

  private requireTask(taskId: string): MemoryTask {
    const task = this.getTask(taskId);
    if (!task)
      throw new Error(
        `MEMORY_TASK_NOT_FOUND: task '${taskId}' does not belong to the active workspace`,
      );
    return task;
  }

  private belongsToWorkspace(evidence: string[]): boolean {
    const clean = evidence.map((entry) => entry.trim()).filter(Boolean);
    if (clean.length === 0) return true;
    return clean.some((entry) => isWithinWorkspace(entry, this.workspacePath));
  }

  private listMemories(taskId?: string, limit = 100): MemoryFact[] {
    const rows = taskId
      ? (this.db
          .prepare(
            `SELECT * FROM memories WHERE workspace_id=? AND (task_id IS NULL OR task_id=?)
             ORDER BY importance DESC, updated_at DESC LIMIT ?`,
          )
          .all(
            this.workspaceId,
            taskId,
            clamp(limit, 1, 500),
          ) as unknown as MemoryRow[])
      : (this.db
          .prepare(
            `SELECT * FROM memories WHERE workspace_id=? AND task_id IS NULL
             ORDER BY importance DESC, updated_at DESC LIMIT ?`,
          )
          .all(
            this.workspaceId,
            clamp(limit, 1, 500),
          ) as unknown as MemoryRow[]);
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      category: row.category as MemoryCategory,
      value: row.value,
      tags: parseStringArray(row.tags_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private touchedPaths(taskId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT path FROM task_files WHERE workspace_id=? AND task_id=? ORDER BY last_touched_at DESC LIMIT 24`,
      )
      .all(this.workspaceId, taskId) as unknown as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  private sessionCount(taskId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM task_sessions WHERE workspace_id=? AND task_id=?",
      )
      .get(this.workspaceId, taskId) as { count: number };
    return Number(row.count ?? 0);
  }

  private count(table: "events" | "memories"): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id=?`)
      .get(this.workspaceId) as { count: number };
    return Number(row.count ?? 0);
  }

  private emit(
    type: MemoryV2LiveEvent["type"],
    taskId?: string,
    summary?: string,
    entityId?: string,
  ): void {
    this.revision += 1;
    const event: MemoryV2LiveEvent = {
      type,
      workspaceId: this.workspaceId,
      workspacePath: this.workspacePath,
      timestamp: new Date().toISOString(),
      revision: this.revision,
      ...(taskId ? { taskId } : {}),
      ...(summary
        ? { summary: sanitizeText(summary).value.slice(0, 1_000) }
        : {}),
      ...(entityId ? { entityId } : {}),
    };
    for (const listener of this.listeners) listener(event);
  }
}

interface TaskRow {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  current_task: string;
  completed_json: string;
  pending_json: string;
  critical_context: string;
  created_at: string;
  updated_at: string;
  last_event_at: string | null;
}

interface EventRow {
  id: string;
  workspace_id: string;
  task_id: string;
  timestamp: string;
  source: string;
  action: string;
  status: string;
  summary: string;
  paths_json: string;
}

interface MemoryRow {
  id: string;
  category: string;
  key: string;
  value: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

function taskFromRow(
  row: TaskRow,
  sessionCount: number,
  touchedPaths: string[],
): MemoryTask {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: normalizeTaskStatus(row.status),
    currentTask: row.current_task,
    completedSteps: parseStringArray(row.completed_json),
    pendingSteps: parseStringArray(row.pending_json),
    criticalContext: row.critical_context,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventAt: row.last_event_at ?? undefined,
    sessionCount,
    touchedPaths,
  };
}

function eventFromRow(row: EventRow): MemoryV2Event {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    timestamp: row.timestamp,
    source: row.source,
    action: row.action,
    status: row.status === "error" ? "error" : "success",
    summary: row.summary,
    paths: parseStringArray(row.paths_json),
  };
}

function detectConflicts(tasks: MemoryTask[]): MemoryV2Snapshot["conflicts"] {
  const owners = new Map<string, MemoryTask[]>();
  for (const task of tasks) {
    if (task.status === "completed") continue;
    for (const file of task.touchedPaths) {
      const normalized = normalizeWorkspacePath(file);
      const list = owners.get(normalized) ?? [];
      list.push(task);
      owners.set(normalized, list);
    }
  }
  const conflicts: MemoryV2Snapshot["conflicts"] = [];
  for (const [file, ownersForFile] of owners) {
    if (ownersForFile.length < 2) continue;
    for (let left = 0; left < ownersForFile.length - 1; left += 1) {
      for (let right = left + 1; right < ownersForFile.length; right += 1) {
        const a = ownersForFile[left]!;
        const b = ownersForFile[right]!;
        conflicts.push({
          id: `conflict:${a.id}:${b.id}:${file}`,
          path: file,
          taskIds: [a.id, b.id],
          taskTitles: [a.title, b.title],
          severity: "warning",
        });
      }
    }
  }
  return conflicts.slice(0, 50);
}

function taskScore(task: MemoryTask, query: string): number {
  const semanticText = [
    task.title,
    task.currentTask,
    task.criticalContext,
    ...task.pendingSteps,
    ...task.completedSteps,
    ...task.touchedPaths,
  ].join(" ");
  let score = localSemanticSimilarity(query, semanticText) * 24;
  const haystacks = [
    [task.title, 8],
    [task.currentTask, 6],
    [task.criticalContext, 3],
    [task.pendingSteps.join(" "), 4],
    [task.completedSteps.join(" "), 2],
    [task.touchedPaths.join(" "), 3],
  ] as const;
  const tokens = query
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length >= 2);
  for (const [text, weight] of haystacks) {
    const normalized = normalizeSearch(text);
    if (normalized.includes(query)) score += weight * 3;
    for (const token of tokens) if (normalized.includes(token)) score += weight;
  }
  if (task.status === "active") score += 3;
  if (task.status === "blocked") score += 1;
  return score;
}

function eventStep(event: MemoryV2Event): string {
  return `${event.source}.${event.action}: ${event.summary}`.slice(0, 1_000);
}

function isCheckpointMilestone(event: MemoryV2Event): boolean {
  if (event.status !== "success") return false;
  if (event.source === "git")
    return ["commit", "push", "pull", "merge", "rebase", "checkout"].includes(
      event.action,
    );
  return false;
}

function sanitizeTaskId(input?: string): string | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  if (!/^task_[A-Za-z0-9._:-]{1,180}$/.test(value))
    throw new Error(
      "INVALID_INPUT: taskId must start with 'task_' and contain only letters, digits, dot, underscore, colon or hyphen",
    );
  return value;
}

function sanitizeActive(input: MemoryActiveState): MemoryActiveState {
  const safe = sanitizeValue(input).value as MemoryActiveState;
  return {
    currentTask: safe.currentTask.trim().slice(0, 4_000),
    completedSteps: dedupe(
      safe.completedSteps.map((entry) => entry.trim()).filter(Boolean),
    ).slice(-100),
    pendingSteps: dedupe(
      safe.pendingSteps.map((entry) => entry.trim()).filter(Boolean),
    ).slice(0, 100),
    criticalContext: safe.criticalContext.trim().slice(0, 12_000),
  };
}

function sanitizePaths(paths: string[], workspacePath: string): string[] {
  return dedupe(
    paths
      .map((entry) => sanitizeText(entry).value.trim())
      .filter(Boolean)
      .filter((entry) => isWithinWorkspace(entry, workspacePath))
      .map((entry) => path.resolve(workspacePath, entry)),
  ).slice(0, 50);
}

function isWithinWorkspace(candidate: string, workspacePath: string): boolean {
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspacePath, candidate);
  const workspace = normalizeWorkspacePath(workspacePath);
  const normalized = normalizeWorkspacePath(resolved);
  return (
    normalized === workspace || normalized.startsWith(`${workspace}${path.sep}`)
  );
}

function normalizeWorkspacePath(input: string): string {
  const normalized = path.normalize(path.resolve(input));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeSearch(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseStringArray(input: string): string[] {
  try {
    const parsed = JSON.parse(input) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeTaskStatus(input: string): MemoryTaskStatus {
  return input === "active" ||
    input === "idle" ||
    input === "completed" ||
    input === "blocked"
    ? input
    : "idle";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}
