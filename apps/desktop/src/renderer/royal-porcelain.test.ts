import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererUrl = new URL("./renderer.tsx", import.meta.url);
const themeUrl = new URL("./royal-porcelain.css", import.meta.url);

async function source(): Promise<string> {
  return readFile(rendererUrl, "utf8");
}

async function theme(): Promise<string> {
  return readFile(themeUrl, "utf8");
}

describe("Royal Porcelain desktop theme", () => {
  it("loads the Royal Porcelain layer after the Skill Manager component import", async () => {
    const text = await source();
    const skillImport = text.indexOf(
      'import { SkillManager } from "./skill-manager.js";',
    );
    const themeImport = text.indexOf('import "./royal-porcelain.css";');
    expect(skillImport).toBeGreaterThan(-1);
    expect(themeImport).toBeGreaterThan(skillImport);
    expect(text).toContain('<h1 className="brand-title">QNECTOR</h1>');
    expect(text).toContain('<div className="brand-tag">Royal MCP Bridge</div>');
  });

  it("uses ivory and champagne-gold semantic tokens", async () => {
    const css = await theme();
    expect(css).toContain("--bg-dark: #f8f4ea;");
    expect(css).toContain("--gold-primary: #c79b35;");
    expect(css).toContain("--text-main: #30291f;");
    expect(css).toContain("color-scheme: light;");
  });

  it("explicitly removes the rejected corner/sweep treatment", async () => {
    const css = await theme();
    expect(css).toMatch(
      /\.hero-glass-section::before,[\s\S]*?\.hero-glass-section::after[\s\S]*?content:\s*none !important;/,
    );
    expect(css).toMatch(
      /\.btn-liquid-action::before[\s\S]*?content:\s*none !important;/,
    );
    expect(css).toMatch(/\.brand-crest::after[\s\S]*?content:\s*none;/);
    expect(css).not.toContain(".corner");
    expect(css).not.toContain("panelSheen");
  });

  it("adds motion throughout the shell without relying on frame-wide white sweeps", async () => {
    const css = await theme();
    for (const keyframe of [
      "royalRailShimmer",
      "royalDustDrift",
      "royalHeaderIn",
      "royalPanelRise",
      "royalCrestBreathe",
      "royalStatusPulse",
      "royalGoldButtonFlow",
      "royalActivityEnter",
      "royalDockIn",
      "royalSkillRowIn",
    ]) {
      expect(css).toContain(`@keyframes ${keyframe}`);
    }
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("raises previously tiny utility labels to a 10px readability floor", async () => {
    const css = await theme();
    const text = await source();
    expect(css).toContain(".setup-link-grid small,");
    expect(css).toContain(".memory-v2-status,");
    expect(css).toContain(".skills-state-pill,");
    expect(css).toMatch(/font-size:\s*10px !important;/);

    const inlineSizes = [...text.matchAll(/fontSize:\s*"([0-9.]+)px"/g)].map(
      (match) => Number(match[1]),
    );
    expect(inlineSizes.every((size) => size >= 10)).toBe(true);
  });
});
