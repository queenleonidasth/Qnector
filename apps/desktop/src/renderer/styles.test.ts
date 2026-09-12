import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const stylesUrl = new URL("./styles.css", import.meta.url);

async function styles(): Promise<string> {
  return readFile(stylesUrl, "utf8");
}

describe("desktop UI overflow guards", () => {
  it("wraps dynamic memory content instead of allowing it to escape cards", async () => {
    const css = await styles();
    expect(css).toContain("/* UI overflow hardening");
    expect(css).toMatch(/\.memory-box-text,[\s\S]*?overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(
      /\.memory-checklist-item > span:last-child,[\s\S]*?word-break:\s*break-word;/,
    );
    expect(css).toMatch(
      /\.memory-fact-chip \{[\s\S]*?width:\s*100%;[\s\S]*?overflow:\s*hidden;/,
    );
  });

  it("keeps drawer, workspace and settings layouts shrinkable", async () => {
    const css = await styles();
    expect(css).toMatch(/\.drawer-card,[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.workspace-path-box \{[\s\S]*?max-width:\s*100%;/);
    expect(css).toMatch(
      /\.drawer-select \{[\s\S]*?width:\s*52%;[\s\S]*?max-width:\s*52%;/,
    );
    expect(css).toMatch(
      /\.setting-toggle-card > div:first-child \{[\s\S]*?flex:\s*1 1 0;/,
    );
  });

  it("protects the main dashboard from narrow-window flex overflow", async () => {
    const css = await styles();
    expect(css).toMatch(/\.endpoint-url-text \{[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.item-right,[\s\S]*?flex-shrink:\s*0;/);
    expect(css).toMatch(
      /\.floating-glass-dock \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /\.dock-pill-btn > span:last-child \{[\s\S]*?overflow:\s*visible;[\s\S]*?text-overflow:\s*clip;/,
    );
  });

  it("keeps the animated activity queue scrollable through older calls", async () => {
    const css = await styles();
    expect(css).toMatch(
      /\.activity-stream \{[\s\S]*?overflow-y:\s*scroll;[\s\S]*?scrollbar-gutter:\s*auto;[\s\S]*?transparent 0,[\s\S]*?transparent 100%/,
    );
    expect(css).toMatch(
      /\.activity-track \{[\s\S]*?position:\s*relative;[\s\S]*?min-height:\s*100%;/,
    );
    expect(css).toMatch(
      /\.activity-item \{[\s\S]*?position:\s*absolute;[\s\S]*?height:\s*44px;[\s\S]*?transform 100ms/,
    );
    expect(css).toContain("@keyframes activityQueueReveal");
  });

  it("gives drawers and runtime diagnostics a real vertical scroll region", async () => {
    const css = await styles();
    expect(css).toMatch(
      /\.drawer-content \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(css).toMatch(
      /\.runtime-scroll \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(css).toMatch(/\.runtime-footer \{[\s\S]*?flex:\s*0 0 auto;/);
  });

  it("keeps Live Activity Feed text comfortably readable", async () => {
    const css = await styles();
    expect(css).toMatch(/\.card-eyebrow \{[\s\S]*?font-size:\s*11px;/);
    expect(css).toMatch(/\.item-title \{[\s\S]*?font-size:\s*12px;/);
    expect(css).toMatch(/\.item-args \{[\s\S]*?font-size:\s*10px;/);
    expect(css).toMatch(/\.item-right \{[\s\S]*?font-size:\s*10px;/);
    expect(css).toMatch(
      /\.activity-detail-summary \{[\s\S]*?font-size:\s*11px;/,
    );
    expect(css).toMatch(
      /\.activity-skill-badge \{[\s\S]*?border-radius:\s*999px;[\s\S]*?font-size:\s*9px;/,
    );
    expect(css).toMatch(/\.activity-skill-chips \{[\s\S]*?flex-wrap:\s*wrap;/);
    expect(css).toMatch(
      /\.activity-skill-route \{[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
  });

  it("keeps the setup wizard readable and touch-friendly", async () => {
    const css = await styles();
    expect(css).toContain(
      "/* v0.3.0 setup wizard readability and usability pass */",
    );
    expect(css).toMatch(/\.setup-header h2 \{[\s\S]*?font-size:\s*18px;/);
    expect(css).toMatch(/\.setup-copy-block h3 \{[\s\S]*?font-size:\s*15px;/);
    expect(css).toMatch(
      /\.setup-copy-block p,[\s\S]*?\.setup-note \{[\s\S]*?font-size:\s*11\.5px;/,
    );
    expect(css).toMatch(/\.setup-field input \{[\s\S]*?min-height:\s*42px;/);
    expect(css).toMatch(
      /\.setup-primary,[\s\S]*?\.setup-secondary \{[\s\S]*?min-height:\s*42px;/,
    );
  });

  it("keeps App Updates visually prominent and easy to scan", async () => {
    const css = await styles();
    expect(css).toMatch(
      /\.update-settings-card \{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?padding:\s*15px;[\s\S]*?border:\s*1px solid rgba\(230, 186, 80, 0\.3\);/,
    );
    expect(css).toMatch(
      /\.update-card-copy strong \{[\s\S]*?font-size:\s*13\.5px;/,
    );
    expect(css).toMatch(
      /\.update-version-panel strong \{[\s\S]*?font:\s*750 16px/,
    );
    expect(css).toMatch(
      /\.update-status-panel p \{[\s\S]*?font-size:\s*10px;[\s\S]*?line-height:\s*1\.5;/,
    );
    expect(css).toMatch(
      /\.btn-update-primary,[\s\S]*?\.btn-update-secondary \{[\s\S]*?min-height:\s*40px;/,
    );
  });

  it("locks the viewport so tool-call overflow cannot create a root scrollbar", async () => {
    const css = await styles();
    expect(css).toMatch(
      /html,\s*body,\s*#root \{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*clip !important;[\s\S]*?scrollbar-width:\s*none;/,
    );
    expect(css).toMatch(
      /html::-webkit-scrollbar,[\s\S]*?body::-webkit-scrollbar,[\s\S]*?#root::-webkit-scrollbar \{[\s\S]*?width:\s*0 !important;[\s\S]*?display:\s*none !important;/,
    );
    expect(css).toMatch(
      /\.app-container \{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*clip;/,
    );
    expect(css).not.toMatch(
      /\.app-container,\s*\.drawer-backdrop,[\s\S]*?overflow-x:\s*hidden;/,
    );
    expect(css).not.toContain("height: 100vh;");
    expect(css).toMatch(
      /\.activity-stream \{[\s\S]*?overflow-y:\s*scroll;[\s\S]*?scrollbar-gutter:\s*auto;[\s\S]*?transparent 0,[\s\S]*?transparent 100%/,
    );
  });
  it("keeps typography and dock metrics stable during activity re-renders", async () => {
    const css = await styles();
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("Plus Jakarta Sans");
    expect(css).not.toContain("JetBrains Mono");
    expect(css).toContain(
      '--font-sans: "Segoe UI", Tahoma, Arial, sans-serif;',
    );
    expect(css).toContain("--font-royal: Constantia, Cambria, Georgia, serif;");
    expect(css).toContain("-webkit-text-size-adjust: 100%;");
    expect(css).toContain("text-size-adjust: 100%;");
    expect(css).toMatch(
      /\.dock-pill-btn > span:first-child \{[\s\S]*?width:\s*14px;[\s\S]*?flex:\s*0 0 14px;/,
    );
    expect(css).not.toMatch(/\.dock-pill-btn[\s\S]{0,800}?transition:\s*all/);
  });
});

describe("drawer animation smoothness", () => {
  it("keeps the drawer overlay aligned to the full viewport and on compositor-friendly transforms", async () => {
    const css = await styles();
    expect(css).toMatch(
      /\.drawer-backdrop \{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/,
    );
    expect(css).toMatch(
      /\.drawer-backdrop::before \{[\s\S]*?will-change:\s*opacity;[\s\S]*?translateZ\(0\)/,
    );
    expect(css).toMatch(
      /\.drawer-card \{[\s\S]*?will-change:\s*transform;[\s\S]*?translate3d\(0, 0, 0\)/,
    );
    expect(css).toContain("transform: translate3d(0, calc(100% + 24px), 0);");
  });

  it("does not fade the drawer card through the backdrop opacity animation", async () => {
    const css = await styles();
    const backdropBlock =
      css.match(/\.drawer-backdrop \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(backdropBlock).not.toContain("animation: backdropFade");
    expect(css).toMatch(
      /\.drawer-backdrop::before \{[\s\S]*?animation:\s*backdropFade/,
    );
  });
});
