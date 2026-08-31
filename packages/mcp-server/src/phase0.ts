import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cors from "@fastify/cors";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface Phase0Options {
  port?: number;
  host?: string;
  testFile?: string;
}

export class Phase0Server {
  public readonly app: FastifyInstance;
  private readonly file: string;
  private readonly mcpHandler: ReturnType<typeof createMcpHandler>;
  private readonly mcpNodeHandler: ReturnType<typeof toNodeHandler>;

  public constructor(options: Phase0Options = {}) {
    this.file = path.resolve(
      options.testFile ?? path.join(process.cwd(), "qnector-write-test.txt"),
    );
    this.app = Fastify({ logger: false });
    this.mcpHandler = createMcpHandler(() => this.createServer());
    this.mcpNodeHandler = toNodeHandler(this.mcpHandler);
    void this.app.register(cors, { origin: true });
    this.app.get("/healthz", async () => ({ ok: true, phase: 0 }));
    this.app.post("/mcp", async (request, reply) =>
      this.handle(request, reply),
    );
    this.app.get("/mcp", async (request, reply) => this.handle(request, reply));
    this.app.delete("/mcp", async (request, reply) =>
      this.handle(request, reply),
    );
  }

  public async start(options: Phase0Options = {}): Promise<void> {
    await this.app.listen({
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 8788,
    });
  }
  public async stop(): Promise<void> {
    await this.mcpHandler.close().catch(() => undefined);
    await this.app.close();
  }

  private async handle(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    reply.hijack();
    await this.mcpNodeHandler(
      request.raw,
      reply.raw,
      request.method === "POST" ? request.body : undefined,
    );
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: "Qnector Phase 0", version: "0.1.0" });
    server.registerTool(
      "ping",
      { description: "Return a liveness response", inputSchema: z.object({}) },
      async () => {
        const result = { ok: true, time: new Date().toISOString() };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
    server.registerTool(
      "read_test",
      {
        description: "Read the Qnector Phase 0 test file",
        inputSchema: z.object({}),
      },
      async () => {
        const content = await readFile(this.file, "utf8").catch(
          () => "(test file does not exist yet)",
        );
        const result = { ok: true, path: this.file, content };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
    server.registerTool(
      "write_test",
      {
        description: "Create or update qnector-write-test.txt",
        inputSchema: z.object({ message: z.string().optional() }),
      },
      async ({ message }) => {
        const content = `${message ?? "Qnector Phase 0 write succeeded"}\n`;
        await writeFile(this.file, content, "utf8");
        const sha256 = createHash("sha256").update(content).digest("hex");
        const result = {
          ok: true,
          path: this.file,
          bytes: Buffer.byteLength(content),
          sha256,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
    return server;
  }
}
