import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import type { ProcessSnapshot } from "@qnector/shared";
import {
  canUsePersistentPowerShell,
  runPersistentPowerShell,
  shutdownPowerShellWorkers,
} from "./powershell-worker.js";

export type ProcessShell = "powershell" | "cmd" | "direct";

export interface RunOptions {
  command: string;
  cwd: string;
  shell?: ProcessShell;
  timeoutMs: number;
  env?: Record<string, string>;
  maxChars?: number;
  outputMode?: "raw" | "smart";
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  omittedChars: number;
  omittedLines: number;
  originalSize: { stdout: number; stderr: number };
  sha256: string;
  reductionMode: "raw" | "smart";
}

interface ManagedProcess {
  child: ChildProcess;
  snapshot: ProcessSnapshot;
  output: string;
  baseCursor: number;
  listeners: Set<(snapshot: ProcessSnapshot) => void>;
}

export interface ProcessOutput {
  processId: string;
  text: string;
  cursor: number;
  nextCursor: number;
  truncated: boolean;
  state: ProcessSnapshot["state"];
  reductionMode?: "raw" | "smart";
  omittedChars?: number;
  omittedLines?: number;
}

export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly maxBufferChars = 250_000;
  private readonly globalListeners = new Set<
    (snapshot: ProcessSnapshot) => void
  >();

  private defaultShell: ProcessShell;

  public constructor(
    defaultShell: ProcessShell = os.platform() === "win32"
      ? "powershell"
      : "direct",
    private readonly maxTrackedProcesses = 200,
  ) {
    this.defaultShell = defaultShell;
  }

  public setDefaultShell(shell: ProcessShell): void {
    this.defaultShell = shell;
  }

  private commandFor(options: RunOptions): {
    file: string;
    args: string[];
    shell?: boolean;
  } {
    const shell = options.shell ?? this.defaultShell;
    if (shell === "powershell") {
      const direct = smartDirectCommand(options.command);
      if (direct) return direct;
      const executable = powershellExecutable();
      return {
        file: executable,
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          options.command,
        ],
      };
    }
    if (shell === "cmd")
      return {
        file: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        args:
          process.platform === "win32"
            ? ["/d", "/s", "/c", options.command]
            : ["-c", options.command],
      };
    const tokens = tokenizeCommand(options.command);
    return { file: tokens[0] ?? options.command, args: tokens.slice(1) };
  }

  private spawnProcess(options: RunOptions): ChildProcess {
    const command = this.commandFor(options);
    const env = { ...process.env, ...(options.env ?? {}) };
    return spawn(command.file, command.args, {
      cwd: options.cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  public async run(options: RunOptions): Promise<RunResult> {
    const started = Date.now();
    const maxChars = Math.max(
      1,
      Math.min(options.maxChars ?? 100_000, 1_000_000),
    );
    const shell = options.shell ?? this.defaultShell;
    const direct =
      shell === "powershell" ? smartDirectCommand(options.command) : null;
    if (
      shell === "powershell" &&
      !direct &&
      canUsePersistentPowerShell(options.command, options.env)
    ) {
      try {
        const worker = await runPersistentPowerShell(powershellExecutable(), {
          command: options.command,
          cwd: options.cwd,
          timeoutMs: options.timeoutMs,
        });
        return finalizeRunResult({
          exitCode: worker.exitCode,
          signal: worker.signal,
          stdout: worker.stdout,
          stderr: worker.stderr,
          durationMs: worker.durationMs,
          maxChars,
          outputMode: options.outputMode ?? "smart",
        });
      } catch {
        // The worker is an optimization only. Protocol/startup failures fall
        // back to the isolated one-shot path so execution reliability wins.
      }
    }
    const child = this.spawnProcess(options);
    const stdoutCollector = new OutputCollector();
    const stderrCollector = new OutputCollector();
    const outputHash = createHash("sha256");
    let hashFinalized = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutCollector.append(chunk);
      if (!hashFinalized) {
        outputHash.update("stdout\u0000");
        outputHash.update(chunk);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrCollector.append(chunk);
      if (!hashFinalized) {
        outputHash.update("stderr\u0000");
        outputHash.update(chunk);
      }
    });
    let timeout: NodeJS.Timeout | undefined;
    const result = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const finish = (value: {
        exitCode: number | null;
        signal: NodeJS.Signals | null;
      }): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(value);
      };
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        if (!timedOut) finish({ exitCode, signal });
      });
      timeout = setTimeout(() => {
        timedOut = true;
        void this.stopChild(child).finally(() =>
          finish({ exitCode: null, signal: "SIGTERM" }),
        );
      }, options.timeoutMs);
    }).catch((error: unknown) => {
      throw new Error(
        `PROCESS_START_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    const stdout = reduceOutput(
      stdoutCollector.value(),
      maxChars,
      options.outputMode ?? "smart",
      stdoutCollector.totalChars,
    );
    const stderr = reduceOutput(
      stderrCollector.value(),
      maxChars,
      options.outputMode ?? "smart",
      stderrCollector.totalChars,
    );
    hashFinalized = true;
    return {
      ...result,
      stdout: stdout.text,
      stderr: stderr.text,
      durationMs: Date.now() - started,
      truncated: stdout.truncated || stderr.truncated,
      omittedChars: stdout.omittedChars + stderr.omittedChars,
      omittedLines: stdout.omittedLines + stderr.omittedLines,
      originalSize: {
        stdout: stdoutCollector.totalChars,
        stderr: stderrCollector.totalChars,
      },
      sha256: outputHash.digest("hex"),
      reductionMode: options.outputMode ?? "smart",
    };
  }

  public start(options: RunOptions): ProcessSnapshot {
    this.pruneCompletedHistory(Math.max(0, this.maxTrackedProcesses - 1));
    const id = `proc_${randomUUID()}`;
    const child = this.spawnProcess(options);
    const snapshot: ProcessSnapshot = {
      id,
      ...(child.pid === undefined ? {} : { pid: child.pid }),
      command: options.command,
      cwd: options.cwd,
      startedAt: new Date().toISOString(),
      state: "running",
      cursor: 0,
      outputSize: 0,
    };
    const managed: ManagedProcess = {
      child,
      snapshot,
      output: "",
      baseCursor: 0,
      listeners: new Set(),
    };
    this.processes.set(id, managed);
    const append = (prefix: string, chunk: Buffer): void => {
      managed.output += `${prefix}${chunk.toString("utf8")}`;
      managed.snapshot.outputSize = managed.baseCursor + managed.output.length;
      managed.snapshot.cursor = managed.snapshot.outputSize;
      if (managed.output.length > this.maxBufferChars) {
        const drop = managed.output.length - this.maxBufferChars;
        managed.output = managed.output.slice(drop);
        managed.baseCursor += drop;
      }
      this.emit(managed);
    };
    child.stdout?.on("data", (chunk: Buffer) => append("", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("[stderr] ", chunk));
    child.once("error", (error) => {
      append(
        "[error] ",
        Buffer.from(error instanceof Error ? error.message : String(error)),
      );
      managed.snapshot.state = "failed";
      managed.snapshot.endedAt = new Date().toISOString();
      this.emit(managed);
      this.pruneCompletedHistory();
    });
    child.once("close", (exitCode) => {
      managed.snapshot.exitCode = exitCode;
      managed.snapshot.state =
        managed.snapshot.state === "stopped"
          ? "stopped"
          : exitCode === 0
            ? "exited"
            : "failed";
      managed.snapshot.endedAt = new Date().toISOString();
      this.emit(managed);
    });
    this.emit(managed);
    return this.cloneSnapshot(snapshot);
  }

  private emit(managed: ManagedProcess): void {
    const snapshot = this.cloneSnapshot(managed.snapshot);
    for (const listener of managed.listeners) listener(snapshot);
    for (const listener of this.globalListeners) listener(snapshot);
  }

  private cloneSnapshot(snapshot: ProcessSnapshot): ProcessSnapshot {
    return { ...snapshot };
  }

  public output(
    processId: string,
    cursor = 0,
    maxChars = 20_000,
    outputMode: "raw" | "smart" = "raw",
  ): ProcessOutput {
    const managed = this.processes.get(processId);
    if (!managed) throw new Error(`PROCESS_NOT_FOUND: ${processId}`);
    maxChars = Math.max(1, Math.min(Math.floor(maxChars), 100_000));
    const actualCursor = Math.max(cursor, managed.baseCursor);
    const offset = Math.max(0, actualCursor - managed.baseCursor);
    const rawText = managed.output.slice(offset, offset + maxChars);
    const reduced =
      outputMode === "smart"
        ? reduceOutput(rawText, maxChars, outputMode, rawText.length)
        : {
            text: rawText,
            truncated: false,
            omittedChars: 0,
            omittedLines: 0,
          };
    const nextCursor = actualCursor + rawText.length;
    return {
      processId,
      text: reduced.text,
      cursor,
      nextCursor,
      truncated:
        cursor < managed.baseCursor ||
        offset + rawText.length < managed.output.length ||
        reduced.truncated,
      state: managed.snapshot.state,
      reductionMode: outputMode,
      omittedChars: reduced.omittedChars,
      omittedLines: reduced.omittedLines,
    };
  }

  public async stdin(processId: string, text: string): Promise<void> {
    const managed = this.processes.get(processId);
    if (
      !managed ||
      managed.snapshot.state !== "running" ||
      !managed.child.stdin
    )
      throw new Error(`PROCESS_NOT_RUNNING: ${processId}`);
    await new Promise<void>((resolve, reject) => {
      managed.child.stdin?.write(text, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  public async stop(processId: string): Promise<ProcessSnapshot> {
    const managed = this.processes.get(processId);
    if (!managed) throw new Error(`PROCESS_NOT_FOUND: ${processId}`);
    await this.stopChild(managed.child);
    managed.snapshot.state = "stopped";
    managed.snapshot.endedAt ??= new Date().toISOString();
    this.emit(managed);
    return this.cloneSnapshot(managed.snapshot);
  }

  public async killTree(processId: string): Promise<ProcessSnapshot> {
    return this.stop(processId);
  }

  private async stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return;
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      });
    } else if (!child.killed) {
      child.kill("SIGTERM");
    }
    await waitForChildClose(child, 1_000);
  }

  private pruneCompletedHistory(limit = this.maxTrackedProcesses): void {
    const bounded = Math.max(1, Math.floor(limit));
    if (this.processes.size <= bounded) return;
    for (const [id, managed] of this.processes) {
      if (this.processes.size <= bounded) break;
      if (managed.snapshot.state === "running") continue;
      this.processes.delete(id);
    }
  }

  public list(): ProcessSnapshot[] {
    return [...this.processes.values()].map((entry) =>
      this.cloneSnapshot(entry.snapshot),
    );
  }

  public subscribe(
    processId: string,
    listener: (snapshot: ProcessSnapshot) => void,
  ): () => void {
    const managed = this.processes.get(processId);
    if (!managed) throw new Error(`PROCESS_NOT_FOUND: ${processId}`);
    managed.listeners.add(listener);
    return () => managed.listeners.delete(listener);
  }

  public subscribeAll(
    listener: (snapshot: ProcessSnapshot) => void,
  ): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  public snapshot(processId: string): ProcessSnapshot {
    const managed = this.processes.get(processId);
    if (!managed) throw new Error(`PROCESS_NOT_FOUND: ${processId}`);
    return this.cloneSnapshot(managed.snapshot);
  }

  public async waitForExit(
    processId: string,
    timeoutMs = 120_000,
  ): Promise<ProcessSnapshot> {
    const current = this.snapshot(processId);
    if (current.state !== "running") return current;
    timeoutMs = Math.max(100, Math.min(Math.floor(timeoutMs), 600_000));
    return new Promise<ProcessSnapshot>((resolve, reject) => {
      let unsubscribe: () => void = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            `PROCESS_WAIT_TIMEOUT: ${processId} did not exit within ${timeoutMs} ms`,
          ),
        );
      }, timeoutMs);
      unsubscribe = this.subscribe(processId, (snapshot) => {
        if (snapshot.state === "running") return;
        clearTimeout(timer);
        unsubscribe();
        resolve(snapshot);
      });
    });
  }

  public async waitForOutput(input: {
    processId: string;
    pattern: string;
    cursor?: number;
    timeoutMs?: number;
    caseSensitive?: boolean;
  }): Promise<ProcessOutput & { matched: string }> {
    const pattern = input.pattern;
    if (!pattern) throw new Error("INVALID_INPUT: pattern is required");
    if (pattern.length > 5_000)
      throw new Error(
        "INVALID_INPUT: pattern must be 5000 characters or fewer",
      );
    const timeoutMs = Math.max(
      100,
      Math.min(Math.floor(input.timeoutMs ?? 60_000), 600_000),
    );
    let cursor = Math.max(0, input.cursor ?? 0);
    const match = (): (ProcessOutput & { matched: string }) | null => {
      const output = this.output(input.processId, cursor, 100_000, "raw");
      const haystack = input.caseSensitive
        ? output.text
        : output.text.toLowerCase();
      const needle = input.caseSensitive ? pattern : pattern.toLowerCase();
      const index = haystack.indexOf(needle);
      if (index >= 0)
        return {
          ...output,
          matched: output.text.slice(index, index + pattern.length),
        };
      cursor = output.nextCursor;
      return null;
    };
    const immediate = match();
    if (immediate) return immediate;
    return new Promise((resolve, reject) => {
      let unsubscribe: () => void = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            `PROCESS_WAIT_TIMEOUT: output pattern was not observed within ${timeoutMs} ms`,
          ),
        );
      }, timeoutMs);
      unsubscribe = this.subscribe(input.processId, (snapshot) => {
        try {
          const found = match();
          if (found) {
            clearTimeout(timer);
            unsubscribe();
            resolve(found);
          } else if (snapshot.state !== "running") {
            clearTimeout(timer);
            unsubscribe();
            reject(
              new Error(
                `PROCESS_EXITED_BEFORE_MATCH: ${input.processId} exited before '${pattern}' appeared`,
              ),
            );
          }
        } catch (error) {
          clearTimeout(timer);
          unsubscribe();
          reject(error);
        }
      });
    });
  }

  public async waitForPort(input: {
    host?: string;
    port: number;
    timeoutMs?: number;
    intervalMs?: number;
  }): Promise<{ host: string; port: number; elapsedMs: number }> {
    const host = input.host?.trim() || "127.0.0.1";
    const port = Math.floor(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error("INVALID_INPUT: port must be an integer from 1 to 65535");
    const timeoutMs = Math.max(
      100,
      Math.min(Math.floor(input.timeoutMs ?? 60_000), 600_000),
    );
    const intervalMs = Math.max(
      50,
      Math.min(Math.floor(input.intervalMs ?? 200), 5_000),
    );
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      if (await canConnect(host, port))
        return { host, port, elapsedMs: Date.now() - startedAt };
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `PORT_WAIT_TIMEOUT: ${host}:${port} did not accept connections within ${timeoutMs} ms`,
    );
  }

  public async stopAll(): Promise<void> {
    await Promise.all(
      [...this.processes.keys()]
        .filter((id) => this.processes.get(id)?.snapshot.state === "running")
        .map((id) => this.stop(id)),
    );
    await shutdownPowerShellWorkers();
  }
}

class OutputCollector {
  private readonly maxStoredChars = 2_000_000;
  private stored = "";
  public totalChars = 0;

  public append(chunk: Buffer): void {
    const value = chunk.toString("utf8");
    this.totalChars += value.length;
    this.stored += value;
    if (this.stored.length > this.maxStoredChars) {
      const half = Math.floor(this.maxStoredChars / 2);
      this.stored = `${this.stored.slice(0, half)}\n[...collector omitted... ]\n${this.stored.slice(-half)}`;
    }
  }

  public value(): string {
    return this.stored;
  }
}

interface ReducedOutput {
  text: string;
  truncated: boolean;
  omittedChars: number;
  omittedLines: number;
}

function reduceOutput(
  value: string,
  maxChars: number,
  mode: "raw" | "smart",
  originalSize: number,
): ReducedOutput {
  if (value.length <= maxChars)
    return { text: value, truncated: false, omittedChars: 0, omittedLines: 0 };
  if (mode === "raw") {
    const text = value.slice(0, maxChars);
    return {
      text,
      truncated: true,
      omittedChars: Math.max(0, originalSize - text.length),
      omittedLines: Math.max(
        0,
        value.slice(text.length).split(/\r?\n/).length - 1,
      ),
    };
  }
  const normalized = value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  const lines = normalized.split(/\r?\n/);
  const diagnosticIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      /\b(error|failed|failure|exception|traceback|fatal|panic|warning)\b|\bat\s+[^\s]+\([^)]*:\d+[:)]/i.test(
        line,
      ),
    )
    .flatMap(({ index }) => [index - 1, index, index + 1])
    .filter(
      (index, position, indexes) =>
        index >= 0 &&
        index < lines.length &&
        indexes.indexOf(index) === position,
    );
  const diagnostic = diagnosticIndexes.map((index) => lines[index]!).join("\n");
  const diagnosticSection = diagnostic
    ? `\n[diagnostics]\n${diagnostic.slice(0, Math.floor(maxChars * 0.4))}`
    : "";
  const omittedMarker = `\n[… ${Math.max(0, originalSize - maxChars)} chars omitted …]\n`;
  const budget = Math.max(
    0,
    maxChars - diagnosticSection.length - omittedMarker.length,
  );
  const headChars = Math.floor(budget * 0.45);
  const tailChars = budget - headChars;
  const head = normalized.slice(0, headChars);
  const tail = tailChars > 0 ? normalized.slice(-tailChars) : "";
  const sections = [
    head,
    diagnosticSection && !head.includes(diagnosticSection)
      ? diagnosticSection
      : "",
    omittedMarker,
    tail,
  ].filter(Boolean);
  const text = sections.join("").slice(0, maxChars);
  return {
    text,
    truncated: true,
    omittedChars: Math.max(0, originalSize - text.length),
    omittedLines: Math.max(0, lines.length - text.split(/\r?\n/).length),
  };
}

function finalizeRunResult(input: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  maxChars: number;
  outputMode: "raw" | "smart";
}): RunResult {
  const stdout = reduceOutput(
    input.stdout,
    input.maxChars,
    input.outputMode,
    input.stdout.length,
  );
  const stderr = reduceOutput(
    input.stderr,
    input.maxChars,
    input.outputMode,
    input.stderr.length,
  );
  const hash = createHash("sha256");
  if (input.stdout) {
    hash.update("stdout\u0000");
    hash.update(input.stdout);
  }
  if (input.stderr) {
    hash.update("stderr\u0000");
    hash.update(input.stderr);
  }
  return {
    exitCode: input.exitCode,
    signal: input.signal,
    stdout: stdout.text,
    stderr: stderr.text,
    durationMs: input.durationMs,
    truncated: stdout.truncated || stderr.truncated,
    omittedChars: stdout.omittedChars + stderr.omittedChars,
    omittedLines: stdout.omittedLines + stderr.omittedLines,
    originalSize: { stdout: input.stdout.length, stderr: input.stderr.length },
    sha256: hash.digest("hex"),
    reductionMode: input.outputMode,
  };
}

function waitForChildClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("close", finish);
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

const executableLookupCache = new Map<string, string | null>();
let cachedPowerShellExecutable: string | undefined;

function smartDirectCommand(
  command: string,
): { file: string; args: string[] } | null {
  if (process.platform !== "win32") return null;
  if (process.env.QNECTOR_SMART_DIRECT === "0") return null;
  const trimmed = command.trim();
  if (!trimmed || /[\r\n|><;&`$(){}\[\]*?]/.test(trimmed)) return null;
  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) return null;
  const requested = tokens[0]!;
  const base = path
    .basename(requested)
    .toLowerCase()
    .replace(/\.exe$/i, "");
  const directExecutables = new Set([
    "git",
    "node",
    "python",
    "python3",
    "py",
    "rg",
    "where",
    "dotnet",
    "curl",
    "winget",
    "tasklist",
    "taskkill",
    "ipconfig",
    "ping",
    "nslookup",
    "netstat",
    "whoami",
    "hostname",
    "ssh",
    "scp",
    "tar",
  ]);
  const commandShims = new Set([
    "npm",
    "npx",
    "pnpm",
    "corepack",
    "tsc",
    "vite",
    "vitest",
    "eslint",
    "prettier",
  ]);
  if (!directExecutables.has(base) && !commandShims.has(base)) return null;
  const executable = resolveNativeExecutable(requested, commandShims.has(base));
  if (!executable) return null;
  if (/\.(?:cmd|bat)$/i.test(executable)) {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", trimmed] };
  }
  if (!/\.(?:exe|com)$/i.test(executable)) return null;
  return { file: executable, args: tokens.slice(1) };
}

function resolveNativeExecutable(
  command: string,
  allowCommandShim = false,
): string | null {
  const key = `${command.toLowerCase()}\u0000${allowCommandShim ? "shim" : "native"}`;
  if (executableLookupCache.has(key))
    return executableLookupCache.get(key) ?? null;
  let resolved: string | null = null;
  try {
    if (path.isAbsolute(command)) {
      resolved = existsSync(command) ? command : null;
    } else {
      const lookup = spawnSync("where.exe", [command], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (lookup.status === 0) {
        resolved =
          String(lookup.stdout ?? "")
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .find((entry) =>
              allowCommandShim
                ? /\.(?:exe|com|cmd|bat)$/i.test(entry)
                : /\.(?:exe|com)$/i.test(entry),
            ) ?? null;
      }
    }
  } catch {
    resolved = null;
  }
  executableLookupCache.set(key, resolved);
  return resolved;
}

function tokenizeCommand(command: string): string[] {
  const tokens = command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? [];
  return tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1).replace(/\\([\\"'])/g, "$1");
    }
    return token;
  });
}

function powershellExecutable(): string {
  if (cachedPowerShellExecutable) return cachedPowerShellExecutable;
  const requested = process.env.QNECTOR_POWERSHELL_PATH;
  if (requested && executableOnPath(requested))
    return (cachedPowerShellExecutable = requested);
  if (process.platform !== "win32")
    return (cachedPowerShellExecutable = requested ?? "pwsh");
  return (cachedPowerShellExecutable = executableOnPath("pwsh.exe")
    ? "pwsh.exe"
    : "powershell.exe");
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
