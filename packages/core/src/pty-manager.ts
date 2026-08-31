import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { IPty } from "node-pty";
import type { ProcessShell } from "./process-manager.js";

export type PtyState = "running" | "exited" | "failed" | "stopped";

export interface PtyStartOptions {
  command?: string;
  cwd: string;
  shell?: ProcessShell;
  powershellPath?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtySnapshot {
  id: string;
  pid: number;
  command: string;
  executable: string;
  cwd: string;
  shell: ProcessShell;
  cols: number;
  rows: number;
  state: PtyState;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  signal?: number;
  cursor: number;
  outputSize: number;
}

export interface PtyReadResult {
  ptyId: string;
  text: string;
  cursor: number;
  nextCursor: number;
  truncated: boolean;
  state: PtyState;
}

interface ManagedPty {
  pty: IPty;
  snapshot: PtySnapshot;
  output: string;
  baseCursor: number;
  requestedStop: boolean;
  exitPromise: Promise<void>;
  resolveExit: () => void;
}

interface PtyLaunch {
  file: string;
  args: string[];
  commandLabel: string;
  shell: ProcessShell;
}

export class PtyManager {
  private readonly sessions = new Map<string, ManagedPty>();
  private readonly maxBufferChars = 500_000;
  private nodePtyPromise?: Promise<typeof import("node-pty")>;

  public constructor(
    private defaultShell: ProcessShell = os.platform() === "win32"
      ? "powershell"
      : "direct",
    private readonly maxTrackedSessions = 100,
  ) {}

  public setDefaultShell(shell: ProcessShell): void {
    this.defaultShell = shell;
  }

  public async start(options: PtyStartOptions): Promise<PtySnapshot> {
    this.pruneCompleted(Math.max(0, this.maxTrackedSessions - 1));
    const launch = this.launchFor(options);
    const cols = boundedDimension(options.cols, 120);
    const rows = boundedDimension(options.rows, 30);
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...(options.env ?? {}),
      TERM: options.env?.TERM ?? process.env.TERM ?? "xterm-256color",
    };
    if (process.platform === "win32") env.SystemRoot ??= process.env.SystemRoot;

    const nodePty = await this.loadNodePty();
    let pty: IPty;
    try {
      pty = nodePty.spawn(launch.file, launch.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: options.cwd,
        env,
        ...(process.platform === "win32"
          ? { useConpty: true, useConptyDll: true }
          : { encoding: "utf8" as const }),
      });
    } catch (error) {
      throw new Error(
        `PTY_START_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const id = `pty_${randomUUID()}`;
    const snapshot: PtySnapshot = {
      id,
      pid: pty.pid,
      command: launch.commandLabel,
      executable: launch.file,
      cwd: path.resolve(options.cwd),
      shell: launch.shell,
      cols,
      rows,
      state: "running",
      startedAt: new Date().toISOString(),
      cursor: 0,
      outputSize: 0,
    };
    let resolveExit = (): void => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const managed: ManagedPty = {
      pty,
      snapshot,
      output: "",
      baseCursor: 0,
      requestedStop: false,
      exitPromise,
      resolveExit,
    };
    this.sessions.set(id, managed);

    pty.onData((chunk) => this.append(managed, chunk));
    pty.onExit((event) => {
      managed.snapshot.exitCode = event.exitCode;
      if (event.signal !== undefined) managed.snapshot.signal = event.signal;
      managed.snapshot.state = managed.requestedStop
        ? "stopped"
        : event.exitCode === 0
          ? "exited"
          : "failed";
      managed.snapshot.endedAt = new Date().toISOString();
      cleanupWindowsNodePtyHandles(managed.pty);
      managed.resolveExit();
      this.pruneCompleted();
    });

    return cloneSnapshot(snapshot);
  }

  public read(ptyId: string, cursor = 0, maxChars = 20_000): PtyReadResult {
    const managed = this.requireSession(ptyId);
    const boundedMax = Math.max(1, Math.min(Math.floor(maxChars), 100_000));
    const requestedCursor = Math.max(0, Math.floor(cursor));
    const actualCursor = Math.max(requestedCursor, managed.baseCursor);
    const offset = Math.max(0, actualCursor - managed.baseCursor);
    const text = managed.output.slice(offset, offset + boundedMax);
    const nextCursor = actualCursor + text.length;
    return {
      ptyId,
      text,
      cursor: requestedCursor,
      nextCursor,
      truncated:
        requestedCursor < managed.baseCursor ||
        offset + text.length < managed.output.length,
      state: managed.snapshot.state,
    };
  }

  public write(ptyId: string, text: string, enter = false): { bytes: number } {
    const managed = this.requireRunning(ptyId);
    if (text.length > 1_000_000)
      throw new Error(
        "INVALID_INPUT: PTY write text must be 1000000 characters or fewer",
      );
    const payload = `${text}${enter ? "\r" : ""}`;
    try {
      managed.pty.write(payload);
    } catch (error) {
      throw new Error(
        `PTY_WRITE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { bytes: Buffer.byteLength(payload, "utf8") };
  }

  public resize(ptyId: string, cols: number, rows: number): PtySnapshot {
    const managed = this.requireRunning(ptyId);
    const nextCols = boundedDimension(cols, managed.snapshot.cols);
    const nextRows = boundedDimension(rows, managed.snapshot.rows);
    try {
      managed.pty.resize(nextCols, nextRows);
    } catch (error) {
      throw new Error(
        `PTY_RESIZE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    managed.snapshot.cols = nextCols;
    managed.snapshot.rows = nextRows;
    return cloneSnapshot(managed.snapshot);
  }

  public async close(ptyId: string): Promise<PtySnapshot> {
    const managed = this.requireSession(ptyId);
    if (managed.snapshot.state !== "running")
      return cloneSnapshot(managed.snapshot);
    managed.requestedStop = true;
    await this.terminate(managed);
    await Promise.race([managed.exitPromise, delay(2_000)]);
    if (managed.snapshot.state === "running") {
      managed.snapshot.state = "stopped";
      managed.snapshot.endedAt = new Date().toISOString();
    }
    return cloneSnapshot(managed.snapshot);
  }

  public list(): PtySnapshot[] {
    return [...this.sessions.values()].map((entry) =>
      cloneSnapshot(entry.snapshot),
    );
  }

  public snapshot(ptyId: string): PtySnapshot {
    return cloneSnapshot(this.requireSession(ptyId).snapshot);
  }

  private append(managed: ManagedPty, chunk: string): void {
    managed.output += chunk;
    managed.snapshot.outputSize = managed.baseCursor + managed.output.length;
    managed.snapshot.cursor = managed.snapshot.outputSize;
    if (managed.output.length > this.maxBufferChars) {
      const drop = managed.output.length - this.maxBufferChars;
      managed.output = managed.output.slice(drop);
      managed.baseCursor += drop;
    }
  }

  private requireSession(ptyId: string): ManagedPty {
    const managed = this.sessions.get(ptyId);
    if (!managed) throw new Error(`PTY_NOT_FOUND: ${ptyId}`);
    return managed;
  }

  private requireRunning(ptyId: string): ManagedPty {
    const managed = this.requireSession(ptyId);
    if (managed.snapshot.state !== "running")
      throw new Error(`PTY_NOT_RUNNING: ${ptyId}`);
    return managed;
  }

  private launchFor(options: PtyStartOptions): PtyLaunch {
    const shell = options.shell ?? this.defaultShell;
    const command = options.command?.trim() ?? "";
    if (shell === "powershell") {
      const file = powershellExecutable(options.powershellPath);
      return {
        file,
        args: command
          ? ["-NoLogo", "-NoProfile", "-NoExit", "-Command", command]
          : ["-NoLogo", "-NoProfile"],
        commandLabel: command || file,
        shell,
      };
    }
    if (shell === "cmd") {
      const file = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
      return {
        file,
        args:
          process.platform === "win32"
            ? command
              ? ["/d", "/q", "/k", command]
              : ["/d", "/q"]
            : command
              ? ["-c", command]
              : [],
        commandLabel: command || file,
        shell,
      };
    }
    if (!command)
      throw new Error(
        "INVALID_INPUT: command is required when PTY shell is direct",
      );
    const tokens = tokenizeCommand(command);
    const file = tokens[0];
    if (!file) throw new Error("INVALID_INPUT: command is required");
    return {
      file,
      args: tokens.slice(1),
      commandLabel: command,
      shell,
    };
  }

  private async loadNodePty(): Promise<typeof import("node-pty")> {
    this.nodePtyPromise ??= import("node-pty").catch((error: unknown) => {
      this.nodePtyPromise = undefined;
      throw new Error(
        `PTY_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return this.nodePtyPromise;
  }

  private async terminate(managed: ManagedPty): Promise<void> {
    if (process.platform === "win32" && managed.pty.pid > 0) {
      await new Promise<void>((resolve) => {
        const killer = spawnChild(
          "taskkill.exe",
          ["/PID", String(managed.pty.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        killer.once("close", finish);
        killer.once("error", finish);
      });
    }
    try {
      managed.pty.kill();
    } catch (error) {
      if (managed.snapshot.state === "running")
        throw new Error(
          `PTY_CLOSE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      cleanupWindowsNodePtyHandles(managed.pty);
    }
  }

  private pruneCompleted(limit = this.maxTrackedSessions): void {
    const bounded = Math.max(1, Math.floor(limit));
    if (this.sessions.size <= bounded) return;
    for (const [id, managed] of this.sessions) {
      if (this.sessions.size <= bounded) break;
      if (managed.snapshot.state === "running") continue;
      this.sessions.delete(id);
    }
  }
}

function cloneSnapshot(snapshot: PtySnapshot): PtySnapshot {
  return { ...snapshot };
}

function boundedDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(2, Math.min(Math.floor(value), 500));
}

function tokenizeCommand(command: string): string[] {
  const tokens = command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? [];
  return tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    )
      return token.slice(1, -1).replace(/\\([\\"'])/g, "$1");
    return token;
  });
}

function powershellExecutable(requested?: string): string {
  if (requested && executableOnPath(requested)) return requested;
  if (process.platform !== "win32") return requested ?? "pwsh";
  return executableOnPath("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
}

function executableOnPath(command: string): boolean {
  try {
    if (path.isAbsolute(command)) return existsSync(command);
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    return spawnSync(lookup, [command], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function cleanupWindowsNodePtyHandles(pty: IPty): void {
  if (process.platform !== "win32") return;
  const agent = (
    pty as IPty & {
      _agent?: {
        _inSocket?: { destroy(): void };
        _outSocket?: { destroy(): void };
        _conoutSocketWorker?: { dispose(): void };
      };
    }
  )._agent;
  try {
    agent?._inSocket?.destroy();
  } catch {
    // node-pty internals vary across releases; cleanup is best-effort and idempotent.
  }
  try {
    agent?._outSocket?.destroy();
  } catch {
    // See above.
  }
  try {
    agent?._conoutSocketWorker?.dispose();
  } catch {
    // See above.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
