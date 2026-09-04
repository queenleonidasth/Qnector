import { describe, expect, it, vi } from "vitest";
import type { TransportAdapter, TransportSnapshot } from "@qnector/shared";
import { ResilientTransportAdapter } from "./resilient.js";

class FakeTransport implements TransportAdapter {
  public readonly mode = "openai-tunnel" as const;
  public startCalls = 0;
  public stopCalls = 0;
  public failStarts = 0;
  public startError = "network unavailable";
  private snapshot: TransportSnapshot = {
    state: "disconnected",
    mode: this.mode,
  };
  private readonly listeners = new Set<(snapshot: TransportSnapshot) => void>();

  public async start(): Promise<TransportSnapshot> {
    this.startCalls += 1;
    if (this.failStarts > 0) {
      this.failStarts -= 1;
      throw new Error(this.startError);
    }
    this.emit({
      state: "connected",
      mode: this.mode,
      publicUrl: "https://example.test/mcp",
    });
    return this.getSnapshot();
  }

  public async stop(): Promise<void> {
    this.stopCalls += 1;
    this.emit({ state: "disconnected", mode: this.mode });
  }

  public getSnapshot(): TransportSnapshot {
    return { ...this.snapshot };
  }

  public onState(listener: (snapshot: TransportSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public crash(): void {
    this.emit({ state: "error", mode: this.mode, message: "bridge exited" });
  }

  private emit(snapshot: TransportSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}

describe("ResilientTransportAdapter", () => {
  it("reconnects after an unexpected transport exit", async () => {
    vi.useFakeTimers();
    try {
      const inner = new FakeTransport();
      const adapter = new ResilientTransportAdapter(inner, {
        retryDelaysMs: [100, 200],
      });
      await adapter.start();
      expect(inner.startCalls).toBe(1);
      inner.crash();
      expect(adapter.getSnapshot().state).toBe("connecting");
      expect(adapter.getSnapshot().message).toContain("Reconnecting in 100 ms");
      await vi.advanceTimersByTimeAsync(100);
      expect(inner.startCalls).toBe(2);
      expect(adapter.getSnapshot().state).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off repeated start failures and resets after recovery", async () => {
    vi.useFakeTimers();
    try {
      const inner = new FakeTransport();
      inner.failStarts = 2;
      const adapter = new ResilientTransportAdapter(inner, {
        retryDelaysMs: [100, 200, 500],
      });
      await adapter.start();
      expect(adapter.getSnapshot().message).toContain("100 ms");
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.getSnapshot().message).toContain("200 ms");
      await vi.advanceTimersByTimeAsync(200);
      expect(adapter.getSnapshot().state).toBe("connected");
      expect(inner.startCalls).toBe(3);
      inner.crash();
      expect(adapter.getSnapshot().message).toContain("100 ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reconnects after an explicit disconnect", async () => {
    vi.useFakeTimers();
    try {
      const inner = new FakeTransport();
      const adapter = new ResilientTransportAdapter(inner, {
        retryDelaysMs: [100],
      });
      await adapter.start();
      inner.crash();
      await adapter.stop();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(inner.startCalls).toBe(1);
      expect(inner.stopCalls).toBe(1);
      expect(adapter.getSnapshot().state).toBe("disconnected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry permanent configuration errors", async () => {
    vi.useFakeTimers();
    try {
      const inner = new FakeTransport();
      inner.failStarts = 1;
      inner.startError =
        "OPENAI_RUNTIME_API_KEY_REQUIRED: Runtime API key is required";
      const adapter = new ResilientTransportAdapter(inner, {
        retryDelaysMs: [100],
      });
      const state = await adapter.start();
      expect(state.state).toBe("error");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(inner.startCalls).toBe(1);
      expect(adapter.getSnapshot().state).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});
