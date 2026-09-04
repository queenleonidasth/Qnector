import type { TransportAdapter, TransportSnapshot } from "@qnector/shared";

export interface ResilientTransportOptions {
  retryDelaysMs?: number[];
  setTimer?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Keeps a transport alive after unexpected process/network failures while still
 * respecting an explicit user disconnect. The wrapped adapter remains the
 * source of truth for the actual connection; this class only owns retry intent.
 */
export class ResilientTransportAdapter implements TransportAdapter {
  public readonly mode: TransportAdapter["mode"];
  private snapshot: TransportSnapshot;
  private readonly listeners = new Set<(snapshot: TransportSnapshot) => void>();
  private readonly retryDelaysMs: number[];
  private readonly setTimer: NonNullable<ResilientTransportOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<
    ResilientTransportOptions["clearTimer"]
  >;
  private readonly shouldRetry: NonNullable<
    ResilientTransportOptions["shouldRetry"]
  >;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private desiredRunning = false;
  private retryAttempt = 0;
  private generation = 0;
  private connectPromise?: Promise<TransportSnapshot>;
  private readonly unsubscribe: () => void;

  public constructor(
    private readonly inner: TransportAdapter,
    options: ResilientTransportOptions = {},
  ) {
    this.mode = inner.mode;
    this.snapshot = inner.getSnapshot();
    this.retryDelaysMs = (
      options.retryDelaysMs ?? [1_000, 2_000, 5_000, 10_000, 30_000]
    )
      .map((value) => Math.max(50, Math.floor(value)))
      .filter((value) => Number.isFinite(value));
    if (this.retryDelaysMs.length === 0) this.retryDelaysMs.push(1_000);
    this.setTimer =
      options.setTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.shouldRetry = options.shouldRetry ?? defaultShouldRetry;
    this.unsubscribe = inner.onState((snapshot) =>
      this.handleInnerState(snapshot),
    );
  }

  public async start(): Promise<TransportSnapshot> {
    this.desiredRunning = true;
    if (this.snapshot.state === "connected") return this.getSnapshot();
    this.cancelRetry();
    this.retryAttempt = 0;
    const generation = ++this.generation;
    return this.connect(generation, false);
  }

  public async stop(): Promise<void> {
    this.desiredRunning = false;
    this.generation += 1;
    this.cancelRetry();
    this.retryAttempt = 0;
    await this.inner.stop();
    this.setSnapshot({ state: "disconnected", mode: this.mode });
  }

  public getSnapshot(): TransportSnapshot {
    return { ...this.snapshot };
  }

  public onState(listener: (snapshot: TransportSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.desiredRunning = false;
    this.cancelRetry();
    this.unsubscribe();
    this.listeners.clear();
  }

  private async connect(
    generation: number,
    retrying: boolean,
  ): Promise<TransportSnapshot> {
    if (!this.desiredRunning || generation !== this.generation)
      return this.getSnapshot();
    if (this.connectPromise) return this.connectPromise;
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: retrying
        ? `Reconnecting ${this.mode} (attempt ${this.retryAttempt})…`
        : `Connecting ${this.mode}…`,
    });
    this.connectPromise = this.inner
      .start()
      .then((snapshot) => {
        if (generation !== this.generation || !this.desiredRunning)
          return this.getSnapshot();
        this.retryAttempt = 0;
        this.setSnapshot(snapshot);
        return this.getSnapshot();
      })
      .catch((error: unknown) => {
        if (generation === this.generation && this.desiredRunning) {
          this.setSnapshot({
            state: "error",
            mode: this.mode,
            message: error instanceof Error ? error.message : String(error),
          });
          this.scheduleRetry(generation, error);
        }
        return this.getSnapshot();
      })
      .finally(() => {
        this.connectPromise = undefined;
      });
    return this.connectPromise;
  }

  private handleInnerState(snapshot: TransportSnapshot): void {
    if (!this.desiredRunning) {
      if (snapshot.state === "disconnected") this.setSnapshot(snapshot);
      return;
    }
    this.setSnapshot(snapshot);
    if (snapshot.state === "connected") {
      this.retryAttempt = 0;
      this.cancelRetry();
      return;
    }
    if (snapshot.state === "error")
      this.scheduleRetry(this.generation, snapshot.message);
  }

  private scheduleRetry(generation: number, reason?: unknown): void {
    if (
      !this.desiredRunning ||
      generation !== this.generation ||
      this.retryTimer ||
      !this.shouldRetry(reason)
    )
      return;
    this.retryAttempt += 1;
    const delay =
      this.retryDelaysMs[
        Math.min(this.retryAttempt - 1, this.retryDelaysMs.length - 1)
      ]!;
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: `Connection lost. Reconnecting in ${formatDelay(delay)} (attempt ${this.retryAttempt})…`,
    });
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      void this.connect(generation, true);
    }, delay);
  }

  private cancelRetry(): void {
    if (!this.retryTimer) return;
    this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
  }

  private setSnapshot(snapshot: TransportSnapshot): void {
    this.snapshot = { ...snapshot };
    const cloned = this.getSnapshot();
    for (const listener of this.listeners) listener(cloned);
  }
}

function defaultShouldRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) return true;
  return !/(?:_REQUIRED\b|INVALID_CONFIG|ENOENT|EACCES|EPERM|not found|is missing|permission denied|runtime api key.*required)/i.test(
    message,
  );
}

function formatDelay(delayMs: number): string {
  if (delayMs < 1_000) return `${delayMs} ms`;
  const seconds = delayMs / 1_000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}
