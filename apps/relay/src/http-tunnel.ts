import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  decodeRelayMessage,
  encodeRelayMessage,
  toBase64,
} from "@qnector/shared";
import type { RelayMessage } from "@qnector/shared";
import { DeviceRegistry } from "./device-registry.js";

interface PendingRequest {
  requestId: string;
  reply: FastifyReply;
  socket: WebSocket;
  timer: NodeJS.Timeout;
  started: boolean;
}

export class HttpTunnel {
  private readonly pending = new Map<string, PendingRequest>();

  public constructor(
    private readonly registry: DeviceRegistry,
    private readonly timeoutMs = 180_000,
  ) {}

  public async handle(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const deviceId = String((request.params as { deviceId: string }).deviceId);
    const connection = this.registry.get(deviceId);
    if (!connection) {
      reply.code(503).send({
        ok: false,
        error: {
          code: "DEVICE_OFFLINE",
          message: `Qnector device '${deviceId}' is offline`,
        },
      });
      return;
    }
    const requestId = `req_${randomUUID()}`;
    const rawBody =
      request.body === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.from(JSON.stringify(request.body), "utf8");
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }
    const pending: PendingRequest = {
      requestId,
      reply,
      socket: connection.socket,
      started: false,
      timer: setTimeout(() => this.timeout(requestId), this.timeoutMs),
    };
    this.pending.set(requestId, pending);
    reply.hijack();
    connection.socket.send(
      encodeRelayMessage({
        type: "http.request",
        requestId,
        method: request.method,
        path: "/mcp",
        headers,
        ...(rawBody.length ? { bodyBase64: toBase64(rawBody) } : {}),
      }),
    );
    reply.raw.once("close", () => {
      if (this.pending.delete(requestId)) {
        clearTimeout(pending.timer);
        if (connection.socket.readyState === 1)
          connection.socket.send(
            encodeRelayMessage({ type: "request.cancel", requestId }),
          );
      }
    });
  }

  public onMessage(socket: WebSocket, raw: string): void {
    let message: RelayMessage;
    try {
      message = decodeRelayMessage(raw);
    } catch {
      return;
    }
    if (message.type === "heartbeat.ping") {
      socket.send(
        encodeRelayMessage({
          type: "heartbeat.pong",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }
    if (
      message.type === "heartbeat.pong" ||
      message.type === "agent.hello" ||
      message.type === "agent.ready"
    )
      return;
    if (message.type === "agent.error") {
      const pending = message.requestId
        ? this.pending.get(message.requestId)
        : undefined;
      if (pending && !pending.reply.raw.writableEnded)
        this.sendError(pending, 502, { ok: false, error: message.error });
      if (pending) this.finish(message.requestId!);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.reply.raw.destroyed) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(
      () => this.timeout(message.requestId),
      this.timeoutMs,
    );
    if (message.type === "http.response.start") {
      pending.started = true;
      pending.reply.raw.writeHead(message.status, message.headers);
    } else if (message.type === "http.response.chunk") {
      if (!pending.started) return;
      pending.reply.raw.write(Buffer.from(message.bodyBase64, "base64"));
    } else if (message.type === "http.response.end") {
      pending.reply.raw.end();
      this.finish(message.requestId);
    }
  }

  public cancelSocket(socket: WebSocket): void {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.socket !== socket) continue;
      if (!pending.reply.raw.writableEnded && !pending.reply.raw.destroyed)
        this.sendError(pending, 502, {
          ok: false,
          error: {
            code: "DEVICE_DISCONNECTED",
            message:
              "Qnector desktop disconnected before completing the relay request",
          },
        });
      this.finish(requestId);
    }
  }

  private timeout(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (!pending.reply.raw.writableEnded)
      this.sendError(pending, 504, {
        ok: false,
        error: {
          code: "RELAY_TIMEOUT",
          message: "Desktop did not return a response before the relay timeout",
        },
      });
    this.finish(requestId);
  }

  private sendError(
    pending: PendingRequest,
    status: number,
    payload: Record<string, unknown>,
  ): void {
    if (!pending.reply.raw.headersSent)
      pending.reply.raw.writeHead(status, {
        "content-type": "application/json",
      });
    pending.reply.raw.end(JSON.stringify(payload));
  }

  private finish(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(requestId);
  }
}
