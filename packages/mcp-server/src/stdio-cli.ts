import path from "node:path";
import { installStdioLogGuard } from "./stdio-log-guard.js";

// Do not import the full runtime before redirecting console diagnostics: ESM
// static dependencies execute before main() and may otherwise pollute stdout.
installStdioLogGuard();

/** Opt-in local stdio frontend. Never starts a daemon, changes the default
 * HTTP/tunnel route or logs protocol diagnostics to stdout. */
async function main(): Promise<void> {
  const [{daemonRequest}, {createRuntime}] = await Promise.all([
    import("@qnector/daemon/client"), import("./server.js"),
  ]);
  const preview = process.env.QNECTOR_DURABLE_PREVIEW === "1";
  const rootValue = process.env.QNECTOR_DURABLE_ROOT;
  if (preview && !rootValue) throw new Error("DURABLE_STDIO_ROOT_REQUIRED");
  const root = preview ? path.resolve(rootValue!) : undefined;
  if (root) {
    const ping = await daemonRequest(root, { action: "ping" }, 3_000);
    const info = ping.data as { state?: string; protocol?: number; jobHostEnabled?: boolean } | undefined;
    if (!ping.ok || info?.state !== "ready" || info.protocol !== 1)
      throw new Error("DURABLE_STDIO_DAEMON_NOT_READY");
    if (process.platform === "win32" && !info.jobHostEnabled)
      throw new Error("DURABLE_STDIO_JOB_HOST_REQUIRED");
  }
  const runtime = await createRuntime({
    workspace: process.env.QNECTOR_WORKSPACE,
    configFile: process.env.QNECTOR_CONFIG_FILE,
    durableDaemonRoot: root,
  });
  try {
    await runtime.startStdio();
  } catch (error) {
    await runtime.stop();
    throw error;
  }
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  process.stdin.once("end", () => void stop());
}

void main().catch(error => {
  console.error("Qnector stdio startup failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
