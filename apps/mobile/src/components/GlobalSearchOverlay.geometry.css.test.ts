// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./GlobalSearchOverlay.css", import.meta.url), "utf8");
const flat = css.replace(/\s+/g, " ");

describe("global search overlay cap", () => {
  it("caps the overlay to a comfortable viewport share, not the screen edge", () => {
    expect(flat).toMatch(/\.fb-search-overlay \{[^}]*max-height:\s*min\(60vh,\s*calc\(100dvh - 48px\)\)/);
  });

  it("lets the results card own the overflow", () => {
    expect(flat).toMatch(/\.fb-search-card \{[^}]*overflow:\s*auto/);
    expect(flat).toMatch(/\.fb-search-card \{[^}]*min-height:\s*0/);
  });

  it("keeps the filter bar from shrinking into the scroll owner", () => {
    expect(flat).toMatch(/\.fb-search-filterbar \{[^}]*flex:\s*0 0 auto/);
  });
});