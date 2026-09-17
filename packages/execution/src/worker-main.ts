import { spawn, spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { OutputSpool } from "./output-spool.js";

export type WorkerCommand =
  | { kind: "direct"; file: string; args: string[] }
  | { kind: "shell"; shell: "powershell" | "cmd"; command: string };

export interface WorkerBootstrap {
  attemptId: string;
  spoolRoot: string;
  cwd: string;
  timeoutMs: number;
  command: WorkerCommand;
  maxOutputBytes: number;
}

function validate(value: WorkerBootstrap): WorkerBootstrap {
  if (!/^attempt_[a-f0-9-]{36}$/.test(value.attemptId) ||
      typeof value.spoolRoot !== "string" || !value.spoolRoot ||
      typeof value.cwd !== "string" || !value.cwd ||
      !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3_600_000 ||
      !Number.isSafeInteger(value.maxOutputBytes) || value.maxOutputBytes < 0 ||
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

  await new Promise<void>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 128) { cleanup(); reject(new Error("WORKER_HANDSHAKE_INVALID")); return; }
      if (!buffer.includes("\n")) return;
      cleanup();
      if (buffer === `GO ${bootstrap.attemptId}\n`) resolve();
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

  const command = bootstrap.command;
  const executable = command.kind === "direct" ? command.file :
    command.shell === "cmd" ? (process.platform === "win32" ? "cmd.exe" : "/bin/sh") :
    (process.platform === "win32" ? "powershell.exe" : "pwsh");
  const args = command.kind === "direct" ? command.args :
    command.shell === "cmd" ? (process.platform === "win32" ? ["/d", "/s", "/c", command.command] : ["-c", command.command]) :
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command.command];
  const child = spawn(executable, args, {
    cwd: bootstrap.cwd, windowsHide: true, detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let outputFailure: unknown;
  let timedOut = false;
  const collect = (stream: "stdout" | "stderr", chunk: Buffer): void => {
    if (outputFailure) return;
    try { spool.append(stream, chunk); } catch (error) { outputFailure = error; }
    // Keep draining both pipes even if disk writes fail or quota is exceeded.
  };
  child.stdout?.on("data", chunk => collect("stdout", chunk as Buffer));
  child.stderr?.on("data", chunk => collect("stderr", chunk as Buffer));
  const stopTree = (): void => {
    if (child.pid === undefined) return;
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* exited */ } }
    }
  };
  const timeout = setTimeout(() => { timedOut = true; stopTree(); }, bootstrap.timeoutMs);
  const exit = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve) => {
    child.once("error", () => { /* close follows; no replay on spawn error */ });
    child.once("close", (code, signal) => resolve({code, signal}));
  });
  clearTimeout(timeout);
  if (outputFailure) throw new Error("OUTPUT_PERSISTENCE_FAILED: cannot attest to complete output");
  spool.finalize(timedOut ? null : exit.code, timedOut ? "SIGTERM" : exit.signal);
  // The manifest is the durable completion signal; the daemon imports it after reconnect.
}

void main().catch(() => { process.exitCode = 1; });
