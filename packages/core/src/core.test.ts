import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityLogger } from "./activity-log.js";
import { defaultConfig, loadConfig } from "./config.js";
import { DocumentIntelligenceService } from "./document-intelligence.js";
import { MemoryStore } from "./memory-store.js";
import { REDACTED_SECRET, sanitizeText } from "./secret-sanitizer.js";
import * as XLSX from "xlsx";

describe("DocumentIntelligenceService", () => {
  it("reads XLSX files through the SheetJS ESM filesystem adapter", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qnector-xlsx-esm-"));
    try {
      const file = path.join(root, "stock.xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["Branch", "Stock"],
          ["Bangkok", 42],
        ]),
        "Inventory",
      );
      await writeFile(
        file,
        XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      );

      const result = await new DocumentIntelligenceService().extractText({
        path: file,
      });
      expect(result.text).toContain("Bangkok,42");
      expect(result.metadata.sheets).toEqual(["Inventory"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Qnector config first-run migration", () => {
  it("starts fresh installs in guided OpenAI Tunnel setup", () => {
    const config = defaultConfig("C:\\workspace");
    expect(config.transport.mode).toBe("openai-tunnel");
    expect(config.transport.openaiProfile).toBe("qnector");
    expect(config.ui.setupCompleted).toBe(false);
  });

  it("treats pre-wizard config files as already configured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qnector-old-config-"));
    try {
      const file = path.join(root, "config.json");
      const legacy = defaultConfig(root);
      delete legacy.ui.setupCompleted;
      legacy.transport.mode = "local-only";
      await writeFile(file, JSON.stringify(legacy), "utf8");
      const loaded = await loadConfig({ file, persist: false });
      expect(loaded.transport.mode).toBe("local-only");
      expect(loaded.ui.setupCompleted).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drops a stale configured PowerShell executable so Windows fallback can recover", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qnector-shell-config-"));
    try {
      const file = path.join(root, "config.json");
      const legacy = defaultConfig(root);
      legacy.shell.powershellPath = path.join(root, "missing-pwsh.exe");
      await writeFile(file, JSON.stringify(legacy), "utf8");
      const loaded = await loadConfig({ file, persist: false });
      expect(loaded.shell.powershellPath).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("MemoryStore", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("persists checkpoints, facts and a sanitized markdown mirror", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-"));
    const store = new MemoryStore(root, {
      rootDirectory: path.join(root, "appdata-memory"),
      workspaceMirror: "memory-md",
    });
    await store.saveCheckpoint({
      currentTask: "Ship memory",
      completedSteps: ["schema"],
      pendingSteps: ["docs"],
      criticalContext: "Bearer sk-test-secret-value-123456789",
    });
    await store.upsertNote({
      key: "api_style",
      value: "REST",
      category: "rule",
    });
    await store.recordChange({
      source: "files",
      summary: "Updated source",
      paths: ["src/index.ts"],
    });

    const recalled = await store.recall();
    expect(recalled.available).toBe(true);
    expect(recalled.state.active?.criticalContext).toContain(
      "[REDACTED_SECRET]",
    );
    expect(recalled.state.facts[0]?.key).toBe("api_style");
    expect(
      await readFile(path.join(root, ".qnector", "MEMORY.md"), "utf8"),
    ).toContain("[REDACTED_SECRET]");
    expect(
      await readFile(path.join(root, "appdata-memory", "index.json"), "utf8"),
    ).toContain("workspaces");
  });

  it("automatically checkpoints persisted workspace progress without a model memory call", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-auto-"));
    const store = new MemoryStore(root, {
      rootDirectory: path.join(root, "memory"),
      workspaceMirror: "memory-md",
    });

    await store.recordChange({
      source: "files",
      summary: "Wrote src/a.ts",
      paths: ["src/a.ts"],
    });
    let recalled = await store.recall();
    expect(recalled.counts.checkpoints).toBe(1);
    expect(recalled.checkpoints[0]?.label).toBe(
      "Auto checkpoint - workspace progress",
    );
    expect(recalled.state.active?.currentTask).toContain("Wrote src/a.ts");

    for (const name of ["b", "c", "d", "e"]) {
      await store.recordChange({
        source: "files",
        summary: `Wrote src/${name}.ts`,
        paths: [`src/${name}.ts`],
      });
    }
    recalled = await store.recall();
    expect(recalled.counts.checkpoints).toBe(2);
    expect(recalled.state.active?.completedSteps).toEqual(
      expect.arrayContaining(["files: Wrote src/e.ts (src/e.ts)"]),
    );

    await store.clear("checkpoints");
    expect((await store.recall()).counts.checkpoints).toBe(0);
    await store.ensureAutomaticCheckpoint();
    expect((await store.recall()).counts.checkpoints).toBe(1);
  });

  it("ignores foreign file changes and heals legacy foreign-path checkpoint pollution", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-scope-"));
    const storage = path.join(root, "memory");
    const store = new MemoryStore(root, {
      rootDirectory: storage,
      workspaceMirror: "memory-md",
    });
    const foreignPath = path.join(tmpdir(), "qnector-foreign-helper.ps1");

    await store.recordChange({
      source: "files",
      summary: "Wrote foreign helper",
      paths: [foreignPath],
    });
    let recalled = await store.recall();
    expect(recalled.counts.recentChanges).toBe(0);
    expect(recalled.counts.checkpoints).toBe(0);

    const projectFile = path.join(root, "src", "inside.ts");
    await store.recordChange({
      source: "files",
      summary: "Wrote project file",
      paths: [projectFile],
    });
    recalled = await store.recall();
    expect(recalled.counts.checkpoints).toBe(1);
    const stateFile = path.join(storage, recalled.workspaceId, "state.json");
    const checkpointsFile = path.join(
      storage,
      recalled.workspaceId,
      "checkpoints.jsonl",
    );
    const pollutedState = JSON.parse(await readFile(stateFile, "utf8"));
    pollutedState.recentChanges.unshift({
      timestamp: new Date().toISOString(),
      source: "files",
      summary: "Wrote foreign helper",
      paths: [foreignPath],
    });
    pollutedState.active.currentTask = `Continue workspace work after: Wrote ${foreignPath}`;
    await writeFile(
      stateFile,
      `${JSON.stringify(pollutedState, null, 2)}\n`,
      "utf8",
    );
    const checkpointLines = (await readFile(checkpointsFile, "utf8"))
      .trim()
      .split(/\r?\n/);
    const pollutedCheckpoint = JSON.parse(checkpointLines.at(-1)!);
    pollutedCheckpoint.active = pollutedState.active;
    checkpointLines[checkpointLines.length - 1] =
      JSON.stringify(pollutedCheckpoint);
    await writeFile(checkpointsFile, `${checkpointLines.join("\n")}\n`, "utf8");

    const fresh = new MemoryStore(root, {
      rootDirectory: storage,
      workspaceMirror: "memory-md",
    });
    const healed = await fresh.ensureAutomaticCheckpoint();
    expect(healed.state.recentChanges).toHaveLength(1);
    expect(healed.state.recentChanges[0]?.paths).toEqual([projectFile]);
    expect(healed.state.active?.currentTask).toContain("Wrote project file");
    expect(healed.state.active?.currentTask).not.toContain("foreign-helper");
    expect(healed.counts.checkpoints).toBe(1);
  });

  it("normalizes active steps and avoids duplicate checkpoints or fact keys", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-normalize-"));
    const store = new MemoryStore(root, {
      rootDirectory: path.join(root, "memory"),
    });

    await store.saveCheckpoint({
      currentTask: "  Improve memory continuity  ",
      completedSteps: ["Read source", " read source ", ""],
      pendingSteps: ["READ SOURCE", "Run tests", " run tests "],
      criticalContext: "  Keep the drawer stable.  ",
    });
    await store.saveCheckpoint({
      currentTask: "Improve memory continuity",
      completedSteps: ["Read source"],
      pendingSteps: ["Run tests"],
      criticalContext: "Keep the drawer stable.",
    });

    await store.upsertNote({
      key: " Release Rule ",
      value: "first",
      category: "rule",
      tags: ["Updater", " updater ", "release"],
    });
    await store.upsertNote({
      key: "release   rule",
      value: "second",
      category: "rule",
    });

    const recalled = await store.recall();
    expect(recalled.counts.checkpoints).toBe(1);
    expect(recalled.state.active).toMatchObject({
      currentTask: "Improve memory continuity",
      completedSteps: ["Read source"],
      pendingSteps: ["Run tests"],
      criticalContext: "Keep the drawer stable.",
    });
    expect(recalled.counts.facts).toBe(1);
    expect((await store.getFact({ key: "RELEASE RULE" }))?.value).toBe(
      "second",
    );
  });

  it("recalls facts by deterministic relevance when a query is supplied", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-search-"));
    const store = new MemoryStore(root, {
      rootDirectory: path.join(root, "memory"),
    });
    await store.upsertNote({
      key: "Theme preference",
      value: "Keep the classic dark gold visual design.",
      category: "decision",
    });
    await store.upsertNote({
      key: "Updater behavior",
      value:
        "Keep download progress readable and never hide the update action.",
      category: "rule",
      tags: ["update", "download"],
    });
    await store.upsertNote({
      key: "Database",
      value: "SQLite is used by document fixtures.",
      category: "fact",
    });

    const recalled = await store.recall({
      query: "update download progress",
      factLimit: 2,
    });
    expect(recalled.state.facts[0]?.key).toBe("Updater behavior");
    expect(recalled.state.facts).toHaveLength(1);
    expect(recalled.truncated).toBe(true);
  });

  it("recovers from an unreadable state and replaces it on the next write", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-corrupt-"));
    const storage = path.join(root, "memory");
    const first = new MemoryStore(root, { rootDirectory: storage });
    const id = await first
      .saveCheckpoint({
        currentTask: "seed",
        completedSteps: [],
        pendingSteps: [],
        criticalContext: "seed",
      })
      .then((value) => value.workspaceId);
    await writeFile(path.join(storage, id, "state.json"), "not-json", "utf8");
    const second = new MemoryStore(root, { rootDirectory: storage });
    const recovered = await second.recall();
    expect(recovered.warning).toContain("unreadable");
    await second.upsertNote({ key: "fixed", value: "yes" });
    expect((await second.recall()).warning).toBeUndefined();
  });

  it("serializes concurrent mutations from multiple store instances", async () => {
    root = await mkdtemp(
      path.join(tmpdir(), "qnector-core-memory-concurrent-"),
    );
    const storage = path.join(root, "memory");
    const first = new MemoryStore(root, { rootDirectory: storage });
    const second = new MemoryStore(root, { rootDirectory: storage });
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? first : second).saveCheckpoint({
          currentTask: `task-${index}`,
          completedSteps: [],
          pendingSteps: [],
          criticalContext: "concurrent",
        }),
      ),
    );
    const final = await new MemoryStore(root, {
      rootDirectory: storage,
    }).recall();
    expect(final.counts.checkpoints).toBe(10);
    expect(final.state.active?.currentTask).toBe("task-11");
  });

  it("keeps the workspace index intact for parallel workspaces", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-isolation-"));
    const workspaceA = path.join(root, "a");
    const workspaceB = path.join(root, "b");
    await mkdir(workspaceA);
    await mkdir(workspaceB);
    const storage = path.join(root, "memory");
    await Promise.all([
      new MemoryStore(workspaceA, { rootDirectory: storage }).upsertNote({
        key: "workspace",
        value: "a",
      }),
      new MemoryStore(workspaceB, { rootDirectory: storage }).upsertNote({
        key: "workspace",
        value: "b",
      }),
    ]);
    expect(
      (
        await new MemoryStore(workspaceA, { rootDirectory: storage }).getFact({
          key: "workspace",
        })
      )?.value,
    ).toBe("a");
    expect(
      (
        await new MemoryStore(workspaceB, { rootDirectory: storage }).getFact({
          key: "workspace",
        })
      )?.value,
    ).toBe("b");
  });

  it("invalidates the memory RAM cache when another store changes the file", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-core-memory-cache-"));
    const storage = path.join(root, "memory");
    const first = new MemoryStore(root, { rootDirectory: storage });
    const second = new MemoryStore(root, { rootDirectory: storage });
    await first.upsertNote({ key: "shared", value: "before" });
    expect((await first.getFact({ key: "shared" }))?.value).toBe("before");
    await second.upsertNote({ key: "shared", value: "after" });
    expect((await first.getFact({ key: "shared" }))?.value).toBe("after");
  });
});

describe("ActivityLogger", () => {
  it("exports sanitized JSON and markdown", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "qnector-core-activity-"));
    try {
      const logger = new ActivityLogger(path.join(root, "activity.jsonl"));
      await logger.record({
        tool: "memory",
        action: "note",
        argsSummary: JSON.stringify({ password: "super-secret-value" }),
        status: "success",
        summary: "Saved note",
      });
      expect(logger.export("json")).not.toContain("super-secret-value");
      expect(logger.export("markdown")).toContain("Qnector Activity Export");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent writes and compacts an oversized activity log", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "qnector-core-activity-cap-"),
    );
    try {
      const file = path.join(root, "activity.jsonl");
      const logger = new ActivityLogger(file, 5, 1_500);
      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          logger.record({
            tool: "process",
            action: "run",
            argsSummary: JSON.stringify({ index }),
            status: "success",
            summary: `entry-${index}-${"x".repeat(80)}`,
          }),
        ),
      );
      const raw = await readFile(file, "utf8");
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(1_500);
      for (const line of raw.split(/\r?\n/).filter(Boolean))
        expect(() => JSON.parse(line)).not.toThrow();
      const reloaded = new ActivityLogger(file, 5, 1_500);
      const entries = await reloaded.load();
      expect(entries).toHaveLength(5);
      expect(entries.at(-1)?.summary).toContain("entry-29-");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sanitizes historical entries when loading an activity log", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "qnector-core-activity-load-"),
    );
    try {
      const file = path.join(root, "activity.jsonl");
      await writeFile(
        file,
        `${JSON.stringify({
          id: "old",
          timestamp: new Date().toISOString(),
          tool: "system",
          action: "env",
          argsSummary: JSON.stringify({ token: "historical-secret" }),
          status: "success",
        })}\n`,
        "utf8",
      );
      const logger = new ActivityLogger(file);
      const entries = await logger.load();
      expect(JSON.stringify(entries)).not.toContain("historical-secret");
      expect(JSON.stringify(entries)).toContain("[REDACTED_SECRET]");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("secret sanitizer", () => {
  it("redacts common and opaque token formats without masking low-entropy text", () => {
    const opaque = "aZ3qW7mN9pR2xK8vT4yL6cD1fG5hJ0sU";
    expect(sanitizeText(`token=${opaque}`).value).toContain(REDACTED_SECRET);
    expect(
      sanitizeText("http://localhost:3000/?token=plain-secret").value,
    ).toContain(REDACTED_SECRET);
    expect(sanitizeText("a".repeat(48)).value).toBe("a".repeat(48));
    const hexadecimal = "0123456789abcdef".repeat(4);
    expect(sanitizeText(hexadecimal).value).toBe(hexadecimal);
    const normalPath =
      "C:/Users/QUEEN/backups/qnector-roadmap-complete-20260829-1741";
    expect(sanitizeText(normalPath).value).toBe(normalPath);
    const portableName = "Qnector-0.1.0-win-x64-portable.exe";
    expect(sanitizeText(portableName).value).toBe(portableName);
    const diagnosticLabel = "DOM/query/inspect/computed_style";
    expect(sanitizeText(diagnosticLabel).value).toBe(diagnosticLabel);
  });
});
