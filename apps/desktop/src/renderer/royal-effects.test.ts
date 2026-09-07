import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererUrl = new URL("./renderer.tsx", import.meta.url);
const effectsUrl = new URL("./royal-effects.css", import.meta.url);

async function source(): Promise<string> {
  return readFile(rendererUrl, "utf8");
}

async function effects(): Promise<string> {
  return readFile(effectsUrl, "utf8");
}

describe("Royal motion effects on the classic Qnector theme", () => {
  it("keeps the QNECTOR header while loading the effects layer after Skill Manager", async () => {
    const text = await source();
    const skillImport = text.indexOf(
      'import { SkillManager } from "./skill-manager.js";',
    );
    const effectsImport = text.indexOf('import "./royal-effects.css";');
    expect(skillImport).toBeGreaterThan(-1);
    expect(effectsImport).toBeGreaterThan(skillImport);
    expect(text).toContain('<h1 className="brand-title">QNECTOR</h1>');
    expect(text).toContain('<div className="brand-tag">Royal MCP Bridge</div>');
  });

  it("does not replace the legacy dark/gold palette with light-theme tokens", async () => {
    const css = await effects();
    expect(css).not.toContain("--bg-dark:");
    expect(css).not.toContain("--glass-card:");
    expect(css).not.toContain("--text-main:");
    expect(css).not.toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
  });

  it("keeps the rejected white sweeps and hero corner decoration disabled", async () => {
    const css = await effects();
    expect(css).toMatch(
      /\.hero-glass-section::before,[\s\S]*?\.hero-glass-section::after[\s\S]*?content:\s*none !important;/,
    );
    expect(css).toMatch(
      /\.btn-liquid-action::before[\s\S]*?content:\s*none !important;/,
    );
    expect(css).toMatch(/\.brand-crest::after[\s\S]*?content:\s*none;/);
    expect(css).not.toContain("panelSheen");
  });

  it("retains motion across the classic shell without recoloring its surfaces", async () => {
    const css = await effects();
    for (const keyframe of [
      "royalRailShimmer",
      "royalDustDrift",
      "royalHeaderIn",
      "royalPanelRise",
      "royalCrestBreathe",
      "royalCrestSymbol",
      "royalStatusPulse",
      "royalGoldButtonFlow",
      "royalActivityEnter",
      "royalActivityProcessingGlow",
      "royalActivityRipple",
      "royalDockIn",
      "royalSkillRowIn",
    ]) {
      expect(css).toContain(`@keyframes ${keyframe}`);
    }
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the 10px readability floor from the redesign pass", async () => {
    const css = await effects();
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

  it("keeps all dashboard dock labels gold without falsely selecting a tab", async () => {
    const css = await effects();
    const text = await source();
    expect(text).toContain(
      'className={`floating-glass-dock ${activeDrawer ? "" : "dashboard-dock"}`}',
    );
    expect(css).toContain(
      ".floating-glass-dock.dashboard-dock .dock-pill-btn > span:last-child",
    );
    expect(css).toContain("color: var(--text-gold);");
    expect(css).toContain(
      ".floating-glass-dock:has(.dock-pill-btn.active)::after",
    );
    expect(css).toMatch(/\.floating-glass-dock::after[\s\S]*?opacity:\s*0;/);
  });

  it("marks running activity rows and gives them gold processing feedback", async () => {
    const css = await effects();
    const text = await source();
    expect(text).toContain("activity-item ${item.status}");
    expect(text).toContain('className="activity-processing-label"');
    expect(text).toContain("PROCESSING…");
    expect(css).toContain(".activity-item.running::before");
    expect(css).toContain(
      "animation: royalActivityRipple 1.8s ease-out infinite;",
    );
    expect(css).toContain(
      "animation: royalActivityProcessingGlow 1.8s ease-in-out infinite;",
    );
  });

  it("centers action-button content consistently across primary UI flows", async () => {
    const css = await effects();
    for (const selector of [
      ".btn-gold-copy,",
      ".btn-drawer-action,",
      ".btn-update-primary,",
      ".setup-primary,",
      ".skills-primary,",
    ]) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(
      /\.btn-gold-copy,[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?text-align:\s*center;/,
    );
  });
});
