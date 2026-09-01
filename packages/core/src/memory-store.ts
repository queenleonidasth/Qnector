import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { configDirectory } from "./config.js";
import { memoryCheckpointSchema, memoryStateSchema } from "@qnector/shared";
import type {
  MemoryActiveState,
  MemoryCategory,
  MemoryCheckpoint,
  MemoryFact,
  MemoryState,
} from "@qnector/shared";
import {
  REDACTED_SECRET,
  sanitizeText,
  sanitizeValue,
} from "./secret-sanitizer.js";

const DEFAULT_MAX_CHECKPOINTS = 10;
const DEFAULT_MAX_PAYLOAD_BYTES = 256_000;
const MEMORY_QUERY_STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "can",
  "for",
  "from",
  "has",
  "have",
  "into",
  "not",
  "that",
  "the",
  "then",
  "this",
  "use",
  "used",
  "using",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "will",
  "with",
]);
const mutationQueues = new Map<string, Promise<void>>();
const indexQueues = new Map<string, Promise<void>>();

export interface MemoryStoreOptions {
  rootDirectory?: string;
  workspaceMirror?: "off" | "memory-md";
  maxCheckpoints?: number;
  maxPayloadBytes?: number;
}

export interface MemoryRecallOptions {
  checkpointLimit?: number;
  factLimit?: number;
  changeLimit?: number;
  query?: string;
}

export interface MemoryRecall {
  available: boolean;
  workspaceId: string;
  workspacePath: string;
  updatedAt: string;
  state: MemoryState;
  checkpoints: MemoryCheckpoint[];
  counts: { facts: number; checkpoints: number; recentChanges: number };
  truncated: boolean;
  sanitized: boolean;
  warning?: string;
}

export interface SaveCheckpointInput {
  currentTask: string;
  completedSteps: string[];
  pendingSteps: string[];
  criticalContext: string;
  label?: string;
}

export interface NoteInput {
  key: string;
  value: string;
  category?: MemoryCategory;
  tags?: string[];
}

export interface MemoryListOptions {
  category?: MemoryCategory;
  query?: string;
  limit?: number;
  cursor?: number;
}

export interface MemoryListResult {
  facts: MemoryFact[];
  total: number;
  cursor: number;
  nextCursor: number | null;
  truncated: boolean;
}

export interface MemoryExport {
  format: "json" | "markdown";
  content: string;
  state: MemoryState;
  checkpoints: MemoryCheckpoint[];
}

interface MemoryIndex {
  version: 1;
  workspaces: Record<string, string>;
}

interface LoadedState {
  state: MemoryState;
  existed: boolean;
  warning?: string;
}

export class MemoryStore {
  private workspacePath: string;
  private workspaceId?: string;
  private state?: MemoryState;
  private stateExisted = false;
  private checkpoints?: MemoryCheckpoint[];
  private stateWarning?: string;
  private mirrorMode: "off" | "memory-md";
  private readonly storageRoot: string;
  private readonly maxCheckpoints: number;
  private readonly maxPayloadBytes: number;

  public constructor(workspacePath: string, options: MemoryStoreOptions = {}) {
    this.workspacePath = path.resolve(workspacePath);
    this.storageRoot = path.resolve(
      options.rootDirectory ?? path.join(configDirectory(), "memory"),
    );
    this.mirrorMode = options.workspaceMirror ?? "off";
    this.maxCheckpoints = Math.max(
      1,
      Math.min(options.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS, 100),
    );
    this.maxPayloadBytes = Math.max(
      1_024,
      Math.min(options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES, 1_000_000),
    );
  }

  public get currentWorkspace(): string {
    return this.workspacePath;
  }

  public get currentWorkspaceId(): string | undefined {
    return this.workspaceId;
  }

  public setWorkspace(workspacePath: string): void {
    const next = path.resolve(workspacePath);
    if (next === this.workspacePath) return;
    this.workspacePath = next;
    this.workspaceId = undefined;
    this.state = undefined;
    this.stateExisted = false;
    this.checkpoints = undefined;
    this.stateWarning = undefined;
  }

  public setMirrorMode(mode: "off" | "memory-md"): void {
    this.mirrorMode = mode;
  }

  public async syncMirror(): Promise<void> {
    await this.serial(async () => {
      const state = (await this.loadState(true)).state;
      await this.writeMirror(state, await this.loadCheckpoints(true));
    });
  }

  public async recall(
    options: MemoryRecallOptions = {},
  ): Promise<MemoryRecall> {
    return this.serial(async () => {
      const loaded = await this.loadState(true);
      const checkpoints = await this.loadCheckpoints(true);
      const checkpointLimit = clampLimit(
        options.checkpointLimit,
        this.maxCheckpoints,
      );
      const factLimit = clampLimit(options.factLimit, 100);
      const changeLimit = clampLimit(options.changeLimit, 100);
      const facts = selectFacts(loaded.state.facts, factLimit, options.query);
      const changes = loaded.state.recentChanges.slice(0, changeLimit);
      const selectedCheckpoints = checkpoints.slice(-checkpointLimit).reverse();
      const truncated =
        facts.length < loaded.state.facts.length ||
        changes.length < loaded.state.recentChanges.length ||
        selectedCheckpoints.length < checkpoints.length;
      return {
        available:
          loaded.existed || facts.length > 0 || Boolean(loaded.state.active),
        workspaceId: await this.ensureWorkspaceId(),
        workspacePath: this.workspacePath,
        updatedAt: loaded.state.updatedAt,
        state: {
          ...loaded.state,
          facts,
          recentChanges: changes,
        },
        checkpoints: selectedCheckpoints,
        counts: {
          facts: loaded.state.facts.length,
          checkpoints: checkpoints.length,
          recentChanges: loaded.state.recentChanges.length,
        },
        truncated,
        sanitized: containsRedaction(loaded.state),
        ...(loaded.warning ? { warning: loaded.warning } : {}),
      };
    });
  }

  public async saveCheckpoint(
    input: SaveCheckpointInput,
  ): Promise<MemoryRecall> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const active = sanitizeActive(input);
      const now = new Date().toISOString();
      const existingCheckpoints = await this.loadCheckpoints(true);
      const checkpoint: MemoryCheckpoint = {
        id: `checkpoint_${randomUUID()}`,
        createdAt: now,
        ...(input.label ? { label: sanitizeText(input.label).value } : {}),
        active,
      };
      const next: MemoryState = {
        ...state,
        active,
        updatedAt: now,
      };
      this.assertPayload(next);
      await this.writeState(next);
      const previous = existingCheckpoints.at(-1);
      const duplicateCheckpoint =
        !input.label && previous?.active && sameActive(previous.active, active);
      const checkpoints = (
        duplicateCheckpoint
          ? existingCheckpoints
          : [...existingCheckpoints, checkpoint]
      ).slice(-this.maxCheckpoints);
      await this.writeCheckpoints(checkpoints);
      await this.writeMirror(next, checkpoints);
      this.state = next;
      this.checkpoints = checkpoints;
      return this.recallUnlocked();
    });
  }

  public async upsertNote(input: NoteInput): Promise<MemoryFact> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const key = sanitizeText(input.key).value.trim();
      if (!key) throw new Error("INVALID_INPUT: memory note key is required");
      const now = new Date().toISOString();
      const normalizedKey = normalizeMemoryKey(key);
      const existing = state.facts.find(
        (entry) => normalizeMemoryKey(entry.key) === normalizedKey,
      );
      const fact: MemoryFact = {
        id: existing?.id ?? `fact_${randomUUID()}`,
        key,
        category: input.category ?? existing?.category ?? "note",
        value: sanitizeText(input.value).value,
        tags: dedupeTextValues(
          (input.tags ?? existing?.tags ?? []).map(
            (tag) => sanitizeText(tag).value,
          ),
        ).slice(0, 32),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const facts = [
        fact,
        ...state.facts.filter((entry) => entry.id !== fact.id),
      ].slice(0, 500);
      const next = { ...state, facts, updatedAt: now };
      this.assertPayload(next);
      await this.writeState(next);
      const checkpoints = await this.loadCheckpoints(true);
      await this.writeMirror(next, checkpoints);
      this.state = next;
      return fact;
    });
  }

  public async listFacts(
    options: MemoryListOptions = {},
  ): Promise<MemoryListResult> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const query = options.query?.trim();
      const filtered = state.facts.filter((fact) => {
        if (options.category && fact.category !== options.category)
          return false;
        if (!query) return true;
        return memorySearchScore(fact, query) > 0;
      });
      if (query) {
        filtered.sort(
          (a, b) =>
            memorySearchScore(b, query) - memorySearchScore(a, query) ||
            Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        );
      }
      const limit = clampLimit(options.limit, 100);
      const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
      const facts = filtered.slice(cursor, cursor + limit);
      const nextCursor =
        cursor + facts.length < filtered.length ? cursor + facts.length : null;
      return {
        facts,
        total: filtered.length,
        cursor,
        nextCursor,
        truncated: nextCursor !== null,
      };
    });
  }

  public async getFact(input: {
    id?: string;
    key?: string;
  }): Promise<MemoryFact | null> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const normalizedKey = input.key
        ? normalizeMemoryKey(input.key)
        : undefined;
      return (
        state.facts.find((fact) =>
          input.id
            ? fact.id === input.id
            : normalizedKey
              ? normalizeMemoryKey(fact.key) === normalizedKey
              : false,
        ) ?? null
      );
    });
  }

  public async deleteFact(input: {
    id?: string;
    key?: string;
  }): Promise<boolean> {
    return this.serial(async () => {
      if (!input.id && !input.key) return false;
      const state = (await this.loadState(true)).state;
      const normalizedKey = input.key
        ? normalizeMemoryKey(input.key)
        : undefined;
      const facts = state.facts.filter((fact) =>
        input.id
          ? fact.id !== input.id
          : normalizedKey
            ? normalizeMemoryKey(fact.key) !== normalizedKey
            : true,
      );
      const deleted = facts.length !== state.facts.length;
      if (!deleted) return false;
      const next = { ...state, facts, updatedAt: new Date().toISOString() };
      await this.writeState(next);
      await this.writeMirror(next, await this.loadCheckpoints(true));
      this.state = next;
      return true;
    });
  }

  public async compact(
    input: {
      keepCheckpoints?: number;
      replacementSummary?: string;
    } = {},
  ): Promise<MemoryRecall> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const factsByKey = new Map<string, MemoryFact>();
      for (const fact of [...state.facts].reverse())
        factsByKey.set(normalizeMemoryKey(fact.key), fact);
      const facts = [...factsByKey.values()].reverse();
      const now = new Date().toISOString();
      const active = input.replacementSummary
        ? {
            ...(state.active ?? {
              currentTask: "",
              completedSteps: [],
              pendingSteps: [],
              criticalContext: "",
            }),
            criticalContext: sanitizeText(input.replacementSummary).value,
          }
        : state.active;
      const next = { ...state, facts, active, updatedAt: now };
      const checkpoints = (await this.loadCheckpoints(true)).slice(
        -clampLimit(input.keepCheckpoints, this.maxCheckpoints),
      );
      this.assertPayload(next);
      await this.writeState(next);
      await this.writeCheckpoints(checkpoints);
      await this.writeMirror(next, checkpoints);
      this.state = next;
      this.checkpoints = checkpoints;
      return this.recallUnlocked();
    });
  }

  public async clear(
    scope: "active" | "checkpoints" | "facts" | "all",
  ): Promise<MemoryRecall> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const now = new Date().toISOString();
      const next: MemoryState = {
        ...state,
        active: scope === "active" || scope === "all" ? null : state.active,
        facts: scope === "facts" || scope === "all" ? [] : state.facts,
        recentChanges: scope === "all" ? [] : state.recentChanges,
        updatedAt: now,
      };
      const checkpoints =
        scope === "checkpoints" || scope === "all"
          ? []
          : await this.loadCheckpoints(true);
      await this.writeState(next);
      await this.writeCheckpoints(checkpoints);
      if (scope === "all" && this.mirrorMode === "memory-md") {
        await rm(this.mirrorPath(), { force: true });
      } else {
        await this.writeMirror(next, checkpoints);
      }
      this.state = next;
      this.checkpoints = checkpoints;
      return this.recallUnlocked();
    });
  }

  public async recordChange(input: {
    source: "files" | "git" | "manual";
    summary: string;
    paths?: string[];
  }): Promise<void> {
    await this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const now = new Date().toISOString();
      const next: MemoryState = {
        ...state,
        updatedAt: now,
        recentChanges: [
          {
            timestamp: now,
            source: input.source,
            summary: sanitizeText(input.summary).value,
            paths: (input.paths ?? [])
              .map((entry) => sanitizeText(entry).value)
              .slice(0, 50),
          },
          ...state.recentChanges,
        ].slice(0, 100),
      };
      this.assertPayload(next);
      await this.writeState(next);
      await this.writeMirror(next, await this.loadCheckpoints(true));
      this.state = next;
    });
  }

  public async export(format: "json" | "markdown"): Promise<MemoryExport> {
    return this.serial(async () => {
      const state = (await this.loadState(true)).state;
      const checkpoints = await this.loadCheckpoints(true);
      const safeState = sanitizeValue(state).value as MemoryState;
      const safeCheckpoints = sanitizeValue(checkpoints)
        .value as MemoryCheckpoint[];
      const content =
        format === "markdown"
          ? renderMemoryMarkdown(safeState, safeCheckpoints)
          : `${JSON.stringify({ state: safeState, checkpoints: safeCheckpoints }, null, 2)}\n`;
      return {
        format,
        content,
        state: safeState,
        checkpoints: safeCheckpoints,
      };
    });
  }

  public async writeExport(
    format: "json" | "markdown",
    target: string,
  ): Promise<MemoryExport> {
    return this.serial(async () => {
      const exported = await this.exportUnlocked(format);
      const absolute = path.resolve(target);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeAtomic(absolute, exported.content);
      return exported;
    });
  }

  private async recallUnlocked(): Promise<MemoryRecall> {
    const loaded = await this.loadState();
    const checkpoints = await this.loadCheckpoints();
    return {
      available:
        loaded.existed ||
        Boolean(loaded.state.active) ||
        loaded.state.facts.length > 0,
      workspaceId: await this.ensureWorkspaceId(),
      workspacePath: this.workspacePath,
      updatedAt: loaded.state.updatedAt,
      state: loaded.state,
      checkpoints: [...checkpoints].reverse(),
      counts: {
        facts: loaded.state.facts.length,
        checkpoints: checkpoints.length,
        recentChanges: loaded.state.recentChanges.length,
      },
      truncated: false,
      sanitized: containsRedaction(loaded.state),
      ...(loaded.warning ? { warning: loaded.warning } : {}),
    };
  }

  private async exportUnlocked(
    format: "json" | "markdown",
  ): Promise<MemoryExport> {
    const state = (await this.loadState(true)).state;
    const checkpoints = await this.loadCheckpoints(true);
    const safeState = sanitizeValue(state).value as MemoryState;
    const safeCheckpoints = sanitizeValue(checkpoints)
      .value as MemoryCheckpoint[];
    return {
      format,
      content:
        format === "markdown"
          ? renderMemoryMarkdown(safeState, safeCheckpoints)
          : `${JSON.stringify({ state: safeState, checkpoints: safeCheckpoints }, null, 2)}\n`,
      state: safeState,
      checkpoints: safeCheckpoints,
    };
  }

  private async loadState(force = false): Promise<LoadedState> {
    const workspaceId = await this.ensureWorkspaceId();
    if (!force && this.state && this.state.workspaceId === workspaceId)
      return {
        state: this.state,
        existed: this.stateExisted,
        ...(this.stateWarning ? { warning: this.stateWarning } : {}),
      };
    const file = this.statePath();
    try {
      const parsed = memoryStateSchema.safeParse(
        JSON.parse(await readFile(file, "utf8")),
      );
      if (parsed.success && parsed.data.workspaceId === workspaceId) {
        const sanitized = sanitizeValue(parsed.data);
        this.state = sanitized.value as MemoryState;
        this.stateExisted = true;
        this.stateWarning = undefined;
        if (sanitized.redacted)
          await writeAtomic(file, `${JSON.stringify(this.state, null, 2)}\n`);
        return { state: this.state, existed: true };
      }
      this.stateWarning =
        "Memory state did not match the active workspace and was ignored.";
    } catch {
      try {
        await access(file);
        this.stateWarning =
          "Memory state was unreadable; using an empty state until it is replaced.";
      } catch {
        this.stateWarning = undefined;
      }
    }
    const state = emptyState(workspaceId, this.workspacePath);
    this.state = state;
    this.stateExisted = false;
    return {
      state,
      existed: false,
      ...(this.stateWarning ? { warning: this.stateWarning } : {}),
    };
  }

  private async loadCheckpoints(force = false): Promise<MemoryCheckpoint[]> {
    if (!force && this.checkpoints) return [...this.checkpoints];
    const file = this.checkpointsPath();
    try {
      const lines = (await readFile(file, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      let redacted = false;
      this.checkpoints = lines
        .map((line) => memoryCheckpointSchema.safeParse(JSON.parse(line)))
        .flatMap((entry) => {
          if (!entry.success) return [];
          const sanitized = sanitizeValue(entry.data);
          redacted ||= sanitized.redacted;
          return [sanitized.value as MemoryCheckpoint];
        })
        .slice(-this.maxCheckpoints);
      if (redacted) await this.writeCheckpoints(this.checkpoints);
    } catch {
      this.checkpoints = [];
    }
    return [...this.checkpoints];
  }

  private async ensureWorkspaceId(): Promise<string> {
    if (this.workspaceId) return this.workspaceId;
    const queueKey = normalizeWorkspacePath(this.storageRoot);
    const previous = indexQueues.get(queueKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    indexQueues.set(queueKey, current);
    await previous;
    try {
      if (this.workspaceId) return this.workspaceId;
      try {
        this.workspacePath = await realpath(this.workspacePath);
      } catch {
        // A workspace may not exist yet; retain its resolved path for the index key.
      }
      const index = await this.loadIndex();
      const key = normalizeWorkspacePath(this.workspacePath);
      this.workspaceId = index.workspaces[key] ?? randomUUID();
      if (!index.workspaces[key]) {
        index.workspaces[key] = this.workspaceId;
        await writeAtomic(
          this.indexPath(),
          `${JSON.stringify(index, null, 2)}\n`,
        );
      }
      return this.workspaceId;
    } finally {
      release();
      if (indexQueues.get(queueKey) === current) indexQueues.delete(queueKey);
    }
  }

  private async loadIndex(): Promise<MemoryIndex> {
    try {
      const parsed = JSON.parse(
        await readFile(this.indexPath(), "utf8"),
      ) as Partial<MemoryIndex>;
      if (
        parsed.version === 1 &&
        parsed.workspaces &&
        typeof parsed.workspaces === "object"
      )
        return { version: 1, workspaces: { ...parsed.workspaces } };
    } catch {
      // first run or malformed index
    }
    return { version: 1, workspaces: {} };
  }

  private statePath(): string {
    return path.join(
      this.rootDirectory(),
      this.workspaceId ?? "unknown",
      "state.json",
    );
  }

  private checkpointsPath(): string {
    return path.join(
      this.rootDirectory(),
      this.workspaceId ?? "unknown",
      "checkpoints.jsonl",
    );
  }

  private indexPath(): string {
    return path.join(this.rootDirectory(), "index.json");
  }

  private mirrorPath(): string {
    return path.join(this.workspacePath, ".qnector", "MEMORY.md");
  }

  private rootDirectory(): string {
    return this.storageRoot;
  }

  private async writeState(state: MemoryState): Promise<void> {
    await writeAtomic(this.statePath(), `${JSON.stringify(state, null, 2)}\n`);
    this.stateExisted = true;
    this.stateWarning = undefined;
  }

  private async writeCheckpoints(
    checkpoints: MemoryCheckpoint[],
  ): Promise<void> {
    const content = checkpoints.length
      ? `${checkpoints.map((entry) => JSON.stringify(entry)).join("\n")}\n`
      : "";
    await writeAtomic(this.checkpointsPath(), content);
    this.checkpoints = [...checkpoints];
  }

  private async writeMirror(
    state: MemoryState,
    checkpoints: MemoryCheckpoint[],
  ): Promise<void> {
    if (this.mirrorMode !== "memory-md") return;
    await writeAtomic(
      this.mirrorPath(),
      renderMemoryMarkdown(state, checkpoints),
    );
  }

  private assertPayload(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > this.maxPayloadBytes)
      throw new Error(
        `MEMORY_PAYLOAD_TOO_LARGE: payload exceeds ${this.maxPayloadBytes} bytes`,
      );
  }

  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const key = `${normalizeWorkspacePath(this.storageRoot)}\u0000${normalizeWorkspacePath(this.workspacePath)}`;
    const previous = mutationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    mutationQueues.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (mutationQueues.get(key) === current) mutationQueues.delete(key);
    }
  }
}

function containsRedaction(value: unknown): boolean {
  return JSON.stringify(value).includes(REDACTED_SECRET);
}

function emptyState(workspaceId: string, workspacePath: string): MemoryState {
  const now = new Date().toISOString();
  return {
    version: 1,
    workspaceId,
    workspacePath,
    createdAt: now,
    updatedAt: now,
    active: null,
    facts: [],
    recentChanges: [],
  };
}

function sanitizeActive(input: SaveCheckpointInput): MemoryActiveState {
  const safe = sanitizeValue({
    currentTask: input.currentTask,
    completedSteps: input.completedSteps,
    pendingSteps: input.pendingSteps,
    criticalContext: input.criticalContext,
  }).value as MemoryActiveState;
  const completedSteps = dedupeTextValues(safe.completedSteps).slice(0, 100);
  const completed = new Set(completedSteps.map(normalizeMemoryKey));
  const pendingSteps = dedupeTextValues(safe.pendingSteps)
    .filter((entry) => !completed.has(normalizeMemoryKey(entry)))
    .slice(0, 100);
  return {
    currentTask: safe.currentTask.trim(),
    completedSteps,
    pendingSteps,
    criticalContext: safe.criticalContext.trim(),
  };
}

function selectFacts(
  facts: MemoryFact[],
  limit: number,
  query?: string,
): MemoryFact[] {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return facts.slice(0, limit);
  const ranked = facts
    .map((fact, index) => ({
      fact,
      index,
      score: memorySearchScore(fact, trimmedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.fact.updatedAt) - Date.parse(a.fact.updatedAt) ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.fact);
  return ranked.length > 0 ? ranked : facts.slice(0, limit);
}

function memorySearchScore(fact: MemoryFact, query: string): number {
  const normalizedQuery = normalizeMemoryKey(query);
  if (!normalizedQuery) return 0;
  const key = normalizeMemoryKey(fact.key);
  const value = normalizeMemoryKey(fact.value);
  const tags = fact.tags.map(normalizeMemoryKey);
  const tokens = tokenizeMemoryQuery(normalizedQuery);
  let score = 0;
  if (key === normalizedQuery) score += 40;
  else if (key.includes(normalizedQuery)) score += 24;
  if (value.includes(normalizedQuery)) score += 12;
  if (tags.some((tag) => tag === normalizedQuery)) score += 18;
  else if (tags.some((tag) => tag.includes(normalizedQuery))) score += 10;
  for (const token of tokens) {
    if (key.includes(token)) score += 7;
    if (tags.some((tag) => tag.includes(token))) score += 5;
    if (value.includes(token)) score += 2;
  }
  if (score > 0) {
    if (fact.category === "rule") score += 4;
    else if (fact.category === "decision") score += 3;
    else if (fact.category === "fact") score += 1;
  }
  return score;
}

function tokenizeMemoryQuery(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((entry) => entry.trim())
        .filter(
          (entry) => entry.length >= 2 && !MEMORY_QUERY_STOP_WORDS.has(entry),
        ),
    ),
  ].slice(0, 48);
}

function normalizeMemoryKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function dedupeTextValues(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalized = normalizeMemoryKey(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function sameActive(
  left: MemoryActiveState,
  right: MemoryActiveState,
): boolean {
  return (
    normalizeMemoryKey(left.currentTask) ===
      normalizeMemoryKey(right.currentTask) &&
    arraysEqual(left.completedSteps, right.completedSteps) &&
    arraysEqual(left.pendingSteps, right.pendingSteps) &&
    normalizeMemoryKey(left.criticalContext) ===
      normalizeMemoryKey(right.criticalContext)
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (value, index) =>
      normalizeMemoryKey(value) === normalizeMemoryKey(right[index] ?? ""),
  );
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (input === undefined || !Number.isFinite(input)) return fallback;
  return Math.max(1, Math.min(Math.floor(input), fallback));
}

function normalizeWorkspacePath(input: string): string {
  const normalized = path.normalize(path.resolve(input));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

function renderMemoryMarkdown(
  state: MemoryState,
  checkpoints: MemoryCheckpoint[],
): string {
  const active = state.active;
  const lines = [
    "# Qnector Memory",
    "",
    `- Workspace: ${state.workspacePath}`,
    `- Workspace ID: ${state.workspaceId}`,
    `- Last Updated: ${state.updatedAt}`,
    "",
    "## Current Task",
    "",
    active?.currentTask || "(none)",
    "",
    "## Pending Steps",
    "",
    ...(active?.pendingSteps.length
      ? active.pendingSteps.map((entry) => `- ${entry}`)
      : ["(none)"]),
    "",
    "## Completed Steps",
    "",
    ...(active?.completedSteps.length
      ? active.completedSteps.map((entry) => `- ${entry}`)
      : ["(none)"]),
    "",
    "## Critical Context",
    "",
    active?.criticalContext || "(none)",
    "",
    "## Core Facts",
    "",
    ...(state.facts.length
      ? state.facts.map(
          (fact) =>
            `- **${fact.category} — ${fact.key}:** ${fact.value}${fact.tags.length ? ` _(tags: ${fact.tags.join(", ")})_` : ""}`,
        )
      : ["(none)"]),
    "",
    "## Recent Qnector Changes",
    "",
    ...(state.recentChanges.length
      ? state.recentChanges
          .slice(0, 20)
          .map(
            (change) =>
              `- ${change.timestamp} — ${change.source}: ${change.summary}${change.paths.length ? ` (${change.paths.join(", ")})` : ""}`,
          )
      : ["(none)"]),
    "",
    "## Checkpoints",
    "",
    ...(checkpoints.length
      ? [...checkpoints]
          .reverse()
          .map(
            (checkpoint) =>
              `- ${checkpoint.createdAt}${checkpoint.label ? ` — ${checkpoint.label}` : ""}`,
          )
      : ["(none)"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
