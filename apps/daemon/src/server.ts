import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import net, { type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { DurableRunner, type SubmitCommand } from "@qnector/execution";

export function daemonSocketPath(root: string): string {
  if (process.platform !== "win32") return path.join(path.resolve(root), "daemon.sock");
  const identity = createHash("sha256")
    .update(JSON.stringify([os.userInfo().username, path.resolve(root).toLowerCase()]))
    .digest("hex").slice(0, 28);
  return `\\\\.\\pipe\\qnector-durable-${identity}`;
}

export function daemonAuthToken(root: string): string {
  return readFileSync(path.join(path.resolve(root), "daemon-token"), "utf8").trim();
}

type Request = {
  token?: string;
  action?: string;
  taskId?: string;
  workspace?: string;
  limit?: number;
  stream?: "stdout" | "stderr";
  cursor?: number;
  maxBytes?: number;
  waitTimeoutMs?: number;
  idempotencyKey?: string;
  command?: SubmitCommand["command"];
  timeoutMs?: number;
};

/** Standalone, opt-in daemon: one named-pipe listener, one DB writer, no Electron imports. */
export class DurableDaemon {
  public readonly socketPath: string;
  private readonly root: string;
  private readonly jobHostPath: string | undefined;
  private server: Server | undefined;
  private runner: DurableRunner | undefined;
  private token = "";
  private recoveryTimer: NodeJS.Timeout | undefined;

  public constructor(root: string, options: {jobHostPath?: string} = {}) {
    this.root = path.resolve(root);
    this.jobHostPath = options.jobHostPath ? path.resolve(options.jobHostPath) : undefined;
    this.socketPath = daemonSocketPath(this.root);
  }

  public async start(): Promise<void> {
    if (this.server) throw new Error("DAEMON_ALREADY_STARTED");
    mkdirSync(this.root, {recursive: true, mode: 0o700});
    const server = net.createServer(socket => this.handleConnection(socket));
    // Bind before opening SQLite. The OS disallows two listeners with the same pipe name.
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({path: this.socketPath, readableAll: false, writableAll: false}, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      server.close(() => undefined);
      throw error;
    }
    this.server = server;
    try {
      const tokenFile = path.join(this.root, "daemon-token");
      if (!existsSync(tokenFile)) {
        try { writeFileSync(tokenFile, randomBytes(32).toString("hex"), {flag: "wx", mode: 0o600}); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
      }
      if (process.platform !== "win32") chmodSync(tokenFile, 0o600);
      this.token = daemonAuthToken(this.root);
      if (!/^[a-f0-9]{64}$/.test(this.token)) throw new Error("DAEMON_TOKEN_INVALID");
      this.runner = new DurableRunner(this.root, {jobHostPath: this.jobHostPath});
      this.runner.recover();
      this.recoveryTimer = setInterval(() => {
        try { this.runner?.recover(); } catch { /* exposed by diagnostics in later phases */ }
      }, 1_000);
    } catch (error) {
      this.runner?.close();
      this.runner = undefined;
      await new Promise<void>(resolve => server.close(() => resolve()));
      this.server = undefined;
      throw error;
    }
  }

  private authenticated(candidate: string | undefined): boolean {
    if (typeof candidate !== "string" || candidate.length !== this.token.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token));
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding("utf8");
    const waitController = new AbortController();
    socket.once("close", () => waitController.abort());
    let data = "";
    let done = false;
    const respond = (result: unknown): void => {
      if (done) return;
      done = true;
      socket.end(`${JSON.stringify(result)}\n`);
    };
    socket.on("data", (chunk: string) => {
      if (done) return;
      data += chunk;
      if (Buffer.byteLength(data, "utf8") > 64 * 1024) {
        respond({ok: false, error: "IPC_REQUEST_TOO_LARGE"});
        return;
      }
      if (!data.includes("\n")) return;
      try {
        if (!data.endsWith("\n") || data.indexOf("\n") !== data.length - 1)
          throw new Error("IPC_SINGLE_REQUEST_REQUIRED");
        const request = JSON.parse(data.slice(0, -1)) as Request;
        if (!this.authenticated(request.token)) throw new Error("IPC_UNAUTHORIZED");
        void this.route(request, waitController.signal)
          .then(result => respond({ok: true, data: result}))
          .catch(error => respond({ok: false, error: error instanceof Error ? error.message : "IPC_ERROR"}));
      } catch (error) {
        respond({ok: false, error: error instanceof Error ? error.message : "IPC_ERROR"});
      }
    });
    socket.on("error", () => { /* client disconnect cancels only this subscription */ });
  }

  private async route(request: Request, waitSignal: AbortSignal): Promise<unknown> {
    const runner = this.runner;
    if (!runner) throw new Error("DAEMON_NOT_READY");
    switch (request.action) {
      case "ping": return {state: "ready", protocol: 1};
      case "submit": {
        if (!request.command) throw new Error("INVALID_INPUT: command required");
        const {task, reused} = runner.submit({
          workspace: request.workspace ?? "", idempotencyKey: request.idempotencyKey ?? "",
          command: request.command, timeoutMs: request.timeoutMs,
        });
        return {taskId: task.taskId, state: task.state, reused, nextAction: "get"};
      }
      case "cancel": {
        if (!request.taskId) throw new Error("INVALID_INPUT: taskId required");
        const task = runner.cancel(request.taskId);
        return {taskId: task.taskId, state: task.state, outcome: task.outcome,
          nextAction: task.state === "canceling" ? "wait" : "result"};
      }
      case "inspect": {
        if (!request.taskId) throw new Error("INVALID_INPUT: taskId required");
        return runner.inspect(request.taskId);
      }
      case "get": {
        const task = runner.get(request.taskId ?? "");
        if (!task) return null;
        const {taskId, attemptId, state, outputState, verificationState, outcome,
          resultManifest, reason, createdAt, updatedAt} = task;
        return {taskId, attemptId, state, outputState, verificationState, outcome,
          resultManifest, reason, createdAt, updatedAt};
      }
      case "wait": {
        if (!request.taskId) throw new Error("INVALID_INPUT: taskId required");
        const timeout = request.waitTimeoutMs ?? 10_000;
        if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 20_000)
          throw new Error("INVALID_INPUT: waitTimeoutMs must be 0..20000");
        const deadline = Date.now() + timeout;
        for (;;) {
          if (waitSignal.aborted) throw new Error("IPC_WAIT_CANCELED");
          const task = runner.get(request.taskId);
          if (!task) throw new Error("TASK_NOT_FOUND");
          const active = ["queued", "starting", "running", "canceling"].includes(task.state);
          if (!active || Date.now() >= deadline)
            return {taskId: task.taskId, attemptId: task.attemptId, state: task.state,
              nextAction: active ? "wait" : "result"};
          await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now())));
        }
      }
      case "result": {
        const task = runner.get(request.taskId ?? "");
        if (!task) throw new Error("TASK_NOT_FOUND");
        const manifest = task.resultManifest ? JSON.parse(readFileSync(task.resultManifest, "utf8")) as unknown : null;
        return {taskId: task.taskId, state: task.state, outcome: task.outcome,
          outputState: task.outputState, verificationState: task.verificationState, manifest};
      }
      case "list": {
        if (!request.workspace) throw new Error("INVALID_INPUT: workspace required");
        return runner.store.list(request.workspace, request.limit).map(task => ({
          taskId: task.taskId, state: task.state, outcome: task.outcome,
          attemptId: task.attemptId, createdAt: task.createdAt,
        }));
      }
      case "output": {
        if (!request.taskId || !["stdout", "stderr"].includes(request.stream ?? ""))
          throw new Error("INVALID_INPUT: taskId and stream required");
        return runner.output(request.taskId, request.stream!, request.cursor,
          Math.min(request.maxBytes ?? 32 * 1024, 32 * 1024));
      }
      default: throw new Error("IPC_ACTION_UNSUPPORTED");
    }
  }

  /** Stop only the daemon; independently dispatched workers are not canceled. */
  public async close(): Promise<void> {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.runner?.close();
    this.runner = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
