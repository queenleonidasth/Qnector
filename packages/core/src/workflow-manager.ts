import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileWatchService } from "./file-watch.js";
import type { ProcessManager, ProcessShell } from "./process-manager.js";

export type WorkflowStep =
  | {
      id?: string;
      type: "command";
      command: string;
      cwd?: string;
      shell?: ProcessShell;
      timeoutMs?: number;
    }
  | {
      id?: string;
      type: "wait_for_port";
      host?: string;
      port: number;
      timeoutMs?: number;
    }
  | {
      id?: string;
      type: "wait_for_file";
      path?: string;
      pattern: string;
      timeoutMs?: number;
    }
  | {
      id?: string;
      type: "wait_for_change";
      path: string;
      timeoutMs?: number;
    }
  | { id?: string; type: "delay"; delayMs: number };

export interface WorkflowDefinition {
  version: 1;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStep {
  index: number;
  id: string;
  type: WorkflowStep["type"];
  state: "pending" | "running" | "succeeded" | "failed" | "canceled";
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  error?: string;
}

export interface WorkflowRun {
  runId: string;
  workflow: string;
  workspace: string;
  state: "pending" | "running" | "succeeded" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  currentStep: number | null;
  steps: WorkflowRunStep[];
  error?: string;
}

export class WorkflowManager {
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly canceled = new Set<string>();

  public constructor(
    private readonly processManager: ProcessManager,
    private readonly fileWatch: FileWatchService,
  ) {}

  public async save(
    workspace: string,
    input: { name: string; description?: string; steps: WorkflowStep[] },
  ): Promise<WorkflowDefinition> {
    const name = validateName(input.name);
    const steps = validateSteps(input.steps);
    const existing = await this.get(workspace, name).catch(() => null);
    const now = new Date().toISOString();
    const definition: WorkflowDefinition = {
      version: 1,
      name,
      ...(input.description?.trim()
        ? { description: input.description.trim().slice(0, 2_000) }
        : {}),
      steps,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await writeJsonAtomic(this.definitionPath(workspace, name), definition);
    return definition;
  }

  public async list(workspace: string): Promise<WorkflowDefinition[]> {
    const directory = this.definitionDirectory(workspace);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const result: WorkflowDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        result.push(await this.get(workspace, entry.name.slice(0, -5)));
      } catch {
        // Ignore malformed definitions so one file cannot break the workflow list.
      }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async get(
    workspace: string,
    name: string,
  ): Promise<WorkflowDefinition> {
    const safe = validateName(name);
    const parsed = JSON.parse(
      await readFile(this.definitionPath(workspace, safe), "utf8"),
    ) as Partial<WorkflowDefinition>;
    if (
      parsed.version !== 1 ||
      parsed.name !== safe ||
      !Array.isArray(parsed.steps)
    )
      throw new Error(`WORKFLOW_INVALID: ${safe}`);
    return {
      version: 1,
      name: safe,
      ...(typeof parsed.description === "string"
        ? { description: parsed.description }
        : {}),
      steps: validateSteps(parsed.steps as WorkflowStep[]),
      createdAt:
        typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  }

  public async start(workspace: string, name: string): Promise<WorkflowRun> {
    const definition = await this.get(workspace, name);
    const now = new Date().toISOString();
    const run: WorkflowRun = {
      runId: `workflow_${randomUUID()}`,
      workflow: definition.name,
      workspace: path.resolve(workspace),
      state: "pending",
      createdAt: now,
      updatedAt: now,
      currentStep: null,
      steps: definition.steps.map((step, index) => ({
        index,
        id: step.id?.trim() || `step_${index + 1}`,
        type: step.type,
        state: "pending",
      })),
    };
    this.runs.set(run.runId, run);
    await this.persistRun(run);
    void this.execute(run, definition, 0);
    return cloneRun(run);
  }

  public async status(workspace: string, runId: string): Promise<WorkflowRun> {
    const inMemory = this.runs.get(runId);
    if (inMemory) return cloneRun(inMemory);
    return this.loadRun(workspace, runId);
  }

  public async listRuns(
    workspace: string,
    maxResults = 50,
  ): Promise<WorkflowRun[]> {
    const directory = this.runDirectory(workspace);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const runs: WorkflowRun[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        runs.push(await this.loadRun(workspace, entry.name.slice(0, -5)));
      } catch {
        // Ignore malformed historical run files.
      }
    }
    return runs
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(maxResults, 200)));
  }

  public async cancel(workspace: string, runId: string): Promise<WorkflowRun> {
    const run = this.runs.get(runId) ?? (await this.loadRun(workspace, runId));
    this.runs.set(runId, run);
    this.canceled.add(runId);
    if (run.state === "pending" || run.state === "running") {
      run.state = "canceled";
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
      if (
        run.currentStep !== null &&
        run.steps[run.currentStep]?.state === "running"
      ) {
        const step = run.steps[run.currentStep]!;
        step.state = "canceled";
        step.endedAt = run.endedAt;
      }
      await this.persistRun(run);
    }
    return cloneRun(run);
  }

  public async resume(workspace: string, runId: string): Promise<WorkflowRun> {
    const run = this.runs.get(runId) ?? (await this.loadRun(workspace, runId));
    if (run.state === "running") return cloneRun(run);
    if (run.state === "succeeded") return cloneRun(run);
    const definition = await this.get(workspace, run.workflow);
    const nextIndex = run.steps.findIndex((step) => step.state !== "succeeded");
    if (nextIndex < 0) return cloneRun(run);
    for (let index = nextIndex; index < run.steps.length; index += 1) {
      const step = run.steps[index]!;
      step.state = "pending";
      delete step.startedAt;
      delete step.endedAt;
      delete step.summary;
      delete step.error;
    }
    run.state = "pending";
    run.currentStep = null;
    delete run.endedAt;
    delete run.error;
    run.updatedAt = new Date().toISOString();
    this.canceled.delete(runId);
    this.runs.set(runId, run);
    await this.persistRun(run);
    void this.execute(run, definition, nextIndex);
    return cloneRun(run);
  }

  private async execute(
    run: WorkflowRun,
    definition: WorkflowDefinition,
    startIndex: number,
  ): Promise<void> {
    run.state = "running";
    run.startedAt ??= new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    await this.persistRun(run);
    try {
      for (
        let index = startIndex;
        index < definition.steps.length;
        index += 1
      ) {
        if (this.canceled.has(run.runId)) return;
        const stepDefinition = definition.steps[index]!;
        const step = run.steps[index]!;
        run.currentStep = index;
        step.state = "running";
        step.startedAt = new Date().toISOString();
        run.updatedAt = step.startedAt;
        await this.persistRun(run);
        try {
          step.summary = await this.executeStep(run.workspace, stepDefinition);
          if (this.canceled.has(run.runId)) {
            step.state = "canceled";
            step.endedAt = new Date().toISOString();
            return;
          }
          step.state = "succeeded";
          step.endedAt = new Date().toISOString();
        } catch (error) {
          step.state = "failed";
          step.endedAt = new Date().toISOString();
          step.error = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          run.updatedAt = new Date().toISOString();
          await this.persistRun(run);
        }
      }
      run.state = "succeeded";
      run.currentStep = null;
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
      await this.persistRun(run);
    } catch (error) {
      run.state = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
      await this.persistRun(run);
    }
  }

  private async executeStep(
    workspace: string,
    step: WorkflowStep,
  ): Promise<string> {
    if (step.type === "command") {
      const result = await this.processManager.run({
        command: step.command,
        cwd: path.resolve(workspace, step.cwd ?? "."),
        shell: step.shell,
        timeoutMs: clamp(step.timeoutMs ?? 120_000, 100, 600_000),
        maxChars: 20_000,
        outputMode: "smart",
      });
      if (result.exitCode !== 0)
        throw new Error(
          `WORKFLOW_COMMAND_FAILED: exit ${result.exitCode ?? "null"}: ${step.command}\n${result.stderr || result.stdout}`,
        );
      const output = (result.stdout || result.stderr)
        .trim()
        .replace(/\s+/g, " ");
      return `Command exited 0${output ? ` — ${output.slice(0, 800)}` : ""}`;
    }
    if (step.type === "wait_for_port") {
      const result = await this.processManager.waitForPort({
        host: step.host ?? "127.0.0.1",
        port: step.port,
        timeoutMs: clamp(step.timeoutMs ?? 60_000, 100, 600_000),
      });
      return `${result.host}:${result.port} ready after ${result.elapsedMs} ms`;
    }
    if (step.type === "wait_for_file") {
      const result = await this.fileWatch.waitForFile({
        root: path.resolve(workspace, step.path ?? "."),
        pattern: step.pattern,
        timeoutMs: clamp(step.timeoutMs ?? 60_000, 100, 120_000),
        maxResults: 20,
      });
      return `Found ${result.matches.length} matching file(s) after ${result.elapsedMs} ms`;
    }
    if (step.type === "wait_for_change") {
      const result = await this.fileWatch.waitForChange({
        path: path.resolve(workspace, step.path),
        timeoutMs: clamp(step.timeoutMs ?? 60_000, 100, 120_000),
      });
      return `Detected file change after ${result.elapsedMs} ms`;
    }
    const delay = clamp(step.delayMs, 0, 120_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return `Waited ${delay} ms`;
  }

  private definitionDirectory(workspace: string): string {
    return path.join(path.resolve(workspace), ".qnector", "workflows");
  }

  private definitionPath(workspace: string, name: string): string {
    return path.join(
      this.definitionDirectory(workspace),
      `${validateName(name)}.json`,
    );
  }

  private runDirectory(workspace: string): string {
    return path.join(path.resolve(workspace), ".qnector", "workflow-runs");
  }

  private runPath(workspace: string, runId: string): string {
    if (!/^workflow_[a-z0-9-]+$/i.test(runId))
      throw new Error("INVALID_INPUT: invalid workflow runId");
    return path.join(this.runDirectory(workspace), `${runId}.json`);
  }

  private async persistRun(run: WorkflowRun): Promise<void> {
    await writeJsonAtomic(this.runPath(run.workspace, run.runId), run);
  }

  private async loadRun(
    workspace: string,
    runId: string,
  ): Promise<WorkflowRun> {
    const parsed = JSON.parse(
      await readFile(this.runPath(workspace, runId), "utf8"),
    ) as WorkflowRun;
    if (!parsed || parsed.runId !== runId || !Array.isArray(parsed.steps))
      throw new Error(`WORKFLOW_RUN_INVALID: ${runId}`);
    return parsed;
  }
}

function validateName(value: string): string {
  const name = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(name))
    throw new Error(
      "INVALID_INPUT: workflow name must be 1-80 letters, numbers, dots, underscores, or dashes",
    );
  return name;
}

function validateSteps(value: WorkflowStep[]): WorkflowStep[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new Error("INVALID_INPUT: workflow steps must contain 1-100 steps");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object")
      throw new Error(
        `INVALID_INPUT: workflow step ${index + 1} must be an object`,
      );
    if (raw.type === "command") {
      if (!raw.command?.trim())
        throw new Error(
          `INVALID_INPUT: workflow command step ${index + 1} requires command`,
        );
      if (raw.shell && !["powershell", "cmd", "direct"].includes(raw.shell))
        throw new Error(
          `INVALID_INPUT: workflow command step ${index + 1} has invalid shell`,
        );
      return { ...raw, command: raw.command.trim() };
    }
    if (raw.type === "wait_for_port") {
      if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535)
        throw new Error(
          `INVALID_INPUT: workflow wait_for_port step ${index + 1} requires port 1-65535`,
        );
      return { ...raw };
    }
    if (raw.type === "wait_for_file") {
      if (!raw.pattern?.trim())
        throw new Error(
          `INVALID_INPUT: workflow wait_for_file step ${index + 1} requires pattern`,
        );
      return { ...raw, pattern: raw.pattern.trim() };
    }
    if (raw.type === "wait_for_change") {
      if (!raw.path?.trim())
        throw new Error(
          `INVALID_INPUT: workflow wait_for_change step ${index + 1} requires path`,
        );
      return { ...raw, path: raw.path.trim() };
    }
    if (raw.type === "delay") {
      if (!Number.isFinite(raw.delayMs) || raw.delayMs < 0)
        throw new Error(
          `INVALID_INPUT: workflow delay step ${index + 1} requires non-negative delayMs`,
        );
      return { ...raw, delayMs: clamp(raw.delayMs, 0, 120_000) };
    }
    throw new Error(
      `INVALID_INPUT: workflow step ${index + 1} has unsupported type`,
    );
  });
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function cloneRun(run: WorkflowRun): WorkflowRun {
  return structuredClone(run);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
