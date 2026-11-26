// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static geometry contract for the Settings root.
 *
 * jsdom has no layout engine, so these assertions cannot measure a rendered
 * box. What they can do — and what the S5 defect actually was — is pin the
 * layout rules that decide clipping: the row grid must give a switch its own
 * trailing column instead of the 18px chevron column, and a row must not hide
 * overflow to make a broken grid look fine. Rendered widths at 320dp and large
 * text remain a browser/device acceptance item.
 */
const screenCss = readFileSync(new URL("./Settings.css", import.meta.url), "utf8");
const primitiveCss = readFileSync(new URL("../components/settings/settings.css", import.meta.url), "utf8");
const profileCss = readFileSync(new URL("./Profile.css", import.meta.url), "utf8");
const splitCss = readFileSync(new URL("../components/adaptiveFoundation.css", import.meta.url), "utf8");

describe("Settings row geometry", () => {
  it("keeps distinct trailing layouts for a chevron and a switch", () => {
    expect(screenCss).toMatch(/\.fb-settings-root \.fb-settings-row \{[^}]*grid-template-columns:28px minmax\(0,1fr\) auto/);
    expect(screenCss).toMatch(/\.fb-settings-root \.fb-settings-chevron \{[^}]*grid-column:3/);
    expect(screenCss).toMatch(/\.fb-settings-root \.fb-switch-track \{[^}]*grid-column:3/);
    // The old grid pinned the third column to the chevron's 18px, which clipped
    // the 44px track. That value must not come back.
    expect(screenCss).not.toMatch(/\.fb-settings-root \.fb-settings-row \{[^}]*minmax\(0,1fr\) 18px/);
  });

  it("keeps the switch at a full control width and height", () => {
    expect(primitiveCss).toMatch(/\.fb-switch-track \{[^}]*width: 44px/);
    expect(primitiveCss).toMatch(/\.fb-switch-track \{[^}]*height: 26px/);
  });

  it("never hides row overflow to mask clipping", () => {
    const rowRules = [...primitiveCss.matchAll(/\.fb-settings-row[^{]*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? "")
      .join("\n");
    expect(rowRules).not.toMatch(/overflow\s*:\s*hidden/);
    expect(screenCss).not.toMatch(/\.fb-settings-root \.fb-settings-row[^{]*\{[^}]*overflow\s*:\s*hidden/);
  });

  it("keeps every leading settings icon on one 28px gutter", () => {
    // The shared row primitive and the root row grid both resolve the leading
    // icon to the same 28px box, so the svg inside (20px) keeps one 4px inset
    // regardless of which row primitive or subpane renders it.
    expect(primitiveCss).toMatch(/\.fb-setting-icon \{[^}]*width: 28px/);
    expect(screenCss).toMatch(/\.fb-settings-root \.fb-settings-row \{[^}]*grid-template-columns:28px minmax\(0,1fr\) auto/);
    expect(screenCss).toMatch(/\.fb-settings-root \.fb-setting-icon \{[^}]*width: 28px/);
  });

  it("keeps profile provider marks on the same svg inset as standard icons", () => {
    // Provider marks are 16px, so their box shrinks to 24px and keeps the same
    // 4px svg inset as a 20px glyph in a 28px box.
    expect(profileCss).toMatch(/\.fb-profile \.fb-setting-icon \{[^}]*width: 24px/);
  });

  it("lets a split fall back to one pane when the detail side would be unusable", () => {
    // The split CSS still asks for a readable list column; the collapse decision
    // itself is in SplitView.tsx and is unit-tested there.
    expect(splitCss).toMatch(/\.fb-split-wide \{[^}]*minmax\(16rem, 22rem\)/);
    expect(splitCss).toMatch(/\.fb-split-list, \.fb-split-detail \{[^}]*min-width:\s*0/);
  });
});

/**
 * The house floor is 48px, not 44px. These read the rules the settings
 * controls are built from, so a lowered value fails here instead of only in a
 * browser measurement.
 */
describe("Settings control floors", () => {
  function rule(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start).split("}")[0]!;
  }

  it("keeps the search field and its clear button at 48px", () => {
    expect(rule(primitiveCss, ".fb-settings-search-field input")).toMatch(/min-height:\s*48px/);
    expect(rule(primitiveCss, ".fb-settings-search-field button")).toMatch(/min-height:\s*48px/);
    expect(rule(primitiveCss, ".fb-settings-search-field button")).toMatch(/min-width:\s*48px/);
  });

  it("keeps picture choices at a 48px minimum", () => {
    expect(rule(primitiveCss, ".fb-preview-choice")).toMatch(/min-height:\s*48px/);
  });

  it("keeps the nested back control 48px square", () => {
    const back = rule(screenCss, ".fb-settings-nested-page-header button");
    expect(back).toMatch(/width:\s*48px/);
    expect(back).toMatch(/height:\s*48px/);
  });
});
