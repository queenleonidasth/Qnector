import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../packages/core/src/config.js";
import { QnectorRuntime } from "../packages/mcp-server/src/server.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const root = await mkdtemp(path.join(os.tmpdir(), "qnector-p1-p10-"));
const helperPath = path.join(
  projectRoot,
  "tools",
  "uia-helper",
  "publish",
  "qnector-uia.exe",
);
if (!existsSync(helperPath))
  throw new Error(`UIA helper missing: ${helperPath}`);
process.env.QNECTOR_UIA_HELPER_PATH = helperPath;

await writeFile(
  path.join(root, "sample.ts"),
  [
    "export class AlphaService {",
    "  inventoryExport() { return 'stock export branch inventory'; }",
    "}",
    "export const alpha = new AlphaService();",
    "",
  ].join("\n"),
  "utf8",
);
await writeFile(
  path.join(root, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["sample.ts"],
    },
    null,
    2,
  ),
  "utf8",
);
await writeFile(
  path.join(root, "sample.py"),
  [
    "class InventoryAgent:",
    "    def export_stock(self) -> str:",
    "        return 'inventory export'",
    "",
    "agent = InventoryAgent()",
    "",
  ].join("\n"),
  "utf8",
);
await writeFile(
  path.join(root, "notes.md"),
  "The inventory stock export workflow checks branch availability and product gifts.\n",
  "utf8",
);

const config = {
  ...defaultConfig(root),
  transport: { mode: "local-only" as const },
};
const runtime = new QnectorRuntime({ config });
const checks: Record<string, unknown> = {};
const webPort = await freePort();
const devtoolsPort = await freePort();
const localServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    "<!doctype html><title>Qnector Acceptance</title><main id='app'>P1-P10 acceptance</main>",
  );
});
await new Promise<void>((resolve) =>
  localServer.listen(webPort, "127.0.0.1", () => resolve()),
);

try {
  const build = await call("system", { action: "build_info" });
  checks.p1Build = build.data;
  const doctor = await call("system", { action: "doctor" });
  assert(doctor.ok, "system.doctor failed");
  checks.p1Doctor = doctor.summary;

  const portWait = await call("process", {
    action: "wait_for_port",
    host: "127.0.0.1",
    port: webPort,
    timeoutMs: 5_000,
  });
  assert(portWait.ok, "process.wait_for_port failed");

  const delayedFile = path.join(root, "delayed-export.txt");
  setTimeout(() => void writeFile(delayedFile, "ready\n", "utf8"), 250);
  const fileWait = await call("workspace", {
    action: "wait_for_file",
    path: root,
    pattern: "delayed-export.txt",
    timeoutMs: 5_000,
  });
  assert(fileWait.ok, "workspace.wait_for_file failed");

  const watch = await call("workspace", {
    action: "watch",
    path: root,
    pattern: "watch-*.txt",
  });
  const watchId = readString(watch.data, "watchId");
  await writeFile(path.join(root, "watch-event.txt"), "changed\n", "utf8");
  await delay(350);
  const events = await call("workspace", {
    action: "watch_events",
    watchId,
    cursor: 0,
  });
  assert(
    JSON.stringify(events.data).includes("watch-event.txt"),
    "filesystem watch did not capture event",
  );
  await call("workspace", { action: "unwatch", watchId });
  checks.p2Events = true;

  const task = await call("process", {
    action: "task_start",
    command: "Start-Sleep -Milliseconds 250; Write-Output QNECTOR_TASK_READY",
    shell: "powershell",
    timeoutMs: 10_000,
  });
  const taskId = readString(task.data, "taskId");
  const taskOutput = await call("process", {
    action: "wait_for_output",
    processId: taskId,
    pattern: "QNECTOR_TASK_READY",
    timeoutMs: 10_000,
  });
  assert(taskOutput.ok, "durable task output wait failed");
  const taskExit = await call("process", {
    action: "wait_for_exit",
    processId: taskId,
    timeoutMs: 10_000,
  });
  assert(taskExit.ok, "durable task exit wait failed");
  checks.p8Task = taskId;

  const browserLaunch = await call("browser", {
    action: "launch",
    browser: "chrome",
    port: devtoolsPort,
    url: `http://127.0.0.1:${webPort}/`,
  });
  assert(browserLaunch.ok, "managed browser launch failed");
  await delay(600);
  const targets = await call("browser", {
    action: "targets",
    port: devtoolsPort,
  });
  assert(
    JSON.stringify(targets.data).includes(`127.0.0.1:${webPort}`),
    "managed browser localhost target missing",
  );
  const evaluated = await call("browser", {
    action: "evaluate",
    port: devtoolsPort,
    expression: "document.querySelector('#app')?.textContent",
  });
  assert(
    JSON.stringify(evaluated.data).includes("P1-P10 acceptance"),
    "browser evaluate failed",
  );
  const browserClose = await call("browser", { action: "close" });
  assert(browserClose.ok, "managed browser close failed");
  checks.p3Browser = true;

  const symbols = await call("workspace", {
    action: "workspace_symbols",
    path: root,
    query: "AlphaService",
    tsconfig: "tsconfig.json",
  });
  assert(
    JSON.stringify(symbols.data).includes("AlphaService"),
    "workspace_symbols failed",
  );
  checks.p5WorkspaceSymbols = true;

  const windows = await call("computer", { action: "windows", maxResults: 5 });
  assert(windows.ok, "C# UI Automation helper failed to enumerate windows");
  checks.p6UiaHelper = helperPath;

  const everythingStatus = await call("system", {
    action: "everything_status",
  });
  assert(
    JSON.stringify(everythingStatus.data).includes("everythingAvailable"),
    "Everything status failed",
  );
  const everythingSearch = await call("system", {
    action: "search_files",
    provider: "everything",
    query: "qnector",
    maxResults: 3,
    details: false,
  });
  assert(everythingSearch.ok, "bundled Everything CLI indexed search failed");
  checks.p7Everything = everythingSearch.summary;

  const lspStatus = await call("workspace", { action: "lsp_status" });
  assert(
    JSON.stringify(lspStatus.data).includes("pyright-langserver"),
    "Pyright language server was not detected",
  );
  const lspSymbols = await call("workspace", {
    action: "lsp_document_symbols",
    path: "sample.py",
    maxResults: 20,
  });
  assert(
    JSON.stringify(lspSymbols.data).includes("InventoryAgent"),
    "generic LSP document symbols failed",
  );
  checks.p9GenericLsp = true;

  const semantic = await call("workspace", {
    action: "semantic_search",
    path: root,
    query: "branch inventory stock export gifts",
    maxResults: 5,
  });
  assert(
    JSON.stringify(semantic.data).includes("notes.md"),
    "semantic search did not rank the acceptance document",
  );
  checks.p10Semantic = true;

  checks.p4McpV2 =
    "covered by server.test.ts modern 2026-07-28 pin + legacy stateless test";
  console.log(JSON.stringify({ ok: true, root, checks }, null, 2));
} finally {
  await runtime.stop().catch(() => undefined);
  await new Promise<void>((resolve) => localServer.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}

async function call(tool: string, input: Record<string, unknown>) {
  const result = await runtime.registry.call(tool, runtime.context(), input);
  if (!result.ok)
    throw new Error(
      `${tool}.${String(input.action)} failed: ${result.error?.code}: ${result.error?.message}`,
    );
  return result;
}

function readString(value: unknown, key: string): string {
  const nested = (value as { data?: Record<string, unknown> } | undefined)
    ?.data;
  const direct = value as Record<string, unknown> | undefined;
  const found = nested?.[key] ?? direct?.[key];
  if (typeof found !== "string" || !found)
    throw new Error(`Missing string '${key}' in acceptance result`);
  return found;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
