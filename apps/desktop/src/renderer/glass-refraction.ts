import { useEffect } from "react";
import { MOTION_CHANGE_EVENT } from "./motion-policy.js";

/**
 * Mirrors the approved V2.1 mockup's refracted gold highlight under the
 * pointer. One passive delegated listener and one RAF (at most) per update.
 * Disabled with legacy animation-off, Motion Quality Off and OS reduced motion.
 */
export function useGlassRefraction(): void {
  useEffect(() => {
    const selector = [
      ".app-header", ".floating-glass-dock", ".activity-glass-card",
      ".drawer-card", ".setup-card", ".activity-detail-card",
    ].join(", ");
    let active: HTMLElement | null = null;
    let pending: { element: HTMLElement; x: number; y: number } | null = null;
    let frame = 0;

    const update = (): void => {
      frame = 0;
      if (!pending) return;
      const { element, x, y } = pending;
      pending = null;
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      element.style.setProperty("--glass-x", String(Math.min(100, Math.max(0, ((x - rect.left) / rect.width) * 100))) + "%");
      element.style.setProperty("--glass-y", String(Math.min(100, Math.max(0, ((y - rect.top) / rect.height) * 100))) + "%");
    };
    const onMove = (event: PointerEvent): void => {
      const root = document.documentElement;
      if (root.dataset.motion === "off" ||
        root.dataset.motionQuality === "off" ||
        root.dataset.motionQuality === "reduced" ||
        root.dataset.motionQuality === "eco") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const surface = target.closest<HTMLElement>(selector);
      if (!surface) return;
      active = surface;
      pending = { element: surface, x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onLeave = (): void => {
      if (active) {
        active.style.removeProperty("--glass-x");
        active.style.removeProperty("--glass-y");
        active = null;
      }
      pending = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener(MOTION_CHANGE_EVENT, onLeave);
    window.addEventListener("blur", onLeave);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener(MOTION_CHANGE_EVENT, onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("pointerleave", onLeave);
      onLeave();
    };
  }, []);
}
