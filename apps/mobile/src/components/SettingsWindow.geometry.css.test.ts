// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Settings window geometry contract.
 *
 * The window is a floating surface for a nav tree plus a detail pane, so it
 * needs a definite height, but not the near-full-canvas 1040x760 it used to
 * take on an ordinary laptop. These assertions pin the bounded desktop sizes
 * and the compact contract: the phone surface is anchored to the page's content
 * box (inside `<main>`), with a gutter, never a fixed full-viewport backdrop
 * over the bottom bar.
 *
 * Static declarations only. Rendered proof at desktop and phone widths is a
 * deployed-browser check and is not claimed here.
 */
type CssRule = { context: string | null; selectors: string[]; body: string };

const css = readFileSync(new URL("./SettingsWindow.css", import.meta.url), "utf8");
const COMPACT = "max-width: 599.98px";

/** Rules paired with the at-rule prelude they live under, so blocks stay scoped. */
function cssRules(source: string): CssRule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules: CssRule[] = [];
  const walk = (text: string, context: string | null) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open === -1) break;
      let depth = 0;
      let close = -1;
      for (let cursor = open; cursor < text.length; cursor += 1) {
        if (text.charAt(cursor) === "{") depth += 1;
        else if (text.charAt(cursor) === "}") {
          depth -= 1;
          if (depth === 0) { close = cursor; break; }
        }
      }
      if (close === -1) break;
      const prelude = text.slice(index, open).replace(/\s+/g, " ").trim();
      const body = text.slice(open + 1, close);
      if (prelude.startsWith("@")) walk(body, prelude);
      else rules.push({ context, selectors: prelude.split(",").map(part => part.replace(/\s+/g, " ").trim()), body });
      index = close + 1;
    }
  };
  walk(clean, null);
  return rules;
}

function declaration(body: string, property: string): string | null {
  return new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;
}

const windowRules = cssRules(css).filter(rule => rule.selectors.includes(".fb-settings-window"));
const baseRule = windowRules.find(rule => rule.context === null);
const compactRules = cssRules(css).filter(rule => rule.context?.includes(COMPACT));
const compactRule = (selector: string) => compactRules.find(rule => rule.selectors.includes(selector));

describe("settings window geometry", () => {
  it("caps the floating window below the old near-full-canvas size", () => {
    expect(baseRule).toBeTruthy();
    expect(declaration(baseRule!.body, "width")).toBe("min(960px, calc(100vw - 48px))");
    expect(declaration(baseRule!.body, "height")).toBe("min(720px, calc(100dvh - 48px))");
  });

  it("keeps the max-height guard equal to the new definite height", () => {
    expect(baseRule).toBeTruthy();
    expect(declaration(baseRule!.body, "max-height")).toBe("calc(100dvh - 48px)");
  });

  it("anchors the surface to the page content box, not the viewport", () => {
    const layer = compactRule(".fb-settings-layer");
    expect(layer).toBeTruthy();
    // Absolute inside <main> (position: relative): the box that ends where the
    // bottom bar begins, so the bar is neither covered nor disabled.
    expect(declaration(layer!.body, "position")).toBe("absolute");
    expect(declaration(layer!.body, "inset")).toBe("0");
    const window = compactRule(".fb-settings-window-compact");
    expect(window).toBeTruthy();
    // A floating card inside that box, leaving the dimmed gutter the outside
    // press closes on. Size comes from the inset, not from the desktop width.
    expect(declaration(window!.body, "position")).toBe("absolute");
    expect(declaration(window!.body, "inset")).toBe("10px");
    expect(declaration(window!.body, "width")).toBe("auto");
    expect(declaration(window!.body, "height")).toBe("auto");
    expect(declaration(window!.body, "max-height")).toBe("none");
  });

  it("dims the page with an in-content scrim, not a fixed backdrop", () => {
    const scrim = compactRule(".fb-settings-scrim");
    expect(scrim).toBeTruthy();
    expect(declaration(scrim!.body, "position")).toBe("absolute");
    expect(declaration(scrim!.body, "inset")).toBe("0");
    // Every compact rule stays inside the content box.
    expect(compactRules.length).toBeGreaterThan(0);
    for (const rule of compactRules) {
      expect(declaration(rule.body, "position")).not.toBe("fixed");
    }
  });
});
