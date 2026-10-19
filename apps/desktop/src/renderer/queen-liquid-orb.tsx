import React, { useCallback, useEffect, useRef } from "react";
import { useRoyalCanvasMotion } from "./royal-motion-clock.js";
import { MOTION_CHANGE_EVENT, currentMotionQuality, motionBudget } from "./motion-policy.js";

const QUEEN_IMAGE_URL = new URL("./assets/queen-portrait.png", import.meta.url).href;

interface QueenLiquidOrbProps {
  connected: boolean;
  holding: boolean;
  disconnecting: boolean;
  motionEnabled: boolean;
}

const points = Array.from({ length: 36 }, (_, index) => ({
  phase: index * 2.39996,
  radius: 0.18 + ((index * 19) % 61) / 100,
  width: 0.3 + (index % 3) * 0.22,
}));

/**
 * Hero orb for the real Electron renderer. The transparent user-supplied Queen
 * portrait is integrated INSIDE its fluid glass, without a square badge.
 */
export const QueenLiquidOrb = React.memo(function QueenLiquidOrb({
  connected,
  holding,
  disconnecting,
  motionEnabled,
}: QueenLiquidOrbProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometry = useRef({ width: 0, height: 0 });
  const stateRef = useRef({ connected, holding, disconnecting });
  stateRef.current = { connected, holding, disconnecting };

  const draw = useCallback((seconds: number, animated: boolean): void => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!ctx) return;
    const { width, height } = geometry.current;
    if (!width || !height) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.49;
    const time = animated ? seconds : 0;
    const budget = motionBudget(currentMotionQuality());
    const intensity = stateRef.current.connected ? 1 : 0.52;
    const speed = stateRef.current.holding ? 1.35 : 0.26;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const base = ctx.createRadialGradient(width * 0.32, height * 0.24, 1, cx, cy, radius);
    base.addColorStop(0, "#586475");
    base.addColorStop(0.23, "#242c38");
    base.addColorStop(0.42, "#25212a");
    base.addColorStop(0.74, "#805327");
    base.addColorStop(1, "#0b1018");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const reflection = ctx.createRadialGradient(width * 0.27, height * 0.16, 0, width * 0.34, height * 0.26, radius * 0.85);
    reflection.addColorStop(0, "rgba(255, 249, 226, .42)");
    reflection.addColorStop(0.30, "rgba(228, 237, 244, .12)");
    reflection.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = reflection;
    ctx.fillRect(0, 0, width, height);

    ctx.lineCap = "round";
    for (let arc = 0; arc < budget.orbArcs; arc += 1) {
      const angle = arc * 0.78 + time * speed * (arc % 2 ? -0.49 : 0.46);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(
        0, 0,
        radius * (0.46 + arc * 0.062),
        radius * (0.20 + arc * 0.055),
        arc * 0.17,
        Math.PI * (0.17 + arc * 0.035),
        Math.PI * (1.40 + arc * 0.048),
      );
      ctx.strokeStyle = arc % 2 ? "rgba(255, 230, 165, .48)" : "rgba(233, 161, 67, .52)";
      ctx.lineWidth = arc % 3 === 0 ? 1.5 : 0.8;
      ctx.globalAlpha = intensity;
      ctx.stroke();
      ctx.restore();
    }

    for (const point of points.slice(0, budget.orbPoints)) {
      const phase = point.phase + time * speed * 0.66;
      const x = cx + Math.cos(phase) * point.radius * radius;
      const y = cy + Math.sin(phase * 1.14) * point.radius * radius * 0.8;
      ctx.globalAlpha = intensity * (0.3 + Math.max(0, Math.sin(phase * 2)) * 0.6);
      ctx.fillStyle = "#ffe1a1";
      ctx.beginPath();
      ctx.arc(x, y, point.width, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = (): void => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, motionBudget(currentMotionQuality()).maxDpr);
      geometry.current = { width, height };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(0, false);
    };
    resize();
    // Defer canvas resize writes out of the ResizeObserver delivery phase.
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        resize();
      });
    });
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    document.documentElement.addEventListener(MOTION_CHANGE_EVENT, resize);
    return () => {
      document.documentElement.removeEventListener(MOTION_CHANGE_EVENT, resize);
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, [draw]);

  useRoyalCanvasMotion(draw, motionEnabled && !disconnecting);

  return (
    <div className="queen-orb-visual" aria-hidden="true">
      <div className="queen-orb-float">
        <div className="queen-orb-inner-glass">
          <canvas ref={canvasRef} className="queen-orb-fluid" />
          <img src={QUEEN_IMAGE_URL} className="queen-orb-portrait" alt="" draggable={false} />
          <div className="queen-orb-reflection" />
        </div>
      </div>
    </div>
  );
});
