import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";
import type {
  UiAutomationFindInput,
  UiAutomationWaitCondition,
} from "@qnector/core";

export const computerDefinition: ToolDefinition = {
  name: "computer",
  description:
    "Semantically inspect and interact with controls in local Windows desktop applications through Windows UI Automation. Prefer windows → find/inspect → invoke/set_value/focus/select. Element IDs are session-scoped and may become stale after UI changes. This tool does not provide raw coordinate mouse control, general-purpose synthetic keyboard input, remote desktop, or ChatGPT browser/session automation.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "windows",
          "inspect",
          "find",
          "invoke",
          "set_value",
          "focus",
          "select",
          "toggle",
          "expand",
          "collapse",
          "scroll_into_view",
          "range_value",
          "wait",
        ],
      },
      windowId: { type: "string" },
      elementId: { type: "string" },
      name: { type: "string" },
      automationId: { type: "string" },
      controlType: { type: "string" },
      className: { type: "string" },
      value: { type: "string" },
      numberValue: { type: "number" },
      condition: {
        type: "string",
        enum: ["exists", "not_exists", "enabled", "disabled", "value_equals"],
      },
      depth: { type: "integer", minimum: 1, maximum: 12 },
      maxResults: { type: "integer", minimum: 1, maximum: 1000 },
      timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
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

export async function executeComputer(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "computer", action, input, async () => {
    const ui = context.uiAutomation;
    if (!ui)
      throw new Error(
        "UNSUPPORTED_CAPABILITY: Windows UI Automation is not configured in this Qnector runtime",
      );

    if (action === "windows") {
      const windows = await ui.windows(numberInput(object, "maxResults", 100));
      return {
        summary: `Listed ${windows.length} UI Automation window(s)`,
        data: { windows },
      };
    }

    if (action === "inspect") {
      const windowId = stringInput(object, "windowId", true)!;
      const elements = await ui.inspect({
        windowId,
        depth: numberInput(object, "depth", 4),
        maxResults: numberInput(object, "maxResults", 300),
      });
      return {
        summary: `Inspected ${elements.length} control(s) in ${windowId}`,
        data: { windowId, elements },
        truncated: elements.length >= numberInput(object, "maxResults", 300),
      };
    }

    if (action === "find") {
      const query = findInput(object);
      ensureFindFilter(query);
      const elements = await ui.find(query);
      return {
        summary: `Found ${elements.length} matching control(s) in ${query.windowId}`,
        data: { windowId: query.windowId, elements },
        truncated: elements.length >= numberInput(object, "maxResults", 50),
      };
    }

    if (action === "invoke") {
      const elementId = stringInput(object, "elementId", true)!;
      const element = await ui.invoke(elementId);
      return {
        summary: `Invoked ${describeElement(element)}`,
        data: { element },
      };
    }

    if (action === "set_value") {
      const elementId = stringInput(object, "elementId", true)!;
      const value = stringInput(object, "value", true)!;
      const element = await ui.setValue(elementId, value);
      return {
        summary: `Set value on ${describeElement(element)}`,
        data: { element },
      };
    }

    if (action === "focus") {
      const elementId = stringInput(object, "elementId", true)!;
      const element = await ui.focus(elementId);
      return {
        summary: `Focused ${describeElement(element)}`,
        data: { element },
      };
    }

    if (action === "select") {
      const elementId = stringInput(object, "elementId", true)!;
      const element = await ui.select(elementId);
      return {
        summary: `Selected ${describeElement(element)}`,
        data: { element },
      };
    }

    if (
      [
        "toggle",
        "expand",
        "collapse",
        "scroll_into_view",
        "range_value",
      ].includes(action)
    ) {
      const elementId = stringInput(object, "elementId", true)!;
      const element =
        action === "toggle"
          ? await ui.toggle(elementId)
          : action === "expand"
            ? await ui.expand(elementId)
            : action === "collapse"
              ? await ui.collapse(elementId)
              : action === "scroll_into_view"
                ? await ui.scrollIntoView(elementId)
                : await ui.setRangeValue(
                    elementId,
                    numberInput(object, "numberValue", Number.NaN),
                  );
      return {
        summary: `${action.replaceAll("_", " ")} on ${describeElement(element)}`,
        data: { element },
      };
    }

    if (action === "wait") {
      const query = findInput(object);
      ensureFindFilter(query);
      const condition = (stringInput(object, "condition") ??
        "exists") as UiAutomationWaitCondition;
      if (
        ![
          "exists",
          "not_exists",
          "enabled",
          "disabled",
          "value_equals",
        ].includes(condition)
      )
        throw new Error(
          `INVALID_INPUT: unsupported wait condition '${condition}'`,
        );
      const result = await ui.wait({
        windowId: query.windowId,
        name: query.name,
        automationId: query.automationId,
        controlType: query.controlType,
        className: query.className,
        condition,
        ...(stringInput(object, "value") !== undefined
          ? { value: stringInput(object, "value") }
          : {}),
        timeoutMs: numberInput(object, "timeoutMs", 30_000),
      });
      return {
        summary: `UI wait condition '${condition}' matched in ${result.elapsedMs} ms`,
        data: result,
      };
    }

    throw new Error(`INVALID_ACTION: Unknown computer action '${action}'`);
  });
}

function findInput(object: Record<string, unknown>): UiAutomationFindInput {
  return {
    windowId: stringInput(object, "windowId", true)!,
    ...(stringInput(object, "name") !== undefined
      ? { name: stringInput(object, "name") }
      : {}),
    ...(stringInput(object, "automationId") !== undefined
      ? { automationId: stringInput(object, "automationId") }
      : {}),
    ...(stringInput(object, "controlType") !== undefined
      ? { controlType: stringInput(object, "controlType") }
      : {}),
    ...(stringInput(object, "className") !== undefined
      ? { className: stringInput(object, "className") }
      : {}),
    maxResults: numberInput(object, "maxResults", 50),
  };
}

function ensureFindFilter(input: UiAutomationFindInput): void {
  if (
    !input.name &&
    !input.automationId &&
    !input.controlType &&
    !input.className
  )
    throw new Error(
      "INVALID_INPUT: computer.find/wait requires at least one of name, automationId, controlType, or className",
    );
}

function describeElement(element: {
  name: string;
  automationId: string;
  controlType: string;
}): string {
  const identity = element.name || element.automationId || "unnamed control";
  return `${element.controlType} '${identity}'`;
}
