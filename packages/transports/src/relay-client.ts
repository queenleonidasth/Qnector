import WebSocket from "ws";
import {
  encodeRelayMessage,
  fromBase64,
  localMcpUrl,
  toBase64,
} from "@qnector/shared";
import type { RelayMessage, TransportSnapshot } from "@qnector/shared";
import { BaseTransportAdapter } from "./base.js";

export interface RelayClientOptions {
  relayUrl: string;
  deviceId: string;
  version: string;
  reconnect?: boolean;
}

export class RelayClient extends BaseTransportAdapter {
  public readonly mode = "relay" as const;
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly requests = new Map<string, AbortController>();
  private stopped = false;
  private attempts = 0;

  public constructor(
    localHost: string,
    localPort: number,
    private readonly options: RelayClientOptions,
  ) {
    super(localMcpUrl(localHost, localPort));
  }

  public async start(): Promise<TransportSnapshot> {
    this.stopped = false;
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: "Connecting to Qnector Relay",
    });
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.relayUrl);
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("RELAY_CONNECT_TIMEOUT"));
      }, 15_000);
      let connected = false;
      const markConnected = (): void => {
        if (connected) return;
        connected = true;
        clearTimeout(timeout);
        this.attempts = 0;
        const snapshot = {
          state: "connected" as const,
          mode: this.mode,
          message: "Relay connected",
        };
        this.setSnapshot(snapshot);
        resolve(snapshot);
      };
      socket.once("open", () => {
        socket.send(
          encodeRelayMessage({
            type: "agent.hello",
            deviceId: this.options.deviceId,
            version: this.options.version,
          }),
        );
      });
      socket.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString()) as { type?: string };
          if (message.type === "agent.ready") markConnected();
        } catch {
          /* handleMessage ignores malformed payloads */
        }
        void this.handleMessage(data.toString());
      });
      socket.on("close", () => {
        this.abortRequests();
        if (!this.stopped) {
          this.setSnapshot({
            state: "error",
            mode: this.mode,
            message: "Relay disconnected",
          });
          this.scheduleReconnect();
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        if (this.snapshot.state !== "connected") reject(error);
      });
    });
  }

  public override async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.abortRequests();
    this.socket?.close();
    this.socket = undefined;
    this.setSnapshot({ state: "disconnected", mode: this.mode });
  }

  private scheduleReconnect(): void {
    if (this.options.reconnect === false || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.start().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: RelayMessage;
    try {
      message = JSON.parse(raw) as RelayMessage;
    } catch {
      return;
    }
    if (message.type === "heartbeat.ping") {
      this.socket?.send(
        encodeRelayMessage({
          type: "heartbeat.pong",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }
    if (message.type === "request.cancel") {
      this.requests.get(message.requestId)?.abort();
      this.requests.delete(message.requestId);
      return;
    }
    if (message.type !== "http.request") return;
    const controller = new AbortController();
    this.requests.set(message.requestId, controller);
    try {
      const localOrigin = new URL(this.localUrl).origin;
      const response = await fetch(`${localOrigin}${message.path}`, {
        method: message.method,
        headers: message.headers,
        body: message.bodyBase64
          ? new Uint8Array(fromBase64(message.bodyBase64))
          : undefined,
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      this.socket?.send(
        encodeRelayMessage({
          type: "http.response.start",
          requestId: message.requestId,
          status: response.status,
          headers,
        }),
      );
      if (response.body) {
        const reader = response.body.getReader();
        let sequence = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          this.socket?.send(
            encodeRelayMessage({
              type: "http.response.chunk",
              requestId: message.requestId,
              sequence: sequence++,
              bodyBase64: toBase64(chunk.value),
            }),
          );
        }
      }
      this.socket?.send(
        encodeRelayMessage({
          type: "http.response.end",
          requestId: message.requestId,
        }),
      );
    } catch (error) {
      if (!controller.signal.aborted)
        this.socket?.send(
          encodeRelayMessage({
            type: "agent.error",
            requestId: message.requestId,
            error: {
              code: "LOCAL_FORWARD_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
    } finally {
      this.requests.delete(message.requestId);
    }
  }

  private abortRequests(): void {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
  }
}
