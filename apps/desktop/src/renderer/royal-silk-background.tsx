import React, { useCallback, useEffect, useRef } from "react";
import { useRoyalCanvasMotion } from "./royal-motion-clock.js";
import { MOTION_CHANGE_EVENT, currentMotionQuality, motionBudget } from "./motion-policy.js";

interface RoyalSilkBackgroundProps {
  isConnected: boolean;
  frozen: boolean;
  motionEnabled: boolean;
}

const dust = Array.from({ length: 45 }, (_, index) => ({
  x: ((index * 91.71) % 1000) / 1000,
  y: ((index * 173.83 + 29) % 1000) / 1000,
  phase: index * 1.17,
  size: 0.48 + (index % 5) * 0.22,
}));

/**
 * Production candidate: no Matrix text glyphs or forced sub-60 FPS timers.
 * Keep the total per-frame paths bounded for use beside fullscreen games.
 */
export const RoyalSilkBackground = React.memo(function RoyalSilkBackground({
  isConnected,
  frozen,
  motionEnabled,
}: RoyalSilkBackgroundProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const metricsRef = useRef({ width: 0, height: 0 });
  const connectionRef = useRef(isConnected);
  connectionRef.current = isConnected;

  const draw = useCallback((seconds: number, animated: boolean) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!context) return;
    const { width, height } = metricsRef.current;
    if (!width || !height) return;

    const time = animated ? seconds : 0;
    const budget = motionBudget(currentMotionQuality());
    const strength = connectionRef.current ? 1 : 0.55;
    const ctx = context;
    ctx.clearRect(0, 0, width, height);

    const aura = ctx.createRadialGradient(
      width * 0.5, height * 0.49, 0,
      width * 0.5, height * 0.49, width * 0.70,
    );
    aura.addColorStop(0, "rgba(219, 143, 51, 0.17)");
    aura.addColorStop(0.65, "rgba(137, 90, 38, 0.07)");
    aura.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.globalAlpha = strength;
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, width, height);

    const light = ctx.createLinearGradient(0, height * 0.25, width, height * 0.8);
    light.addColorStop(0, "rgba(246, 200, 125, 0)");
    light.addColorStop(0.23, "rgba(246, 198, 108, 0.52)");
    light.addColorStop(0.53, "rgba(255, 233, 164, 0.74)");
    light.addColorStop(0.83, "rgba(214, 150, 68, 0.50)");
    light.addColorStop(1, "rgba(248, 184, 98, 0)");

    ctx.strokeStyle = light;
    ctx.lineCap = "round";
    for (let band = 0; band < budget.ribbons; band += 1) {
      const baseline = height * (0.18 + band * 0.124);
      const amplitude = height * (0.039 + (band % 3) * 0.013);
      const offset = band * 0.78 + time * (0.14 + band * 0.015);
      ctx.beginPath();
      for (let x = -20; x <= width + 20; x += 13) {
        const xx = x / Math.max(1, width);
        const y = baseline +
          Math.sin(xx * Math.PI * (1.6 + band * 0.10) + offset) * amplitude +
          Math.sin(xx * Math.PI * 3.1 - time * 0.095 + band) * amplitude * 0.27;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = strength * (band % 2 === 0 ? 0.36 : 0.25);
      ctx.lineWidth = band % 3 === 0 ? 3.5 : 1.6;
      ctx.stroke();
    }
    ctx.globalAlpha = strength;

    for (const dot of dust.slice(0, budget.dust)) {
      const x = dot.x * width + Math.sin(time * 0.19 + dot.phase) * 9;
      const y = dot.y * height + Math.cos(time * 0.16 + dot.phase) * 7;
      ctx.globalAlpha = strength * (0.18 + 0.32 * (0.5 + 0.5 * Math.sin(dot.phase + time * 0.65)));
      ctx.fillStyle = "rgb(255, 218, 143)";
      ctx.beginPath();
      ctx.arc(x, y, dot.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = (): void => {
      const target = canvas.parentElement;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, motionBudget(currentMotionQuality()).maxDpr);
      metricsRef.current = { width, height };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now() / 1000, false);
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

  useRoyalCanvasMotion(draw, motionEnabled && !frozen);

  return (
    <div className="royal-silk-layer" aria-hidden="true">
      <canvas ref={canvasRef} className="liquid-silk-canvas" />
      <div className="royal-silk-vignette" />
    </div>
  );
});
