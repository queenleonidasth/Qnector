import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExecutionStore,
  type DispatchAttempt,
  type ExecutionTask,
} from "./execution-store.js";
import {
  type CompletionManifest,
  OutputSpool,
  type OutputStream,
} from "./output-spool.js";
import { inspectWorker, type WorkerInspection } from "./worker-identity.js";
import type { WorkerBootstrap, WorkerCommand } from "./worker-main.js";

export interface SubmitCommand {
  workspace: string;
  idempotencyKey: string;
  command: WorkerCommand;
  timeoutMs?: number;
}

/** Opt-in P2 headless prototype. Never start a second writer for this root. */
export class DurableRunner {
  public readonly store: ExecutionStore;
  private readonly root: string;
  private readonly spoolRoot: string;
  private readonly workerScript: string;
  private readonly jobHostPath: string | undefined;
  private readonly active = new Map<string, ChildProcess>();
  private readonly concurrency: number;
  private closed = false;
  private pumping = false;
  private lastCancelInspectionAt = 0;

  public constructor(
    root: string,
    options: {
      workerScript?: string;
      concurrency?: number;
      jobHostPath?: string;
    } = {},
  ) {
    this.root = path.resolve(root);
    this.spoolRoot = path.join(this.root, "output");
    mkdirSync(this.spoolRoot, { recursive: true });
    this.store = new ExecutionStore(path.join(this.root, "execution.sqlite"));
    this.workerScript =
      options.workerScript ??
      fileURLToPath(new URL("./worker-main.js", import.meta.url));
    this.jobHostPath = options.jobHostPath
      ? path.resolve(options.jobHostPath)
      : undefined;
    this.concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 8));
  }

  /** Safe to call after a restart: commit readable manifests, never respawn claimed tasks. */
  public recover(): void {
    const initialRecovery = this.lastCancelInspectionAt === 0;
    const inspectCanceled = Date.now() - this.lastCancelInspectionAt >= 5_000;
    if (inspectCanceled) this.lastCancelInspectionAt = Date.now();
    for (const attempt of this.store.activeAttempts()) {
      if (this.reconcile(attempt)) continue;
      if (
        (initialRecovery ||
          (inspectCanceled &&
            this.store.get(attempt.taskId)?.state === "canceling")) &&
        inspectWorker(this.spoolRoot, attempt).status === "exited" &&
        !this.reconcile(attempt)
      ) {
        // OS inspection takes time: recheck the manifest before marking unknown.
        // A dead worker cannot produce new evidence; never infer success or replay.
        this.store.interruptUnverified(
          attempt.taskId,
          "Verified worker exited without a valid completion manifest; outcome unknown",
        );
      }
    }
    this.pump();
  }

  public submit(input: SubmitCommand): {
    task: ExecutionTask;
    reused: boolean;
  } {
    if (this.closed) throw new Error("DAEMON_CLOSED");
    if (!input.idempotencyKey?.trim() || !input.workspace?.trim())
      throw new Error("INVALID_INPUT: key and workspace required");
    if (!input.command || !["direct", "shell"].includes(input.command.kind))
      throw new Error("INVALID_INPUT: command required");
    if (
      input.command.kind === "direct" &&
      (!input.command.file ||
        !Array.isArray(input.command.args) ||
        input.command.args.some((arg) => typeof arg !== "string"))
    )
      throw new Error("INVALID_INPUT: direct file and args required");
    if (
      input.command.kind === "shell" &&
      (!input.command.command ||
        !["cmd", "powershell"].includes(input.command.shell))
    )
      throw new Error("INVALID_INPUT: shell command invalid");
    const timeoutMs = input.timeoutMs ?? 120_000;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 3_600_000
    )
      throw new Error("INVALID_INPUT: timeoutMs invalid");
    const snapshot = { command: input.command, timeoutMs };
    // No custom environment is accepted or persisted. Commands may themselves contain secrets:
    // keep this opt-in, user-local and do not export task definitions to diagnostics.
    const inputDigest = createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");
    const result = this.store.accept({
      owner: os.userInfo().username,
      workspace: input.workspace,
      operation: "command.run",
      idempotencyKey: input.idempotencyKey,
      inputDigest,
      definitionSnapshot: snapshot,
    });
    if (!result.reused) this.pump();
    return result;
  }

  public get(taskId: string): ExecutionTask | null {
    const task = this.store.get(taskId);
    if (
      task?.attemptId &&
      ["starting", "running", "canceling"].includes(task.state)
    ) {
      const attempt = this.store
        .activeAttempts()
        .find((item) => item.taskId === taskId);
      if (attempt) this.reconcile(attempt);
    }
    return this.store.get(taskId);
  }

  /** Read-only OS identity reconciliation: never signal a PID or replay an attempt. */
  public inspect(taskId: string): {
    taskId: string;
    state: ExecutionTask["state"];
    worker: WorkerInspection | null;
  } {
    const task = this.get(taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (!["starting", "running", "canceling"].includes(task.state))
      return { taskId, state: task.state, worker: null };
    const attempt = this.store
      .activeAttempts()
      .find((item) => item.taskId === taskId);
    if (!attempt)
      return {
        taskId,
        state: task.state,
        worker: {
          status: "unverified",
          pid: null,
          reason: "no active fenced attempt",
        },
      };
    const worker = inspectWorker(this.spoolRoot, attempt);
    if (worker.status === "exited" && !this.reconcile(attempt)) {
      // A manifest can appear while OS inspection is running. Reconcile again
      // before declaring an unknown outcome; never auto-replay side effects.
      this.store.interruptUnverified(
        taskId,
        "OS-verified original worker exited without a valid completion manifest; effects unknown",
      );
    }
    return { taskId, state: this.store.get(taskId)!.state, worker };
  }

  /** Explicit cancellation only: an IPC waiter disconnect must never call this. */
  public cancel(taskId: string): ExecutionTask {
    const existing = this.get(taskId);
    if (!existing) throw new Error("TASK_NOT_FOUND");
    const state = this.store.requestCancel(taskId);
    if (state === "canceling" && existing.attemptId) {
      // The worker may not have created the attempt directory yet (cancel-at-accept race).
      mkdirSync(path.join(this.spoolRoot, existing.attemptId), {
        recursive: true,
        mode: 0o700,
      });
      const cancelFile = path.join(
        this.spoolRoot,
        existing.attemptId,
        "cancel.request",
      );
      try {
        writeFileSync(cancelFile, "cancel\n", { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
      }
    }
    return this.get(taskId)!;
  }

  public output(
    taskId: string,
    stream: OutputStream,
    cursor = 0,
    maxBytes = 32 * 1024,
  ) {
    const task = this.get(taskId);
    if (!task?.attemptId) throw new Error("TASK_OUTPUT_NOT_STARTED");
    return new OutputSpool(this.spoolRoot, task.attemptId).page(
      stream,
      cursor,
      maxBytes,
    );
  }

  private verifyManifest(
    attempt: DispatchAttempt,
  ): { path: string; manifest: CompletionManifest } | null {
    const directory = path.join(this.spoolRoot, attempt.attemptId);
    const manifestPath = path.join(directory, "completion.json");
    if (!existsSync(manifestPath)) return null;
    let manifest: CompletionManifest;
    try {
      manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as CompletionManifest;
    } catch {
      return null;
    }
    if (
      manifest.attemptId !== attempt.attemptId ||
      !["complete", "partial"].includes(manifest.outputState) ||
      !Number.isSafeInteger(manifest.stdoutBytes) ||
      !Number.isSafeInteger(manifest.stderrBytes) ||
      manifest.stdoutBytes < 0 ||
      manifest.stderrBytes < 0
    )
      return null;
    for (const stream of ["stdout", "stderr"] as const) {
      const file = path.join(directory, `${stream}.spool`);
      const bytes =
        stream === "stdout" ? manifest.stdoutBytes : manifest.stderrBytes;
      const expected =
        stream === "stdout" ? manifest.stdoutSha256 : manifest.stderrSha256;
      if ((existsSync(file) ? statSync(file).size : 0) !== bytes) return null;
      const hash = createHash("sha256");
      if (existsSync(file)) {
        const fd = openSync(file, "r");
        const buffer = Buffer.alloc(64 * 1024);
        try {
          let count: number;
          while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0)
            hash.update(buffer.subarray(0, count));
        } finally {
          closeSync(fd);
        }
      }
      if (hash.digest("hex") !== expected) return null;
    }
    return { path: manifestPath, manifest };
  }

  private reconcile(attempt: DispatchAttempt): boolean {
    const result = this.verifyManifest(attempt);
    if (!result) return false;
    const task = this.store.get(attempt.taskId);
    if (task?.state === "starting" && !this.store.markStarted(attempt))
      return false;
    const current = this.store.get(attempt.taskId);
    if (!current || !["running", "canceling"].includes(current.state))
      return false;
    if (result.manifest.canceled === true) {
      // A cancellation manifest is meaningful only when cancellation was
      // explicitly requested; the worker attests that its tree kill succeeded.
      return (
        current.state === "canceling" &&
        this.store.confirmCanceled(attempt, result.path)
      );
    }
    // Cancellation can race with natural completion. If the original worker
    // finished before the cancel took effect, preserve its actual result.
    return this.store.finish(attempt, {
      state:
        result.manifest.exitCode === 0 && result.manifest.signal === null
          ? "succeeded"
          : "failed",
      outputState: result.manifest.outputState,
      manifestPath: result.path,
    });
  }

  private pump(): void {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    try {
      for (const taskId of this.store.pending()) {
        if (this.store.activeAttempts().length >= this.concurrency) break;
        const attempt = this.store.claim(taskId);
        if (attempt) this.launch(attempt);
      }
    } finally {
      this.pumping = false;
    }
  }

  private launch(attempt: DispatchAttempt): void {
    const task = this.store.get(attempt.taskId);
    if (!task) return;
    const definition = task.definitionSnapshot as {
      command: WorkerCommand;
      timeoutMs: number;
    };
    const config: WorkerBootstrap = {
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      token: attempt.token,
      spoolRoot: this.spoolRoot,
      cwd: task.workspace,
      timeoutMs: definition.timeoutMs,
      command: definition.command,
      maxOutputBytes: 256 * 1024 * 1024,
      jobHostPath: this.jobHostPath,
    };
    mkdirSync(path.join(this.spoolRoot, attempt.attemptId), {
      recursive: true,
      mode: 0o700,
    });
    const bootstrap = path.join(
      this.root,
      `bootstrap-${attempt.attemptId}.json`,
    );
    writeFileSync(bootstrap, JSON.stringify(config), {
      flag: "wx",
      mode: 0o600,
    });
    const worker = spawn(process.execPath, [this.workerScript, bootstrap], {
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.active.set(attempt.taskId, worker);
    let ready = false;
    let received = "";
    const guard = setTimeout(() => {
      if (!ready) worker.kill();
    }, 10_000);
    worker.stdout?.on("data", (chunk: Buffer) => {
      if (ready) return;
      received += chunk.toString("utf8");
      if (received.length > 256) {
        worker.kill();
        return;
      }
      if (!received.includes("\n")) return;
      if (received !== `READY ${attempt.attemptId}\n`) {
        worker.kill();
        return;
      }
      ready = true;
      clearTimeout(guard);
      if (this.closed) {
        worker.kill();
        return;
      }
      if (this.store.get(attempt.taskId)?.state === "canceling") {
        // Cancellation won the race BEFORE GO. Tell the worker to attest that
        // it never spawned a command rather than starting and then killing it.
        worker.stdin?.end(`CANCEL ${attempt.attemptId}\n`);
        worker.unref();
        return;
      }
      if (!this.store.markStarted(attempt)) {
        worker.kill();
        return;
      }
      worker.stdin?.end(`GO ${attempt.attemptId}\n`);
      worker.unref();
    });
    worker.once("error", () => {
      /* close/reconciliation handles unknown outcomes */
    });
    worker.once("close", () => {
      clearTimeout(guard);
      this.active.delete(attempt.taskId);
      if (this.closed) return;
      if (!this.reconcile(attempt)) {
        // The worker itself is confirmed closed; never replay an unknown command.
        this.store.interruptUnverified(
          attempt.taskId,
          "worker exited without a valid completion manifest; child effects may be unknown",
        );
      }
      this.pump();
    });
  }

  /** This disconnects the coordinator only; it does NOT cancel already-dispatched jobs. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.store.close();
  }
}
