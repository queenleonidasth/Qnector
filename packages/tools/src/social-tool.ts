import type { ToolDefinition, ToolResult } from "@qnector/shared";
import { executeSocialRead } from "@qnector/core";
import {
  objectInput,
  runWithActivity,
  stringInput,
  numberInput,
  type ToolContext,
} from "./tool-result.js";
import type { SocialRequest } from "@qnector/core";

const actions = [
  "health",
  "capabilities",
  "read",
  "search",
  "feed",
  "profile",
  "start",
  "status",
  "result",
  "cancel",
];
export const socialDefinition: ToolDefinition = {
  name: "social",
  description:
    "Read-only opt-in social reader. Use health/capabilities before YouTube metadata/search or authorized Facebook search. Disabled by default. No posting, automatic login or raw cookies; YouTube captions are returned only when verified, while durable social jobs remain unavailable.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: actions },
      platform: { type: "string", enum: ["youtube", "facebook"] },
      url: { type: "string", maxLength: 2048 },
      query: { type: "string", maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
      taskId: { type: "string" },
      idempotencyKey: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export async function executeSocial(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(
    context,
    "social",
    action,
    { action, platform: object.platform, limit: object.limit },
    async () => {
      if (!actions.includes(action))
        throw new Error("INVALID_INPUT: Unknown social action.");
      if (["start", "status", "result", "cancel"].includes(action))
        throw new Error(
          "UNSUPPORTED_OPERATION: Social durable jobs require P4 packaged recovery tests; use synchronous reads for now.",
        );
      const platform = stringInput(object, "platform");
      if (platform && platform !== "youtube" && platform !== "facebook")
        throw new Error("INVALID_INPUT: Unsupported social platform.");
      const request: SocialRequest = {
        action: action as SocialRequest["action"],
      };
      if (platform === "youtube" || platform === "facebook")
        request.platform = platform;
      const url = stringInput(object, "url");
      if (url) request.url = url;
      const query = stringInput(object, "query");
      if (query) request.query = query;
      if (object.limit !== undefined)
        request.limit = numberInput(object, "limit", 5);
      const config = context.getConfig().social ?? {
        enabled: false,
        platforms: [],
      };
      return executeSocialRead(config, request, context.abortSignal);
    },
  );
}
