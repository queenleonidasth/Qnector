import { setTimeout as delay } from "node:timers/promises";

export type ProbeMode = "silent" | "progress" | "keepalive" | "both";

/** Diagnostic-only tool: intentionally keeps its tool call open to measure
 * the real client/tunnel deadline. Never enable in normal tool listings. */
export async function runTimeoutProbe(options: {
  durationSec: number;
  mode: ProbeMode;
  progressToken?: string | number;
  notify: (notification: {
    method: "notifications/progress";
    params: {progressToken: string | number; progress: number; total: number};
  }) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
}): Promise<{ok: true; actualMs: number; mode: ProbeMode; progressSent: number}> {
  const {durationSec, mode, progressToken, notify, signal, onProgress} = options;
  if (!Number.isInteger(durationSec) || durationSec < 0 || durationSec > 300)
    throw new Error("PROBE_INVALID_DURATION");
  const wantsProgress = mode === "progress" || mode === "both";
  if (wantsProgress && progressToken === undefined)
    throw new Error("PROGRESS_TOKEN_MISSING: client did not request progress");
  const started = performance.now();
  let counter = 0;
  const total = Math.ceil(durationSec * 1000 / 20_000) + 2;
  const tick = () => {
    if (signal?.aborted || progressToken === undefined) return;
    counter += 1;
    void notify({method: "notifications/progress", params: {
      progressToken, progress: counter, total,
    }}).then(() => onProgress?.(counter)).catch(() => {
      // Diagnostic notification failure must not crash the tool being measured.
    });
  };
  if (wantsProgress) tick();
  const timer = wantsProgress ? setInterval(tick, 20_000) : undefined;
  timer?.unref();
  try {
    await delay(durationSec * 1000, undefined, signal ? {signal} : undefined);
    return {ok: true, actualMs: Math.round(performance.now() - started),
      mode, progressSent: counter};
  } finally {
    if (timer) clearInterval(timer);
  }
}
