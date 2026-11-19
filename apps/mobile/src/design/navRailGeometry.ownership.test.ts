// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for the R19-4 inset navigation rail.
 *
 * The rail paints its frame as its own border: 4px inline and 8px at the foot,
 * with no top edge. That keeps the outer column on the existing 64/72px
 * budget, the pinned inline width equal to Shell's stored width and the hover
 * negative margin at its existing value; the existing 6px padding is untouched
 * so the rows keep their 44px target, and the 24px outer corner less the 4px
 * frame is the chat panes' 20px surface radius. The phone drawer sits outside
 * `.fb-rail-anchor`, so its full width and own border are untouched. Rendered
 * geometry remains the lead's deployed-browser acceptance item.
 */
const navCss = readFileSync(new URL("../components/Shell.nav.css", import.meta.url), "utf8");
const outsideCss = readFileSync(new URL("../components/navOutsideBrand.css", import.meta.url), "utf8");

const baseRail = /(?:^|\n)\.fb-nav-rail \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const railFrame = /\.fb-rail-anchor > \.fb-nav-rail \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const drawerRail = /\.fb-nav-drawer-panel > \.fb-nav-rail \{([^}]*)\}/.exec(navCss)?.[1] ?? "";

describe("R19-4 inset navigation rail", () => {
  it("frames the rail with the chat container: 4px inline, 8px at the foot, no top edge", () => {
    expect(railFrame).toContain("border: 0 solid var(--fb-surface-container);");
    expect(railFrame).toContain("border-inline-width: 4px;");
    expect(railFrame).toContain("border-block-end-width: 8px;");
    expect(railFrame).toContain("border-radius: 24px;");
    expect(railFrame).toContain("background-clip: padding-box;");
    expect(railFrame).not.toMatch(/border-block-start|(?:^|[;\s])padding[-a-z]*\s*:/);
    expect(baseRail).not.toContain("border-inline-end");
  });

  it("turns the 24px outer corner into the panes' 20px surface radius", () => {
    const outer = Number(/border-radius: (\d+)px;/.exec(railFrame)?.[1] ?? "");
    const frame = Number(/border-inline-width: (\d+)px;/.exec(railFrame)?.[1] ?? "");
    expect(outer).toBe(24);
    expect(frame).toBe(4);
    expect(outer - frame).toBe(20);
  });

  it("keeps the collapsed 64/72px column, the pinned stored width and the hover math", () => {
    expect(navCss).toMatch(/--fb-rail-collapsed: 64px;/);
    expect(navCss).toMatch(/@media \(min-width: 1200px\) \{[\s\S]*?--fb-rail-collapsed: 72px;/);
    expect(navCss).toMatch(/--fb-rail-expanded: 196px;/);
    expect(baseRail).toContain("width: var(--fb-rail-collapsed);");
    expect(navCss).toMatch(/\.fb-nav-rail\[data-pinned="true"\] \{[^}]*width: var\(--fb-rail-w, 192px\);/);
    expect(navCss).toMatch(/\.fb-nav-rail\[data-pinned="false"\]:is\(\[data-hover-expanded="true"\], :has\(:focus-visible\)\) \{[^}]*width: var\(--fb-rail-expanded\);[^}]*margin-inline-end: calc\(var\(--fb-rail-collapsed\) - var\(--fb-rail-expanded\)\);/);
    // The frame is a border, not an added width or padding: every state keeps
    // its old outer size, so <main> cannot reflow and the stored width stands.
    expect(railFrame).not.toMatch(/(^|\n)\s*width\s*:/);
    expect(railFrame).not.toMatch(/(^|\n)\s*padding/);
  });

  it("still fits the 44px hit target and keeps the 32/36px icon axis", () => {
    const paddingInline = Number(/\.fb-nav-rail \{[^}]*padding: \d+px (\d+)px;/.exec(navCss)?.[1] ?? "");
    const borderInline = Number(/border-inline-width: (\d+)px;/.exec(railFrame)?.[1] ?? "");
    expect(paddingInline).toBe(6);
    expect(borderInline).toBe(4);
    const narrowContent = 64 - borderInline * 2 - paddingInline * 2;
    const wideContent = 72 - borderInline * 2 - paddingInline * 2;
    expect(narrowContent).toBe(44);
    expect(wideContent).toBe(52);
    expect(borderInline + paddingInline + narrowContent / 2).toBe(32);
    expect(borderInline + paddingInline + wideContent / 2).toBe(36);
  });

  it("keeps the 28px mark on the icon axis inside the narrowed column", () => {
    const brand = /\.fb-nav-brand \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
    expect(brand).toContain("justify-content: center;");
    expect(brand).toContain("padding: 0 10px;");
    expect(navCss).toMatch(/\.fb-nav-rail\[data-pinned="false"\] \.fb-nav-rail-head \{[^}]*justify-content: center;/);
  });

  it("keeps the 28px head centre and the outside name's box", () => {
    expect(navCss).toMatch(/--fb-rail-head-center: 28px;/);
    expect(navCss).toMatch(/\.fb-nav-rail-head \{[^}]*min-height: 40px;/);
    expect(outsideCss).toMatch(/\.fb-nav-outside-brand \{[^}]*inset-inline-start: 100%;[^}]*top: var\(--fb-rail-head-center, 28px\);[^}]*margin-inline-start: 7px;/);
    expect(outsideCss).toMatch(/\.fb-rail-anchor \{[^}]*min-width: 0;/);
    expect(outsideCss).not.toMatch(/\.fb-rail-anchor \{[^}]*padding/);
  });

  it("leaves the phone drawer's own width and border alone", () => {
    expect(drawerRail).toContain("width: 100%;");
    expect(drawerRail).toContain("border-inline-end: 1px solid var(--fb-outline-variant);");
    expect(railFrame).not.toContain("data-drawer");
  });
});
