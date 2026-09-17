import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CompletionManifest } from "./output-spool.js";

/** P1 execution journal. This store is not a scheduler or a replacement for Memory v2. */
export type ExecutionState =
  | "queued" | "starting" | "running" | "succeeded" | "failed"
  | "canceling" | "canceled" | "interrupted";
export type OutputState = "streaming" | "complete" | "partial" | "failed";
export type VerificationState = "not_requested" | "pending" | "passed" | "failed";

export interface AcceptTaskInput {
  owner: string;
  workspace: string;
  operation: string;
  idempotencyKey: string;
  inputDigest: string;
  /** Caller MUST remove secrets. Snapshot is persisted as plain JSON for future dispatch. */
  definitionSnapshot: unknown;
}

export interface ExecutionTask {
  taskId: string;
  owner: string;
  workspace: string;
  operation: string;
  inputDigest: string;
  definitionSnapshot: unknown;
  state: ExecutionState;
  outputState: OutputState;
  verificationState: VerificationState;
  outcome: "known" | "unknown";
  attemptId: string | null;
  createdAt: string;
  updatedAt: string;
  resultManifest: string | null;
  reason: string | null;
}

export interface DispatchAttempt {
  taskId: string;
  attemptId: string;
  token: string;
  generation: number;
}

export interface ExecutionEvent {
  sequence: number;
  taskId: string;
  attemptId: string | null;
  name: string;
  detail: string | null;
  createdAt: string;
}

interface TaskRow {
  task_id: string; owner: string; workspace: string; operation: string;
  input_digest: string; definition_json: string; state: ExecutionState;
  output_state: OutputState; verification_state: VerificationState;
  outcome: "known" | "unknown"; attempt_id: string | null;
  created_at: string; updated_at: string; result_manifest: string | null;
  reason: string | null;
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`INVALID_INPUT: ${field} is required`);
  return value;
}

function asTask(row: TaskRow): ExecutionTask {
  return {
    taskId: row.task_id, owner: row.owner, workspace: row.workspace,
    operation: row.operation, inputDigest: row.input_digest,
    definitionSnapshot: JSON.parse(row.definition_json) as unknown,
    state: row.state, outputState: row.output_state,
    verificationState: row.verification_state, outcome: row.outcome,
    attemptId: row.attempt_id, createdAt: row.created_at,
    updatedAt: row.updated_at, resultManifest: row.result_manifest,
    reason: row.reason,
  };
}

/** A single-writer owner is required at daemon level; SQLite also arbitrates atomic submissions. */
export class ExecutionStore {
  private readonly db: DatabaseSync;

  public constructor(file: string) {
    const resolved = path.resolve(file);
    mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    // FULL is intentional: accepted means committed, not merely cached in the WAL.
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY, owner TEXT NOT NULL, workspace TEXT NOT NULL,
        operation TEXT NOT NULL, input_digest TEXT NOT NULL,
        definition_json TEXT NOT NULL, state TEXT NOT NULL,
        output_state TEXT NOT NULL, verification_state TEXT NOT NULL,
        outcome TEXT NOT NULL, attempt_id TEXT,
        result_manifest TEXT, reason TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        scope_hash TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE,
        input_digest TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      );
      CREATE TABLE IF NOT EXISTS attempts (
        attempt_id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL,
        state TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id),
        UNIQUE (task_id, generation)
      );
      CREATE TABLE IF NOT EXISTS dispatch_intents (
        task_id TEXT PRIMARY KEY, state TEXT NOT NULL,
        attempt_id TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL, attempt_id TEXT, name TEXT NOT NULL,
        detail TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace_state ON tasks(workspace, state, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_task_sequence ON events(task_id, sequence);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);
    const version = this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version: number};
    if (version.version !== 1) {
      this.db.close();
      throw new Error(`EXECUTION_SCHEMA_UNSUPPORTED: expected 1, found ${version.version}`);
    }
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private event(taskId: string, attemptId: string | null, name: string, detail: string | null = null): void {
    this.db.prepare("INSERT INTO events(task_id,attempt_id,name,detail,created_at) VALUES (?,?,?,?,?)")
      .run(taskId, attemptId, name, detail, new Date().toISOString());
  }

  /** Commit task, accepted event, deduplication key and dispatch intent atomically. */
  public accept(input: AcceptTaskInput): { task: ExecutionTask; reused: boolean } {
    const owner = required(input.owner, "owner");
    const workspace = path.resolve(required(input.workspace, "workspace"));
    const operation = required(input.operation, "operation");
    const key = required(input.idempotencyKey, "idempotencyKey");
    const digest = required(input.inputDigest, "inputDigest");
    const definition = JSON.stringify(input.definitionSnapshot);
    if (definition === undefined) throw new Error("INVALID_INPUT: definitionSnapshot must be JSON serializable");
    const scope = createHash("sha256").update(JSON.stringify([owner, process.platform === "win32" ? workspace.toLowerCase() : workspace, operation, key])).digest("hex");
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT k.task_id,k.input_digest,t.definition_json FROM idempotency_keys k JOIN tasks t ON t.task_id=k.task_id WHERE k.scope_hash=?")
        .get(scope) as {task_id: string; input_digest: string; definition_json: string} | undefined;
      if (existing) {
        if (existing.input_digest !== digest || existing.definition_json !== definition)
          throw new Error("IDEMPOTENCY_CONFLICT: same key with different input digest");
        const task = this.get(existing.task_id);
        if (!task) throw new Error("EXECUTION_CORRUPTION: idempotency key references missing task");
        return {task, reused: true};
      }
      const taskId = `task_${randomUUID()}`;
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO tasks
        (task_id,owner,workspace,operation,input_digest,definition_json,state,output_state,
         verification_state,outcome,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'queued','streaming','not_requested','known',?,?)`)
        .run(taskId,owner,workspace,operation,digest,definition,now,now);
      this.db.prepare("INSERT INTO idempotency_keys(scope_hash,task_id,input_digest) VALUES (?,?,?)")
        .run(scope,taskId,digest);
      this.db.prepare("INSERT INTO dispatch_intents(task_id,state,created_at) VALUES (?,'pending',?)")
        .run(taskId,now);
      this.event(taskId,null,"accepted");
      const task = this.get(taskId);
      if (!task) throw new Error("EXECUTION_CORRUPTION: committed task missing");
      return {task,reused:false};
    });
  }

  public get(taskId: string): ExecutionTask | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as TaskRow | undefined;
    return row ? asTask(row) : null;
  }

  public list(workspace: string, limit = 100): ExecutionTask[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE workspace=? ORDER BY created_at DESC LIMIT ?")
      .all(path.resolve(workspace), Math.max(1,Math.min(limit,200))) as unknown as TaskRow[]).map(asTask);
  }

  public pending(): string[] {
    return (this.db.prepare("SELECT d.task_id FROM dispatch_intents d JOIN tasks t ON t.task_id=d.task_id WHERE d.state='pending' AND t.state='queued' ORDER BY d.created_at")
      .all() as {task_id:string}[]).map(row => row.task_id);
  }

  /** Recovery reads the existing attempt; it never creates a new dispatch. */
  public activeAttempts(): DispatchAttempt[] {
    return (this.db.prepare(`SELECT a.task_id,a.attempt_id,a.token,a.generation
      FROM attempts a JOIN tasks t ON t.attempt_id=a.attempt_id AND t.task_id=a.task_id
      WHERE t.state IN ('starting','running','canceling') ORDER BY t.created_at`)
      .all() as {task_id:string;attempt_id:string;token:string;generation:number}[])
      .map(row => ({taskId:row.task_id,attemptId:row.attempt_id,token:row.token,generation:row.generation}));
  }
  /** CAS claim. A crash after this step is unknown until a worker handshake/reconciliation. */
  public claim(taskId: string): DispatchAttempt | null {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const updated = this.db.prepare("UPDATE tasks SET state='starting',updated_at=? WHERE task_id=? AND state='queued'")
        .run(now,taskId);
      if (updated.changes !== 1) return null;
      const attemptId = `attempt_${randomUUID()}`;
      const token = randomUUID();
      const generation = (this.db.prepare("SELECT COALESCE(MAX(generation),0)+1 AS generation FROM attempts WHERE task_id=?")
        .get(taskId) as {generation:number}).generation;
      this.db.prepare("INSERT INTO attempts(attempt_id,task_id,token,generation,state) VALUES (?,?,?,?,'starting')")
        .run(attemptId,taskId,token,generation);
      this.db.prepare("UPDATE dispatch_intents SET state='claimed',attempt_id=? WHERE task_id=? AND state='pending'")
        .run(attemptId,taskId);
      this.db.prepare("UPDATE tasks SET attempt_id=? WHERE task_id=?").run(attemptId,taskId);
      this.event(taskId,attemptId,"claimed");
      return {taskId,attemptId,token,generation};
    });
  }

  private verify(attempt: DispatchAttempt): boolean {
    const row = this.db.prepare("SELECT task_id,token,generation FROM attempts WHERE attempt_id=?")
      .get(attempt.attemptId) as {task_id:string;token:string;generation:number} | undefined;
    return row?.task_id === attempt.taskId && row.token === attempt.token && row.generation === attempt.generation;
  }

  /** Call only from the authenticated worker handshake, before any external command. */
  public markStarted(attempt: DispatchAttempt): boolean {
    return this.transaction(() => {
      if (!this.verify(attempt)) return false;
      const now = new Date().toISOString();
      const updated = this.db.prepare("UPDATE tasks SET state='running',updated_at=? WHERE task_id=? AND attempt_id=? AND state='starting'")
        .run(now,attempt.taskId,attempt.attemptId);
      if (updated.changes !== 1) return false;
      this.db.prepare("UPDATE attempts SET state='running',started_at=? WHERE attempt_id=?")
        .run(now,attempt.attemptId);
      this.event(attempt.taskId,attempt.attemptId,"started");
      return true;
    });
  }

  /** Complete only after stdout/stderr EOF and completion manifest are durable. */
  public finish(attempt: DispatchAttempt, result: {
    state: "succeeded" | "failed";
    outputState: "complete" | "partial" | "failed";
    manifestPath: string;
    verificationState?: VerificationState;
  }): boolean {
    if (!required(result.manifestPath,"manifestPath")) return false;
    return this.transaction(() => {
      if (!this.verify(attempt)) return false;
      let manifest: CompletionManifest;
      try { manifest = JSON.parse(readFileSync(result.manifestPath,"utf8")) as CompletionManifest; }
      catch { throw new Error("OUTPUT_MANIFEST_INVALID: durable completion manifest not readable"); }
      if (manifest.attemptId !== attempt.attemptId ||
          manifest.outputState !== result.outputState ||
          (result.state === "succeeded" && (manifest.exitCode !== 0 || manifest.signal !== null)))
        throw new Error("OUTPUT_MANIFEST_INVALID: attempt, output or exit status mismatch");
      const now = new Date().toISOString();
      const updated = this.db.prepare(`UPDATE tasks SET state=?,output_state=?,verification_state=?,outcome='known',
        result_manifest=?,updated_at=? WHERE task_id=? AND attempt_id=? AND state IN ('running','canceling')`)
        .run(result.state,result.outputState,result.verificationState ?? "not_requested",result.manifestPath,now,attempt.taskId,attempt.attemptId);
      if (updated.changes !== 1) return false;
      this.db.prepare("UPDATE attempts SET state=?,finished_at=? WHERE attempt_id=?")
        .run(result.state,now,attempt.attemptId);
      this.db.prepare("UPDATE dispatch_intents SET state='finished' WHERE task_id=?")
        .run(attempt.taskId);
      this.event(attempt.taskId,attempt.attemptId,result.state);
      return true;
    });
  }

  /** Transport cancellation MUST NOT call this method. This is explicit task cancellation only. */
  public requestCancel(taskId: string): ExecutionState | null {
    return this.transaction(() => {
      const task = this.get(taskId);
      if (!task) return null;
      if (task.state === "queued") {
        this.db.prepare("UPDATE tasks SET state='canceled',updated_at=? WHERE task_id=? AND state='queued'")
          .run(new Date().toISOString(),taskId);
        this.db.prepare("UPDATE dispatch_intents SET state='canceled' WHERE task_id=?")
          .run(taskId);
        this.event(taskId,null,"canceled","before dispatch");
        return "canceled";
      }
      if (task.state === "starting" || task.state === "running") {
        this.db.prepare("UPDATE tasks SET state='canceling',updated_at=? WHERE task_id=?")
          .run(new Date().toISOString(),taskId);
        this.event(taskId,task.attemptId,"cancel_requested");
        return "canceling";
      }
      return task.state;
    });
  }

  /** Caller must first verify the worker AND its complete child process tree stopped. */
  public confirmCanceled(attempt: DispatchAttempt, manifestPath: string): boolean {
    return this.transaction(() => {
      if (!this.verify(attempt)) return false;
      let manifest: CompletionManifest;
      try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CompletionManifest; }
      catch { throw new Error("OUTPUT_MANIFEST_INVALID: cancellation manifest not readable"); }
      if (manifest.attemptId !== attempt.attemptId || manifest.canceled !== true ||
          !["complete", "partial"].includes(manifest.outputState))
        throw new Error("OUTPUT_MANIFEST_INVALID: cancellation not attested by worker");
      const updated = this.db.prepare("UPDATE tasks SET state='canceled',output_state='partial',result_manifest=?,updated_at=? WHERE task_id=? AND attempt_id=? AND state='canceling'")
        .run(manifestPath,new Date().toISOString(),attempt.taskId,attempt.attemptId);
      if (updated.changes !== 1) return false;
      this.db.prepare("UPDATE attempts SET state='canceled',finished_at=? WHERE attempt_id=?")
        .run(new Date().toISOString(),attempt.attemptId);
      this.db.prepare("UPDATE dispatch_intents SET state='finished' WHERE task_id=?").run(attempt.taskId);
      this.event(attempt.taskId,attempt.attemptId,"canceled","worker tree confirmed stopped");
      return true;
    });
  }

  /** Only after daemon has verified no matching worker is alive; never auto-replay. */
  public interruptUnverified(taskId: string, reason: string): boolean {
    required(reason,"reason");
    return this.transaction(() => {
      const task = this.get(taskId);
      if (!task || !["starting","running","canceling"].includes(task.state)) return false;
      this.db.prepare("UPDATE tasks SET state='interrupted',outcome='unknown',output_state='partial',reason=?,updated_at=? WHERE task_id=?")
        .run(reason,new Date().toISOString(),taskId);
      if (task.attemptId) this.db.prepare("UPDATE attempts SET state='interrupted',finished_at=? WHERE attempt_id=?")
        .run(new Date().toISOString(),task.attemptId);
      this.db.prepare("UPDATE dispatch_intents SET state='needs_reconciliation' WHERE task_id=?")
        .run(taskId);
      this.event(taskId,task.attemptId,"interrupted",reason);
      return true;
    });
  }

  public events(taskId: string, afterSequence = 0, limit = 100): ExecutionEvent[] {
    return (this.db.prepare("SELECT sequence,task_id,attempt_id,name,detail,created_at FROM events WHERE task_id=? AND sequence>? ORDER BY sequence LIMIT ?")
      .all(taskId,afterSequence,Math.max(1,Math.min(limit,200))) as {sequence:number;task_id:string;attempt_id:string|null;name:string;detail:string|null;created_at:string}[])
      .map(row => ({sequence:row.sequence,taskId:row.task_id,attemptId:row.attempt_id,name:row.name,detail:row.detail,createdAt:row.created_at}));
  }

  public close(): void { this.db.close(); }
}
