import { afterEach, describe, expect, it, vi } from "vitest";
import { withToolProgressHeartbeat } from "./mcp-reliability.js";

afterEach(() => vi.useRealTimers());

describe("MCP progress heartbeat", () => {
  it("sends monotonically increasing progress with a token and stops on completion", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const running = withToolProgressHeartbeat({
      progressToken: "progress-token", intervalMs: 10,
      notify: async notification => { sent.push(notification.params.progress); },
    }, async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 55));
      return "done";
    });
    await vi.advanceTimersByTimeAsync(60);
    expect(await running).toBe("done");
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(sent).toEqual(sent.map((_, index) => index + 1));
    const count = sent.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(count);
  });

  it("never emits unsolicited progress without a client token", async () => {
    const notify = vi.fn(async () => undefined);
    const value = await withToolProgressHeartbeat({notify, intervalMs: 10}, async () => 42);
    expect(value).toBe(42);
    expect(notify).not.toHaveBeenCalled();
  });

  it("notification failures do not fail work or leave a timer behind", async () => {
    vi.useFakeTimers();
    const notify = vi.fn(async () => { throw new Error("transport closed"); });
    const onError = vi.fn();
    const running = withToolProgressHeartbeat({
      progressToken: 7, intervalMs: 10, notify, onError,
    }, async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 35));
      return "completed";
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(await running).toBe("completed");
    expect(onError).toHaveBeenCalledTimes(1);
    const count = notify.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(notify).toHaveBeenCalledTimes(count);
  });
});
