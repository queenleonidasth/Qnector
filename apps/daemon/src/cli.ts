import os from "node:os";
import path from "node:path";
import { DurableDaemon } from "./server.js";

// Explicit opt-in: not invoked from Electron or the installed MCP runtime.
const root = process.env.QNECTOR_DURABLE_ROOT ?? path.join(
  process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
  "Qnector", "durable-preview",
);
const daemon = new DurableDaemon(root, {jobHostPath: process.env.QNECTOR_JOB_HOST_PATH});
await daemon.start();
console.log(`QNECTOR_DURABLE_READY ${daemon.socketPath}`);
const stop = (): void => { void daemon.close().then(() => { process.exitCode = 0; }); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
