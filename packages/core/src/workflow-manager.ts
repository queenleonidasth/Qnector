import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { FileWatchService } from "./file-watch.js";
import type {
  ProcessManager,
  ProcessShell,
  RunResult,
} from "./process-manager.js";

export type WorkflowMode = "sequential" | "graph";
export type WorkflowReplayPolicy = "safe" | "manual";
export type WorkflowVerificationStatus = "passed" | "failed" | "unverified";

interface WorkflowStepBase {
  id?: string;
  dependsOn?: string[];
  resourcePaths?: string[];
  outputs?: string[];
  replay?: WorkflowReplayPolicy;
}

export type WorkflowStep = WorkflowStepBase &
  (
    | {
        type: "command";
        command: string;
        cwd?: string;
        shell?: ProcessShell;
        timeoutMs?: number;
      }
    | {
        type: "tool";
        tool: string;
        input: Record<string, unknown>;
        timeoutMs?: number;
        expect?: { contains?: string[] };
      }
    | {
        type: "wait_for_port";
        host?: string;
        port: number;
        timeoutMs?: number;
      }
    | {
        type: "wait_for_file";
        path?: string;
        pattern: string;
        timeoutMs?: number;
      }
    | {
        type: "wait_for_change";
        path: string;
        timeoutMs?: number;
      }
    | { type: "delay"; delayMs: number }
  );

export interface WorkflowDefinition {
  version: 1;
  name: string;
  description?: string;
  mode: WorkflowMode;
  maxConcurrency: number;

  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRunState =
  | "pending"
  | "running"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted";

export type WorkflowRunStepState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted"
  | "skipped";

export interface WorkflowRunStep {
  index: number;
  id: string;
  type: WorkflowStep["type"];
  state: WorkflowRunStepState;
  dependsOn: string[];
  resourcePaths: string[];
  outputs: string[];
  attempt: number;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  resultFile?: string;
  verificationStatus?: WorkflowVerificationStatus;
}

export interface WorkflowRun {
  runId: string;
  workflow: string;
  workspace: string;
  state: WorkflowRunState;
  mode: WorkflowMode;
  maxConcurrency: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  currentStep: number | null;
  activeSteps: string[];
  steps: WorkflowRunStep[];
  definition: WorkflowDefinition;

  memoryTaskId?: string;
  error?: string;
}

export interface WorkflowStepResult {
  runId: string;
  stepId: string;
  attempt: number;
  type: WorkflowStep["type"];
  state: "succeeded" | "failed" | "canceled" | "interrupted";
  startedAt: string;
  endedAt: string;
  summary: string;
  verificationStatus: WorkflowVerificationStatus;
  outputs: string[];
  error?: string;
  command?: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    truncated: boolean;
    sha256: string;
  };
  tool?: {
    name: string;
    result: unknown;
  };

  data?: unknown;
}

export interface WorkflowWaitResult {
  run: WorkflowRun;
  timedOut: boolean;
}

export interface WorkflowResultIndex {
  run: WorkflowRun;
  results: Array<{
    stepId: string;
    state: WorkflowRunStepState;
    attempt: number;
    resultFile?: string;
    summary?: string;
    error?: string;
    verificationStatus?: WorkflowVerificationStatus;
  }>;
}

export type WorkflowToolExecutor = (
  tool: string,
  input: Record<string, unknown>,
  context: {
    workspace: string;
    runId: string;
    stepId: string;
    memoryTaskId?: string;
  },
) => Promise<unknown>;

export interface WorkflowManagerOptions {
  executeTool?: WorkflowToolExecutor;
}

type StepExecutionPayload = {
  ok: boolean;
  summary: string;
  verificationStatus: WorkflowVerificationStatus;
  error?: string;
  command?: WorkflowStepResult["command"];
  tool?: WorkflowStepResult["tool"];
  data?: unknown;
};

const TERMINAL_RUN_STATES = new Set<WorkflowRunState>([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
]);

const TERMINAL_STEP_STATES = new Set<WorkflowRunStepState>([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
  "skipped",
]);

export class WorkflowManager {
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly canceled = new Set<string>();
  private readonly executions = new Map<string, Promise<void>>();
  private readonly activeControllers = new Map<
    string,
    Map<string, AbortController>
  >();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly executeTool?: WorkflowToolExecutor;

  public constructor(
    private readonly processManager: ProcessManager,
    private readonly fileWatch: FileWatchService,
    options: WorkflowManagerOptions = {},
  ) {
    this.executeTool = options.executeTool;
  }

  public async save(
    workspace: string,
    input: {
      name: string;
      description?: string;
      mode?: WorkflowMode;
      maxConcurrency?: number;
      steps: WorkflowStep[];
    },
  ): Promise<WorkflowDefinition> {
    const name = validateName(input.name);
    const existing = await this.get(workspace, name).catch(() => null);
    const now = new Date().toISOString();
    const definition = validateDefinition({
      version: 1,
      name,
      ...(input.description?.trim()
        ? { description: input.description.trim().slice(0, 2_000) }
        : {}),
      mode: input.mode ?? "sequential",
      maxConcurrency: input.maxConcurrency ?? (input.mode === "graph" ? 4 : 1),
      steps: input.steps,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
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
    return validateDefinition({
      version: 1,
      name: safe,
      ...(typeof parsed.description === "string"
        ? { description: parsed.description }
        : {}),
      mode: parsed.mode === "graph" ? "graph" : "sequential",
      maxConcurrency:
        typeof parsed.maxConcurrency === "number"
          ? parsed.maxConcurrency
          : parsed.mode === "graph"
            ? 4
            : 1,
      steps: parsed.steps as WorkflowStep[],
      createdAt:
        typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    });
  }

  public async start(
    workspace: string,
    name: string,
    memoryTaskId?: string,
  ): Promise<WorkflowRun> {
    const definition = await this.get(workspace, name);
    return this.startDefinition(workspace, definition, memoryTaskId);
  }

  public async run(
    workspace: string,
    input: {
      name: string;
      description?: string;
      mode?: WorkflowMode;
      maxConcurrency?: number;
      steps: WorkflowStep[];
      memoryTaskId?: string;
    },
  ): Promise<WorkflowRun> {
    const now = new Date().toISOString();
    const definition = validateDefinition({
      version: 1,
      name: validateName(input.name),
      ...(input.description?.trim()
        ? { description: input.description.trim().slice(0, 2_000) }
        : {}),
      mode: input.mode ?? "graph",
      maxConcurrency:
        input.maxConcurrency ?? (input.mode === "sequential" ? 1 : 4),
      steps: input.steps,
      createdAt: now,
      updatedAt: now,
    });
    return this.startDefinition(workspace, definition, input.memoryTaskId);
  }

  private async startDefinition(
    workspace: string,
    definition: WorkflowDefinition,
    memoryTaskId?: string,
  ): Promise<WorkflowRun> {
    const now = new Date().toISOString();
    const run: WorkflowRun = {
      runId: `workflow_${randomUUID()}`,
      workflow: definition.name,
      workspace: path.resolve(workspace),
      state: "pending",
      mode: definition.mode,
      maxConcurrency: definition.maxConcurrency,
      createdAt: now,
      updatedAt: now,
      currentStep: null,
      activeSteps: [],
      definition: structuredClone(definition),
      ...(memoryTaskId ? { memoryTaskId } : {}),
      steps: definition.steps.map((step, index) => ({
        index,
        id: step.id!,
        type: step.type,
        state: "pending",
        dependsOn: [...(step.dependsOn ?? [])],
        resourcePaths: [...(step.resourcePaths ?? [])],
        outputs: [...(step.outputs ?? [])],
        attempt: 0,
      })),
    };
    this.runs.set(run.runId, run);
    await this.persistRun(run);
    this.launch(run, definition);
    return cloneRun(run);
  }

  public async status(workspace: string, runId: string): Promise<WorkflowRun> {
    const inMemory = this.runs.get(runId);
    if (inMemory) return cloneRun(inMemory);
    const loaded = await this.loadRun(workspace, runId);
    this.runs.set(runId, loaded);
    return cloneRun(loaded);
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
        const run = await this.loadRun(workspace, entry.name.slice(0, -5));
        this.runs.set(run.runId, run);
        runs.push(run);
      } catch {
        // Ignore malformed historical run files.
      }
    }
    return runs
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(maxResults, 200)))
      .map(cloneRun);
  }

  public async wait(
    workspace: string,
    runId: string,
    timeoutMs = 120_000,
  ): Promise<WorkflowWaitResult> {
    const initial = await this.status(workspace, runId);
    if (TERMINAL_RUN_STATES.has(initial.state))
      return { run: initial, timedOut: false };
    const execution = this.executions.get(runId);
    if (!execution) {
      const refreshed = await this.status(workspace, runId);
      return { run: refreshed, timedOut: false };
    }
    const bounded = clamp(timeoutMs, 1, 600_000);
    let timedOut = false;
    await Promise.race([
      execution,
      new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, bounded),
      ),
    ]);
    return { run: await this.status(workspace, runId), timedOut };
  }

  public async result(
    workspace: string,
    runId: string,
    stepId?: string,
  ): Promise<WorkflowResultIndex | WorkflowStepResult> {
    const run = await this.status(workspace, runId);
    if (stepId) {
      const step = run.steps.find((entry) => entry.id === stepId);
      if (!step) throw new Error(`WORKFLOW_STEP_NOT_FOUND: ${stepId}`);
      if (!step.resultFile)
        throw new Error(`WORKFLOW_RESULT_NOT_READY: ${stepId}`);
      return JSON.parse(
        await readFile(path.join(run.workspace, step.resultFile), "utf8"),
      ) as WorkflowStepResult;
    }
    return {
      run,
      results: run.steps.map((step) => ({
        stepId: step.id,
        state: step.state,
        attempt: step.attempt,
        ...(step.resultFile ? { resultFile: step.resultFile } : {}),
        ...(step.summary ? { summary: step.summary } : {}),
        ...(step.error ? { error: step.error } : {}),
        ...(step.verificationStatus
          ? { verificationStatus: step.verificationStatus }
          : {}),
      })),
    };
  }

  public async cancel(workspace: string, runId: string): Promise<WorkflowRun> {
    const run = this.runs.get(runId) ?? (await this.loadRun(workspace, runId));
    this.runs.set(runId, run);
    if (TERMINAL_RUN_STATES.has(run.state)) return cloneRun(run);

    this.canceled.add(runId);
    run.state = "canceling";
    run.updatedAt = new Date().toISOString();
    await this.persistRun(run);
    for (const controller of this.activeControllers.get(runId)?.values() ?? [])
      controller.abort();

    const execution = this.executions.get(runId);
    if (execution) await execution;
    else await this.finalizeCanceled(run);
    return cloneRun(this.runs.get(runId) ?? run);
  }

  public async resume(
    workspace: string,
    runId: string,
    options: { replayInterrupted?: boolean } = {},
  ): Promise<WorkflowRun> {
    const run = this.runs.get(runId) ?? (await this.loadRun(workspace, runId));
    this.runs.set(runId, run);
    if (
      this.executions.has(runId) ||
      run.state === "running" ||
      run.state === "canceling"
    )
      return cloneRun(run);
    if (run.state === "succeeded") return cloneRun(run);

    const definition = validateDefinition(run.definition);
    const unknownOutcome = run.steps.filter(
      (step) => step.state === "interrupted",
    );
    const unsafe = unknownOutcome.filter((runStep) => {
      const definitionStep = definition.steps[runStep.index];
      return (
        definitionStep &&
        (definitionStep.type === "command" || definitionStep.type === "tool") &&
        definitionStep.replay !== "safe"
      );
    });
    if (unsafe.length > 0 && !options.replayInterrupted)
      throw new Error(
        `WORKFLOW_REPLAY_CONFIRMATION_REQUIRED: interrupted step(s) have unknown mutation outcome: ${unsafe.map((step) => step.id).join(", ")}`,
      );

    for (const step of run.steps) {
      if (step.state === "succeeded") continue;
      step.state = "pending";
      delete step.startedAt;
      delete step.endedAt;
      delete step.summary;
      delete step.error;
      delete step.verificationStatus;
    }
    run.state = "pending";
    run.currentStep = null;
    run.activeSteps = [];
    delete run.endedAt;
    delete run.error;
    run.updatedAt = new Date().toISOString();
    this.canceled.delete(runId);
    await this.persistRun(run);
    this.launch(run, definition);
    return cloneRun(run);
  }

  private launch(run: WorkflowRun, definition: WorkflowDefinition): void {
    const execution = this.execute(run, definition);
    this.executions.set(run.runId, execution);
    void execution.finally(() => {
      if (this.executions.get(run.runId) === execution)
        this.executions.delete(run.runId);
    });
  }

  private async execute(
    run: WorkflowRun,
    definition: WorkflowDefinition,
  ): Promise<void> {
    run.state = "running";
    run.startedAt ??= new Date().toISOString();
    run.updatedAt = new Date().toISOString();
    await this.persistRun(run);
    try {
      if (definition.mode === "graph") await this.executeGraph(run, definition);
      else await this.executeSequential(run, definition);
      if (this.canceled.has(run.runId)) {
        await this.finalizeCanceled(run);
        return;
      }
      const failures = run.steps.filter((step) =>
        ["failed", "interrupted"].includes(step.state),
      );
      run.state = failures.length > 0 ? "failed" : "succeeded";
      run.currentStep = null;
      run.activeSteps = [];
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
      if (failures.length > 0)
        run.error = `${failures.length} workflow step(s) failed: ${failures.map((step) => step.id).join(", ")}`;
      else delete run.error;
      await this.persistRun(run);
    } catch (error) {
      if (this.canceled.has(run.runId)) {
        await this.finalizeCanceled(run);
        return;
      }
      run.state = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      run.currentStep = null;
      run.activeSteps = [];
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
      await this.persistRun(run);
    } finally {
      this.activeControllers.delete(run.runId);
    }
  }

  private async executeSequential(
    run: WorkflowRun,
    definition: WorkflowDefinition,
  ): Promise<void> {
    for (let index = 0; index < definition.steps.length; index += 1) {
      if (this.canceled.has(run.runId)) return;
      const runStep = run.steps[index]!;
      if (runStep.state === "succeeded") continue;
      run.currentStep = index;
      await this.executeOne(run, definition.steps[index]!, runStep);
      if (runStep.state === "failed" || runStep.state === "interrupted") {
        for (let rest = index + 1; rest < run.steps.length; rest += 1) {
          const pending = run.steps[rest]!;
          if (pending.state !== "pending") continue;
          pending.state = "skipped";
          pending.error = `Skipped because ${runStep.id} did not succeed`;
          pending.endedAt = new Date().toISOString();
        }
        await this.persistRun(run);
        return;
      }
    }
  }

  private async executeGraph(
    run: WorkflowRun,
    definition: WorkflowDefinition,
  ): Promise<void> {
    const active = new Map<string, Promise<void>>();
    const activeResources = new Map<string, string[]>();

    while (true) {
      if (this.canceled.has(run.runId)) {
        await Promise.allSettled(active.values());
        return;
      }

      let changed = false;
      for (const step of run.steps) {
        if (step.state !== "pending") continue;
        const dependencies = step.dependsOn.map((id) =>
          run.steps.find((candidate) => candidate.id === id),
        );
        const blocked = dependencies.find(
          (dependency) =>
            dependency &&
            ["failed", "canceled", "interrupted", "skipped"].includes(
              dependency.state,
            ),
        );
        if (!blocked) continue;
        step.state = "skipped";
        step.error = `Skipped because dependency ${blocked.id} is ${blocked.state}`;
        step.endedAt = new Date().toISOString();
        changed = true;
      }
      if (changed) await this.persistRun(run);

      const unfinished = run.steps.filter(
        (step) => !TERMINAL_STEP_STATES.has(step.state),
      );
      if (unfinished.length === 0 && active.size === 0) return;

      let started = false;
      for (const runStep of run.steps) {
        if (active.size >= definition.maxConcurrency) break;
        if (runStep.state !== "pending") continue;
        if (
          !runStep.dependsOn.every(
            (id) =>
              run.steps.find((candidate) => candidate.id === id)?.state ===
              "succeeded",
          )
        )
          continue;
        const resources = runStep.resourcePaths.map((resource) =>
          normalizeResource(run.workspace, resource),
        );
        if (
          [...activeResources.values()].some((held) =>
            resources.some((resource) =>
              held.some((candidate) => resourcesOverlap(resource, candidate)),
            ),
          )
        )
          continue;

        const definitionStep = definition.steps[runStep.index]!;
        const promise = this.executeOne(run, definitionStep, runStep).then(
          () => {
            active.delete(runStep.id);
            activeResources.delete(runStep.id);
          },
        );
        active.set(runStep.id, promise);
        activeResources.set(runStep.id, resources);
        started = true;
      }

      run.activeSteps = [...active.keys()];
      run.currentStep = null;
      if (started) await this.persistRun(run);
      if (active.size > 0) {
        await Promise.race(active.values());
        continue;
      }

      const pending = run.steps.filter((step) => step.state === "pending");
      if (pending.length > 0)
        throw new Error(
          `WORKFLOW_SCHEDULER_DEADLOCK: pending steps could not be scheduled: ${pending.map((step) => step.id).join(", ")}`,
        );
      return;
    }
  }

  private async executeOne(
    run: WorkflowRun,
    definitionStep: WorkflowStep,
    runStep: WorkflowRunStep,
  ): Promise<void> {
    const controller = new AbortController();
    let controllers = this.activeControllers.get(run.runId);
    if (!controllers) {
      controllers = new Map();
      this.activeControllers.set(run.runId, controllers);
    }
    controllers.set(runStep.id, controller);
    runStep.state = "running";
    runStep.attempt += 1;
    runStep.startedAt = new Date().toISOString();
    delete runStep.endedAt;
    delete runStep.summary;
    delete runStep.error;
    run.updatedAt = runStep.startedAt;
    await this.persistRun(run);

    let payload: StepExecutionPayload | undefined;
    try {
      payload = await this.executeStep(run, definitionStep, controller.signal);
      if (controller.signal.aborted && definitionStep.type !== "tool") {
        runStep.state = "canceled";
        runStep.summary = "Canceled while executor was active";
        runStep.verificationStatus = "unverified";
      } else if (payload.ok) {
        await this.verifyDeclaredOutputs(
          run.workspace,
          definitionStep.outputs ?? [],
        );
        runStep.state = "succeeded";
        runStep.summary = payload.summary;
        runStep.verificationStatus = payload.verificationStatus;
      } else {
        runStep.state = "failed";
        runStep.summary = payload.summary;
        runStep.error = payload.error ?? payload.summary;
        runStep.verificationStatus = "failed";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted || this.canceled.has(run.runId)) {
        runStep.state = "canceled";
        runStep.summary = "Canceled while executor was active";
        runStep.error = message;
        runStep.verificationStatus = "unverified";
      } else {
        runStep.state = "failed";
        runStep.error = message;
        runStep.summary = message;
        runStep.verificationStatus = "failed";
      }
    } finally {
      controllers.delete(runStep.id);
      runStep.endedAt = new Date().toISOString();
      run.updatedAt = runStep.endedAt;
      const result = this.makeStepResult(run, runStep, payload);
      runStep.resultFile = await this.persistStepResult(run, result);
      await this.persistRun(run);
    }
  }

  private async executeStep(
    run: WorkflowRun,
    step: WorkflowStep,
    signal: AbortSignal,
  ): Promise<StepExecutionPayload> {
    if (step.type === "command") {
      const result = await this.processManager.run({
        command: step.command,
        cwd: path.resolve(run.workspace, step.cwd ?? "."),
        shell: step.shell,
        timeoutMs: clamp(step.timeoutMs ?? 120_000, 100, 600_000),
        maxChars: 100_000,
        outputMode: "raw",
        signal,
      });
      const output = (result.stdout || result.stderr)
        .trim()
        .replace(/\s+/g, " ");
      const command = compactCommandResult(result);
      if (signal.aborted)
        return {
          ok: false,
          summary: "Command canceled",
          verificationStatus: "unverified",
          error: "WORKFLOW_COMMAND_CANCELED",
          command,
        };
      if (result.exitCode !== 0)
        return {
          ok: false,
          summary: `Command exited ${result.exitCode ?? "null"}`,
          verificationStatus: "failed",
          error: `WORKFLOW_COMMAND_FAILED: exit ${result.exitCode ?? "null"}: ${step.command}\n${result.stderr || result.stdout}`,
          command,
        };
      return {
        ok: true,
        summary: `Command exited 0${output ? ` — ${output.slice(0, 800)}` : ""}`,
        verificationStatus: step.outputs?.length ? "passed" : "unverified",
        command,
      };
    }

    if (step.type === "tool") {
      if (!this.executeTool)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: workflow tool steps are not configured in this runtime",
        );
      if (
        step.tool === "process" &&
        typeof step.input.action === "string" &&
        step.input.action.startsWith("workflow_")
      )
        throw new Error(
          "INVALID_INPUT: workflow tool steps cannot recursively invoke process.workflow_* actions",
        );
      const result = await withTimeout(
        this.executeTool(step.tool, step.input, {
          workspace: run.workspace,
          runId: run.runId,
          stepId: step.id!,
          ...(run.memoryTaskId ? { memoryTaskId: run.memoryTaskId } : {}),
        }),
        clamp(step.timeoutMs ?? 120_000, 100, 600_000),
        `WORKFLOW_TOOL_TIMEOUT: ${step.id}`,
      );
      const serialized = safeJsonValue(result);
      const record = serialized as {
        ok?: unknown;
        summary?: unknown;
        error?: unknown;
      };
      if (record && typeof record === "object" && record.ok === false) {
        const error =
          record.error && typeof record.error === "object"
            ? JSON.stringify(record.error)
            : String(record.summary ?? "tool returned ok=false");
        return {
          ok: false,
          summary: String(record.summary ?? `${step.tool} failed`),
          verificationStatus: "failed",
          error,
          tool: { name: step.tool, result: serialized },
        };
      }
      if (step.expect?.contains?.length) {
        const haystack = JSON.stringify(serialized);
        const missing = step.expect.contains.filter(
          (value) => !haystack.includes(value),
        );
        if (missing.length > 0)
          return {
            ok: false,
            summary: `Tool result did not satisfy ${missing.length} content assertion(s)`,
            verificationStatus: "failed",
            error: `WORKFLOW_ASSERTION_FAILED: missing ${missing.map((value) => JSON.stringify(value)).join(", ")}`,
            tool: { name: step.tool, result: serialized },
          };
      }
      return {
        ok: true,
        summary:
          typeof record?.summary === "string"
            ? record.summary
            : `${step.tool} completed`,
        verificationStatus:
          step.expect?.contains?.length || step.outputs?.length
            ? "passed"
            : "unverified",
        tool: { name: step.tool, result: serialized },
      };
    }

    if (step.type === "wait_for_port") {
      const result = await abortable(
        this.processManager.waitForPort({
          host: step.host ?? "127.0.0.1",
          port: step.port,
          timeoutMs: clamp(step.timeoutMs ?? 60_000, 100, 600_000),
        }),
        signal,
      );
      return {
        ok: true,
        summary: `${result.host}:${result.port} ready after ${result.elapsedMs} ms`,
        verificationStatus: "passed",
        data: result,
      };
    }
    if (step.type === "wait_for_file") {
      const result = await abortable(
        this.fileWatch.waitForFile({
          root: path.resolve(run.workspace, step.path ?? "."),
          pattern: step.pattern,
          timeoutMs: clamp(step.timeoutMs ?? 60_000, 100, 120_000),
          maxResults: 20,
        }),
        signal,
      );
      return {
        ok: true,
        summary: `Found ${result.matches.length} matching file(s) after ${result.elapsedMs} ms`,
        verificationStatus: "passed",
        data: result,
      };
    }
    if (step.type === "wait_for_change") {
      const result = await abortable(
        this.fileWatch.waitForChange({
          path: path.resolve(run.workspace, step.path),
          timeoutMs: clamp(step.timeoutMs ?? 60_000, 100, 120_000),
        }),
        signal,
      );
      return {
        ok: true,
        summary: `Detected file change after ${result.elapsedMs} ms`,
        verificationStatus: "passed",
        data: result,
      };
    }
    const delay = clamp(step.delayMs, 0, 120_000);
    await delayWithAbort(delay, signal);
    return {
      ok: true,
      summary: `Waited ${delay} ms`,
      verificationStatus: "passed",
    };
  }

  private makeStepResult(
    run: WorkflowRun,
    step: WorkflowRunStep,
    payload?: StepExecutionPayload,
  ): WorkflowStepResult {
    const state = ["succeeded", "failed", "canceled", "interrupted"].includes(
      step.state,
    )
      ? (step.state as WorkflowStepResult["state"])
      : "failed";
    return {
      runId: run.runId,
      stepId: step.id,
      attempt: step.attempt,
      type: step.type,
      state,
      startedAt: step.startedAt ?? new Date().toISOString(),
      endedAt: step.endedAt ?? new Date().toISOString(),
      summary: step.summary ?? step.error ?? state,
      verificationStatus: step.verificationStatus ?? "unverified",
      outputs: [...step.outputs],
      ...(step.error ? { error: step.error } : {}),
      ...(payload?.command ? { command: payload.command } : {}),
      ...(payload?.tool ? { tool: payload.tool } : {}),
      ...(payload?.data !== undefined ? { data: payload.data } : {}),
    };
  }

  private async verifyDeclaredOutputs(
    workspace: string,
    outputs: string[],
  ): Promise<void> {
    for (const output of outputs) {
      const target = path.resolve(workspace, output);
      try {
        await stat(target);
      } catch {
        throw new Error(`WORKFLOW_OUTPUT_MISSING: ${output}`);
      }
    }
  }

  private async finalizeCanceled(run: WorkflowRun): Promise<void> {
    const now = new Date().toISOString();
    for (const step of run.steps) {
      if (step.state === "running") {
        step.state = "canceled";
        step.endedAt = now;
        step.summary ??= "Canceled while executor was active";
        step.verificationStatus ??= "unverified";
      } else if (step.state === "pending") {
        step.state = "canceled";
        step.endedAt = now;
        step.summary = "Not started because workflow was canceled";
        step.verificationStatus = "unverified";
      }
    }
    run.state = "canceled";
    run.currentStep = null;
    run.activeSteps = [];
    run.endedAt = now;
    run.updatedAt = now;
    await this.persistRun(run);
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

  private resultDirectory(workspace: string, runId: string): string {
    return path.join(
      path.resolve(workspace),
      ".qnector",
      "workflow-results",
      runId,
    );
  }

  private runPath(workspace: string, runId: string): string {
    validateRunId(runId);
    return path.join(this.runDirectory(workspace), `${runId}.json`);
  }

  private async persistRun(run: WorkflowRun): Promise<void> {
    const snapshot = cloneRun(run);
    const previous = this.writeQueues.get(run.runId) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(() =>
        writeJsonAtomic(this.runPath(run.workspace, run.runId), snapshot),
      );
    this.writeQueues.set(run.runId, write);
    try {
      await write;
    } finally {
      if (this.writeQueues.get(run.runId) === write)
        this.writeQueues.delete(run.runId);
    }
  }

  private async persistStepResult(
    run: WorkflowRun,
    result: WorkflowStepResult,
  ): Promise<string> {
    const filename = `${safeStepFilename(result.stepId)}.json`;
    const absolute = path.join(
      this.resultDirectory(run.workspace, run.runId),
      filename,
    );
    await writeJsonAtomic(absolute, result);
    return path.relative(run.workspace, absolute);
  }

  private async loadRun(
    workspace: string,
    runId: string,
  ): Promise<WorkflowRun> {
    validateRunId(runId);
    const parsed = JSON.parse(
      await readFile(this.runPath(workspace, runId), "utf8"),
    ) as Partial<WorkflowRun>;
    if (!parsed || parsed.runId !== runId || !Array.isArray(parsed.steps))
      throw new Error(`WORKFLOW_RUN_INVALID: ${runId}`);

    const definition = parsed.definition
      ? validateDefinition(parsed.definition)
      : await this.get(workspace, String(parsed.workflow ?? ""));
    const run: WorkflowRun = {
      runId,
      workflow: definition.name,
      workspace: path.resolve(parsed.workspace ?? workspace),
      state: normalizeRunState(parsed.state),
      mode: parsed.mode === "graph" ? "graph" : definition.mode,
      maxConcurrency:
        typeof parsed.maxConcurrency === "number"
          ? clamp(parsed.maxConcurrency, 1, 8)
          : definition.maxConcurrency,
      createdAt:
        typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      ...(typeof parsed.startedAt === "string"
        ? { startedAt: parsed.startedAt }
        : {}),
      ...(typeof parsed.endedAt === "string"
        ? { endedAt: parsed.endedAt }
        : {}),
      currentStep:
        typeof parsed.currentStep === "number" ? parsed.currentStep : null,
      activeSteps: Array.isArray(parsed.activeSteps)
        ? parsed.activeSteps.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      definition,
      ...(typeof parsed.memoryTaskId === "string"
        ? { memoryTaskId: parsed.memoryTaskId }
        : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
      steps: definition.steps.map((step, index) => {
        const stored = parsed.steps?.[index] as
          Partial<WorkflowRunStep> | undefined;
        return {
          index,
          id: step.id!,
          type: step.type,
          state: normalizeStepState(stored?.state),
          dependsOn: [...(step.dependsOn ?? [])],
          resourcePaths: [...(step.resourcePaths ?? [])],
          outputs: [...(step.outputs ?? [])],
          attempt:
            typeof stored?.attempt === "number" && stored.attempt >= 0
              ? Math.floor(stored.attempt)
              : 0,
          ...(typeof stored?.startedAt === "string"
            ? { startedAt: stored.startedAt }
            : {}),
          ...(typeof stored?.endedAt === "string"
            ? { endedAt: stored.endedAt }
            : {}),
          ...(typeof stored?.summary === "string"
            ? { summary: stored.summary }
            : {}),
          ...(typeof stored?.error === "string" ? { error: stored.error } : {}),
          ...(typeof stored?.resultFile === "string"
            ? { resultFile: stored.resultFile }
            : {}),
          ...(stored?.verificationStatus === "passed" ||
          stored?.verificationStatus === "failed" ||
          stored?.verificationStatus === "unverified"
            ? { verificationStatus: stored.verificationStatus }
            : {}),
        };
      }),
    };

    if (["pending", "running", "canceling"].includes(run.state)) {
      const now = new Date().toISOString();
      for (const step of run.steps) {
        if (step.state === "running") {
          step.state = "interrupted";
          step.endedAt = now;
          step.error =
            "Executor ownership was lost when the previous runtime stopped";
          step.verificationStatus = "unverified";
        }
      }
      run.state = "interrupted";
      run.currentStep = null;
      run.activeSteps = [];
      run.endedAt = now;
      run.updatedAt = now;
      run.error =
        "Workflow runtime stopped before the run reached a terminal state";
      await writeJsonAtomic(this.runPath(run.workspace, run.runId), run);
    }
    return run;
  }
}

function validateDefinition(input: WorkflowDefinition): WorkflowDefinition {
  const name = validateName(input.name);
  const mode: WorkflowMode = input.mode === "graph" ? "graph" : "sequential";
  const maxConcurrency =
    mode === "graph" ? clamp(input.maxConcurrency ?? 4, 1, 8) : 1;
  const steps = validateSteps(input.steps);
  validateGraph(steps, mode);
  return {
    version: 1,
    name,
    ...(input.description?.trim()
      ? { description: input.description.trim().slice(0, 2_000) }
      : {}),
    mode,
    maxConcurrency,
    steps,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
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
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object")
      throw new Error(
        `INVALID_INPUT: workflow step ${index + 1} must be an object`,
      );
    const id = validateStepId(raw.id?.trim() || `step_${index + 1}`);
    if (seen.has(id))
      throw new Error(`INVALID_INPUT: duplicate workflow step id '${id}'`);
    seen.add(id);
    const common = {
      id,
      dependsOn: validateStringList(raw.dependsOn, "dependsOn", index),
      resourcePaths: validateStringList(
        raw.resourcePaths,
        "resourcePaths",
        index,
      ),
      outputs: validateStringList(raw.outputs, "outputs", index),
      replay: raw.replay === "safe" ? ("safe" as const) : ("manual" as const),
    };
    if (raw.type === "command") {
      if (!raw.command?.trim())
        throw new Error(
          `INVALID_INPUT: workflow command step ${index + 1} requires command`,
        );
      if (raw.shell && !["powershell", "cmd", "direct"].includes(raw.shell))
        throw new Error(
          `INVALID_INPUT: workflow command step ${index + 1} has invalid shell`,
        );
      return { ...common, ...raw, id, command: raw.command.trim() };
    }
    if (raw.type === "tool") {
      if (!raw.tool?.trim())
        throw new Error(
          `INVALID_INPUT: workflow tool step ${index + 1} requires tool`,
        );
      if (
        !raw.input ||
        typeof raw.input !== "object" ||
        Array.isArray(raw.input)
      )
        throw new Error(
          `INVALID_INPUT: workflow tool step ${index + 1} requires object input`,
        );
      const contains = raw.expect?.contains;
      if (
        contains !== undefined &&
        (!Array.isArray(contains) ||
          contains.some((entry) => typeof entry !== "string"))
      )
        throw new Error(
          `INVALID_INPUT: workflow tool step ${index + 1} expect.contains must be a string array`,
        );
      return {
        ...common,
        ...raw,
        id,
        tool: raw.tool.trim(),
        input: structuredClone(raw.input),
        ...(contains?.length
          ? { expect: { contains: contains.slice(0, 50) } }
          : {}),
      };
    }
    if (raw.type === "wait_for_port") {
      if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535)
        throw new Error(
          `INVALID_INPUT: workflow wait_for_port step ${index + 1} requires port 1-65535`,
        );
      return { ...common, ...raw, id, replay: "safe" };
    }
    if (raw.type === "wait_for_file") {
      if (!raw.pattern?.trim())
        throw new Error(
          `INVALID_INPUT: workflow wait_for_file step ${index + 1} requires pattern`,
        );
      return {
        ...common,
        ...raw,
        id,
        pattern: raw.pattern.trim(),
        replay: "safe",
      };
    }
    if (raw.type === "wait_for_change") {
      if (!raw.path?.trim())
        throw new Error(
          `INVALID_INPUT: workflow wait_for_change step ${index + 1} requires path`,
        );
      return { ...common, ...raw, id, path: raw.path.trim(), replay: "safe" };
    }
    if (raw.type === "delay") {
      if (!Number.isFinite(raw.delayMs) || raw.delayMs < 0)
        throw new Error(
          `INVALID_INPUT: workflow delay step ${index + 1} requires non-negative delayMs`,
        );
      return {
        ...common,
        ...raw,
        id,
        delayMs: clamp(raw.delayMs, 0, 120_000),
        replay: "safe",
      };
    }
    throw new Error(
      `INVALID_INPUT: workflow step ${index + 1} has unsupported type`,
    );
  });
}

function validateGraph(steps: WorkflowStep[], mode: WorkflowMode): void {
  if (mode !== "graph") return;
  const ids = new Set(steps.map((step) => step.id!));
  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!ids.has(dependency))
        throw new Error(
          `INVALID_INPUT: workflow step '${step.id}' depends on missing step '${dependency}'`,
        );
      if (dependency === step.id)
        throw new Error(
          `INVALID_INPUT: workflow step '${step.id}' cannot depend on itself`,
        );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id!, step]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id))
      throw new Error(
        `INVALID_INPUT: workflow dependency cycle includes '${id}'`,
      );
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

function validateStepId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value))
    throw new Error(
      "INVALID_INPUT: workflow step id must be 1-100 letters, numbers, dots, underscores, or dashes",
    );
  return value;
}

function validateStringList(
  value: string[] | undefined,
  field: string,
  index: number,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(
      `INVALID_INPUT: workflow step ${index + 1} ${field} must be a string array`,
    );
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))].slice(
    0,
    100,
  );
}

function normalizeRunState(value: unknown): WorkflowRunState {
  return [
    "pending",
    "running",
    "canceling",
    "succeeded",
    "failed",
    "canceled",
    "interrupted",
  ].includes(String(value))
    ? (value as WorkflowRunState)
    : "interrupted";
}

function normalizeStepState(value: unknown): WorkflowRunStepState {
  return [
    "pending",
    "running",
    "succeeded",
    "failed",
    "canceled",
    "interrupted",
    "skipped",
  ].includes(String(value))
    ? (value as WorkflowRunStepState)
    : "pending";
}

function validateRunId(runId: string): void {
  if (!/^workflow_[a-z0-9-]+$/i.test(runId))
    throw new Error("INVALID_INPUT: invalid workflow runId");
}

function safeStepFilename(stepId: string): string {
  return validateStepId(stepId).replace(/[^a-z0-9._-]/gi, "_");
}

function normalizeResource(workspace: string, resource: string): string {
  const trimmed = resource.trim();
  if (/^[a-z][a-z0-9_-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed))
    return `key:${trimmed.toLowerCase()}`;
  const resolved = path.resolve(workspace, trimmed);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resourcesOverlap(left: string, right: string): boolean {
  if (left.startsWith("key:") || right.startsWith("key:"))
    return left === right;
  if (left === right) return true;
  const separator = path.sep;
  return (
    left.startsWith(`${right}${separator}`) ||
    right.startsWith(`${left}${separator}`)
  );
}

function compactCommandResult(
  result: RunResult,
): WorkflowStepResult["command"] {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    truncated: result.truncated,
    sha256: result.sha256,
  };
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

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(
      new Error("WORKFLOW_CANCELED: executor was canceled"),
    );
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new Error("WORKFLOW_CANCELED: executor was canceled"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function delayWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new Error("WORKFLOW_CANCELED: delay was canceled"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("WORKFLOW_CANCELED: delay was canceled"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function safeJsonValue(value: unknown): unknown {
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (
        item &&
        typeof item === "object" &&
        "dataBase64" in (item as Record<string, unknown>)
      ) {
        const attachment = item as Record<string, unknown>;
        const { dataBase64: _discard, ...metadata } = attachment;
        return metadata;
      }
      return item;
    });
    if (text.length > 1_000_000)
      return {
        truncated: true,
        preview: text.slice(0, 1_000_000),
        originalChars: text.length,
      };
    return JSON.parse(text) as unknown;
  } catch {
    return String(value);
  }
}
