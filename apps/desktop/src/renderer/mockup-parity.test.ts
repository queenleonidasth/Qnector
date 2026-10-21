import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const source = async (name: string): Promise<string> =>
  readFile(new URL(name, root), "utf8");

describe("QNECTOR V2.1 mockup parity", () => {
  it("moves the royal silk from the narrow hero slot to the app background", async () => {
    const jsx = await source("renderer.tsx");
    const css = await source("mockup-parity.css");
    expect(jsx.match(/<RoyalSilkBackground/g)?.length).toBe(1);
    expect(jsx.indexOf("<RoyalSilkBackground")).toBeLessThan(jsx.indexOf("<header"));
    expect(css).toContain(".app-container > .royal-silk-layer");
    expect(css).toContain("position: absolute !important");
    expect(css).toContain(".liquid-silk-canvas");
    expect(css).toContain("inset: -12px -12px -10px");
    expect(css).toContain(".hero-glass-section");
    expect(css).toContain("background: transparent !important");
  });
  it("preserves the large, alpha-composited Queen glass and celestial rings", async () => {
    const jsx = await source("renderer.tsx");
    const css = await source("mockup-parity.css");
    const component = await source("queen-liquid-orb.tsx");
    for (const cls of ["orb-astral-orbit", "orb-eclipse-plane", "orb-comet-track"]) {
      expect(jsx).toContain('className="' + cls);
      expect(css).toContain("." + cls);
    }
    expect(css).toContain("--parity-orb-size: clamp(190px");
    expect(css).toContain("width: var(--parity-orb-size)");
    expect(css).toContain(".charge-svg-ring.active");
    expect(component).toContain("queen-portrait.png");
    expect(component).toContain("ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)");
    expect(css).toContain("mix-blend-mode:normal");
  });
  it("keeps truthful status/actions and Motion quality accessibility", async () => {
    const jsx = await source("renderer.tsx");
    const css = await source("mockup-parity.css");
    const motion = await source("royal-silk-background.tsx");
    expect(jsx).toContain("Your bridge is online.");
    expect(jsx).toContain("Hold for 3 seconds to disconnect");
    expect(jsx).toContain("handleOrbClick");
    expect(jsx).toContain("<ActivityPanel initialActivity");
    expect(jsx).toContain("useGlassRefraction()");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain('html[data-motion-quality="off"]');
    expect(motion).toContain("motionBudget(currentMotionQuality())");
    expect(motion).not.toContain("GoldMatrixRain");
  });
  it("renders glass pointer lighting on bounded RAF with cleanup", async () => {
    const hook = await source("glass-refraction.ts");
    expect(hook).toContain("requestAnimationFrame(update)");
    expect(hook).toContain('root.dataset.motionQuality === "eco"');
    expect(hook).toContain('root.dataset.motion === "off"');
    expect(hook).toContain('window.addEventListener("blur", onLeave)');
    expect(hook).toContain("cancelAnimationFrame(frame)");
    expect(hook).toContain('document.removeEventListener("pointermove", onMove)');
  });
});
