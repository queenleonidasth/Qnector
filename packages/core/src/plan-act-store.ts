import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type PlanActMode = "plan" | "act";

export interface PlanActStep {
  id: string;
  text: string;
  done: boolean;
}

export type PlanDecisionSource = "human" | "ai-delegated";
export interface PlanActDecision {
  id: string;
  question: string;
  answer: string | null;
  decidedBy: PlanDecisionSource | null;
  rationale: string | null;
  alternatives: string[];
  epoch: number;
}

export interface PlanActPlan {
  /** Undefined in previously persisted plan files; legacy approvals remain valid. */
  phase?: "discovery" | "ready";
  decisions?: PlanActDecision[];
  design?: string | null;
  implementationPlan?: string | null;
  discoveryEpoch?: number;
  revision: number;
  title: string;
  summary: string;
  steps: PlanActStep[];
  approvedRevision: number | null;
  approvedAt: string | null;
}

export interface PlanActState {
  scopeId: string;
  workspace: string;
  mode: PlanActMode;
  plan: PlanActPlan | null;
  updatedAt: string;
}

interface PersistedPlans {
  version: 1;
  states: PlanActState[];
}

const MAX_STATES = 300;
const MAX_STEPS = 60;
const MAX_DECISIONS = 50;

function fail(code: string, reason: string): never {
  throw new Error(code + ": " + reason);
}

function requiredScope(scopeId: string | undefined): string {
  if (!scopeId || scopeId.length > 256 || !/^(task|session):[a-zA-Z0-9_:-]+$/.test(scopeId))
    return fail("PLAN_SCOPE_REQUIRED", "A memoryTaskId or trusted MCP session is required; use memory.task_start before starting Plan Mode.");
  return scopeId;
}

function normalizedText(value: string, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    return fail("INVALID_PLAN", label + " must be non-empty and at most " + max + " characters.");
  return value.trim();
}

function normalizedSteps(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_STEPS)
    return fail("INVALID_PLAN", "Plan steps must contain 1 to " + MAX_STEPS + " items.");
  return values.map((value, index) => normalizedText(value, 500, "Step " + (index + 1)));
}

function initial(scopeId: string, workspace: string): PlanActState {
  return {
    scopeId,
    workspace,
    mode: "act", // Preserve full-access behavior for pre-existing Qnector chats.
    plan: null,
    updatedAt: new Date().toISOString(),
  };
}

function copy(value: PlanActState): PlanActState {
  return structuredClone(value);
}

/**
 * Plan/Act metadata is separate from project files and from the model prompt.
 * All changes are atomic and serialized within this runtime. It is a behavioral
 * guard on MCP dispatch, not a Windows process sandbox or host authorization.
 */
export class PlanActStore {
  private readonly states = new Map<string, PlanActState>();
  private loaded?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly file: string) {}

  private async load(): Promise<void> {
    if (!this.loaded) this.loaded = this.loadFromDisk();
    return this.loaded;
  }

  private async loadFromDisk(): Promise<void> {
    let source: string;
    try {
      source = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let parsed: PersistedPlans;
    try {
      parsed = JSON.parse(source) as PersistedPlans;
    } catch {
      return fail("PLAN_STATE_CORRUPTED", "The saved mode state is invalid JSON. Changes are blocked until repaired.");
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.states))
      return fail("PLAN_STATE_CORRUPTED", "Unsupported plan state version; changes are blocked.");
    for (const entry of parsed.states) {
      if (
        !entry || typeof entry.scopeId !== "string" ||
        typeof entry.workspace !== "string" ||
        (entry.mode !== "plan" && entry.mode !== "act") ||
        (entry.plan !== null && (!entry.plan || !Number.isSafeInteger(entry.plan.revision)))
      ) return fail("PLAN_STATE_CORRUPTED", "Saved mode state has malformed entries.");
      this.states.set(entry.scopeId, entry);
    }
  }

  private async transact(fn: () => Promise<PlanActState>): Promise<PlanActState> {
    const run = this.queue.then(async () => {
      await this.load();
      const state = await fn();
      await this.save();
      return copy(state);
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async save(): Promise<void> {
    const entries = [...this.states.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_STATES);
    this.states.clear();
    for (const entry of entries) this.states.set(entry.scopeId, entry);
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify({ version: 1, states: entries }, null, 2), "utf8");
    await rename(temporary, this.file);
  }

  public async get(scopeId: string | undefined, workspace: string): Promise<PlanActState> {
    await this.queue;
    await this.load();
    if (!scopeId) return initial("unscoped", workspace);
    return copy(this.states.get(scopeId) ?? initial(scopeId, workspace));
  }

  public async hasActivePlan(workspace: string): Promise<boolean> {
    await this.queue;
    await this.load();
    return [...this.states.values()].some((state) =>
      state.mode === "plan" && path.resolve(state.workspace).toLowerCase() === path.resolve(workspace).toLowerCase());
  }

  public async begin(scopeId: string | undefined, workspace: string, title: string, summary: string, steps: string[]): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    const safeTitle = normalizedText(title, 200, "Title");
    const safeSummary = normalizedText(summary, 8_000, "Summary");
    const safeSteps = normalizedSteps(steps);
    return this.transact(async () => {
      const previous = this.states.get(scope);
      const revision = (previous?.plan?.revision ?? 0) + 1;
      const now = new Date().toISOString();
      const state: PlanActState = {
        scopeId: scope, workspace, mode: "plan", updatedAt: now,
        plan: {
          revision, title: safeTitle, summary: safeSummary,
          steps: safeSteps.map((text) => ({ id: randomUUID(), text, done: false })),
          phase: "discovery", decisions: [], design: null, implementationPlan: null, discoveryEpoch: 1,
          approvedRevision: null, approvedAt: null,
        },
      };
      this.states.set(scope, state);
      return state;
    });
  }

  public async update(scopeId: string | undefined, title?: string, summary?: string, steps?: string[]): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state || state.mode !== "plan" || !state.plan)
        return fail("PLAN_NOT_ACTIVE", "Start a plan or return to Plan Mode before updating it.");
      const plan = state.plan;
      const nextTitle = title === undefined ? plan.title : normalizedText(title, 200, "Title");
      const nextSummary = summary === undefined ? plan.summary : normalizedText(summary, 8_000, "Summary");
      const nextSteps = steps === undefined ? plan.steps.map((item) => item.text) : normalizedSteps(steps);
      // Preserve verified progress for unchanged steps when editing a plan.
      // Match by text rather than index so reorder/insertion cannot transfer
      // a completed checkbox to an unrelated step.
      const priorByText = new Map<string, PlanActStep[]>();
      for (const entry of plan.steps) {
        const matches = priorByText.get(entry.text) ?? [];
        matches.push(entry);
        priorByText.set(entry.text, matches);
      }
      const wasReady = plan.phase === "ready";
      state.plan = {
        title: nextTitle, summary: nextSummary, revision: plan.revision + 1,
        phase: "discovery", decisions: plan.decisions ?? [], design: null, implementationPlan: null,
        discoveryEpoch: (plan.discoveryEpoch ?? 1) + (wasReady ? 1 : 0),
        steps: nextSteps.map((text) => {
          const old = priorByText.get(text)?.shift();
          return { id: old?.id ?? randomUUID(), text, done: old?.done ?? false };
        }),
        approvedRevision: null, approvedAt: null,
      };
      state.updatedAt = new Date().toISOString();
      return state;
    });
  }

  /** Only one outstanding question is allowed: ask in ChatGPT, then wait for the answer. */
  public async ask(scopeId: string | undefined, question: string): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    const safeQuestion = normalizedText(question, 600, "Question");
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state || state.mode !== "plan" || !state.plan)
        return fail("PLAN_NOT_ACTIVE", "Start Plan Mode to ask a question.");
      const plan = state.plan;
      if (plan.phase === "ready") return fail("PLAN_ALREADY_FINALIZED", "Revise the plan before asking again.");
      const decisions = plan.decisions ?? [];
      if (decisions.length >= MAX_DECISIONS) return fail("PLAN_TOO_MANY_QUESTIONS", "Question limit reached.");
      if (decisions.some((decision) => decision.answer === null))
        return fail("PLAN_DECISIONS_PENDING", "Answer the existing question before adding another.");
      plan.phase = "discovery";
      plan.discoveryEpoch ??= 1;
      plan.decisions = [...decisions, {id:randomUUID(),question:safeQuestion,answer:null,
        decidedBy:null,rationale:null,alternatives:[],epoch:plan.discoveryEpoch}];
      state.updatedAt = new Date().toISOString();
      return state;
    });
  }

  public async resolve(scopeId: string | undefined, decisionId: string, answer: string,
    decidedBy: PlanDecisionSource, rationale?: string, alternatives: string[] = [],
    delegationConfirmed = false): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    const safeAnswer = normalizedText(answer, 2_000, "Answer");
    if (decidedBy !== "human" && decidedBy !== "ai-delegated")
      return fail("PLAN_INVALID_DECIDER", "Decision owner must be human or ai-delegated.");
    if (decidedBy === "ai-delegated" && !delegationConfirmed)
      return fail("PLAN_DELEGATION_REQUIRED", "Record explicit user delegation.");
    if (decidedBy === "ai-delegated" && (!Array.isArray(alternatives) || !alternatives.length))
      return fail("PLAN_ALTERNATIVES_REQUIRED", "AI-delegated decisions need alternatives.");
    if (decidedBy === "ai-delegated" && !rationale?.trim())
      return fail("PLAN_RATIONALE_REQUIRED", "AI-delegated decisions need rationale.");
    if (!Array.isArray(alternatives) || alternatives.length > 10)
      return fail("PLAN_INVALID_ALTERNATIVES", "At most 10 alternatives allowed.");
    const safeAlternatives = alternatives.map((item,i) => normalizedText(item,500,"Alternative "+i));
    const safeRationale = rationale?.trim() ? normalizedText(rationale,2_000,"Rationale") : null;
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state || state.mode !== "plan" || !state.plan || state.plan.phase === "ready")
        return fail("PLAN_NOT_ACTIVE", "Draft Plan Mode is required.");
      const decision = state.plan.decisions?.find((x) => x.id === decisionId);
      if (!decision) return fail("PLAN_DECISION_NOT_FOUND", "Question not found in this plan.");
      if (decision.answer !== null) return fail("PLAN_DECISION_ALREADY_RESOLVED", "Question already answered.");
      decision.answer=safeAnswer;decision.decidedBy=decidedBy;decision.rationale=safeRationale;
      decision.alternatives=safeAlternatives;state.updatedAt=new Date().toISOString();
      return state;
    });
  }

  public async finalize(scopeId: string | undefined, design: string, implementationPlan: string): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    const safeDesign = normalizedText(design, 12_000, "Design");
    const safeImplementation = normalizedText(implementationPlan,16_000,"Implementation plan");
    if (safeDesign.length < 60 || safeImplementation.length < 60)
      return fail("PLAN_DOCUMENTS_REQUIRED", "Provide substantive design and implementation plans.");
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state || state.mode !== "plan" || !state.plan)
        return fail("PLAN_NOT_ACTIVE", "Start Plan Mode before finalizing.");
      const plan = state.plan;
      if (plan.phase === "ready") return fail("PLAN_ALREADY_FINALIZED", "Plan already finalized.");
      if (plan.decisions?.some((x)=>x.answer===null))
        return fail("PLAN_DECISIONS_PENDING", "Answer all recorded questions in ChatGPT first.");
      if (!plan.decisions?.some((x)=>x.epoch===(plan.discoveryEpoch??1)))
        return fail("PLAN_QUESTIONS_REQUIRED", "Ask and resolve a material question on every Plan activation.");
      plan.design=safeDesign;plan.implementationPlan=safeImplementation;plan.phase="ready";
      plan.revision++;plan.approvedRevision=null;plan.approvedAt=null;
      state.updatedAt=new Date().toISOString();return state;
    });
  }

  public async approve(scopeId: string | undefined, expectedRevision: number): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state || state.mode !== "plan" || !state.plan)
        return fail("PLAN_NOT_ACTIVE", "A saved Plan Mode plan is required before Act Mode.");
      if (!Number.isSafeInteger(expectedRevision) || state.plan.revision !== expectedRevision)
        return fail("PLAN_REVISION_MISMATCH", "The plan changed; inspect the current revision before approving.");
      if (state.plan.phase !== undefined && state.plan.phase !== "ready")
        return fail("PLAN_NOT_READY", "Discuss and finalize the full design before approving.");
      if (state.plan.decisions?.some((decision) => decision.answer === null))
        return fail("PLAN_DECISIONS_PENDING", "Unanswered decisions block approval.");
      state.mode = "act";
      state.plan.approvedRevision = state.plan.revision;
      state.plan.approvedAt = new Date().toISOString();
      state.updatedAt = state.plan.approvedAt;
      return state;
    });
  }

  public async backToPlan(
    scopeId: string | undefined,
    expectedRevision?: number,
    expectedApprovedAt?: string,
  ): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state) return fail("PLAN_NOT_FOUND", "No plan exists for this task. Start a plan first.");
      if (expectedRevision !== undefined && state.plan?.revision !== expectedRevision)
        return fail("PLAN_REVISION_MISMATCH", "The plan changed before returning to Plan Mode. Refresh the panel.");
      if (expectedApprovedAt !== undefined && state.plan?.approvedAt !== expectedApprovedAt)
        return fail("PLAN_APPROVAL_MISMATCH", "The approval state changed. Refresh before revoking it.");
      state.mode = "plan";
      if (state.plan) {
        state.plan.approvedRevision = null;
        state.plan.approvedAt = null;
        state.plan.phase = "discovery";
        state.plan.discoveryEpoch = (state.plan.discoveryEpoch ?? 0) + 1;
        state.plan.design = null;
        state.plan.implementationPlan = null;
      }
      state.updatedAt = new Date().toISOString();
      return state;
    });
  }

  public async markStep(
    scopeId: string | undefined,
    index: number,
    done: boolean,
    expectedRevision?: number,
    expectedStepId?: string,
    expectedApprovedAt?: string,
  ): Promise<PlanActState> {
    const scope = requiredScope(scopeId);
    return this.transact(async () => {
      const state = this.states.get(scope);
      if (!state || state.mode !== "act" || !state.plan ||
          state.plan.approvedRevision !== state.plan.revision)
        return fail("PLAN_NOT_APPROVED", "An approved Act Mode plan is required to mark steps.");
      if (expectedRevision !== undefined && state.plan.revision !== expectedRevision)
        return fail("PLAN_REVISION_MISMATCH", "The checklist changed. Refresh the panel before editing it.");
      if (expectedApprovedAt !== undefined && state.plan.approvedAt !== expectedApprovedAt)
        return fail("PLAN_APPROVAL_MISMATCH", "The approval state changed. Refresh before editing the checklist.");
      if (!Number.isSafeInteger(index) || index < 0 || index >= state.plan.steps.length)
        return fail("INVALID_PLAN_STEP", "Step index is out of range (zero-based).");
      if (expectedStepId !== undefined && state.plan.steps[index]!.id !== expectedStepId)
        return fail("PLAN_STEP_MISMATCH", "The checklist step changed. Refresh the panel.");
      state.plan.steps[index]!.done = done;
      state.updatedAt = new Date().toISOString();
      return state;
    });
  }
}
