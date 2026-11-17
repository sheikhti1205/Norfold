import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");

describe("screen scrollbars", () => {
  it("hides scrollbars for all elements on screen without reserving a gutter", () => {
    expect(flat).toMatch(
      /@media screen \{ \* \{ scrollbar-width: none; scrollbar-gutter: auto; \} \*::-webkit-scrollbar \{ width: 0; height: 0; \} \}/,
    );
  });

  it("does not hide overflow on the document and root containers", () => {
    const rules = flat.matchAll(/([^{}]+)\{([^{}]*)\}/g);
    for (const [, selector, declarations] of rules) {
      if (!selector || !declarations) continue;
      if (selector.split(",").some((part) => /^(html|body|#root)$/.test(part.trim()))) {
        expect(declarations).not.toMatch(/(?:^|;)\s*overflow(?:-[xy])?\s*:\s*(?:hidden|clip)\b/);
      }
    }
  });

  it("preserves the horizontal scroll row", () => {
    expect(flat).toMatch(/\.fb-scroll-row \{[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/);
    expect(flat).toMatch(/\.fb-scroll-row::-webkit-scrollbar \{ display: none; \}/);
  });
});
