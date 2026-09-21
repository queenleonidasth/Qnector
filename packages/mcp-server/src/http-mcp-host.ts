import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { ActivityLogger } from "@qnector/core";
import { attachSseHeartbeat } from "./mcp-reliability.js";
import { TimelineLogger } from "./timeline-logger.js";

/** HTTP-only protocol boundary: origin validation, SSE keepalive and delivery tracing. */
export interface HttpMcpDependencies {
  timeline: TimelineLogger;
  activity: ActivityLogger;
  enableTimeoutProbe: boolean;
  mcpNodeHandler: ReturnType<typeof toNodeHandler>;
  schemaRevision: string;
}

export async function handleHttpMcp(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: HttpMcpDependencies,
): Promise<void> {
  if (!trustedMcpOrigin(request)) {
    await reply.code(403).send({
      ok: false,
      error: "MCP_ORIGIN_FORBIDDEN",
      message: "The MCP Origin must match the request Host.",
    });
    return;
  }
  const traceId = randomUUID();
  const timelineContext = dependencies.timeline.start(traceId);
  dependencies.timeline.record(timelineContext, "request_received", {
    method: request.method,
  });
  const rpc =
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : undefined;
  dependencies.timeline.record(timelineContext, "rpc_parsed", {
    method:
      typeof rpc?.method === "string"
        ? rpc.method.slice(0, 80)
        : request.method,
    ...(typeof rpc?.id === "number" || typeof rpc?.id === "string"
      ? { rpcId: String(rpc.id).slice(0, 80) }
      : {}),
  });
  const startedAt = Date.now();
  // Capture before finish: reply.raw.socket may be cleared on close.
  const responseSocket = reply.raw.socket;
  const initialSocketBytes = responseSocket?.bytesWritten ?? 0;
  const socketByteDelta = () =>
    Math.max(
      0,
      (responseSocket?.bytesWritten ?? initialSocketBytes) - initialSocketBytes,
    );
  let traceRecorded = false;
  const recordTrace = (status: "success" | "error", summary: string) => {
    if (traceRecorded) return;
    traceRecorded = true;
    const socketBytesDelta = socketByteDelta();
    dependencies.activity.recordBuffered({
      tool: "mcp",
      action: "exchange",
      argsSummary: JSON.stringify({
        traceId,
        requestId: request.id,
        method: request.method,
        path: request.url.split("?", 1)[0],
        statusCode: reply.raw.statusCode,
        durationMs: Date.now() - startedAt,
        socketBytesDelta,
        aborted: reply.raw.destroyed && !reply.raw.writableFinished,
      }),
      status,
      durationMs: Date.now() - startedAt,
      summary,
    });
  };
  reply.raw.once("close", () => {
    dependencies.timeline.record(timelineContext, "stream_closed", {
      source: "res",
      finished: reply.raw.writableFinished,
    });
    if (!reply.raw.writableFinished)
      dependencies.timeline.record(timelineContext, "client_aborted", {
        source: "res",
      });
    if (!reply.raw.writableFinished)
      recordTrace(
        "error",
        "MCP exchange disconnected before response finished",
      );
  });
  request.raw.once("aborted", () =>
    dependencies.timeline.record(timelineContext, "client_aborted", {
      source: "req",
    }),
  );
  reply.raw.once("finish", () =>
    dependencies.timeline.record(timelineContext, "response_flushed", {
      statusCode: reply.raw.statusCode,
      socketBytesDelta: socketByteDelta(),
    }),
  );
  const originalWriteHead = reply.raw.writeHead;
  let responseWritten = false;
  const observedWriteHead = ((
    ...args: Parameters<typeof originalWriteHead>
  ) => {
    if (!responseWritten) {
      responseWritten = true;
      dependencies.timeline.record(timelineContext, "response_written", {
        statusCode:
          typeof args[0] === "number" ? args[0] : reply.raw.statusCode,
      });
    }
    return Reflect.apply(
      originalWriteHead,
      reply.raw,
      args,
    ) as typeof reply.raw;
  }) as typeof reply.raw.writeHead;
  reply.raw.writeHead = observedWriteHead;
  const restoreWriteHead = () => {
    if (reply.raw.writeHead === observedWriteHead)
      reply.raw.writeHead = originalWriteHead;
  };
  reply.raw.once("finish", restoreWriteHead);
  reply.raw.once("close", restoreWriteHead);
  reply.raw.socket?.setNoDelay(true);
  reply.raw.setHeader("X-Qnector-Trace-Id", traceId);
  reply.raw.setHeader("X-Qnector-Schema-Revision", dependencies.schemaRevision);
  reply.raw.setHeader("X-Qnector-Capability", "live");
  reply.hijack();
  // Never emit SSE comments into JSON or stdio. The guard only writes when
  // the MCP library has committed an actual event-stream response.
  const call =
    rpc?.params && typeof rpc.params === "object" && !Array.isArray(rpc.params)
      ? (rpc.params as Record<string, unknown>)
      : undefined;
  const callArgs =
    call?.arguments &&
    typeof call.arguments === "object" &&
    !Array.isArray(call.arguments)
      ? (call.arguments as Record<string, unknown>)
      : undefined;
  const quietProbe =
    dependencies.enableTimeoutProbe &&
    rpc?.method === "tools/call" &&
    call?.name === "system.timeout_probe" &&
    (callArgs?.mode === "silent" || callArgs?.mode === "progress");
  const stopHeartbeat = quietProbe
    ? () => undefined
    : attachSseHeartbeat(reply.raw, undefined, () =>
        dependencies.timeline.record(timelineContext, "keepalive_sent"),
      );
  try {
    await dependencies.timeline.run(timelineContext, () =>
      dependencies.mcpNodeHandler(
        request.raw,
        reply.raw,
        request.method === "POST" ? request.body : undefined,
      ),
    );
    recordTrace("success", "MCP exchange completed");
  } catch (error) {
    dependencies.timeline.record(timelineContext, "error", {
      source: "mcp_handler",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    recordTrace(
      "error",
      `MCP exchange failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    stopHeartbeat();
    throw error;
  }
}

function trustedMcpOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (Array.isArray(origin) || !request.headers.host) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false;
    return parsed.host.toLowerCase() === request.headers.host.toLowerCase();
  } catch {
    return false;
  }
}
