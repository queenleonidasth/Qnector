import { useEffect, useRef } from "react";

/**
 * All continuous Royal visuals subscribe directly to the display's rAF cadence.
 * This is NOT a 30/42/60 fps timer: on 60/120/165 Hz displays we request every
 * available VSync. Degrade effect complexity instead of intentionally skipping
 * frames. Actual fps still depends on hardware, refresh rate and OS load.
 */
export const MIN_ACTIVE_MOTION_TARGET_FPS = 60;
export const RAF_CADENCE = "native-vsync" as const;

export type RoyalFramePainter = (timeSeconds: number, animated: boolean) => void;

export function useRoyalCanvasMotion(
  paint: RoyalFramePainter,
  motionEnabled: boolean,
): void {
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let nativeVisible = false;
    let visibilityReceived = false;
    let frame: number | null = null;

    const running = (): boolean =>
      !disposed && nativeVisible && !document.hidden && motionEnabled && !query.matches;

    const stop = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };

    const tick = (timestamp: number): void => {
      frame = null;
      if (!running()) return;
      // Wall-clock time avoids cumulative drift and 30 fps "stepped" motion.
      paintRef.current(timestamp / 1000, true);
      frame = requestAnimationFrame(tick);
    };

    const refresh = (): void => {
      stop();
      if (disposed) return;
      paintRef.current(performance.now() / 1000, false);
      if (running()) frame = requestAnimationFrame(tick);
    };

    const onVisibility = (visible: boolean): void => {
      visibilityReceived = true;
      nativeVisible = visible;
      refresh();
    };

    const unsubscribe = window.qnector.onWindowVisible(onVisibility);
    void window.qnector.getWindowVisible()
      .then((visible) => {
        if (!visibilityReceived) onVisibility(visible);
      })
      .catch(() => undefined);
    document.addEventListener("visibilitychange", refresh);
    query.addEventListener("change", refresh);

    // Initial static frame does not run a hidden window's animation loop.
    refresh();
    return () => {
      disposed = true;
      stop();
      unsubscribe();
      query.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [motionEnabled]);
}
