import { spawn, type ChildProcess } from "node:child_process";
import type {
  TransportAdapter,
  TransportMode,
  TransportSnapshot,
} from "@qnector/shared";

export abstract class BaseTransportAdapter implements TransportAdapter {
  public abstract readonly mode: TransportMode;
  protected snapshot: TransportSnapshot;
  protected child?: ChildProcess;
  private readonly listeners = new Set<(snapshot: TransportSnapshot) => void>();

  public constructor(protected readonly localUrl: string) {
    // The subclass mode field is initialized immediately after `super()`; use a
    // neutral value here and all public snapshots are replaced before use.
    this.snapshot = { state: "disconnected", mode: "local-only" };
  }

  public abstract start(): Promise<TransportSnapshot>;

  public async stop(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      if (process.platform === "win32" && this.child.pid) {
        await new Promise<void>((resolve) => {
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(this.child!.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.once("close", () => resolve());
          killer.once("error", () => resolve());
        });
      } else this.child.kill("SIGTERM");
    }
    this.child = undefined;
    this.setSnapshot({ state: "disconnected", mode: this.mode });
  }

  public getSnapshot(): TransportSnapshot {
    return { ...this.snapshot };
  }

  public onState(listener: (snapshot: TransportSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected setSnapshot(snapshot: TransportSnapshot): void {
    this.snapshot = { ...snapshot };
    for (const listener of this.listeners) listener(this.getSnapshot());
  }

  protected watchExit(child: ChildProcess): void {
    child.once("error", (error) =>
      this.setSnapshot({
        state: "error",
        mode: this.mode,
        message: error.message,
      }),
    );
    child.once("exit", (code, signal) => {
      if (this.snapshot.state !== "disconnected")
        this.setSnapshot({
          state: "error",
          mode: this.mode,
          message: `bridge exited (${code ?? signal ?? "unknown"})`,
        });
    });
  }
}

export function waitForOrigin(
  child: ChildProcess,
  matcher: RegExp,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let timer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(matcher);
      if (match?.[0]) {
        cleanup();
        resolve(match[0]);
      }
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error("TUNNEL_EXITED_BEFORE_URL"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`TUNNEL_URL_TIMEOUT: no public URL after ${timeoutMs} ms`),
      );
    }, timeoutMs);
  });
}
