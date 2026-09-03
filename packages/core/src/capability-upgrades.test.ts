import { createServer } from "node:net";
import {
  appendFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import ts from "typescript";
import {
  FileWatchService,
  LocalSemanticSearchService,
  ManagedBrowserRuntime,
  ProcessManager,
  TypeScriptCodeIntelligence,
} from "./index.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe("P1-P10 capability upgrades", () => {
  test("waits for a TCP port without chat polling", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server has no TCP address");
    const manager = new ProcessManager("direct");
    const result = await manager.waitForPort({
      host: "127.0.0.1",
      port: address.port,
      timeoutMs: 2_000,
    });
    expect(result.port).toBe(address.port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("does not reuse an occupied managed-browser DevTools port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server has no TCP address");
    const runtime = new ManagedBrowserRuntime();
    try {
      await expect(runtime.launch({ port: address.port })).rejects.toThrow(
        "BROWSER_RUNTIME_PORT_IN_USE",
      );
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("waits for a timed-out child process to terminate before returning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qnector-timeout-test-"));
    cleanup.push(root);
    const script = path.join(root, "hang.mjs");
    const pidFile = path.join(root, "pid.txt");
    await writeFile(
      script,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
      "utf8",
    );
    const shell = "direct";
    const command = `"${process.execPath}" "${script}"`;
    const manager = new ProcessManager(shell);
    const result = await manager.run({
      command,
      cwd: root,
      shell,
      timeoutMs: 250,
      outputMode: "raw",
    });
    expect(result.exitCode).toBeNull();
    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(Number.isInteger(childPid)).toBe(true);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  test("bounds completed background-process history without pruning running work", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "qnector-process-history-"),
    );
    cleanup.push(root);
    const script = path.join(root, "exit.mjs");
    await writeFile(script, "process.exit(0);\n", "utf8");
    const manager = new ProcessManager("direct", 3);
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const snapshot = manager.start({
        command: `"${process.execPath}" "${script}"`,
        cwd: root,
        shell: "direct",
        timeoutMs: 5_000,
      });
      ids.push(snapshot.id);
      await manager.waitForExit(snapshot.id, 5_000);
    }
    expect(manager.list()).toHaveLength(3);
    expect(manager.list().map((entry) => entry.id)).toContain(ids.at(-1));
    expect(manager.list().map((entry) => entry.id)).not.toContain(ids[0]);
  });

  test("waits for a matching exported file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qnector-watch-test-"));
    cleanup.push(root);
    const service = new FileWatchService();
    setTimeout(() => {
      void writeFile(path.join(root, "stock-export.xlsx"), "fixture", "utf8");
    }, 80);
    const result = await service.waitForFile({
      root,
      pattern: "*.xlsx",
      timeoutMs: 3_000,
      intervalMs: 40,
    });
    expect(result.matches.map((entry) => path.basename(entry))).toContain(
      "stock-export.xlsx",
    );
    service.stopAll();
  });

  test("retrieves relevant local chunks with the model-free vector index", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "qnector-semantic-test-"),
    );
    cleanup.push(root);
    await writeFile(
      path.join(root, "stock-workflow.md"),
      "The stock export workflow writes an XLSX spreadsheet after the Export button is invoked.\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "unrelated.md"),
      "This document only describes image wallpapers and colors.\n",
      "utf8",
    );
    const service = new LocalSemanticSearchService();
    const result = await service.search({
      workspaceRoot: root,
      query: "stock export spreadsheet",
      maxResults: 5,
    });
    expect(result.engine).toBe("local-hashed-vector-v1");
    expect(result.matches[0]?.file).toContain("stock-workflow.md");
  });

  test("uses an explicit packaged TypeScript standard-library directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qnector-tslib-test-"));
    cleanup.push(root);
    const project = path.join(root, "project");
    const runtimeLib = path.join(root, "typescript-lib");
    await mkdir(path.join(project, "src"), { recursive: true });
    const defaultLib = path.dirname(
      ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }),
    );
    await cp(defaultLib, runtimeLib, {
      recursive: true,
      filter: (source) => source === defaultLib || source.endsWith(".d.ts"),
    });
    await appendFile(
      path.join(runtimeLib, "lib.es2022.d.ts"),
      "\ndeclare const QNECTOR_PACKAGED_LIB_SENTINEL: number;\n",
      "utf8",
    );
    await writeFile(
      path.join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          lib: ["ES2022"],
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      "utf8",
    );
    await writeFile(
      path.join(project, "src", "sentinel.ts"),
      "export const sentinel = QNECTOR_PACKAGED_LIB_SENTINEL;\n",
      "utf8",
    );
    const previous = process.env.QNECTOR_TYPESCRIPT_LIB_PATH;
    process.env.QNECTOR_TYPESCRIPT_LIB_PATH = runtimeLib;
    try {
      const service = new TypeScriptCodeIntelligence();
      const result = await service.diagnostics({
        workspaceRoot: project,
        path: ".",
        maxResults: 20,
      });
      expect(result.total).toBe(0);
    } finally {
      if (previous === undefined)
        delete process.env.QNECTOR_TYPESCRIPT_LIB_PATH;
      else process.env.QNECTOR_TYPESCRIPT_LIB_PATH = previous;
    }
  });

  test("searches TypeScript symbols across a project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qnector-symbol-test-"));
    cleanup.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022" },
        include: ["src/**/*.ts"],
      }),
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "service.ts"),
      "export interface StockExportService { exportStock(): Promise<void>; }\nexport class DefaultStockExportService implements StockExportService { async exportStock() {} }\n",
      "utf8",
    );
    const service = new TypeScriptCodeIntelligence();
    const result = await service.workspaceSymbols({
      workspaceRoot: root,
      query: "StockExport",
      maxResults: 20,
    });
    expect(
      result.symbols.some((entry) => entry.name === "StockExportService"),
    ).toBe(true);
    expect(
      result.symbols.some(
        (entry) => entry.name === "DefaultStockExportService",
      ),
    ).toBe(true);
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
