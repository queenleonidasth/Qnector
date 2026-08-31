import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { describe, expect, it, afterEach } from "vitest";
import { ActivityLogger } from "../../core/src/activity-log.js";
import { TypeScriptCodeIntelligence } from "../../core/src/code-intelligence.js";
import { WindowsFileSearchService } from "../../core/src/file-search.js";
import { defaultConfig } from "../../core/src/config.js";
import { MemoryStore } from "../../core/src/memory-store.js";
import type { PlatformServices } from "../../core/src/platform-services.js";
import type {
  UiAutomationElement,
  UiAutomationService,
  UiAutomationWindow,
} from "../../core/src/ui-automation.js";
import { ProcessManager } from "../../core/src/process-manager.js";
import { WorkspaceState } from "../../core/src/workspace-state.js";
import { ToolRegistry, type ToolContext } from "./index.js";

describe("Qnector grouped tools", () => {
  let root: string | undefined;
  let browserServer: Server | undefined;
  let browserWebSocketServer: WebSocketServer | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
    await new Promise<void>((resolve) => {
      if (!browserWebSocketServer) return resolve();
      for (const client of browserWebSocketServer.clients) client.terminate();
      browserWebSocketServer.close(() => resolve());
      browserWebSocketServer = undefined;
    });
    await new Promise<void>((resolve) => {
      if (!browserServer) return resolve();
      browserServer.close(() => resolve());
      browserServer = undefined;
    });
  });

  it("advertises eight grouped tools and supports file mutations", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-tools-"));
    const config = defaultConfig(root);
    const context = makeContext(config);
    const registry = new ToolRegistry();
    expect(registry.list().map((entry) => entry.name)).toEqual([
      "system",
      "workspace",
      "files",
      "process",
      "git",
      "memory",
      "browser",
      "computer",
    ]);
    const write = await registry.call("files", context, {
      action: "write",
      path: "hello.txt",
      content: "old\n",
    });
    expect(write.ok).toBe(true);
    const replace = await registry.call("files", context, {
      action: "replace",
      path: "hello.txt",
      oldText: "old",
      newText: "new",
    });
    expect(replace.ok).toBe(true);
    const patch = await registry.call("files", context, {
      action: "apply_patch",
      patch: "*** Begin Patch\n*** Add File: added.txt\n+added\n*** End Patch",
    });
    expect(patch.ok).toBe(true);
    expect(await readFile(path.join(root, "hello.txt"), "utf8")).toBe("new\n");
    expect(await readFile(path.join(root, "added.txt"), "utf8")).toBe(
      "added\n",
    );
  });

  it("runs independent tool calls through one bounded parallel batch", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-parallel-"));
    await writeFile(path.join(root, "alpha.txt"), "alpha\n");
    await writeFile(path.join(root, "beta.txt"), "beta\n");
    const context = makeContext(defaultConfig(root));
    const result = await new ToolRegistry().call("system", context, {
      action: "parallel",
      maxConcurrency: 3,
      calls: [
        { id: "status", tool: "system", input: { action: "status" } },
        {
          id: "alpha",
          tool: "files",
          input: { action: "read", path: "alpha.txt" },
        },
        {
          id: "beta",
          tool: "files",
          input: { action: "read", path: "beta.txt" },
        },
      ],
    });
    expect(result.ok).toBe(true);
    const batch = (
      result.data as {
        data?: { results?: Array<{ id?: string; result: { ok: boolean } }> };
      }
    )?.data;
    expect(batch?.results?.map((entry) => entry.id)).toEqual([
      "status",
      "alpha",
      "beta",
    ]);
    expect(batch?.results?.every((entry) => entry.result.ok)).toBe(true);
    expect(JSON.stringify(result)).toContain('"maxConcurrency":3');
  });

  it("rejects recursive parallel fan-out", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-parallel-recursive-"));
    const context = makeContext(defaultConfig(root));
    const result = await new ToolRegistry().call("system", context, {
      action: "parallel",
      calls: [
        { tool: "system", input: { action: "status" } },
        {
          tool: "system",
          input: {
            action: "parallel",
            calls: [
              { tool: "system", input: { action: "status" } },
              { tool: "system", input: { action: "status" } },
            ],
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("preserves image attachments returned by parallel subcalls", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-parallel-image-"));
    const image = pngFixture(3, 2);
    await writeFile(path.join(root, "preview.png"), image);
    const result = await new ToolRegistry().call(
      "system",
      makeContext(defaultConfig(root)),
      {
        action: "parallel",
        calls: [
          { tool: "system", input: { action: "status" } },
          {
            tool: "files",
            input: { action: "preview", path: "preview.png" },
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments?.[0]).toMatchObject({
      mimeType: "image/png",
      width: 3,
      height: 2,
    });
    expect(JSON.stringify(result.data)).not.toContain(image.toString("base64"));
  });

  it("uses one-call batch reads and bounded workspace grep", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-fast-read-"));
    await writeFile(path.join(root, "alpha.txt"), "needle alpha\n");
    await writeFile(path.join(root, "beta.txt"), "needle beta\n");
    const context = makeContext(defaultConfig(root));
    const registry = new ToolRegistry();

    const batch = await registry.call("files", context, {
      action: "read_many",
      paths: ["alpha.txt", "beta.txt"],
      maxChars: 10_000,
    });
    expect(batch.ok).toBe(true);
    expect(JSON.stringify(batch.data)).toContain("needle alpha");
    expect(JSON.stringify(batch.data)).toContain("needle beta");

    const grep = await registry.call("workspace", context, {
      action: "grep",
      pattern: "needle",
      maxResults: 10,
    });
    expect(grep.ok).toBe(true);
    expect(JSON.stringify(grep.data)).toContain("alpha.txt");
    expect(JSON.stringify(grep.data)).toContain("beta.txt");
    expect(["ripgrep", "node"]).toContain(
      (grep.data as { data?: { provider?: string } }).data?.provider ?? "",
    );
  });

  it("paginates base64 reads so large binary files stay bounded", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-base64-page-"));
    await writeFile(
      path.join(root, "binary.bin"),
      Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    const result = await new ToolRegistry().call(
      "files",
      makeContext(defaultConfig(root)),
      { action: "read", path: "binary.bin", encoding: "base64", limitBytes: 4 },
    );
    expect(result.ok).toBe(true);
    const payload = (result.data as { data: Record<string, unknown> }).data;
    expect(payload.contentBase64).toBe(
      Buffer.from([0, 1, 2, 3]).toString("base64"),
    );
    expect(payload.bytes).toBe(4);
    expect(payload.totalBytes).toBe(10);
    expect(payload.nextOffsetBytes).toBe(4);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.nextCursor).toBe(4);

    const next = await new ToolRegistry().call(
      "files",
      makeContext(defaultConfig(root)),
      {
        action: "read",
        path: "binary.bin",
        encoding: "base64",
        offsetBytes: 8,
        limitBytes: 4,
      },
    );
    const nextPayload = (next.data as { data: Record<string, unknown> }).data;
    expect(nextPayload.contentBase64).toBe(
      Buffer.from([8, 9]).toString("base64"),
    );
    expect(nextPayload.bytes).toBe(2);
    expect(next.meta.truncated).toBe(false);
    expect(next.meta.nextCursor).toBeNull();
  });

  it("previews PNG, JPEG, and WEBP files as image attachments", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-preview-"));
    const context = makeContext(defaultConfig(root));
    const registry = new ToolRegistry();
    const fixtures = [
      {
        name: "ภาพทดสอบ.png",
        mimeType: "image/png",
        bytes: pngFixture(3, 2),
        width: 3,
        height: 2,
      },
      {
        name: "preview.jpg",
        mimeType: "image/jpeg",
        bytes: jpegFixture(7, 5),
        width: 7,
        height: 5,
      },
      {
        name: "preview.webp",
        mimeType: "image/webp",
        bytes: webpFixture(9, 6),
        width: 9,
        height: 6,
      },
    ];

    for (const fixture of fixtures) {
      await writeFile(path.join(root, fixture.name), fixture.bytes);
      const result = await registry.call("files", context, {
        action: "preview",
        path: fixture.name,
      });
      expect(result.ok).toBe(true);
      expect(result.attachments?.[0]?.mimeType).toBe(fixture.mimeType);
      expect(result.attachments?.[0]?.width).toBe(fixture.width);
      expect(result.attachments?.[0]?.height).toBe(fixture.height);
      expect(JSON.stringify(result.data)).not.toContain(
        fixture.bytes.toString("base64"),
      );
    }
  });

  it("rejects unsupported content from files.preview", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-preview-invalid-"));
    await writeFile(path.join(root, "not-image.txt"), "hello");
    const result = await new ToolRegistry().call(
      "files",
      makeContext(defaultConfig(root)),
      { action: "preview", path: "not-image.txt" },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED_PREVIEW");
  });

  it("rejects oversized image previews before loading file content", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-preview-large-"));
    const imagePath = path.join(root, "large.png");
    await writeFile(imagePath, pngFixture(1, 1));
    await truncate(imagePath, 20 * 1024 * 1024 + 1);
    const result = await new ToolRegistry().call(
      "files",
      makeContext(defaultConfig(root)),
      { action: "preview", path: imagePath },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PREVIEW_TOO_LARGE");
  });

  it("persists checkpoints and sanitizes secrets", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-memory-"));
    const config = defaultConfig(root);
    const context = makeContext(config);
    const saved = await new ToolRegistry().call("memory", context, {
      action: "save_checkpoint",
      currentTask: "Keep the release moving",
      completedSteps: ["implemented memory"],
      pendingSteps: ["run tests"],
      criticalContext: "Authorization: Bearer sk-test-secret-value-123456789",
    });
    expect(saved.ok).toBe(true);
    const recalled = await new ToolRegistry().call("memory", context, {
      action: "recall",
    });
    expect(recalled.ok).toBe(true);
    expect((recalled.data as { data: unknown }).data).toMatchObject({
      workspaceId: expect.any(String),
      updatedAt: expect.any(String),
      counts: expect.any(Object),
      sanitized: true,
    });
    expect(JSON.stringify(recalled)).not.toContain("sk-test-secret-value");
    expect(JSON.stringify(recalled)).toContain("[REDACTED_SECRET]");
  });

  it("resolves relative paths and runs a direct command", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-process-"));
    const config = defaultConfig(root);
    const context = makeContext(config);
    const result = await new ToolRegistry().call("process", context, {
      action: "run",
      command: "node --version",
      shell: "direct",
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toMatch(/v\d+/);
  });

  it("returns structured TypeScript diagnostics with pagination and invalidates changed source", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-diagnostics-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
    );
    const sourcePath = path.join(root, "src", "index.ts");
    await writeFile(
      sourcePath,
      "const first: string = 123;\nconst second: number = 'bad';\n",
    );
    const context = makeContext(defaultConfig(root));
    const registry = new ToolRegistry();
    const firstPage = await registry.call("workspace", context, {
      action: "diagnostics",
      path: ".",
      severity: "error",
      maxResults: 1,
    });
    expect(firstPage.ok).toBe(true);
    expect(firstPage.meta.truncated).toBe(true);
    expect(firstPage.meta.nextCursor).toBe(1);
    expect(JSON.stringify(firstPage)).toContain("TS2322");
    expect(JSON.stringify(firstPage)).toContain('"file":"src/index.ts"');
    expect(JSON.stringify(firstPage)).toMatch(/"line":1/);
    expect(JSON.stringify(firstPage)).toMatch(/"column":\d+/);

    const secondPage = await registry.call("workspace", context, {
      action: "diagnostics",
      path: ".",
      severity: "error",
      maxResults: 1,
      offset: 1,
    });
    expect(secondPage.ok).toBe(true);
    expect(JSON.stringify(secondPage)).toContain("TS2322");
    expect(JSON.stringify(secondPage)).toMatch(/"line":2/);

    await writeFile(
      sourcePath,
      "const first: string = 'fixed';\nconst second: number = 42;\n",
    );
    const fixed = await registry.call("workspace", context, {
      action: "diagnostics",
      path: ".",
      severity: "error",
    });
    expect(fixed.ok).toBe(true);
    expect(JSON.stringify(fixed)).not.toContain("TS2322");
  });

  it("returns an actionable error when TypeScript config is missing", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-diagnostics-none-"));
    const result = await new ToolRegistry().call(
      "workspace",
      makeContext(defaultConfig(root)),
      { action: "diagnostics", path: "." },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TSCONFIG_NOT_FOUND");
    expect(result.error?.hint).toContain("tsconfig");
  });

  it("provides TypeScript symbols, definitions, references, hover, and rename locations", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-symbols-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
    );
    await writeFile(
      path.join(root, "src", "lib.ts"),
      [
        "export interface User { name: string }",
        "export function greet(user: User): string { return user.name; }",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "src", "main.ts"),
      [
        'import { greet, type User } from "./lib.js";',
        'const user: User = { name: "Q" };',
        "console.log(greet(user));",
        "",
      ].join("\n"),
    );
    const context = makeContext(defaultConfig(root));
    const registry = new ToolRegistry();

    const symbols = await registry.call("workspace", context, {
      action: "document_symbols",
      path: "src/lib.ts",
    });
    expect(symbols.ok).toBe(true);
    expect(JSON.stringify(symbols)).toContain('"name":"User"');
    expect(JSON.stringify(symbols)).toContain('"kind":"interface"');
    expect(JSON.stringify(symbols)).toContain('"name":"greet"');

    const definition = await registry.call("workspace", context, {
      action: "definition",
      path: "src/main.ts",
      line: 3,
      column: 13,
    });
    expect(definition.ok).toBe(true);
    expect(JSON.stringify(definition)).toContain('"file":"src/lib.ts"');
    expect(JSON.stringify(definition)).toContain("function greet");

    const references = await registry.call("workspace", context, {
      action: "references",
      path: "src/main.ts",
      line: 3,
      column: 13,
      maxResults: 1,
    });
    expect(references.ok).toBe(true);
    expect(references.meta.truncated).toBe(true);
    expect(references.meta.nextCursor).toBe(1);

    const hover = await registry.call("workspace", context, {
      action: "hover",
      path: "src/main.ts",
      line: 3,
      column: 13,
    });
    expect(hover.ok).toBe(true);
    expect(JSON.stringify(hover)).toContain("greet(user: User): string");

    const rename = await registry.call("workspace", context, {
      action: "rename_locations",
      path: "src/main.ts",
      line: 3,
      column: 13,
    });
    expect(rename.ok).toBe(true);
    expect(JSON.stringify(rename)).toContain('"file":"src/lib.ts"');
    expect(JSON.stringify(rename)).toContain('"file":"src/main.ts"');

    const invalid = await registry.call("workspace", context, {
      action: "definition",
      path: "src/main.ts",
      line: 99,
      column: 1,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.code).toBe("INVALID_POSITION");
  });

  it("uses Everything-style search results through system.search_files with pagination", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-everything-"));
    const context = makeContext(defaultConfig(root));
    context.fileSearch = new WindowsFileSearchService({
      platform: "win32",
      findEverythingExecutable: async () => "C:\\Tools\\es.exe",
      runExecutable: async () => ({
        stdout: [
          "C:\\Data\\report-one.xlsx",
          "C:\\Data\\report-two.xlsx",
          "C:\\Data\\report-three.xlsx",
        ].join("\r\n"),
        stderr: "",
      }),
      fallbackRoots: () => [],
    });
    const result = await new ToolRegistry().call("system", context, {
      action: "search_files",
      query: "report ext:xlsx",
      provider: "everything",
      maxResults: 1,
      offset: 1,
      details: false,
    });
    expect(result.ok).toBe(true);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.nextCursor).toBe(2);
    expect(JSON.stringify(result)).toContain('"provider":"everything"');
    expect(JSON.stringify(result)).toContain("report-two.xlsx");
    expect(JSON.stringify(result)).not.toContain("report-one.xlsx");
  });

  it("returns actionable Everything-unavailable errors when the fast provider is required", async () => {
    const service = new WindowsFileSearchService({
      platform: "win32",
      findEverythingExecutable: async () => null,
      runExecutable: async () => {
        throw new Error("not expected");
      },
      fallbackRoots: () => [],
    });
    await expect(
      service.search({ query: "invoice ext:xlsx", provider: "everything" }),
    ).rejects.toThrow("EVERYTHING_UNAVAILABLE");
  });

  it("preserves Unicode Everything output and handles empty results", async () => {
    let stdout = "C:\\ข้อมูล\\ใบแจ้งหนี้ สิงหาคม.xlsx\r\n";
    const service = new WindowsFileSearchService({
      platform: "win32",
      findEverythingExecutable: async () => "C:\\Tools\\es.exe",
      runExecutable: async () => ({ stdout, stderr: "" }),
      fallbackRoots: () => [],
    });
    const thai = await service.search({
      query: "ใบแจ้งหนี้ ext:xlsx",
      provider: "everything",
      details: false,
    });
    expect(thai.matches[0]?.name).toBe("ใบแจ้งหนี้ สิงหาคม.xlsx");
    stdout = "";
    const empty = await service.search({
      query: "definitely-missing-file",
      provider: "everything",
      details: false,
    });
    expect(empty.matches).toEqual([]);
    expect(empty.truncated).toBe(false);
  });

  it("falls back to bounded local filename search when Everything is unavailable", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-search-fallback-"));
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "nested", "report-final.xlsx"), "sheet");
    await writeFile(path.join(root, "nested", "report-notes.txt"), "notes");
    const context = makeContext(defaultConfig(root));
    context.fileSearch = new WindowsFileSearchService({
      platform: "win32",
      findEverythingExecutable: async () => null,
      runExecutable: async () => {
        throw new Error("not expected");
      },
      fallbackRoots: () => [root!],
    });
    const result = await new ToolRegistry().call("system", context, {
      action: "search_files",
      query: "report ext:xlsx",
      provider: "auto",
      maxResults: 10,
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"provider":"fallback"');
    expect(JSON.stringify(result)).toContain("report-final.xlsx");
    expect(JSON.stringify(result)).not.toContain("report-notes.txt");
    expect(JSON.stringify(result)).toContain("bounded");
  });

  it("resolves bundled ripgrep through system.which on Windows", async () => {
    if (process.platform !== "win32") return;
    root = await mkdtemp(path.join(tmpdir(), "qnector-which-rg-"));
    const ripgrepPath = path.join(root, "rg.exe");
    await writeFile(ripgrepPath, "test executable placeholder");
    const previous = process.env.QNECTOR_RIPGREP_PATH;
    process.env.QNECTOR_RIPGREP_PATH = ripgrepPath;
    try {
      const result = await new ToolRegistry().call(
        "system",
        makeContext(defaultConfig(root)),
        { action: "which", name: "rg" },
      );
      expect(result.ok).toBe(true);
      const payload = result.data as { data?: { path?: string[] } } | undefined;
      expect(payload?.data?.path).toContain(ripgrepPath);
    } finally {
      if (previous === undefined) delete process.env.QNECTOR_RIPGREP_PATH;
      else process.env.QNECTOR_RIPGREP_PATH = previous;
    }
  });

  it("routes semantic Windows UI Automation through the computer tool", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-computer-"));
    const window: UiAutomationWindow = {
      windowId: "uiaw_test",
      name: "iTEC stock",
      automationId: "",
      controlType: "Window",
      className: "Window",
      processId: 123,
      enabled: true,
      offscreen: false,
    };
    const button: UiAutomationElement = {
      elementId: "uia_button",
      name: "Export",
      automationId: "btnExport",
      controlType: "Button",
      className: "Button",
      processId: 123,
      enabled: true,
      offscreen: false,
      focusable: true,
    };
    const textbox: UiAutomationElement = {
      elementId: "uia_text",
      name: "Product Code",
      automationId: "productCode",
      controlType: "Edit",
      className: "TextBox",
      processId: 123,
      enabled: true,
      offscreen: false,
      focusable: true,
      value: "",
    };
    const item: UiAutomationElement = {
      elementId: "uia_item",
      name: "Bangkok",
      automationId: "branchBangkok",
      controlType: "ListItem",
      className: "ListBoxItem",
      processId: 123,
      enabled: true,
      offscreen: false,
      focusable: true,
    };
    let currentValue = "";
    let invoked = false;
    let selected = false;
    const uiAutomation: UiAutomationService = {
      windows: async () => [window],
      inspect: async () => [textbox, button, item],
      find: async (input) => {
        if (input.automationId === "productCode")
          return [{ ...textbox, value: currentValue }];
        if (input.automationId === "branchBangkok") return [item];
        return [button];
      },
      invoke: async () => {
        invoked = true;
        return button;
      },
      setValue: async (_elementId, value) => {
        currentValue = value;
        return { ...textbox, value };
      },
      focus: async (elementId) =>
        elementId === textbox.elementId ? textbox : button,
      select: async () => {
        selected = true;
        return item;
      },
      wait: async () => ({
        condition: "enabled",
        matched: true,
        elapsedMs: 25,
        element: button,
      }),
    };
    const context = makeContext(defaultConfig(root), undefined, uiAutomation);
    const registry = new ToolRegistry();

    const windows = await registry.call("computer", context, {
      action: "windows",
    });
    expect(windows.ok).toBe(true);
    expect(JSON.stringify(windows)).toContain("iTEC stock");

    const inspected = await registry.call("computer", context, {
      action: "inspect",
      windowId: window.windowId,
      depth: 4,
    });
    expect(inspected.ok).toBe(true);
    expect(JSON.stringify(inspected)).toContain("btnExport");

    const found = await registry.call("computer", context, {
      action: "find",
      windowId: window.windowId,
      automationId: "btnExport",
    });
    expect(found.ok).toBe(true);
    expect(JSON.stringify(found)).toContain("uia_button");

    const setValue = await registry.call("computer", context, {
      action: "set_value",
      elementId: textbox.elementId,
      value: "ABC123",
    });
    expect(setValue.ok).toBe(true);
    expect(JSON.stringify(setValue)).toContain("ABC123");

    const focused = await registry.call("computer", context, {
      action: "focus",
      elementId: button.elementId,
    });
    expect(focused.ok).toBe(true);

    const selectedResult = await registry.call("computer", context, {
      action: "select",
      elementId: item.elementId,
    });
    expect(selectedResult.ok).toBe(true);
    expect(selected).toBe(true);

    const waited = await registry.call("computer", context, {
      action: "wait",
      windowId: window.windowId,
      automationId: "btnExport",
      condition: "enabled",
      timeoutMs: 1000,
    });
    expect(waited.ok).toBe(true);
    expect(JSON.stringify(waited)).toContain('"matched":true');

    const invokedResult = await registry.call("computer", context, {
      action: "invoke",
      elementId: button.elementId,
    });
    expect(invokedResult.ok).toBe(true);
    expect(invoked).toBe(true);
  });

  it("returns actionable stale-element errors from computer actions", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-computer-stale-"));
    const uiAutomation = {
      windows: async () => [],
      inspect: async () => [],
      find: async () => [],
      invoke: async () => {
        throw new Error("ELEMENT_STALE: control changed after navigation");
      },
      setValue: async () => {
        throw new Error("not expected");
      },
      focus: async () => {
        throw new Error("not expected");
      },
      select: async () => {
        throw new Error("not expected");
      },
      wait: async () => {
        throw new Error("not expected");
      },
    } satisfies UiAutomationService;
    const result = await new ToolRegistry().call(
      "computer",
      makeContext(defaultConfig(root), undefined, uiAutomation),
      { action: "invoke", elementId: "uia_old" },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ELEMENT_STALE");
    expect(result.error?.hint).toContain("computer.find");
  });

  it("routes system platform actions and returns image attachments", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-platform-"));
    const config = defaultConfig(root);
    const clipboardState = { text: "" };
    const platform: PlatformServices = {
      capabilities: () => ({
        clipboardText: true,
        toast: true,
        screenCapture: true,
        windowList: true,
        windowFocus: true,
        provider: "electron",
      }),
      readClipboard: async () => ({
        type: "text",
        text: clipboardState.text,
        sizeBytes: clipboardState.text.length,
        truncated: false,
      }),
      writeClipboard: async ({ text }) => {
        clipboardState.text = text;
      },
      showToast: async () => undefined,
      captureScreen: async () => ({
        type: "image",
        mimeType: "image/png",
        dataBase64: "aGVsbG8=",
        width: 1,
        height: 1,
        sizeBytes: 5,
      }),
      listWindows: async () => [],
      focusWindow: async () => undefined,
    };
    const context = makeContext(config, platform);
    const registry = new ToolRegistry();
    await registry.call("system", context, {
      action: "clipboard_write",
      text: "hello",
    });
    const read = await registry.call("system", context, {
      action: "clipboard_read",
    });
    expect(JSON.stringify(read)).toContain("hello");
    const captured = await registry.call("system", context, {
      action: "screen_capture",
    });
    expect(captured.attachments?.[0]?.mimeType).toBe("image/png");
    expect(JSON.stringify(captured.data)).not.toContain("aGVsbG8=");
    expect(JSON.stringify(context.activity.list())).not.toContain(
      '"text":"hello"',
    );
  });

  it("keeps diagnostics and the final summary in smart process output", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-log-"));
    const config = defaultConfig(root);
    const context = makeContext(config);
    const result = await new ToolRegistry().call("process", context, {
      action: "run",
      shell: "direct",
      command:
        "node -e \"console.log('head-' + 'x'.repeat(200)); console.error('ERROR middle'); console.log('tail-summary')\"",
      maxChars: 80,
      timeoutMs: 30_000,
      outputMode: "smart",
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain("ERROR middle");
    expect(JSON.stringify(result)).toContain("tail-summary");
    expect(JSON.stringify(result)).toContain("omittedChars");
    expect(JSON.stringify(result)).toMatch(/"sha256":"[a-f0-9]{64}"/);
  });

  it("captures browser screenshots and bounded DOM diagnostics over one CDP session", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-browser-dom-"));
    browserWebSocketServer = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
    });
    await new Promise<void>((resolve) =>
      browserWebSocketServer!.once("listening", () => resolve()),
    );
    const wsAddress = browserWebSocketServer.address();
    const wsPort =
      typeof wsAddress === "object" && wsAddress ? wsAddress.port : 0;
    browserWebSocketServer.on("connection", (socket) => {
      socket.on("message", (payload) => {
        const request = JSON.parse(payload.toString()) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        let result: unknown = {};
        if (request.method === "Page.getLayoutMetrics")
          result = {
            cssVisualViewport: {
              pageX: 0,
              pageY: 0,
              clientWidth: 1440,
              clientHeight: 900,
            },
            cssContentSize: { x: 0, y: 0, width: 1440, height: 1800 },
          };
        else if (request.method === "Page.captureScreenshot")
          result = {
            data: Buffer.from("fake-image", "utf8").toString("base64"),
          };
        else if (request.method === "Runtime.evaluate") {
          const expression = String(request.params?.expression ?? "");
          if (expression.includes("performance.getEntriesByType"))
            result = {
              result: {
                value: {
                  navigation: {
                    type: "navigate",
                    duration: 123.4,
                    domInteractive: 45.6,
                    domContentLoadedEventEnd: 67.8,
                    loadEventEnd: 123.4,
                    transferSize: 2048,
                    encodedBodySize: 1024,
                    decodedBodySize: 4096,
                  },
                  paint: [{ name: "first-paint", startTime: 12.5 }],
                },
              },
            };
          else if (expression.includes("answer:42"))
            result = {
              result: {
                type: "object",
                value: { answer: 42, label: "ok" },
              },
            };
          else
            result = {
              result: {
                value: [
                  {
                    tag: "html",
                    id: null,
                    classes: [],
                    text: "Save",
                    role: null,
                    visible: true,
                    bounds: { x: 0, y: 0, width: 1440, height: 900 },
                    depth: 0,
                  },
                  {
                    tag: "button",
                    id: "save",
                    classes: ["primary"],
                    text: "Save",
                    role: "button",
                    visible: true,
                    bounds: { x: 900, y: 80, width: 90, height: 36 },
                    depth: 3,
                  },
                ],
              },
            };
        } else if (request.method === "Performance.getMetrics")
          result = {
            metrics: [
              { name: "Nodes", value: 25 },
              { name: "JSHeapUsedSize", value: 123456 },
              { name: "Frames", value: 1 },
            ],
          };
        else if (request.method === "DOM.getDocument")
          result = { root: { nodeId: 1 } };
        else if (request.method === "DOM.querySelectorAll")
          result = { nodeIds: [2] };
        else if (request.method === "DOM.describeNode")
          result = {
            node: {
              nodeId: 2,
              backendNodeId: 42,
              nodeName: "BUTTON",
              attributes: ["id", "save", "class", "primary", "role", "button"],
            },
          };
        else if (request.method === "DOM.resolveNode")
          result = { object: { objectId: "object-42" } };
        else if (request.method === "Runtime.callFunctionOn")
          result = {
            result: {
              value: {
                text: "Save",
                role: "button",
                visible: true,
                bounds: { x: 900, y: 80, width: 90, height: 36 },
              },
            },
          };
        else if (request.method === "DOM.pushNodesByBackendIdsToFrontend")
          result = { nodeIds: [2] };
        else if (request.method === "CSS.getComputedStyleForNode")
          result = {
            computedStyle: [
              { name: "display", value: "block" },
              { name: "color", value: "rgb(1, 2, 3)" },
              { name: "font-size", value: "16px" },
            ],
          };
        socket.send(JSON.stringify({ id: request.id, result }));
        if (request.method === "Network.enable") {
          socket.send(
            JSON.stringify({
              method: "Network.requestWillBeSent",
              params: {
                requestId: "request-1",
                timestamp: 1,
                type: "Document",
                request: {
                  url: "http://localhost:3000/api/data",
                  method: "GET",
                  headers: { Authorization: "Bearer secret-must-not-leak" },
                },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              method: "Network.responseReceived",
              params: {
                requestId: "request-1",
                timestamp: 1.05,
                type: "Fetch",
                response: {
                  url: "http://localhost:3000/api/data",
                  status: 200,
                  mimeType: "application/json",
                  protocol: "http/1.1",
                  fromDiskCache: false,
                  headers: { "set-cookie": "secret-cookie" },
                },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              method: "Network.loadingFinished",
              params: {
                requestId: "request-1",
                timestamp: 1.1,
                encodedDataLength: 321,
              },
            }),
          );
        }
      });
    });

    browserServer = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/json/version") {
        response.end(
          JSON.stringify({ Browser: "Mock", "Protocol-Version": "1.3" }),
        );
        return;
      }
      response.end(
        JSON.stringify([
          {
            id: "local-dom",
            type: "page",
            title: "Local DOM fixture",
            url: "http://localhost:3000/",
            webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/local-dom`,
          },
        ]),
      );
    });
    await new Promise<void>((resolve) =>
      browserServer!.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = browserServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const context = makeContext(defaultConfig(root));
    const registry = new ToolRegistry();

    const screenshot = await registry.call("browser", context, {
      action: "screenshot",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      format: "png",
      maxWidth: 720,
    });
    expect(screenshot.ok).toBe(true);
    expect(screenshot.attachments?.[0]?.mimeType).toBe("image/png");
    expect(screenshot.attachments?.[0]?.width).toBe(720);
    expect(screenshot.attachments?.[0]?.height).toBe(450);
    expect(JSON.stringify(screenshot.data)).not.toContain(
      Buffer.from("fake-image", "utf8").toString("base64"),
    );

    const snapshot = await registry.call("browser", context, {
      action: "dom_snapshot",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      maxResults: 10,
      maxDepth: 5,
    });
    expect(snapshot.ok).toBe(true);
    expect(JSON.stringify(snapshot)).toContain('"tag":"button"');
    expect(JSON.stringify(snapshot)).toContain('"id":"save"');

    const queried = await registry.call("browser", context, {
      action: "query",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      selector: "#save",
    });
    expect(queried.ok).toBe(true);
    expect(JSON.stringify(queried)).toContain('"nodeId":42');
    expect(JSON.stringify(queried)).toContain('"text":"Save"');

    const inspected = await registry.call("browser", context, {
      action: "inspect",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      nodeId: 42,
    });
    expect(inspected.ok).toBe(true);
    expect(JSON.stringify(inspected)).toContain('"classes":["primary"]');

    const styles = await registry.call("browser", context, {
      action: "computed_style",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      nodeId: 42,
      properties: ["display", "color"],
    });
    expect(styles.ok).toBe(true);
    expect(JSON.stringify(styles)).toContain('"display":"block"');
    expect(JSON.stringify(styles)).toContain('"color":"rgb(1, 2, 3)"');
    expect(JSON.stringify(styles)).not.toContain("font-size");

    const evaluated = await registry.call("browser", context, {
      action: "evaluate",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      expression: "({answer:42,label:'ok'})",
    });
    expect(evaluated.ok).toBe(true);
    expect(JSON.stringify(evaluated)).toContain('"answer":42');
    expect(JSON.stringify(evaluated)).toContain('"label":"ok"');

    const deniedEvaluate = await registry.call("browser", context, {
      action: "evaluate",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      expression: "localStorage.getItem('token')",
    });
    expect(deniedEvaluate.ok).toBe(false);
    expect(deniedEvaluate.error?.code).toBe("BROWSER_EVALUATE_DENIED");
    expect(deniedEvaluate.error?.hint).toContain("browser.query");

    const requests = await registry.call("browser", context, {
      action: "requests",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      idleMs: 100,
      maxResults: 10,
    });
    expect(requests.ok).toBe(true);
    expect(JSON.stringify(requests)).toContain("/api/data");
    expect(JSON.stringify(requests)).toContain('"status":200');
    expect(JSON.stringify(requests)).toContain('"durationMs":100');
    expect(JSON.stringify(requests)).not.toContain("Authorization");
    expect(JSON.stringify(requests)).not.toContain("secret-cookie");
    expect(JSON.stringify(requests)).not.toContain("secret-must-not-leak");

    const performance = await registry.call("browser", context, {
      action: "performance",
      host: "127.0.0.1",
      port,
      targetId: "local-dom",
      metrics: ["Nodes", "JSHeapUsedSize"],
    });
    expect(performance.ok).toBe(true);
    expect(JSON.stringify(performance)).toContain('"Nodes":25');
    expect(JSON.stringify(performance)).toContain('"JSHeapUsedSize":123456');
    expect(JSON.stringify(performance)).not.toContain('"Frames":1');
    expect(JSON.stringify(performance)).toContain("first-paint");
    expect(JSON.stringify(performance)).toContain('"duration":123.4');
  });

  it("allows normal web page targets while keeping the DevTools endpoint local", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-browser-"));
    browserServer = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/json/version") {
        response.end(
          JSON.stringify({ Browser: "Mock", "Protocol-Version": "1.3" }),
        );
        return;
      }
      response.end(
        JSON.stringify([
          {
            id: "local",
            type: "page",
            title: "Local fixture",
            url: "http://localhost:3000/",
            webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/local",
          },
          {
            id: "external",
            type: "page",
            title: "External",
            url: "https://example.com/",
            webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/external",
          },
          {
            id: "bad-ws",
            type: "page",
            title: "Local with external socket",
            url: "http://127.0.0.1:3000/",
            webSocketDebuggerUrl: "ws://example.com/devtools/page/bad-ws",
          },
        ]),
      );
    });
    await new Promise<void>((resolve) =>
      browserServer!.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = browserServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const context = makeContext(defaultConfig(root));
    const result = await new ToolRegistry().call("browser", context, {
      action: "targets",
      host: "127.0.0.1",
      port,
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('"id":"local"');
    expect(JSON.stringify(result)).toContain('"id":"external"');
    expect(JSON.stringify(result)).not.toContain('"id":"bad-ws"');
  });
});

function pngFixture(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegFixture(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

function webpFixture(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  writeUInt24LE(buffer, 24, width - 1);
  writeUInt24LE(buffer, 27, height - 1);
  return buffer;
}

function writeUInt24LE(buffer: Buffer, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
}

function makeContext(
  config: ReturnType<typeof defaultConfig>,
  platform?: PlatformServices,
  uiAutomation?: UiAutomationService,
): ToolContext {
  return {
    workspace: new WorkspaceState(config),
    processManager: new ProcessManager("direct"),
    codeIntelligence: new TypeScriptCodeIntelligence(),
    memory: new MemoryStore(config.activeWorkspace, {
      rootDirectory: path.join(config.activeWorkspace, ".memory-test"),
      workspaceMirror: "off",
    }),
    ...(platform ? { platform } : {}),
    ...(uiAutomation ? { uiAutomation } : {}),
    activity: new ActivityLogger(
      path.join(config.activeWorkspace, "activity.jsonl"),
    ),
    getConfig: () => config,
    setConfig: async () => undefined,
  };
}
