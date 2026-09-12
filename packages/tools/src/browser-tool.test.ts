import type { Locator, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { playwrightLocator } from "./browser-tool.js";

describe("browser strict locator targeting", () => {
  it("preserves Playwright strictness when no index is supplied", () => {
    const base = { nth: vi.fn() } as unknown as Locator;
    const page = {
      getByText: vi.fn(() => base),
    } as unknown as Page;

    const locator = playwrightLocator(page, { text: "Save" });

    expect(locator).toBe(base);
    expect(base.nth).not.toHaveBeenCalled();
  });

  it("uses nth only when the caller explicitly supplies an index", () => {
    const selected = {} as Locator;
    const nth = vi.fn(() => selected);
    const base = { nth } as unknown as Locator;
    const page = {
      getByText: vi.fn(() => base),
    } as unknown as Page;

    const locator = playwrightLocator(page, { text: "Save", index: 1 });

    expect(locator).toBe(selected);
    expect(nth).toHaveBeenCalledWith(1);
  });
});
