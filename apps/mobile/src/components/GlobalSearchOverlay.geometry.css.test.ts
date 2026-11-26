// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./GlobalSearchOverlay.css", import.meta.url), "utf8");
const flat = css.replace(/\s+/g, " ");
const sharedCss = readFileSync(new URL("./searchField.css", import.meta.url), "utf8");
const sharedFlat = sharedCss.replace(/\s+/g, " ");

/** Every declarations block written for one class selector, phone override included. */
function declarationsFor(selector: string) {
  return [...flat.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1] ?? "");
}

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

describe("global search overlay touch targets", () => {
  it("gives every control, and the row that hosts one, a 48px minimum", () => {
    const controls = [
      "fb-search-iconbtn",
      "fb-gsearch-row",
      "fb-search-pill",
      "fb-search-clear-filters",
      "fb-search-menu-option",
      "fb-search-date-preset",
      "fb-search-date-clear",
      "fb-search-reset",
      "fb-search-date-field-head",
    ];
    for (const selector of controls) {
      const rules = declarationsFor(selector);
      expect(rules.length, selector).toBeGreaterThan(0);
      // Include the phone block: it used to win at 390px with 44px.
      for (const rule of rules) {
        expect(rule, selector).toMatch(/(?:min-height|height):\s*48px/);
      }
    }
  });

  it("keeps the icon-only controls 48px square", () => {
    for (const selector of ["fb-search-iconbtn", "fb-search-date-clear"]) {
      for (const rule of declarationsFor(selector)) {
        expect(rule, selector).toMatch(/width:\s*48px/);
        expect(rule, selector).toMatch(/height:\s*48px/);
      }
    }
  });

  it("fills the field's own input and keeps a 48px action inside this surface", () => {
    // The shared pill is 48px (1px border + 46px content). In the overlay the
    // entry fills it with the same 1px negative block margin, so the pill stays
    // 48px. The clear action is already 48px in searchField.css, so this sheet
    // needs no extra hit patch for it.
    expect(flat).toMatch(/\.fb-search-overlay-field \.fb-search-field-input \{[^}]*height:\s*48px/);
    expect(flat).toMatch(/\.fb-search-overlay-field \.fb-search-field-input \{[^}]*margin-block:\s*-1px/);
    expect(flat).not.toMatch(/\.fb-search-overlay-field \.fb-search-field-action/);
    expect(sharedFlat).toMatch(/\.fb-search-field-action \{[^}]*width:\s*48px/);
    expect(sharedFlat).toMatch(/\.fb-search-field-action \{[^}]*height:\s*48px/);
    // The category filter's own search field is a tap target too.
    expect(flat).toMatch(/\.fb-search-menu-search input \{[^}]*min-height:\s*48px/);
  });

  it("leaves no 40px or 44px height anywhere in the sheet", () => {
    // Test the whole sheet, not a list: a new control must not reintroduce the
    // sub-48 floor, and the phone block must not override one back down.
    expect(flat).not.toMatch(/(?:^|[^-\w])(?:min-)?height:\s*(?:40|44)px/);
  });
});