import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";
import { planScopeForCall } from "./plan-guard.js";

/** Metadata tool is separate from the approval tool to keep approval prompts
 * isolated from harmless status reads and draft edits. */
export const modeDefinition: ToolDefinition = {
  name: "mode",
  description:
    "Plan/Act controller. Use mode.begin to save a proposed plan and enter strict read-only Plan Mode; mode.update revises and invalidates approval; mode.get shows current mode/revision/checklist; mode.back_to_plan pauses new actions; mode.step marks a step only after approval. IMPORTANT: Pass the same memoryTaskId to every Qnector call in this task (start one with memory.task_start); otherwise fallback depends on host-provided conversation metadata. Only mode_approve switches to Act Mode after the user has explicitly approved the displayed revision. Changing the mode never cancels already-running processes. UX ORDER: use mode.begin early to enforce read-only Plan Mode, finish analysis using read-only tools, update the final proposal with mode.update, verify revision via mode.get, and only THEN call plan_panel once as the presentation step. Do not display an early draft panel that ChatGPT will bury under a long explanation.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["get", "begin", "update", "back_to_plan", "step"] },
      title: { type: "string", maxLength: 200 },
      summary: { type: "string", maxLength: 8000 },
      steps: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 60 },
      index: { type: "integer", minimum: 0 },
      done: { type: "boolean" },
      expectedRevision: { type: "integer", minimum: 1 },
      expectedStepId: { type: "string" },
      expectedApprovedAt: { type: "string" },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export async function executeMode(context: ToolContext, input: unknown): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "mode", action, input, async () => {
    if (!context.planActStore)
      throw new Error("UNSUPPORTED_CAPABILITY: Plan/Act state store is unavailable.");
    const scopeId = planScopeForCall(context, input);
    const workspace = context.getConfig().activeWorkspace;
    if (action === "get") {
      const state = await context.planActStore.get(scopeId, workspace);
      return {
        summary: state.plan
          ? "Task " + state.mode + " Mode, plan revision " + state.plan.revision
          : "Task defaults to Act Mode (no plan saved)",
        data: { ...state, scoped: !!scopeId },
      };
    }
    if (action === "begin") {
      const steps = object.steps;
      if (!Array.isArray(steps) || !steps.every((entry) => typeof entry === "string"))
        throw new Error("INVALID_PLAN: steps must be an array of strings.");
      const state = await context.planActStore.begin(
        scopeId, workspace,
        stringInput(object, "title", true)!,
        stringInput(object, "summary", true)!,
        steps as string[],
      );
      return { summary: "Plan saved as revision " + state.plan?.revision + ". All mutating operations are now blocked for this task.", data: state };
    }
    if (action === "update") {
      if (object.steps !== undefined && (!Array.isArray(object.steps) ||
          !object.steps.every((entry) => typeof entry === "string")))
        throw new Error("INVALID_PLAN: steps must be an array of strings.");
      const state = await context.planActStore.update(
        scopeId, stringInput(object, "title"), stringInput(object, "summary"),
        object.steps as string[] | undefined,
      );
      return { summary: "Updated plan to revision " + state.plan?.revision + " (approval reset).", data: state };
    }
    if (action === "back_to_plan") {
      const state = await context.planActStore.backToPlan(
        scopeId,
        object.expectedRevision === undefined ? undefined : numberInput(object, "expectedRevision", -1),
        stringInput(object, "expectedApprovedAt"),
      );
      return {
        summary: "Returned to read-only Plan Mode; prior approval revoked. Already-running external jobs are NOT canceled.",
        data: state,
      };
    }
    if (action === "step") {
      if (object.index === undefined || object.done === undefined)
        throw new Error("INVALID_INPUT: index (zero-based) and done are required.");
      const state = await context.planActStore.markStep(
        scopeId, numberInput(object, "index", -1), booleanInput(object, "done", false),
        object.expectedRevision === undefined ? undefined : numberInput(object, "expectedRevision", -1),
        stringInput(object, "expectedStepId"),
        stringInput(object, "expectedApprovedAt"),
      );
      return { summary: "Updated plan step " + object.index + ".", data: state };
    }
    // Deliberately not listed in the public mode input schema: this action is
    // exposed solely through the separately annotated mode_approve tool.
    if (action === "approve") {
      const state = await context.planActStore.approve(scopeId, numberInput(object, "expectedRevision", -1));
      return {
        summary: "Approved plan revision " + state.plan?.revision + ". Act Mode is now enabled for this task.",
        data: state,
      };
    }
    throw new Error("INVALID_ACTION: Unknown Plan/Act action " + action);
  });
}
