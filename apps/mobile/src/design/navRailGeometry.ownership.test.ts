// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for the R19-4 inset navigation rail.
 *
 * The column (`.fb-rail-anchor`) owns the frame: a square container paint with
 * a 4px inline and 8px foot gutter and no top inset. The rail inside owns only
 * the surface: the chat panes' 20px corner and no border, upgraded to the
 * avatars' superellipse where `corner-shape` exists while the absolute 20px
 * stays the whole shape elsewhere. One curved outline therefore remains - the
 * surface - instead of the rejected 24px border ring with its own 20px inner
 * edge floating on a surface-colored parent.
 *
 * The column keeps the exact 64/72px budget and the stored pinned width, and it
 * alone owns that width: the surface is always the column minus the 8px inline
 * frame (64/56, 72/64, 192/184, 196/188). Four pixels of frame plus the
 * existing 6px rail padding still gives 44/52px of content, the 32/36px icon
 * axis and the 44px target; no top inset keeps the 32px head centre. The
 * outside name and the in-rail copy share one 1.125rem/700 wordmark - the same
 * size as an AppBar screen title, because the owner rejected a name smaller
 * than the Chat title - and the name's reservation is 5rem: its measured
 * single-line box (about 77px) rounded up to the next quarter rem, so 20px
 * text scales the band with it.
 * The phone drawer sits outside `.fb-rail-anchor`, so its full width and own
 * border are untouched. Rendered geometry remains the lead's deployed-browser
 * acceptance item.
 */
const navCss = readFileSync(new URL("../components/Shell.nav.css", import.meta.url), "utf8");
const outsideCss = readFileSync(new URL("../components/navOutsideBrand.css", import.meta.url), "utf8");
const avatarCss = readFileSync(new URL("../components/avatarShape.css", import.meta.url), "utf8");

const baseRail = /(?:^|\n)\.fb-nav-rail \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const railColumn = /\.fb-rail-anchor:has\(> \.fb-nav-rail\) \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const pinnedColumn = /\.fb-rail-anchor:has\(> \.fb-nav-rail\[data-pinned="true"\]\) \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const hoverColumn = /\.fb-rail-anchor:has\(> \.fb-nav-rail\[data-pinned="false"\] :focus-visible\) \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const railSurface = /\.fb-rail-anchor > \.fb-nav-rail \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const pinnedSurface = /\.fb-rail-anchor > \.fb-nav-rail\[data-pinned="true"\] \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const hoverSurface = /\.fb-rail-anchor > \.fb-nav-rail\[data-pinned="false"\]:is\(\[data-hover-expanded="true"\], :has\(:focus-visible\)\) \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const drawerRail = /\.fb-nav-drawer-panel > \.fb-nav-rail \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const railWordmark = /\.fb-nav-wordmark \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
const outsideLabel = /\.fb-nav-outside-label \{([^}]*)\}/.exec(outsideCss)?.[1] ?? "";

/** The `@media (min-width: 600px)` body that owns `query`, not the first one. */
function desktopBody(css: string, query: string) {
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf("@media (min-width: 600px)", from);
    if (start < 0) return "";
    const open = css.indexOf("{", start);
    if (open < 0) return "";
    let depth = 0;
    let end = -1;
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    if (end < 0) return "";
    const body = css.slice(open + 1, end);
    if (body.includes(query)) return body;
    from = end + 1;
  }
  return "";
}

/** The `@supports (...)` body for `query`, found by brace matching. */
function supportsBody(css: string, query: string) {
  const start = css.indexOf(query);
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return "";
}

const railDesktop = desktopBody(navCss, ".fb-rail-anchor:has(> .fb-nav-rail)");

describe("R19-4 inset navigation rail", () => {
  it("paints the container frame on the column and the surface on the rail", () => {
    expect(railColumn).toContain("background: var(--fb-surface-container);");
    expect(railColumn).toContain("padding: 0 4px 8px;");
    // The frame, shadow and 4px sliver of the hover overlay paint above the
    // route exactly as the rail's own z-index 30 did.
    expect(railColumn).toContain("z-index: 30;");
    expect(railColumn).not.toMatch(/(^|[;\n])\s*border\s*:/);
    expect(railColumn).not.toContain("border-radius");
    expect(railSurface).toContain("border: 0;");
    expect(railSurface).toContain("border-radius: 20px;");
    expect(railSurface).not.toContain("background: var(--fb-surface-container);");
    expect(railDesktop).toContain(".fb-rail-anchor:has(> .fb-nav-rail)");
    expect(railDesktop).toContain(".fb-rail-anchor > .fb-nav-rail");
    // The rejected mechanism was a border ring whose 24px outer corner and
    // 20px inner edge both drew on the surface-colored viewport.
    expect(navCss).not.toContain("border-inline-width");
    expect(navCss).not.toContain("border-block-end-width");
    expect(navCss).not.toContain("border-radius: 24px");
  });

  it("shapes the rail with the canonical squircle and keeps the 20px fallback", () => {
    const shapeArm = supportsBody(navCss, "@supports (corner-shape: squircle)");
    expect(shapeArm).toContain(".fb-rail-anchor > .fb-nav-rail");
    expect(shapeArm).toContain("corner-shape: squircle;");
    // The arm upgrades the shape only: no engine loses the radius and no
    // second corner source competes with it.
    expect(shapeArm).not.toContain("border-radius");
    // The avatar's 32% belongs to a glyph box. The rail is a surface and keeps
    // the absolute 20px wherever the superellipse is unavailable.
    expect(railSurface).toContain("border-radius: 20px;");
    expect(railSurface).not.toMatch(/border-radius:[^;}]*%/);
    expect(avatarCss).toMatch(/\.fb-avatar-squircle \{[^}]*border-radius: var\(--fb-avatar-radius, 32%\);/);
    expect(avatarCss).toMatch(/@supports \(corner-shape: squircle\) \{[\s\S]*?corner-shape: squircle;/);
    // One surface takes the shape (the declaration, not the at-rule prelude):
    // the drawer, the right info pane and the chat cards keep their own.
    expect(navCss.match(/corner-shape: squircle;/g)?.length).toBe(1);
    expect(drawerRail).not.toContain("corner-shape");
  });

  it("keeps the 64/72px column, the stored pinned width and the hover cancellation", () => {
    expect(navCss).toMatch(/--fb-rail-collapsed: 64px;/);
    expect(navCss).toMatch(/@media \(min-width: 1200px\) \{[\s\S]*?--fb-rail-collapsed: 72px;/);
    expect(navCss).toMatch(/--fb-rail-expanded: 196px;/);
    expect(railColumn).toContain("width: var(--fb-rail-collapsed);");
    expect(pinnedColumn).toContain("width: var(--fb-rail-w, 192px);");
    expect(railDesktop).toMatch(/\.fb-rail-anchor:has\(> \.fb-nav-rail\[data-pinned="false"\]\[data-hover-expanded="true"\]\)/);
    expect(railDesktop).toMatch(/\.fb-rail-anchor:has\(> \.fb-nav-rail\[data-pinned="false"\] :focus-visible\)/);
    expect(hoverColumn).toContain("width: var(--fb-rail-expanded);");
    expect(hoverColumn).toContain("margin-inline-end: calc(var(--fb-rail-collapsed) - var(--fb-rail-expanded));");
    expect(hoverColumn).toContain("box-shadow: var(--shadow-md);");
    // The surface fills the column's content box in every state, so the frame
    // never adds width and <main> never reflows.
    expect(railSurface).toContain("width: 100%;");
    expect(pinnedSurface).toContain("width: 100%;");
    expect(hoverSurface).toContain("width: 100%;");
    expect(hoverSurface).toContain("margin-inline-end: 0;");
    expect(hoverSurface).toContain("box-shadow: none;");
    expect(baseRail).toContain("width: var(--fb-rail-collapsed);");
  });

  it("derives every surface from the column and never from an inline width", () => {
    const shellSource = readFileSync(new URL("../components/Shell.tsx", import.meta.url), "utf8");
    const frameInline = Number(/padding: 0 (\d+)px 8px;/.exec(railColumn)?.[1] ?? "");
    expect(frameInline).toBe(4);
    // One width owner: the stored value is published as the root variable and
    // the column reads it. A React inline width on the rail out-ranks the
    // `100%` surface rule, so the stored width would paint inside the already
    // inset column and cover the 8px band to the list.
    expect(shellSource).not.toMatch(/\bwidth:\s*railWidthState/);
    expect(shellSource).toContain('setProperty("--fb-rail-w", `${railWidthState}px`)');
    // The resize handle still reports the stored column width.
    expect(shellSource).toContain("aria-valuenow={railWidthState}");
    expect(shellSource).toContain("aria-valuetext={`${railWidthState} pixels`}");
    // Surface = column - two 4px frame edges. The stored pinned (192), hover
    // (196) and collapsed (64/72) values are columns; 184/188/56/64 are the
    // surfaces, and the rail's own padding sits inside the surface.
    const surfaceOf = (column: number) => column - frameInline * 2;
    expect(surfaceOf(192)).toBe(184);
    expect(surfaceOf(196)).toBe(188);
    expect(surfaceOf(64)).toBe(56);
    expect(surfaceOf(72)).toBe(64);
    expect(pinnedSurface).toContain("width: 100%;");
    expect(hoverSurface).toContain("width: 100%;");
    expect(pinnedSurface).not.toMatch(/width:\s*var\(--fb-rail-w/);
  });

  it("still fits the 44px hit target and keeps the 32/36px icon axis", () => {
    const frameInline = Number(/padding: 0 (\d+)px 8px;/.exec(railColumn)?.[1] ?? "");
    const paddingInline = Number(/\.fb-nav-rail \{[^}]*padding: \d+px (\d+)px;/.exec(navCss)?.[1] ?? "");
    expect(frameInline).toBe(4);
    expect(paddingInline).toBe(6);
    const narrowContent = 64 - frameInline * 2 - paddingInline * 2;
    const wideContent = 72 - frameInline * 2 - paddingInline * 2;
    expect(narrowContent).toBe(44);
    expect(wideContent).toBe(52);
    expect(frameInline + paddingInline + narrowContent / 2).toBe(32);
    expect(frameInline + paddingInline + wideContent / 2).toBe(36);
  });

  it("keeps the 28px mark on the icon axis inside the narrowed column", () => {
    const brand = /\.fb-nav-brand \{([^}]*)\}/.exec(navCss)?.[1] ?? "";
    expect(brand).toContain("justify-content: center;");
    expect(brand).toContain("padding: 0 10px;");
    expect(navCss).toMatch(/\.fb-nav-rail\[data-pinned="false"\] \.fb-nav-rail-head \{[^}]*justify-content: center;/);
  });

  it("keeps the 32px head centre and the outside name's box", () => {
    expect(navCss).toMatch(/--fb-rail-head-center: 32px;/);
    expect(navCss).toMatch(/\.fb-nav-rail-head \{[^}]*min-height: 48px;/);
    expect(railColumn).toContain("padding: 0 4px 8px;");
    expect(railColumn).not.toMatch(/padding-top|padding-block-start/);
    expect(outsideCss).toMatch(/\.fb-nav-outside-brand \{[^}]*inset-inline-start: 100%;[^}]*top: var\(--fb-rail-head-center, 28px\);[^}]*margin-inline-start: 7px;/);
    expect(outsideCss).toMatch(/\.fb-rail-anchor \{[^}]*min-width: 0;/);
    expect(outsideCss).not.toMatch(/\.fb-rail-anchor \{[^}]*padding/);
  });

  it("keeps one 1.125rem wordmark matching the AppBar title", () => {
    expect(railWordmark).toContain("font-size: 1.125rem;");
    expect(outsideLabel).toContain("font-size: 1.125rem;");
    expect(railWordmark).not.toContain("font-size: 1rem;");
    expect(outsideLabel).not.toContain("font-size: 1rem;");
    expect(railWordmark).toContain("font-weight: 700;");
    expect(outsideLabel).toContain("font-weight: 700;");
    expect(railWordmark).toContain("letter-spacing: -0.02em;");
    expect(outsideLabel).toContain("letter-spacing: -0.02em;");
    expect(railWordmark).toContain("line-height: 1.2;");
    expect(outsideLabel).toContain("line-height: 1.2;");
    expect(outsideLabel).not.toContain("0.9375rem");
    // Parity is with the title's size, not its weight: 1.125rem is 18px at a
    // 16px root. The name keeps its own 700 so it still reads as a wordmark.
    const appBarCss = readFileSync(new URL("../components/appBar.css", import.meta.url), "utf8");
    expect(appBarCss).toMatch(/\.fb-app-bar-title :is\(h1, h2\) \{[^}]*font-size: 1\.125rem;/);
  });

  it("reserves only colliding headers and both chat split states", () => {
    expect(outsideCss).toContain("--fb-reader-gutter: max(0px, (100vw - var(--fb-rail-collapsed) - 44rem) / 2);");
    expect(outsideCss).toMatch(/main\[data-canvas="wide"\] \.fb-app-bar \{\s*padding-inline-start: max\(0\.75rem, 5rem\);/);
    expect(outsideCss).toMatch(/\.fb-notification-header \{\s*padding-inline-start: max\(0\.75rem, calc\(5rem - var\(--fb-reader-gutter\)\)\);/);
    expect(outsideCss).toMatch(/\.fb-saved-reports-header \{\s*padding-inline-start:/);
    expect(outsideCss).toMatch(/\.fb-settings-sticky > button \{\s*margin-inline-start:/);
    expect(outsideCss).toMatch(/\.fb-chat-rail-header \{\s*padding-block-start:/);
    expect(outsideCss).toMatch(/\.fb-split-list:has\(> \.fb-chat-rail\) ~ \.fb-split-detail \.fb-chat-header \{\s*padding-inline-start: calc\(0\.6rem \+ max\(0px, 5rem - 64px\)\);/);
    expect(outsideCss).toMatch(/\.fb-split-list\[hidden\] ~ \.fb-split-detail \.fb-chat-header \{\s*padding-inline-start: 5rem;/);
    expect(outsideCss).toMatch(/\.fb-nav-outside-brand \{[^}]*max-inline-size: calc\(5rem - 7px\);[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    expect(outsideCss).toMatch(/\.fb-nav-outside-brand \{[^}]*pointer-events: none;/);
    expect(outsideCss).not.toContain("--fb-outside-band");
    expect(outsideCss).not.toMatch(/\.fb-rail-anchor[^{}]*::after/);
    expect(outsideCss).not.toMatch(/> main \{\s*padding-block-start/);
  });

  it("turns the frame transition off with the rail's reduced motion", () => {
    expect(navCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.fb-rail-anchor:has\(> \.fb-nav-rail\) \{ transition: none;/);
    expect(navCss).toMatch(/html\.fb-reduce-motion \.fb-rail-anchor:has\(> \.fb-nav-rail\) \{ transition: none;/);
  });

  it("matches hover and focus without nesting :has, and hides the frame in the editor", () => {
    // `:has()` is invalid inside `:has()`, so a nested guard is dropped whole
    // and the 196px overlay would silently never open.
    expect(navCss).not.toMatch(/\.fb-rail-anchor[^{}]*:has\([^)]*:has\(/);
    // The fullscreen editor hides the rail; the column that now owns its
    // 64px frame must go with it or the editor loses 64px of canvas.
    expect(navCss).toMatch(/body:has\(#report-editor-overlay\) \.fb-rail-anchor,\s*body:has\(#report-editor-overlay\) \.fb-nav-rail \{ display: none; \}/);
  });

  it("leaves the phone drawer's own width and border alone", () => {
    expect(drawerRail).toContain("width: 100%;");
    expect(drawerRail).toContain("border-inline-end: 1px solid var(--fb-outline-variant);");
    expect(railSurface).not.toContain("data-drawer");
    expect(railColumn).not.toContain("data-drawer");
    expect(navCss).toMatch(/\.fb-nav-drawer \{[^}]*z-index: 65;/);
    expect(navCss).not.toMatch(/body:has\(\.fb-nav-drawer\)\s+\.fb-hover-label/);
  });
});
