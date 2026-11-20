// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Owner ruling 2026-11-20: no pop-up may take unnecessary width, excess height
 * or oversized content just to fill the screen. Three small panels each kept a
 * near-window ceiling that their content never needed: the seven-row account
 * menu (44rem = 704px in an 800-900px window), the category picker (70vh for a
 * 48px trigger) and the search filters (680px tall, 380px wide).
 *
 * These assertions pin the compact ceilings and the owner of each scrollport.
 * Each surface keeps one scroller inside a fixed cap, so a longer list is
 * reachable without stretching the card or shrinking a row. Rendered
 * confirmation belongs to the deployed browser, not to this file.
 */
type CssRule = { selectors: string[]; body: string };

const accountCss = readFileSync(new URL("../components/AccountMenu.css", import.meta.url), "utf8");
const categoryCss = readFileSync(new URL("../components/CategoryField.css", import.meta.url), "utf8");
const categorySource = readFileSync(new URL("../components/CategoryField.tsx", import.meta.url), "utf8");
const searchCss = readFileSync(new URL("../screens/SearchScreen.css", import.meta.url), "utf8");
const searchFiltersSource = readFileSync(new URL("../screens/AdvancedSearchFilters.tsx", import.meta.url), "utf8");

function cssRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules: CssRule[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorText = "", body = ""] = match;
    rules.push({
      selectors: selectorText.split(",").map(selector => selector.replace(/\s+/g, " ").trim()),
      body,
    });
  }
  return rules;
}

/** Every declaration body that names this selector, including media-query copies. */
function bodies(css: string, selector: string) {
  return cssRules(css).filter(rule => rule.selectors.includes(selector)).map(rule => rule.body).join("\n");
}

describe("account menu ceiling", () => {
  it("caps the menu at 30rem instead of most of an 800px window", () => {
    const menu = bodies(accountCss, ".fb-account-menu");
    expect(accountCss).not.toContain("44rem");
    expect(menu).toMatch(/max-height:\s*min\(30rem,\s*calc\(100vh - 1\.5rem\)\)/);
    expect(menu).toMatch(/max-height:\s*min\(30rem,\s*calc\(100dvh - 1\.5rem\),\s*var\(--available-height, 100dvh\)\)/);
  });

  it("scrolls the menu dialog and never compresses a row", () => {
    const dialog = bodies(accountCss, ".fb-account-dialog");
    expect(dialog).toContain("overflow-y: auto;");
    expect(dialog).toContain("min-height: 0;");
    expect(bodies(accountCss, ".fb-account-row")).toContain("min-height: 44px;");
    expect(bodies(accountCss, ".fb-account-switch-row")).toContain("min-height: 44px;");
  });

  it("keeps the rail width and the phone width", () => {
    const menu = bodies(accountCss, ".fb-account-menu");
    expect(menu).toContain("width: var(--fb-rail-w, 192px);");
    expect(menu).toContain("max-width: calc(100vw - 24px);");
    expect(menu).toContain("width: 320px;");
  });
});

describe("category picker ceiling", () => {
  it("caps the popover and its dialog at 20rem / 50vh", () => {
    expect(categoryCss).not.toContain("70vh");
    for (const selector of [".fb-category-popover", ".fb-category-dialog"]) {
      expect(bodies(categoryCss, selector)).toMatch(/max-height:\s*min\(20rem,\s*var\(--available-height, 50vh\)\)/);
    }
  });

  it("keeps the readable width, the hidden overflow and the inner scroller", () => {
    const popover = bodies(categoryCss, ".fb-category-popover");
    expect(popover).toContain("width: min(24rem, calc(100vw - 16px));");
    expect(popover).toContain("overflow: hidden;");
    expect(bodies(categoryCss, ".fb-category-dialog")).toContain("min-height: 0;");
    // The results list, not the card, scrolls; rows stay 48px tall.
    expect(categorySource).toMatch(/data-testid="category-results"[\s\S]{0,400}?overflow-y-auto/);
    expect(categorySource).toMatch(/min-h-\[48px\] w-full items-center justify-between gap-3/);
  });

  it("keeps the dialog label the shared test util asserts", () => {
    expect(categorySource).toContain('aria-label="Choose a category"');
    expect(categorySource).toContain('aria-label="Search categories"');
  });
});

describe("search filters popover geometry", () => {
  it("keeps the panel inside a 22rem column", () => {
    const popover = bodies(searchCss, ".fb-popover.fb-search-filter-popover");
    expect(popover).toContain("width:min(22rem,calc(100vw - 16px));");
    expect(popover).toContain("overflow:hidden;");
    expect(searchCss).not.toContain("380px");
  });

  it("caps the panel at 480px instead of 680px", () => {
    expect(searchFiltersSource).toMatch(/maxHeight=\{480\}/);
    expect(searchFiltersSource).not.toMatch(/maxHeight=\{680\}/);
  });

  it("scrolls the body and keeps the trigger and dialog semantics", () => {
    expect(bodies(searchCss, ".fb-search-filter-body")).toMatch(/overflow\s*:\s*auto/);
    expect(bodies(searchCss, ".fb-search-filter-dialog")).toContain("max-height:inherit;");
    expect(searchFiltersSource).toContain("<DialogTrigger isOpen={sheetOpen}");
    expect(searchFiltersSource).toContain('<Dialog className="fb-search-filter-dialog">');
    expect(searchFiltersSource).toContain("aria-label={compactTrigger");
  });
});
