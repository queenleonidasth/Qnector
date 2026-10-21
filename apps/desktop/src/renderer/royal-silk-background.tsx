import React, { useCallback, useEffect, useRef } from "react";
import { useRoyalCanvasMotion } from "./royal-motion-clock.js";
import { MOTION_CHANGE_EVENT, currentMotionQuality, motionBudget } from "./motion-policy.js";

interface RoyalSilkBackgroundProps {
  isConnected: boolean;
  frozen: boolean;
  motionEnabled: boolean;
}

const motes = Array.from({ length: 90 }, (_, index) => {
  const seed = (index * 57.7 + 17) % 1000;
  return {
    angle: (seed * 0.071) % (Math.PI * 2),
    radius: 22 + (seed * 0.61) % 330,
    size: 0.5 + (seed % 7) * 0.18,
    drift: 0.22 + (seed % 9) * 0.07,
    phase: seed,
  };
});

/**
 * Full-window silk from the user-approved V2.1 HTML, not a tiny Canvas occupying
 * 150px in the hero flex layout. Three translucent bands per path give the
 * cinematic, refractive light; Quality budgets adjust density and DPR.
 * All painters share the existing visible-only native VSYNC clock.
 */
export const RoyalSilkBackground = React.memo(function RoyalSilkBackground({
  isConnected,
  frozen,
  motionEnabled,
}: RoyalSilkBackgroundProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geometry = useRef({ width: 0, height: 0 });
  const lastAnimatedSecondsRef = useRef(0);
  const connectedRef = useRef(isConnected);
  connectedRef.current = isConnected;

  const draw = useCallback((seconds: number, animated: boolean): void => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!ctx) return;
    const { width: w, height: h } = geometry.current;
    if (w < 1 || h < 1) return;

    const budget = motionBudget(currentMotionQuality());
    if (animated) lastAnimatedSecondsRef.current = seconds;
    const time = lastAnimatedSecondsRef.current;
    const strength = connectedRef.current ? 1 : 0.55;
    ctx.clearRect(0, 0, w, h);

    const backdrop = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.76);
    backdrop.addColorStop(0, "rgba(178,103,37,.25)");
    backdrop.addColorStop(0.36, "rgba(68,45,35,.11)");
    backdrop.addColorStop(1, "rgba(7,9,13,0)");
    ctx.globalAlpha = strength;
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, w, h);

    // Warm-silver silk reflection: broad translucent ribbons, a blurred inner
    // strand, and a sharp filament. Preserve this hierarchy in every profile.
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "rgba(201,132,56,0)");
    gradient.addColorStop(0.16, "rgba(255,211,142,.62)");
    gradient.addColorStop(0.39, "rgba(190,115,38,.80)");
    gradient.addColorStop(0.58, "rgba(255,243,196,.95)");
    gradient.addColorStop(0.82, "rgba(211,151,72,.68)");
    gradient.addColorStop(1, "rgba(250,196,111,0)");

    for (let i = 0; i < Math.min(budget.ribbons, 7); i += 1) {
      const lower = i % 2 === 0;
      const mid = h * (lower ? 0.72 : 0.31);
      const yBase = mid + (i - 3) * h * 0.087;
      const amplitude = h * (0.055 + (i % 3) * 0.024);
      const frequency = 0.72 + i * 0.16;
      const phase = i * 0.92 + (i % 2 ? Math.PI : 0);
      const path = new Path2D();
      for (let x = -30; x <= w + 40; x += 13) {
        const normalized = x / w;
        const bend = Math.sin(normalized * frequency * Math.PI * 2 + phase + (time + i * 0.64) * 0.09) * amplitude;
        const bend2 = Math.sin(normalized * Math.PI * 2.7 - time * 0.06 + phase * 0.44) * amplitude * 0.32;
        const y = yBase + bend + bend2;
        if (x === -30) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      // Three passes use one calculated path rather than recomputing it.
      const layers = budget.ribbons >= 6
        ? [{ width: 67, opacity: 0.065 }, { width: 26, opacity: 0.13 }, { width: 3.2, opacity: 0.66 }]
        : [{ width: 35, opacity: 0.045 }, { width: 2.5, opacity: 0.48 }];
      ctx.strokeStyle = gradient;
      ctx.lineCap = "round";
      for (const layer of layers) {
        ctx.globalAlpha = strength * layer.opacity;
        ctx.lineWidth = layer.width;
        ctx.stroke(path);
      }
    }

    for (let i = 0; i < Math.min(budget.dust, motes.length); i += 1) {
      const p = motes[i]!;
      const x = ((p.radius / 360) * w + Math.sin(p.angle + time * 0.11 * p.drift) * 44 + w) % w;
      const y = ((p.phase * 0.77 / 1000) * h + Math.cos(p.angle + time * 0.09 * p.drift) * 27 + h) % h;
      const twinkle = 0.40 + 0.60 * Math.max(0, Math.sin(p.angle * 2 + time * 0.8));
      ctx.globalAlpha = twinkle * 0.64 * strength;
      ctx.fillStyle = i % 7 === 0 ? "#fff3cf" : "#e9ad62";
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
      if (i % 12 === 0) {
        ctx.globalAlpha = 0.075 * strength;
        ctx.beginPath();
        ctx.arc(x, y, p.size * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
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
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      // Reassigning the same canvas size clears its bitmap unnecessarily.
      if (canvas.width === pixelWidth && canvas.height === pixelHeight) return;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(lastAnimatedSecondsRef.current, false);
    };
    resize();
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => { resizeFrame = null; resize(); });
    });
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    document.documentElement.addEventListener(MOTION_CHANGE_EVENT, resize);
    return () => {
      document.documentElement.removeEventListener(MOTION_CHANGE_EVENT, resize);
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, [draw]);

  useRoyalCanvasMotion(draw, motionEnabled && !frozen);

  return (
    <div className="royal-silk-layer" aria-hidden="true">
      <canvas ref={canvasRef} className="liquid-silk-canvas" />
      <div className="royal-silk-vignette" />
    </div>
  );
});
