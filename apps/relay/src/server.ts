import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, type WebSocket } from "ws";
import { HttpTunnel } from "./http-tunnel.js";
import { DeviceRegistry } from "./device-registry.js";

export interface RelayServerOptions {
  host?: string;
  port?: number;
  requestTimeoutMs?: number;
}

export class QnectorRelayServer {
  public readonly app: FastifyInstance;
  public readonly registry = new DeviceRegistry();
  public readonly tunnel: HttpTunnel;
  private readonly websocketServer = new WebSocketServer({ noServer: true });
  private listening = false;

  public constructor(options: RelayServerOptions = {}) {
    this.app = Fastify({ logger: false, bodyLimit: 2_000_000 });
    this.tunnel = new HttpTunnel(
      this.registry,
      options.requestTimeoutMs ?? 180_000,
    );
    void this.app.register(cors, { origin: true });
    this.app.get("/healthz", async () => ({
      ok: true,
      service: "qnector-relay",
    }));
    this.app.get("/devices/:deviceId/status", async (request) =>
      this.registry.status(
        String((request.params as { deviceId: string }).deviceId),
      ),
    );
    this.app.post("/mcp/:deviceId", async (request, reply) =>
      this.tunnel.handle(request, reply),
    );
    this.app.get("/mcp/:deviceId", async (request, reply) =>
      this.tunnel.handle(request, reply),
    );
    this.app.delete("/mcp/:deviceId", async (request, reply) =>
      this.tunnel.handle(request, reply),
    );
    this.app.server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://relay.local");
      const match = url.pathname.match(/^\/agent\/([^/]+)$/);
      if (!match) {
        socket.destroy();
        return;
      }
      this.websocketServer.handleUpgrade(request, socket, head, (client) =>
        this.onConnection(match[1]!, client),
      );
    });
  }

  public async start(options: RelayServerOptions = {}): Promise<void> {
    if (this.listening) return;
    await this.app.listen({
      host: options.host ?? "0.0.0.0",
      port: options.port ?? Number(process.env.PORT ?? 8790),
    });
    this.listening = true;
  }

  public async stop(): Promise<void> {
    this.registry.closeAll();
    this.websocketServer.close();
    if (this.listening) await this.app.close();
    this.listening = false;
  }

  private onConnection(deviceId: string, socket: WebSocket): void {
    socket.once("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          version?: string;
          deviceId?: string;
        };
        if (message.type !== "agent.hello" || message.deviceId !== deviceId) {
          socket.close(1008, "agent.hello required");
          return;
        }
        this.registry.register(deviceId, message.version ?? "unknown", socket);
        socket.on("message", (payload) =>
          this.tunnel.onMessage(socket, payload.toString()),
        );
        socket.once("close", () => this.tunnel.cancelSocket(socket));
        socket.send(JSON.stringify({ type: "agent.ready", deviceId }));
      } catch {
        socket.close(1008, "invalid agent.hello");
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const server = new QnectorRelayServer();
  await server.start();
  console.log(`Qnector Relay listening on ${process.env.PORT ?? 8790}`);
  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
