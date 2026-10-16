import { createHash } from "node:crypto";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type GenericLspAction =
  | "document_symbols"
  | "workspace_symbols"
  | "definition"
  | "references"
  | "hover";

export interface GenericLspStatusEntry {
  language: string;
  extensions: string[];
  command: string;
  args: string[];
  available: boolean;
  resolvedPath: string | null;
}

export interface GenericLspRequest {
  workspaceRoot: string;
  path?: string;
  action: GenericLspAction;
  query?: string;
  line?: number;
  column?: number;
  maxResults?: number;
  serverCommand?: string;
  serverArgs?: string[];
}

interface LspAdapter {
  language: string;
  extensions: string[];
  command: string;
  args: string[];
}

const ADAPTERS: LspAdapter[] = [
  {
    language: "python",
    extensions: [".py", ".pyi"],
    command: "basedpyright-langserver",
    args: ["--stdio"],
  },
  {
    language: "python",
    extensions: [".py", ".pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
  },
  { language: "rust", extensions: [".rs"], command: "rust-analyzer", args: [] },
  { language: "go", extensions: [".go"], command: "gopls", args: ["serve"] },
  {
    language: "cpp",
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp"],
    command: "clangd",
    args: [],
  },
];

interface CachedLspSession {
  readonly key: string;
  readonly client: Promise<JsonRpcStdioClient>;
  readonly revisions: Map<string, { sha256: string; version: number }>;
  queue: Promise<void>;
  users: number;
  retired: boolean;
  closing?: Promise<void>;
  idleTimer?: NodeJS.Timeout;
}

/** Reuse on-demand, read-only LSP servers briefly; never prewarm or cross workspace roots.
 * Serializing operations per server preserves document version ordering and prevents
 * concurrent requests from observing a half-updated document. */
export class GenericLspService {
  readonly #sessions = new Map<string, CachedLspSession>();
  readonly #idleMs: number;
  readonly #maxSessions: number;

  public constructor(options: { idleMs?: number; maxSessions?: number } = {}) {
    this.#idleMs = Math.max(100, options.idleMs ?? 25_000);
    this.#maxSessions = Math.max(1, Math.min(4, options.maxSessions ?? 2));
  }

  public status(): GenericLspStatusEntry[] {
    return ADAPTERS.map((adapter) => {
      const resolvedPath = resolveCommand(adapter.command);
      return { ...adapter, available: Boolean(resolvedPath), resolvedPath };
    });
  }

  public async request(input: GenericLspRequest): Promise<{
    language: string;
    server: string;
    action: GenericLspAction;
    result: unknown;
    truncated: boolean;
  }> {
    const workspaceRoot = path.resolve(input.workspaceRoot);
    const sourcePath = input.path
      ? path.isAbsolute(input.path)
        ? path.resolve(input.path)
        : path.resolve(workspaceRoot, input.path)
      : undefined;
    const explicit = input.serverCommand?.trim();
    const adapter = explicit
      ? {
          language: sourcePath
            ? languageForExtension(path.extname(sourcePath))
            : "custom",
          extensions: sourcePath ? [path.extname(sourcePath)] : [],
          command: explicit,
          args: input.serverArgs ?? [],
        }
      : selectAdapter(sourcePath);
    const resolved =
      explicit && path.isAbsolute(explicit)
        ? explicit
        : resolveCommand(adapter.command);
    if (!resolved)
      throw new Error(
        "LSP_SERVER_UNAVAILABLE: " + adapter.command + " is not installed or not in PATH",
      );
    if (input.action !== "workspace_symbols" && !sourcePath)
      throw new Error("INVALID_INPUT: path is required for " + input.action);
    const maxResults = clamp(input.maxResults ?? 100, 1, 1_000);
    // Do not start a language server for invalid positions.
    const position = input.action === "definition" || input.action === "references" || input.action === "hover"
      ? { line: positivePosition(input.line, "line") - 1, character: positivePosition(input.column, "column") - 1 }
      : undefined;
    const key = JSON.stringify([resolved, adapter.args, workspaceRoot]);
    const session = this.#acquire(key, resolved, adapter.args, workspaceRoot);
    const work = session.queue.then(async () => {
      const client = await session.client;
      if (sourcePath) {
        // Fresh content fingerprint on every request: a stale LSP document is never reused.
        const text = await readFile(sourcePath, "utf8");
        const uri = pathToFileURL(sourcePath).href;
        const sha256 = createHash("sha256").update(text).digest("hex");
        const previous = session.revisions.get(uri);
        if (!previous) {
          await client.openDocument(sourcePath, adapter.language, text);
          session.revisions.set(uri, { sha256, version: 1 });
        } else if (previous.sha256 !== sha256) {
          const version = previous.version + 1;
          client.changeDocument(sourcePath, text, version);
          session.revisions.set(uri, { sha256, version });
        }
      }
      let result: unknown;
      if (input.action === "document_symbols") {
        result = await client.request("textDocument/documentSymbol", {
          textDocument: { uri: pathToFileURL(sourcePath!).href },
        });
      } else if (input.action === "workspace_symbols") {
        result = await client.request("workspace/symbol", { query: input.query ?? "" });
      } else {
        const params: Record<string, unknown> = {
          textDocument: { uri: pathToFileURL(sourcePath!).href },
          position,
        };
        if (input.action === "references")
          params.context = { includeDeclaration: true };
        result = await client.request(
          input.action === "definition"
            ? "textDocument/definition"
            : input.action === "references"
              ? "textDocument/references"
              : "textDocument/hover",
          params,
        );
      }
      const bounded = boundResult(result, maxResults);
      return {
        language: adapter.language, server: resolved, action: input.action,
        result: bounded.value, truncated: bounded.truncated,
      };
    });
    session.queue = work.then(() => undefined, () => undefined);
    return work.then(
      (value) => { this.#release(session); return value; },
      (error: unknown) => { this.#retire(session); this.#release(session); throw error; },
    );
  }

  public async close(): Promise<void> {
    const entries = [...this.#sessions.values()];
    this.#sessions.clear();
    for (const entry of entries) this.#retire(entry);
    await Promise.all(entries.map(async (entry) => {
      await entry.queue;
      await this.#closeSession(entry);
    }));
  }

  #acquire(key: string, command: string, args: string[], workspace: string): CachedLspSession {
    let session = this.#sessions.get(key);
    if (session) {
      this.#sessions.delete(key);
      this.#sessions.set(key, session); // LRU order
    } else {
      if (this.#sessions.size >= this.#maxSessions) {
        const idle = [...this.#sessions.values()].find((entry) => entry.users === 0);
        if (idle) this.#retire(idle);
      }
      const client = new JsonRpcStdioClient(command, args, workspace);
      const startup = (async () => {
        try {
          await client.start();
          await client.initialize();
          return client;
        } catch (error) {
          await client.close().catch(() => undefined);
          throw error;
        }
      })();
      session = {
        key, client: startup, revisions: new Map(), queue: Promise.resolve(),
        users: 0, retired: this.#sessions.size >= this.#maxSessions,
      };
      if (!session.retired) this.#sessions.set(key, session);
    }
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    session.users++;
    return session;
  }

  #release(session: CachedLspSession): void {
    session.users = Math.max(0, session.users - 1);
    if (session.users !== 0) return;
    if (session.retired) {
      void this.#closeSession(session);
      return;
    }
    session.idleTimer = setTimeout(() => this.#retire(session), this.#idleMs);
    session.idleTimer.unref?.();
  }

  #retire(session: CachedLspSession): void {
    session.retired = true;
    if (this.#sessions.get(session.key) === session)
      this.#sessions.delete(session.key);
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (session.users === 0) void this.#closeSession(session);
  }

  #closeSession(session: CachedLspSession): Promise<void> {
    if (!session.closing) {
      session.closing = session.queue
        .then(() => session.client)
        .then((client) => client.close())
        .catch(() => undefined);
    }
    return session.closing;
  }
}

class JsonRpcStdioClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  public constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly workspaceRoot: string,
  ) {}

  public async start(): Promise<void> {
    const isWindowsShim =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(this.command);
    const executable = isWindowsShim ? "cmd.exe" : this.command;
    const args = isWindowsShim
      ? ["/d", "/c", "call", this.command, ...this.args]
      : this.args;
    const child = spawn(executable, args, {
      cwd: this.workspaceRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", (error) => this.rejectAll(new Error("LSP_SERVER_FAILED: stdin " + error.message)));
    child.once("exit", () =>
      this.rejectAll(new Error("LSP_SERVER_EXITED: language server exited")),
    );
    child.once("error", (error) =>
      this.rejectAll(new Error(`LSP_SERVER_FAILED: ${error.message}`)),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (child.exitCode !== null)
      throw new Error(
        `LSP_SERVER_FAILED: ${this.command} exited during startup`,
      );
  }

  public async initialize(): Promise<void> {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.workspaceRoot).href,
      capabilities: {
        workspace: { workspaceFolders: true },
        textDocument: {
          documentSymbol: {},
          definition: {},
          references: {},
          hover: {},
        },
      },
      workspaceFolders: [
        {
          uri: pathToFileURL(this.workspaceRoot).href,
          name: path.basename(this.workspaceRoot),
        },
      ],
    });
    this.notify("initialized", {});
  }

  public async openDocument(file: string, languageId: string, content?: string): Promise<void> {
    const text = content ?? await readFile(file, "utf8");
    this.notify("textDocument/didOpen", {
      textDocument: { uri: pathToFileURL(file).href, languageId, version: 1, text },
    });
  }

  public changeDocument(file: string, text: string, version: number): void {
    this.notify("textDocument/didChange", {
      textDocument: { uri: pathToFileURL(file).href, version },
      contentChanges: [{ text }],
    });
  }

  public request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP_TIMEOUT: ${method} exceeded 15000 ms`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  public notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  public async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      await Promise.race([
        this.request("shutdown", null),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
      this.notify("exit", {});
    } catch {
      // Shutdown is best-effort.
    }
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("close", () => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    this.child = undefined;
    this.rejectAll(new Error("LSP_CLIENT_CLOSED: language server client closed"));
  }

  private send(message: unknown): void {
    if (!this.child?.stdin.writable)
      throw new Error(
        "LSP_SERVER_FAILED: language server stdin is not writable",
      );
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    this.child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin.write(payload);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer
        .subarray(bodyStart, bodyStart + length)
        .toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        const message = JSON.parse(body) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof message.id !== "number") continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(
            new Error(
              `LSP_ERROR: ${message.error.message ?? "request failed"}`,
            ),
          );
        else pending.resolve(message.result);
      } catch {
        // Ignore malformed server notifications; pending requests retain timeout protection.
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function selectAdapter(sourcePath?: string): LspAdapter {
  if (!sourcePath)
    throw new Error(
      "INVALID_INPUT: path or serverCommand is required to select a language server",
    );
  const extension = path.extname(sourcePath).toLowerCase();
  const candidates = ADAPTERS.filter((adapter) =>
    adapter.extensions.includes(extension),
  );
  if (candidates.length === 0)
    throw new Error(
      `LSP_LANGUAGE_UNSUPPORTED: no generic LSP adapter is configured for '${extension}'`,
    );
  const available = candidates.find((adapter) =>
    resolveCommand(adapter.command),
  );
  return available ?? candidates[0]!;
}

function resolveCommand(command: string): string | null {
  if (path.isAbsolute(command)) return command;
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookup, [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const candidates = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (process.platform === "win32") {
    return (
      candidates.find((entry) => /\.(exe|cmd|bat|com)$/i.test(entry)) ??
      candidates[0] ??
      null
    );
  }
  return candidates[0] ?? null;
}

function languageForExtension(extension: string): string {
  return (
    ADAPTERS.find((adapter) =>
      adapter.extensions.includes(extension.toLowerCase()),
    )?.language ??
    (extension.replace(/^\./, "") || "plaintext")
  );
}

function positivePosition(value: number | undefined, name: string): number {
  if (!Number.isInteger(value) || (value ?? 0) < 1)
    throw new Error(
      `INVALID_POSITION: ${name} must be a positive 1-based integer`,
    );
  return value!;
}

function boundResult(
  value: unknown,
  maxResults: number,
): { value: unknown; truncated: boolean } {
  if (Array.isArray(value)) {
    return {
      value: value.slice(0, maxResults),
      truncated: value.length > maxResults,
    };
  }
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") <= 200_000)
    return { value, truncated: false };
  return { value: { preview: text.slice(0, 180_000) }, truncated: true };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
