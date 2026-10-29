import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { crispCrestBounds } from "./orb-crest-geometry.js";

describe("QNECTOR crest remains crisp at compact window sizes", () => {
  it.each([1, 1.25, 1.5, 2, 2.5])(
    "snaps both painted edges to native pixels at DPR %s",
    (dpr) => {
      const bounds = crispCrestBounds(
        { left: 80.37, top: 16.29, right: 134.53, bottom: 70.45 },
        dpr,
      );
      for (const edge of [
        bounds.left,
        bounds.top,
        bounds.left + bounds.width,
        bounds.top + bounds.height,
      ]) {
        expect(Math.abs(edge * dpr - Math.round(edge * dpr))).toBeLessThan(
          1e-8,
        );
      }
      expect(bounds.width).toBeGreaterThan(50);
      expect(bounds.width).toBeLessThan(60);
    },
  );

  it("never produces a zero-sized icon for tiny viewports or invalid DPR", () => {
    const small = crispCrestBounds(
      { left: 10.49, top: 20.49, right: 10.51, bottom: 20.51 },
      1,
    );
    expect(small.width).toBe(1);
    expect(small.height).toBe(1);
    expect(
      crispCrestBounds(
        { left: 9.5, top: 14.5, right: 63.5, bottom: 68.5 },
        Number.NaN,
      ).width,
    ).toBe(54);
  });

  it("uses an independent untransformed bitmap and follows all orb states", async () => {
    const app = await readFile(
      new URL("./renderer.tsx", import.meta.url),
      "utf8",
    );
    const css = await readFile(
      new URL("./translucent-controls.css", import.meta.url),
      "utf8",
    );
    expect(app).toContain("className={`orb-sharp-crest ");
    expect(app).toContain("ref={orbSharpCrestRef}");
    expect(app).toContain(
      "const bounds = crispCrestBounds(rect, window.devicePixelRatio)",
    );
    expect(app).toContain(
      "crestFrame = requestAnimationFrame(followCrestFlight)",
    );
    expect(app).toContain("cancelAnimationFrame(crestFrame)");
    expect(css).toContain("visibility: hidden;");
    expect(css).toContain('.orb-sharp-crest[data-positioned="true"]');
    expect(css).toContain("transform: none !important;");
    expect(css).toContain(".orb-sharp-crest.orb-route-open:not(.orb-compact)");
  });
});
