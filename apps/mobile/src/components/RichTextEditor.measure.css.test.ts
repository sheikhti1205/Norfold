// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Full-screen report editor, writing-measure contract.
 *
 * The expanded editor is a full-screen overlay, but its editable `.tiptap`
 * field was spanning the viewport minus 30px, which is roughly twice a
 * readable line measure at desktop widths. The fix caps only the overlay's
 * field and centres it; the full-screen canvas, padding, typography and focus
 * ring stay as they were, and the collapsed inline composer (already inside a
 * 40rem report panel) is not selected.
 *
 * Static declarations only. Rendered proof in the deployed browser is a
 * separate check and is not claimed here.
 */
type CssRule = { context: string | null; selectors: string[]; body: string };

const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** Rules paired with the at-rule prelude they live under, so blocks stay scoped. */
function cssRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
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

const rules = cssRules(indexCss);

function declaration(body: string, property: string): string | null {
  return new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;
}

function rulesFor(selector: string): CssRule[] {
  return rules.filter(rule => rule.selectors.includes(selector));
}

const SCOPED = "#report-editor-overlay .tiptap";

/** Selectors that reach the editable field outside the expanded overlay. */
function isBaseTiptap(selector: string): boolean {
  return selector.includes(".tiptap") && !selector.includes("#report-editor-overlay");
}

describe("report editor writing measure", () => {
  it("caps the expanded editor at a 44rem column, centred", () => {
    const matches = rulesFor(SCOPED);
    expect(matches, SCOPED).toHaveLength(1);
    const [rule] = matches;
    if (!rule) throw new Error(`No CSS rule for ${SCOPED}`);
    // Unconditional: the overlay is the only full-screen editor surface and is
    // never queried, so the cap always applies while it is open.
    expect(rule.context).toBeNull();
    expect(declaration(rule.body, "max-width")).toBe("44rem");
    expect(declaration(rule.body, "margin-inline")).toBe("auto");
  });

  it("leaves the base .tiptap block without a max-width", () => {
    const baseRules = rules.filter(rule => rule.selectors.some(isBaseTiptap));
    // The ED-01 typography block and the inline composer live here.
    expect(baseRules.length).toBeGreaterThan(0);
    for (const rule of baseRules) {
      expect(declaration(rule.body, "max-width"), rule.selectors.join(", ")).toBeNull();
    }
    // A future bare `.tiptap` rule must not carry the cap either.
    for (const rule of rulesFor(".tiptap")) {
      expect(declaration(rule.body, "max-width")).toBeNull();
      expect(declaration(rule.body, "margin-inline")).toBeNull();
    }
  });

  it("caps exactly one .tiptap selector, and only inside the overlay", () => {
    const capped = rules.filter(rule =>
      declaration(rule.body, "max-width") !== null
      && rule.selectors.some(selector => selector.endsWith(".tiptap")));
    expect(capped.flatMap(rule => rule.selectors)).toEqual([SCOPED]);
  });
});
