import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { daemonRequest } from "@qnector/daemon/client";

/** Only used when QNECTOR_DURABLE_PREVIEW=1; never replaces legacy tools. */
export async function ensurePreviewDaemon(
  root: string,
  bundleDirectory: string,
  executable: string,
): Promise<string> {
  const daemonFile = path.join(bundleDirectory, "daemon.mjs");
  const workerFile = path.join(bundleDirectory, "worker-main.js");
  const hostFile = path.join(bundleDirectory, "qnector-job-host.exe");
  if (![daemonFile, workerFile, hostFile].every(file => existsSync(file)))
    throw new Error("DURABLE_PREVIEW_PACKAGE_INCOMPLETE");
  const ping = async (): Promise<boolean> => {
    try {
      const response = await daemonRequest(root, {action: "ping"}, 800);
      const data = response.data as {state?: string; protocol?: number; jobHostEnabled?: boolean} | undefined;
      if (!response.ok || data?.state !== "ready") return false;
      if (data.protocol !== 1) throw new Error("DURABLE_DAEMON_PROTOCOL_MISMATCH");
      if (!data.jobHostEnabled) throw new Error("DURABLE_DAEMON_JOB_HOST_REQUIRED");
      return true;
    } catch (error) {
      if (error instanceof Error && ["DURABLE_DAEMON_PROTOCOL_MISMATCH", "DURABLE_DAEMON_JOB_HOST_REQUIRED"].includes(error.message)) throw error;
      return false;
    }
  };
  // Check before spawning: another Desktop or a previous session may own the daemon.
  if (await ping()) return root;
  const child = spawn(executable, [daemonFile], {
    cwd: bundleDirectory,
    env: {...process.env, ELECTRON_RUN_AS_NODE: "1", QNECTOR_DURABLE_ROOT: root,
      QNECTOR_JOB_HOST_PATH: hostFile},
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  // An invalid executable can emit an asynchronous spawn error. Handle it so
  // the GUI falls back to legacy tools rather than crashing the Electron main process.
  let spawnError: Error | undefined;
  child.on("error", error => { spawnError = error; });
  // A browser/desktop exit must NOT own already accepted durable work.
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < 10_000) {
      // A competing instance may win the pipe bind; use its ready daemon if
      // the protocol matches rather than launching a second scheduler.
      if (await ping()) { child.unref(); return root; }
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`DURABLE_DAEMON_EXITED_${child.exitCode ?? child.signalCode}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("DURABLE_DAEMON_BOOT_TIMED_OUT");
  } catch (error) {
    // Stop only the process this caller created; NEVER terminate an existing daemon.
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
    child.unref();
    throw error;
  }
}

/** Opt-in liveness supervision. Checking/restarting uses the same OS singleton
 * pipe as startup and never owns or cancels jobs. Stop only cancels our timer. */
export function watchPreviewDaemon(
  root: string,
  bundleDirectory: string,
  executable: string,
  options: {intervalMs?: number; onError?: (error: Error) => void;
    ensure?: () => Promise<string>} = {},
): () => void {
  let stopped = false;
  let checking = false;
  let lastError = "";
  const check = async (): Promise<void> => {
    if (stopped || checking) return;
    checking = true;
    try {
      await (options.ensure?.() ?? ensurePreviewDaemon(root, bundleDirectory, executable));
      lastError = "";
    } catch (error) {
      const actual = error instanceof Error ? error : new Error(String(error));
      if (!stopped && actual.message !== lastError) options.onError?.(actual);
      lastError = actual.message;
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), Math.max(50, options.intervalMs ?? 5_000));
  timer.unref();
  return () => {stopped = true; clearInterval(timer);};
}
