import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const themeUrl = new URL("./luxury-theme.css", import.meta.url);
const rendererUrl = new URL("./renderer.tsx", import.meta.url);

async function theme(): Promise<string> {
  return readFile(themeUrl, "utf8");
}

async function renderer(): Promise<string> {
  return readFile(rendererUrl, "utf8");
}

describe("luxury high-tech interface", () => {
  it("uses porcelain, champagne gold and platinum as the primary visual system", async () => {
    const css = await theme();
    expect(css).toContain("--surface-canvas: #f6f7f9");
    expect(css).toContain("--surface-panel-solid: #ffffff");
    expect(css).toContain("--silver-300: #cbd2da");
    expect(css).toContain("--gold-500: #b58a30");
    expect(css).toContain("--text-primary: #151a21");
    expect(css).toContain("--text-subtle-new: #526071");
  });

  it("does not reintroduce illegible micro-text in the new theme", async () => {
    const css = await theme();
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) =>
      Number(match[1]),
    );
    expect(sizes.length).toBeGreaterThan(20);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
  });

  it("keeps motion purposeful and provides a reduced-motion fallback", async () => {
    const css = await theme();
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--ease-enter: cubic-bezier(0.16, 1, 0.3, 1)");
    expect(css).toContain("animation-iteration-count: 1 !important");
    expect(css).toContain("body::after {\n  animation: none;");
  });

  it("uses semantic navigation and a consistent vector icon system", async () => {
    const source = await renderer();
    expect(source).toContain(
      '<nav className="floating-glass-dock" aria-label="Qnector sections">',
    );
    expect(source).toContain("function UiIcon(");
    expect(source).toContain('<UiIcon name="workspace" size={17} />');
    expect(source).toContain('<UiIcon name="memory" size={17} />');
    expect(source).toContain('<UiIcon name="runtime" size={17} />');
    expect(source).toContain('<UiIcon name="settings" size={17} />');
  });

  it("uses a compact two-column bridge HUD instead of a stacked hero", async () => {
    const css = await theme();
    const source = await renderer();
    expect(source).toContain('<div className="hero-command-row">');
    expect(source).not.toContain('className="bridge-metrics"');
    expect(css).toMatch(
      /\.hero-command-row \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 94px;/,
    );
    expect(css).toMatch(
      /\.orb-stage,[\s\S]*?\.charge-svg-ring \{[\s\S]*?width:\s*92px;[\s\S]*?height:\s*92px;/,
    );
  });

  it("uses a natural flex activity feed with no absolute row math", async () => {
    const css = await theme();
    const source = await renderer();
    expect(source).toContain('className="activity-track flex-feed"');
    expect(source).not.toContain("activityVisibleRows");
    expect(source).not.toContain("index * 50");
    expect(source).not.toContain("new ResizeObserver");
    expect(css).toMatch(
      /\.activity-track\.flex-feed \{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    );
  });

  it("offers accessible disconnect alternatives and drawer keyboard focus", async () => {
    const source = await renderer();
    expect(source).toContain("const DISCONNECT_HOLD_MS = 2000;");
    expect(source).toContain("const HOLD_EXIT_GRACE_MS = 250;");
    expect(source).toContain("setDisconnectConfirmOpen(true)");
    expect(source).toContain('className="disconnect-confirm-backdrop"');
    expect(source).toContain("onPointerLeave={scheduleHoldCancel}");
    expect(source).toContain("tabIndex={-1}");
    expect(source).toContain('if (event.key !== "Escape") return;');
  });

  it("keeps navigation usable while a drawer is open", async () => {
    const css = await theme();
    expect(css).toMatch(
      /\.floating-glass-dock \{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*100;/,
    );
    expect(css).toMatch(/\.drawer-backdrop \{[\s\S]*?padding-bottom:\s*66px;/);
  });
});
