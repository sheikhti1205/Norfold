// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The full activity route renders inside the Shell, whose `.fb-app-viewport`
 * (index.css) is the app's sole safe-area owner. Its in-flow header therefore
 * keeps only its compact 6.4px row inset, and the in-flow undo keeps its 8px
 * base gutter: the bottom bar is a sibling that reserves its own row, so
 * neither surface adds a second system inset.
 *
 * jsdom has no layout engine, so this pins the declarations; the rendered
 * phone geometry remains a deployed-browser acceptance item.
 */
type CssRule = { selectors: string[]; body: string };

const css = readFileSync(new URL("./Notifications.css", import.meta.url), "utf8");

function cssRules(text: string): CssRule[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules: CssRule[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorText = "", body = ""] = match;
    rules.push({
      selectors: selectorText.split(",").map((selector) => selector.replace(/\s+/g, " ").trim()),
      body,
    });
  }
  return rules;
}

function bodies(selector: string): string {
  return cssRules(css).filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join("\n");
}

describe("Notifications route spends the Shell safe area once", () => {
  it("keeps the in-flow header on its compact row inset", () => {
    const header = bodies(".fb-notification-header");
    const fullHeader = bodies(".fb-notifications--full .fb-notification-header");
    // The popover keeps the shared non-sticky header; only the full route pins it.
    expect(header).not.toMatch(/position\s*:\s*sticky/);
    expect(header).toMatch(/padding\s*:\s*\.4rem \.75rem/);
    expect(fullHeader).toMatch(/position\s*:\s*sticky/);
    expect(fullHeader).toMatch(/top\s*:\s*0/);
    expect(fullHeader).not.toContain("safe-area-inset-top");
  });

  it("keeps the in-flow undo on its base gutter above the bottom bar", () => {
    const undo = bodies(".fb-notification-undo");
    const fullUndo = bodies(".fb-notifications--full .fb-notification-undo");
    expect(undo).toMatch(/margin\s*:\s*0 \.5rem \.5rem/);
    expect(fullUndo).toMatch(/position\s*:\s*sticky/);
    expect(fullUndo).toMatch(/bottom\s*:\s*\.5rem/);
    expect(fullUndo).toMatch(/margin-top\s*:\s*auto/);
    expect(fullUndo).not.toContain("safe-area-inset-bottom");
  });

  it("leaves every inset to the viewport owner", () => {
    expect(css).not.toContain("safe-area-inset-top");
    expect(css).not.toContain("safe-area-inset-bottom");
  });

  it("keeps the 48px controls and the popover surface", () => {
    expect(bodies(".fb-notification-filters button")).toMatch(/min-height\s*:\s*48px/);
    expect(bodies(".fb-notification-mark-all")).toMatch(/min-height\s*:\s*48px/);
    expect(bodies(".fb-notification-overflow")).toMatch(/width\s*:\s*48px/);
    expect(bodies(".fb-notification-overflow")).toMatch(/height\s*:\s*48px/);
    expect(bodies(".fb-popover.fb-notification-popover")).toMatch(/width\s*:\s*390px/);
  });
});
