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
      /\.dock-pill-btn \{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/,
    );
  });
});
