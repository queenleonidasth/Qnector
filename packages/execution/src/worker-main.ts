import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OutputSpool } from "./output-spool.js";
import { writeWorkerIdentity } from "./worker-identity.js";

export type WorkerCommand =
  | { kind: "direct"; file: string; args: string[] }
  | { kind: "shell"; shell: "powershell" | "cmd"; command: string };

export interface WorkerBootstrap {
  attemptId: string;
  generation: number;
  token: string;
  spoolRoot: string;
  cwd: string;
  timeoutMs: number;
  command: WorkerCommand;
  maxOutputBytes: number;
  jobHostPath?: string;
}

function validate(value: WorkerBootstrap): WorkerBootstrap {
  if (!/^attempt_[a-f0-9-]{36}$/.test(value.attemptId) ||
      !Number.isSafeInteger(value.generation) || value.generation < 1 ||
      typeof value.token !== "string" || !/^[a-f0-9-]{36}$/.test(value.token) ||
      typeof value.spoolRoot !== "string" || !value.spoolRoot ||
      typeof value.cwd !== "string" || !value.cwd ||
      !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3_600_000 ||
      !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes < 0 ||
      (value.jobHostPath !== undefined && (process.platform !== "win32" || typeof value.jobHostPath !== "string" || !value.jobHostPath)) ||
      !value.command || !["direct", "shell"].includes(value.command.kind)) {
    throw new Error("WORKER_BOOTSTRAP_INVALID");
  }
  if (value.command.kind === "direct") {
    if (!value.command.file || !Array.isArray(value.command.args) ||
        value.command.args.some(arg => typeof arg !== "string")) throw new Error("WORKER_COMMAND_INVALID");
  } else if (!value.command.command || !["powershell", "cmd"].includes(value.command.shell)) {
    throw new Error("WORKER_COMMAND_INVALID");
  }
  return value;
}

/** The daemon sends GO only after it commits markStarted. The worker never writes the DB. */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("WORKER_BOOTSTRAP_REQUIRED");
  const bootstrap = validate(JSON.parse(readFileSync(file, "utf8")) as WorkerBootstrap);
  unlinkSync(file);
  const spool = new OutputSpool(bootstrap.spoolRoot, bootstrap.attemptId, bootstrap.maxOutputBytes);
  process.stdout.write(`READY ${bootstrap.attemptId}\n`);

  const directive = await new Promise<"GO" | "CANCEL">((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 128) { cleanup(); reject(new Error("WORKER_HANDSHAKE_INVALID")); return; }
      if (!buffer.includes("\n")) return;
      cleanup();
      if (buffer === `GO ${bootstrap.attemptId}\n`) resolve("GO");
      else if (buffer === `CANCEL ${bootstrap.attemptId}\n`) resolve("CANCEL");
      else reject(new Error("WORKER_HANDSHAKE_INVALID"));
    };
    const onEnd = (): void => { cleanup(); reject(new Error("WORKER_HANDSHAKE_LOST")); };
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.resume();
  });

  if (directive === "CANCEL") {
    // The daemon has not sent GO; no command was spawned and no side effects occurred.
    // Persist cancellation evidence before this worker exits, without launching anything.
    spool.finalize(null, "SIGTERM", true);
    return;
  }

  // Persist a fenced worker identity before any external side effect. Missing
  // identity means the daemon must not guess that a PID belongs to this attempt.
  const identity = writeWorkerIdentity(bootstrap.spoolRoot, bootstrap);

  const command = bootstrap.command;
  const executable = command.kind === "direct" ? command.file :
    command.shell === "cmd" ? (process.platform === "win32" ? "cmd.exe" : "/bin/sh") :
    (process.platform === "win32" ? "powershell.exe" : "pwsh");
  const args = command.kind === "direct" ? command.args :
    command.shell === "cmd" ? (process.platform === "win32" ? ["/d", "/s", "/c", command.command] : ["-c", command.command]) :
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command.command];
  const cancelFile = path.join(bootstrap.spoolRoot, bootstrap.attemptId, "cancel.request");
  const statusFile = path.join(bootstrap.spoolRoot, bootstrap.attemptId, "job-host-status.json");
  const useJobHost = process.platform === "win32" && bootstrap.jobHostPath !== undefined;
  if (useJobHost && !existsSync(bootstrap.jobHostPath!)) throw new Error("JOB_HOST_MISSING");
  let launchExecutable = executable;
  let launchArgs = args;
  if (useJobHost) {
    const ticks = /^win:([0-9]+)$/.exec(identity.started)?.[1];
    if (!ticks) throw new Error("JOB_HOST_OWNER_IDENTITY_INVALID");
    const configPath = path.join(bootstrap.spoolRoot, bootstrap.attemptId, "job-host.json");
    writeFileSync(configPath, JSON.stringify({
      File: executable, Args: args, Cwd: bootstrap.cwd, StatusPath: statusFile,
      CancelPath: cancelFile, TimeoutMs: bootstrap.timeoutMs,
      OwnerPid: process.pid, OwnerStartTicks: ticks,
    }), {flag: "wx", mode: 0o600});
    launchExecutable = bootstrap.jobHostPath!;
    launchArgs = [configPath];
  }
  const child = spawn(launchExecutable, launchArgs, {
    cwd: bootstrap.cwd, windowsHide: true, detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let outputFailure: unknown;
  let timedOut = false;
  let cancelRequested = false;
  let cancelConfirmed = false;
  const collect = (stream: "stdout" | "stderr", chunk: Buffer): void => {
    if (outputFailure) return;
    try { spool.append(stream, chunk); } catch (error) { outputFailure = error; }
  };
  child.stdout?.on("data", chunk => collect("stdout", chunk as Buffer));
  child.stderr?.on("data", chunk => collect("stderr", chunk as Buffer));
  const stopTree = (): boolean => {
    if (child.pid === undefined) return false;
    if (process.platform === "win32") {
      const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true, timeout: 10_000});
      return result.status === 0 && !result.error;
    }
    try { process.kill(-child.pid, "SIGKILL"); return true; }
    catch { try { return child.kill("SIGKILL"); } catch { return false; } }
  };
  const cancelInterval = setInterval(() => {
    if (!existsSync(cancelFile)) return;
    cancelRequested = true;
    if (!useJobHost && !cancelConfirmed) cancelConfirmed = stopTree();
  }, 75);
  const timeout = useJobHost ? undefined : setTimeout(() => { timedOut = true; stopTree(); }, bootstrap.timeoutMs);
  const exit = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve) => {
    child.once("error", () => { /* close follows; no replay on spawn error */ });
    child.once("close", (code, signal) => resolve({code, signal}));
  });
  if (timeout) clearTimeout(timeout);
  clearInterval(cancelInterval);
  let exitCode = exit.code;
  if (useJobHost) {
    if (!existsSync(statusFile)) throw new Error("JOB_HOST_STATUS_MISSING");
    const status = JSON.parse(readFileSync(statusFile, "utf8")) as {Reason?: string; ExitCode?: number | null};
    cancelConfirmed = status.Reason === "canceled";
    timedOut = status.Reason === "timed_out";
    if (status.Reason === "worker_lost") throw new Error("JOB_HOST_REPORTED_WORKER_LOST");
    if (!["exited", "canceled", "timed_out"].includes(status.Reason ?? "")) throw new Error("JOB_HOST_STATUS_INVALID");
    exitCode = status.Reason === "exited" && Number.isInteger(status.ExitCode) ? status.ExitCode! : null;
  }
  if (outputFailure) throw new Error("OUTPUT_PERSISTENCE_FAILED: cannot attest to complete output");
  spool.finalize(cancelConfirmed ? null : timedOut ? null : exitCode,
    cancelConfirmed ? "SIGTERM" : timedOut ? "SIGTERM" : exit.signal, cancelConfirmed);
  // The manifest is the durable completion signal; the daemon imports it after reconnect.
}

void main().catch(() => { process.exitCode = 1; });
