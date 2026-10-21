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

const flecks = Array.from({ length: 70 }, (_, index) => {
  const seed = ((index + 21) * 74.61) % 997;
  return {
    angle: (seed * 0.029) % (Math.PI * 2),
    radius: 14 + (seed % 123),
    size: 0.35 + (seed % 7) * 0.15,
    phase: seed,
    velocity: 0.11 + (seed % 17) * 0.005,
  };
});

/**
 * Full-size Queen glass orb inspired by the user's approved V2.1 HTML. The
 * original transparent PNG is composited ABOVE caustic reflections, not
 * screened into the dark shell. No square emblem tile or fuzzy resized copy.
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
    const { width: w, height: h } = geometry.current;
    if (w < 1 || h < 1) return;

    const budget = motionBudget(currentMotionQuality());
    const time = animated ? seconds : 0;
    const speed = stateRef.current.holding ? 0.29 : 0.16;
    const angleTime = time * speed;
    const glow = stateRef.current.connected ? 1 : 0.55;
    const centerX = w * 0.5;
    const centerY = h * 0.5;
    const radius = Math.min(w, h) * 0.5 - 0.5;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();

    const base = ctx.createRadialGradient(w * 0.35, h * 0.24, radius * 0.06, centerX, centerY, radius * 1.16);
    base.addColorStop(0, "#556476");
    base.addColorStop(0.22, "#252b32");
    base.addColorStop(0.40, "#201b23");
    base.addColorStop(0.72, "#744a24");
    base.addColorStop(0.90, "#211b20");
    base.addColorStop(1, "#070c14");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const glare = ctx.createLinearGradient(0, 0, w, h);
    glare.addColorStop(0, "rgba(255,250,226,.38)");
    glare.addColorStop(0.20, "rgba(254,247,207,.08)");
    glare.addColorStop(0.52, "rgba(18,34,57,0)");
    glare.addColorStop(0.8, "rgba(255,190,79,.15)");
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, w, h);

    // The V2.1 concept uses bright, offset liquid caustics with gold shadows,
    // not the previously almost invisible unlit ellipse strokes.
    ctx.globalAlpha = glow;
    ctx.lineCap = "round";
    for (let i = 0; i < budget.orbArcs; i += 1) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angleTime * 0.4 + i * 0.77);
      const rx = radius * (0.38 + i * 0.066);
      const ry = radius * (0.18 + i * 0.065);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, i * 0.15, Math.PI * 0.17 + i * 0.2, Math.PI * 1.72 + i * 0.15);
      ctx.lineWidth = i % 3 === 0 ? 2.4 : 0.72;
      ctx.shadowBlur = i % 3 === 0 ? 10 : 3;
      ctx.shadowColor = "rgba(255,208,127,.82)";
      ctx.strokeStyle = i % 3 === 0 ? "rgba(255,228,160,.78)" : "rgba(255,177,77,.46)";
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < Math.min(budget.orbArcs, 6); i += 1) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-angleTime * 0.37 + i * 1.18);
      ctx.beginPath();
      ctx.arc(0, 0, radius * (0.46 + i * 0.075), i * 0.4, i * 0.4 + 1.28);
      ctx.strokeStyle = i % 2 === 0 ? "rgba(255,251,224,.55)" : "rgba(249,172,72,.62)";
      ctx.lineWidth = 1.15 + (i % 3) * 0.55;
      ctx.shadowBlur = 8;
      ctx.shadowColor = "#ffbc63";
      ctx.stroke();
      ctx.restore();
    }

    ctx.shadowBlur = 0;
    for (let i = 0; i < Math.min(budget.orbPoints, flecks.length); i += 1) {
      const p = flecks[i]!;
      const phase = p.angle + angleTime * p.velocity;
      const radial = (p.radius / 136) * radius;
      const x = centerX + Math.cos(phase) * radial;
      const y = centerY + Math.sin(phase * 1.1) * radial * 0.83;
      const blink = 0.55 + 0.45 * Math.sin(phase * 3 + p.phase);
      ctx.globalAlpha = Math.max(0.12, blink) * 0.72 * glow;
      ctx.fillStyle = i % 7 === 0 ? "#fff5cf" : "#efb363";
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    const reflection = ctx.createRadialGradient(w * 0.29, h * 0.17, 0, w * 0.32, h * 0.21, radius * 0.73);
    reflection.addColorStop(0, "rgba(254,252,240,.30)");
    reflection.addColorStop(0.26, "rgba(238,247,255,.09)");
    reflection.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = reflection;
    ctx.fillRect(0, 0, w, h);
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

  useRoyalCanvasMotion(draw, motionEnabled && !disconnecting);

  return (
    <div className="queen-orb-visual" aria-hidden="true">
      <div className="queen-orb-float">
        <div className="queen-orb-inner-glass">
          <canvas ref={canvasRef} className="queen-orb-fluid" />
          <div className="queen-orb-reflection" />
        </div>
      </div>
      {/* The trademark is deliberately outside the floating/filtered glass layer.
          An unchanged 1:1 alpha PNG can now stay pixel-aligned on the screen
          while the glass, particles and orbital trails move independently. */}
      <div className="queen-orb-emblem-layer">
        <img src={QUEEN_IMAGE_URL} className="queen-orb-portrait" alt="" draggable={false} />
      </div>
    </div>
  );
});
