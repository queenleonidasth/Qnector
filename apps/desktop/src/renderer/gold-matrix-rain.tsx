import React, { useEffect, useRef } from "react";

const CLASSIC_MATRIX_KANA_0_9 =
  "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ1234567890:・.=+-*";

const ROYAL_SOVEREIGN = {
  // Royal Sovereign styling with the user's requested slower flow override.
  flowSpeed: 0.58,
  opacity: 0.5,
  fontSize: 13.5,
  columnSpacing: 14,
  bloom: "royal-glow",
} as const;

const TARGET_FPS = 165;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const DORMANT_SPEED_MULTIPLIER = 0.45;
const MAX_DEVICE_PIXEL_RATIO = 2;

function randomGlyph(): string {
  const index = Math.floor(Math.random() * CLASSIC_MATRIX_KANA_0_9.length);
  return CLASSIC_MATRIX_KANA_0_9.charAt(index) || "0";
}

interface GoldMatrixRainProps {
  isConnected?: boolean;
  opacity?: number;
}

interface MatrixColumn {
  x: number;
  y: number;
  speed: number;
  length: number;
  stream: string[];
  mutationElapsedMs: number;
  mutationIntervalMs: number;
  shimmer: boolean;
}

export function GoldMatrixRain({
  isConnected = true,
  opacity = ROYAL_SOVEREIGN.opacity,
}: GoldMatrixRainProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionQuery.matches;
    let animationFrameId: number | undefined;
    let destroyed = false;
    let lastFrameAt = 0;
    let width = 0;
    let height = 0;
    let columns: MatrixColumn[] = [];

    const connectionSpeed = (): number =>
      isConnected ? ROYAL_SOVEREIGN.flowSpeed : DORMANT_SPEED_MULTIPLIER;

    const createColumns = (): void => {
      const count = Math.max(
        1,
        Math.floor(width / ROYAL_SOVEREIGN.columnSpacing),
      );
      columns = [];

      for (let columnIndex = 0; columnIndex < count; columnIndex++) {
        const length = Math.floor(Math.random() * 12) + 12;
        columns.push({
          x:
            columnIndex * ROYAL_SOVEREIGN.columnSpacing +
            Math.floor(ROYAL_SOVEREIGN.columnSpacing / 2),
          y: Math.random() * (height + 150) - 50,
          speed: Math.random() * 1.2 + 0.9,
          length,
          stream: Array.from({ length }, () => randomGlyph()),
          mutationElapsedMs: 0,
          mutationIntervalMs: (Math.floor(Math.random() * 6) + 3) * 16.67,
          shimmer: Math.random() > 0.7,
        });
      }
    };

    const resizeCanvas = (): void => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        MAX_DEVICE_PIXEL_RATIO,
      );

      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      createColumns();
    };

    const drawFrame = (deltaMs: number, animate: boolean): void => {
      ctx.clearRect(0, 0, width, height);
      ctx.font = `600 ${ROYAL_SOVEREIGN.fontSize}px Consolas, "Cascadia Mono", monospace`;
      ctx.textAlign = "center";

      // Convert movement to elapsed time so 165 Hz looks smoother without
      // making the rain travel faster than the selected slow profile.
      const frameScale = Math.max(0.25, Math.min(3, deltaMs / (1000 / 60)));
      const speedMultiplier = connectionSpeed();

      for (const column of columns) {
        if (animate) {
          column.mutationElapsedMs += deltaMs;
          if (column.mutationElapsedMs >= column.mutationIntervalMs) {
            column.mutationElapsedMs = 0;
            column.mutationIntervalMs =
              (Math.floor(Math.random() * 6) + 3) * 16.67;
            const mutateIndex = Math.floor(Math.random() * column.length);
            column.stream[mutateIndex] = randomGlyph();
          }
        }

        for (let index = 0; index < column.length; index++) {
          const charY = column.y - index * (ROYAL_SOVEREIGN.fontSize + 2);
          if (
            charY < -ROYAL_SOVEREIGN.fontSize ||
            charY > height + ROYAL_SOVEREIGN.fontSize
          ) {
            continue;
          }

          const char = column.stream[index] ?? "0";
          if (index === 0) {
            ctx.fillStyle = "#ffffff";
            ctx.shadowColor = "rgba(251, 230, 162, 0.85)";
            ctx.shadowBlur = ROYAL_SOVEREIGN.bloom === "royal-glow" ? 7 : 0;
          } else if (index === 1) {
            ctx.fillStyle = column.shimmer ? "#fff5c7" : "#fde492";
            ctx.shadowColor = "rgba(230, 186, 80, 0.7)";
            ctx.shadowBlur = ROYAL_SOVEREIGN.bloom === "royal-glow" ? 5 : 0;
          } else if (index < 5) {
            ctx.fillStyle = "#f3ca52";
            ctx.shadowBlur = 0;
          } else if (index < column.length - 3) {
            const ratio = (index - 5) / Math.max(1, column.length - 8);
            const alpha = Math.max(0.35, 0.95 - ratio * 0.55);
            ctx.fillStyle = `rgba(230, 186, 80, ${alpha.toFixed(2)})`;
            ctx.shadowBlur = 0;
          } else {
            const tailRatio = (column.length - index) / 3;
            const alpha = Math.max(0.12, tailRatio * 0.35);
            ctx.fillStyle = `rgba(185, 138, 38, ${alpha.toFixed(2)})`;
            ctx.shadowBlur = 0;
          }

          ctx.fillText(char, column.x, charY);
        }

        if (animate) {
          column.y += column.speed * speedMultiplier * frameScale;
          if (
            column.y - column.length * (ROYAL_SOVEREIGN.fontSize + 2) >
            height
          ) {
            column.y = -(Math.random() * 120 + 20);
            column.speed = Math.random() * 1.4 + 1.1;
            column.shimmer = Math.random() > 0.75;
          }
        }
      }

      ctx.shadowBlur = 0;
    };

    const render = (timestamp: number): void => {
      if (destroyed || document.hidden || reducedMotion) return;

      if (lastFrameAt === 0) lastFrameAt = timestamp;
      const elapsed = timestamp - lastFrameAt;
      if (elapsed >= FRAME_INTERVAL_MS) {
        lastFrameAt = timestamp - (elapsed % FRAME_INTERVAL_MS);
        drawFrame(elapsed, true);
      }
      animationFrameId = requestAnimationFrame(render);
    };

    const startAnimation = (): void => {
      if (destroyed || document.hidden || reducedMotion || animationFrameId) {
        return;
      }
      lastFrameAt = 0;
      animationFrameId = requestAnimationFrame((timestamp) => {
        animationFrameId = undefined;
        render(timestamp);
      });
    };

    const stopAnimation = (): void => {
      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = undefined;
      }
      lastFrameAt = 0;
    };

    const refreshMotionState = (): void => {
      reducedMotion = motionQuery.matches;
      stopAnimation();
      if (reducedMotion) {
        drawFrame(1000 / 60, false);
      } else {
        startAnimation();
      }
    };

    const handleVisibilityChange = (): void => {
      stopAnimation();
      if (!document.hidden && !reducedMotion) startAnimation();
    };

    resizeCanvas();
    if (reducedMotion) {
      drawFrame(1000 / 60, false);
    } else {
      startAnimation();
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      if (reducedMotion) drawFrame(1000 / 60, false);
    });
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    motionQuery.addEventListener("change", refreshMotionState);

    return () => {
      destroyed = true;
      stopAnimation();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      motionQuery.removeEventListener("change", refreshMotionState);
    };
  }, [isConnected]);

  return (
    <div className="gold-matrix-layer" style={{ opacity }} aria-hidden="true">
      <canvas ref={canvasRef} className="gold-matrix-canvas" />
      <div className="gold-matrix-vignette" />
    </div>
  );
}
