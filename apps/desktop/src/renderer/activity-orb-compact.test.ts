import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
const read = (name: string) => readFile(new URL(name, import.meta.url), "utf8");

describe("Royal Liquid Glass V2.3 Activity-first layout", () => {
  it("moves the crisp Queen portrait outside the animated caustic layer", async () => {
    const orb = await read("queen-liquid-orb.tsx");
    const style = await read("activity-orb-compact.css");
    expect(orb).toContain('className="queen-orb-float"');
    expect(orb).toContain('className="queen-orb-emblem-layer"');
    expect(orb.indexOf('className="queen-orb-emblem-layer"')).toBeGreaterThan(
      orb.indexOf('className="queen-orb-reflection"'),
    );
    expect(orb).toContain('src={QUEEN_IMAGE_URL} className="queen-orb-portrait"');
    expect(style).toContain(".queen-orb-emblem-layer > .queen-orb-portrait");
    expect(style).toContain("transform: none !important");
    expect(style).toContain("filter: none !important");
    expect(style).toContain(".glass-sphere-enclosure.holding");
    expect(style).toContain(".orb-stage");
    expect(style).toContain("z-index: 3");
  });
  it("preserves continuous silk and orb visuals across resize and disconnect", async () => {
    const silk = await read("royal-silk-background.tsx");
    const orb = await read("queen-liquid-orb.tsx");
    const clock = await read("royal-motion-clock.ts");
    const renderer = await read("renderer.tsx");
    expect(silk).toContain("lastAnimatedSecondsRef.current");
    expect(silk).toContain("if (canvas.width === pixelWidth && canvas.height === pixelHeight) return");
    expect(silk).not.toContain("draw(0, false)");
    expect(orb).toContain("orbit.phase += delta * orbit.speed");
    expect(orb).toContain("useRoyalCanvasMotion(draw, motionEnabled)");
    expect(orb).not.toContain("const angleTime = time * speed");
    expect(clock).toContain("if (isMoving()) frame = requestAnimationFrame(tick)");
    expect(renderer).not.toContain("setBurstFlash(true)");
  });
  it("replaces the right-side flashing yellow ring with an active status and slim progress rail", async () => {
    const css = await read("activity-orb-compact.css");
    expect(css).toContain(".activity-virtual-row > .activity-item.running::before");
    expect(css).toContain("royalTaskProgressSweep");
    expect(css).toContain(".activity-result-pill.running::before");
    expect(css).toContain("@keyframes royalRunningBadgeBreathe");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain('html[data-motion="off"] .activity-result-pill.running');
  });
  it("allocates true viewport area to real virtualized Activity, not decoration", async () => {
    const jsx = await read("renderer.tsx");
    const css = await read("activity-orb-compact.css");
    expect(jsx).toContain('import "./activity-orb-compact.css"');
    expect(jsx).toContain("Math.ceil(usableHeight / 58)");
    expect(jsx).toContain("const rowHeight = 58");
    expect(jsx).toContain('className="activity-entry-time"');
    expect(jsx).toContain("activity-result-pill");
    expect(jsx).toContain("item-bead");
    expect(jsx).toContain('onClick={() => setSelectedActivity(item)}');
    expect(css).toContain(".activity-glass-card");
    expect(css).toContain("--parity-orb-size: clamp(146px");
    expect(css).toContain(".activity-stream");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (max-height: 760px)");
  });
});
