import { createRuntime } from "./server.js";

const runtime = await createRuntime({
  workspace: process.env.QNECTOR_WORKSPACE,
  port: process.env.QNECTOR_PORT ? Number(process.env.QNECTOR_PORT) : undefined,
});

if (runtime.status().state !== "connected") await runtime.start();
console.log(`Qnector MCP listening at ${runtime.status().localUrl}`);
console.log(`Workspace: ${runtime.status().activeWorkspace}`);

const shutdown = async (): Promise<void> => {
  await runtime.stop();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
