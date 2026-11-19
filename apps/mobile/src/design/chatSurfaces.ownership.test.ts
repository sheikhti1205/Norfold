// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_PANE } from "../components/panePreference";

/**
 * Static ownership contract for the R19-3 chat surfaces.
 *
 * jsdom has no layout engine, so these assertions cannot measure a rounded
 * corner or a gutter. What they pin is the mechanism that decides who moves:
 * the inset stays scoped to Chat, the 64px avatar rail keeps its column budget
 * but takes the 4px its outer face was missing beside the shell's rail plus the
 * shared 8px foot, the details gap only exists with the open grid class, the
 * splitter sits inside one 8px surface gap, and the rail column beside it
 * shares that same 8px band (4px frame + 4px pane inset). The expanded list,
 * the hidden list, non-chat splits and the phone layout keep their geometry,
 * and the shared Settings split, chat scroll ownership and content dividers are
 * not rewritten. Rendered geometry remains the lead's deployed-browser
 * acceptance item.
 *
 * Rule bodies are read by exact selector, not by the first match in the file:
 * a shared selector list or a second rule for the same selector must not hide
 * the declaration under test. Declaration checks tolerate insignificant
 * whitespace but keep the numeric value exact.
 */
type CssRule = { selectors: string[]; body: string };

const splitCss = readFileSync(new URL("../components/adaptiveFoundation.css", import.meta.url), "utf8");
const navCss = readFileSync(new URL("../components/Shell.nav.css", import.meta.url), "utf8");
const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");
const detailsCss = readFileSync(new URL("../components/chatDetailsLayout.css", import.meta.url), "utf8");
const splitViewSource = readFileSync(new URL("../components/SplitView.tsx", import.meta.url), "utf8");
const DIVIDER_WIDTH = Number(/const DIVIDER_WIDTH = (\d+);/.exec(splitViewSource)?.[1] ?? "");

const FOCUS_RING = /box-shadow\s*:\s*0 0 0 2px var\(--fb-focus\)/;

function mediaBlock(css: string, query: string) {
  const start = css.indexOf(query);
  if (start < 0) return "";
  const open = css.indexOf("{", start);
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

/**
 * Bounded leaf-rule reader: comments are removed, then every brace-free body
 * is paired with its comma-separated selector list. At-rule wrappers contain
 * a nested brace, so they are skipped and their inner rules are read normally.
 */
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

/** All bodies for one exact selector, including members of a selector list. */
function bodiesFor(rules: CssRule[], selector: string) {
  return rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.body);
}

/** Exact numeric declaration, tolerant only of spacing around ':', value, ';'. */
function declared(body: string, property: string, value: string) {
  return new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*${value}\\s*(?:;|$)`).test(body);
}

const splitRules = cssRules(splitCss);
const detailsRules = cssRules(detailsCss);
const splitGutters = mediaBlock(splitCss, "@media (min-width: 600px)");
const chatSurfaces = mediaBlock(chatCss, "@media (min-width: 600px)");
const detailsSurfaces = mediaBlock(detailsCss, "@media (min-width: 600px)");

describe("R19 chat surfaces stay chat-scoped", () => {
  it("draws an 8px frame around chat panes only, with no top gutter", () => {
    expect(splitGutters).toMatch(/\.fb-split-view:has\(\.fb-chat-page\) \{\s*background: var\(--fb-surface-container\);/);
    expect(splitGutters).toMatch(/\.fb-split-list:has\(> \.fb-chat-page:not\(\.fb-chat-rail\)\) \{\s*padding: 0 8px 8px;/);
    expect(splitGutters).toMatch(/\.fb-split-detail:has\(> \.fb-chat-workspace\),\s*\.fb-split-detail:has\(> \.fb-chat-empty\) \{\s*padding: 0 8px 8px;/);
    expect(splitCss).not.toMatch(/(^|\n)\.fb-split-list\s*\{/);
    expect(splitCss).not.toMatch(/\.fb-chat-rail\s*\{[^}]*padding/);
  });

  it("puts the splitter inside one 8px chat surface gap", () => {
    const guard = ":has(> .fb-split-resize)";
    expect(splitGutters).toMatch(/\.fb-split-wide:has\(\.fb-chat-page\):has\(> \.fb-split-resize\) \{\s*column-gap: 0\.5px;/);
    const listWide = bodiesFor(splitRules, `.fb-split-wide:has(.fb-chat-page)${guard} > .fb-split-list:has(> .fb-chat-page:not(.fb-chat-rail))`);
    const detailWide = bodiesFor(splitRules, `.fb-split-wide:has(.fb-chat-page)${guard} > .fb-split-detail:has(> .fb-chat-workspace)`);
    const emptyWide = bodiesFor(splitRules, `.fb-split-wide:has(.fb-chat-page)${guard} > .fb-split-detail:has(> .fb-chat-empty)`);
    expect(listWide.some(body => declared(body, "padding-inline", "8px 0"))).toBe(true);
    expect(detailWide.some(body => declared(body, "padding-inline", "0 8px"))).toBe(true);
    expect(emptyWide.some(body => declared(body, "padding-inline", "0 8px"))).toBe(true);
    // Half a pixel of grid gap either side of the 7px track is the same 8px
    // surface gap the rail/list edge and the details pane use.
    expect(DIVIDER_WIDTH).toBe(7);
    const halfGap = Number(/column-gap:\s*([.\d]+)px;/.exec(splitGutters)?.[1] ?? "");
    expect(halfGap).toBe(0.5);
    expect(halfGap * 2 + DIVIDER_WIDTH).toBe(8);
    expect(splitGutters).toMatch(/\.fb-split-list:has\(> \.fb-chat-page:not\(\.fb-chat-rail\)\) \{\s*padding: 0 8px 8px;/);
    expect(splitGutters).toMatch(/\.fb-split-detail:has\(> \.fb-chat-workspace\),\s*\.fb-split-detail:has\(> \.fb-chat-empty\) \{\s*padding: 0 8px 8px;/);
    // Only the state that renders the splitter changes; a collapsed 64px rail
    // and a single pane keep the base 8px gutters.
    expect(splitGutters).not.toMatch(/\.fb-split-wide:has\(\.fb-chat-page\)(?!:has\(> \.fb-split-resize\))/);
    // Rail/list is the same 8px band, measured surface to surface: the column
    // paints a 4px frame and the pane beside it adds 4px, not another 8.
    const railFrame = Number(/\.fb-rail-anchor:has\(> \.fb-nav-rail\) \{[^}]*padding: 0 (\d+)px 8px;/.exec(navCss)?.[1] ?? "");
    const railList = bodiesFor(splitRules, ".fb-app-viewport:has(.fb-rail-anchor > .fb-nav-rail) .fb-split-list:has(> .fb-chat-page:not(.fb-chat-rail))");
    const railDetail = bodiesFor(splitRules, ".fb-app-viewport:has(.fb-rail-anchor > .fb-nav-rail) .fb-split-list[hidden] ~ .fb-split-detail:has(> .fb-chat-workspace)");
    const railEmpty = bodiesFor(splitRules, ".fb-app-viewport:has(.fb-rail-anchor > .fb-nav-rail) .fb-split-list[hidden] ~ .fb-split-detail:has(> .fb-chat-empty)");
    expect(railFrame).toBe(4);
    expect(railList.some(body => declared(body, "padding-inline-start", "4px"))).toBe(true);
    expect(railDetail.some(body => declared(body, "padding-inline-start", "4px"))).toBe(true);
    expect(railEmpty.some(body => declared(body, "padding-inline-start", "4px"))).toBe(true);
    expect(railFrame + 4).toBe(halfGap * 2 + DIVIDER_WIDTH);
    // Only the pane beside the column moves. The wide split and the collapsed
    // conversation rail keep their splitter gap and their own 8px edges.
    expect(splitCss).not.toContain(".fb-nav-rail) .fb-split-detail");
    // The override lands after the splitter's own padding rule, so the guarded
    // 8px/0 does not out-order it at equal specificity.
    const overrideAt = splitCss.indexOf(".fb-app-viewport:has(.fb-rail-anchor > .fb-nav-rail)");
    const guardedAt = splitCss.indexOf(":has(> .fb-split-resize) > .fb-split-list");
    expect(overrideAt).toBeGreaterThan(guardedAt);
  });

  it("rounds the chat canvases with the existing 20px language", () => {
    expect(chatSurfaces).toMatch(/border-radius: 20px;/);
    expect(chatSurfaces).toMatch(/\.fb-split-detail > \.fb-chat-empty \{[^}]*background: var\(--fb-surface\);[^}]*min-height: 100%;/);
    expect(detailsSurfaces).toMatch(/\.fb-chat-details \{\s*border-radius: 20px;/);
    expect(chatCss).not.toContain(".fb-settings-root");
    // The split never styles the rail itself. It may only ask whether the
    // shell's in-flow rail exists, because that is what makes the rail column
    // and the list share one 8px band; the rail's own paint stays in
    // Shell.nav.css.
    expect(splitCss).not.toMatch(/\.fb-nav-rail\s*(?:,|\{)/);
  });

  it("opens the details gap only while the details grid is open", () => {
    expect(detailsSurfaces).toMatch(/\.fb-chat-workspace-details \{\s*column-gap: 8px;/);
    expect(detailsCss).not.toContain("border-inline-start");
    const base = /\.fb-chat-workspace \{[^}]*\}/.exec(detailsCss)?.[0] ?? "";
    expect(base).toContain("grid-template-columns:minmax(0,1fr) 0px;");
    expect(base).toContain("column-gap:0;");
  });

  it("animates the gap with the existing grid transition and a zero closed gap", () => {
    const base = /\.fb-chat-workspace \{[^}]*\}/.exec(detailsCss)?.[0] ?? "";
    expect(base).toContain("transition:grid-template-columns .26s cubic-bezier(.2,.7,.2,1), column-gap .26s cubic-bezier(.2,.7,.2,1);");
    expect(detailsCss).toMatch(/\.fb-chat-workspace-dragging \{ transition:none;/);
    expect(detailsCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.fb-chat-workspace,[\s\S]*?transition:none;/);
  });

  it("centres the details grip in the 8px gap on its 7px target", () => {
    expect(detailsCss).toMatch(/\.fb-chat-details-resize \{[^}]*right:calc\(var\(--fb-details-w, 320px\) \+ \.5px\);[^}]*width:7px;/);
    expect(detailsCss).toMatch(/\.fb-chat-details-resize::before \{[^}]*top:50%;[^}]*transform:translate\(-50%, -50%\);/);
    // 0.5px either side of the 7px target is the same 8px surface gap, and the
    // grip's centre lands on the gap's centre.
    expect(0.5 + DIVIDER_WIDTH + 0.5).toBe(8);
    expect(0.5 + DIVIDER_WIDTH / 2).toBe(8 / 2);
  });

  it("aligns the chat splitter track with the details track's 8px foot inset", () => {
    expect(splitGutters).toMatch(/\.fb-split-view:has\(\.fb-chat-page\) > \.fb-split-resize \{\s*margin-bottom: 8px;/);
    expect(splitGutters).toMatch(/\.fb-split-detail:has\(> \.fb-chat-workspace\),\s*\.fb-split-detail:has\(> \.fb-chat-empty\) \{\s*padding: 0 8px 8px;/);
    expect(detailsCss).toMatch(/\.fb-chat-details-resize \{[^}]*top:0; bottom:0;/);
  });

  it("removes only the chat AppBar rule and keeps content dividers", () => {
    expect(chatCss).toMatch(/\.fb-chat-page \.fb-app-bar \{\s*border-bottom:\s*0;/);
    expect(chatCss).not.toMatch(/(^|\n)\.fb-app-bar\s*\{/);
    expect(chatCss).toMatch(/\.fb-chat-info-divider \{[^}]*border-top:1px solid/);
    expect(splitCss).toMatch(/\.fb-surface-header \{[^}]*border-bottom: 1px solid/);
  });

  it("keeps the 7px divider track and uses a compact grip", () => {
    expect(splitCss).toMatch(/\.fb-split-resize \{ position: relative; width: 7px;/);
    const splitGrip = bodiesFor(splitRules, ".fb-split-view:has(.fb-chat-page) > .fb-split-resize::before");
    expect(splitGrip.some(body => declared(body, "width", "3px") && declared(body, "height", "32px"))).toBe(true);
    const detailsGrip = bodiesFor(detailsRules, ".fb-chat-details-resize::before");
    expect(detailsGrip.some(body => declared(body, "width", "3px") && declared(body, "height", "32px"))).toBe(true);
    expect(detailsCss).not.toMatch(/height:\s*50%/);
  });

  it("replaces only the chat splitter's full-height focus outline with the pill ring", () => {
    const sharedOutline = bodiesFor(splitRules, ".fb-split-resize:focus-visible");
    expect(sharedOutline.some(body => (
      /outline\s*:\s*2px solid var\(--fb-focus\)/.test(body)
      && declared(body, "outline-offset", "-2px")
    ))).toBe(true);
    const chatOutline = bodiesFor(splitRules, ".fb-split-view:has(.fb-chat-page) > .fb-split-resize:focus-visible");
    expect(chatOutline.some(body => declared(body, "outline", "0"))).toBe(true);
    const focusPill = bodiesFor(splitRules, ".fb-split-view:has(.fb-chat-page) > .fb-split-resize:focus-visible::before");
    expect(focusPill.length).toBeGreaterThan(0);
    expect(focusPill.some(body => declared(body, "width", "5px") && declared(body, "height", "32px"))).toBe(true);
    expect(focusPill.some(body => FOCUS_RING.test(body))).toBe(true);
    const detailsOutline = bodiesFor(detailsRules, ".fb-chat-details-resize:focus-visible");
    expect(detailsOutline.some(body => /outline\s*:\s*none/.test(body))).toBe(true);
    const detailsRing = bodiesFor(detailsRules, ".fb-chat-details-resize:focus-visible::before");
    expect(detailsRing.some(body => (
      declared(body, "width", "5px") && declared(body, "height", "32px") && FOCUS_RING.test(body)
    ))).toBe(true);
    expect(detailsCss).not.toMatch(/height:\s*40px/);
  });

  it("gives both chat grips the same rest and engaged size, colour and transition", () => {
    const leftRest = bodiesFor(splitRules, ".fb-split-view:has(.fb-chat-page) > .fb-split-resize::before");
    expect(leftRest.some(body => (
      declared(body, "width", "3px") && declared(body, "height", "32px")
      && /background\s*:\s*var\(--fb-outline-variant\)/.test(body)
      && /transition\s*:\s*width \.15s ease, height \.15s ease, background \.15s ease;/.test(body)
    ))).toBe(true);
    expect(leftRest.some(body => /top:\s*50%/.test(body) && /transform:\s*translateY\(-50%\)/.test(body))).toBe(true);
    const leftHover = bodiesFor(splitRules, ".fb-split-view:has(.fb-chat-page) > .fb-split-resize:hover::before");
    const leftActive = bodiesFor(splitRules, ".fb-split-view:has(.fb-chat-page) > .fb-split-resize:active::before");
    expect(leftHover.length).toBeGreaterThan(0);
    expect(leftActive.length).toBeGreaterThan(0);
    expect([...leftHover, ...leftActive].some(body => (
      declared(body, "width", "5px") && declared(body, "height", "32px")
      && /background\s*:\s*var\(--fb-primary\)/.test(body)
    ))).toBe(true);
    const rightRest = bodiesFor(detailsRules, ".fb-chat-details-resize::before");
    expect(rightRest.some(body => (
      declared(body, "width", "3px") && declared(body, "height", "32px")
      && /background\s*:\s*var\(--fb-outline-variant\)/.test(body)
      && /transition\s*:\s*width \.15s ease, height \.15s ease, background \.15s ease;/.test(body)
    ))).toBe(true);
    const rightHover = bodiesFor(detailsRules, ".fb-chat-details-resize:hover::before");
    const rightDrag = bodiesFor(detailsRules, ".fb-chat-workspace-dragging .fb-chat-details-resize::before");
    expect(rightHover.length).toBeGreaterThan(0);
    expect(rightDrag.length).toBeGreaterThan(0);
    expect([...rightHover, ...rightDrag].some(body => (
      declared(body, "width", "5px") && declared(body, "height", "32px")
      && /background\s*:\s*var\(--fb-primary\)/.test(body)
    ))).toBe(true);
    expect(splitCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.fb-split-view:has\(\.fb-chat-page\) > \.fb-split-resize::before \{ transition\s*:\s*none;/);
  });

  it("keeps the collapsed rail's 64px budget and gives it the shared 8px band", () => {
    expect(CHAT_PANE.collapsedWidth).toBe(64);
    // The expanded list keeps its inner inset; the rail page never takes it.
    const listInset = /\.fb-split-list:has\(> \.fb-chat-page:not\(\.fb-chat-rail\)\) \{([^}]*)\}/.exec(splitCss)?.[1] ?? "";
    expect(listInset).toContain("padding: 0 8px 8px;");
    expect(splitCss).not.toMatch(/\.fb-chat-rail\s*\{[^}]*padding/);
    // Beside the shell's column the rail's outer face takes only the 4px it was
    // missing: the column's frame supplies the other 4px, so the band matches
    // the thread's 8px gutter and the 8px foot ends both surfaces together.
    const collapsed = bodiesFor(splitRules, ".fb-app-viewport:has(.fb-rail-anchor > .fb-nav-rail) .fb-split-list:has(> .fb-chat-page.fb-chat-rail)");
    expect(collapsed).toHaveLength(1);
    const body = collapsed[0] ?? "";
    expect(declared(body, "padding-inline-start", "4px")).toBe(true);
    expect(declared(body, "padding-bottom", "8px")).toBe(true);
    // The 64px column is the budget: the inset never rewrites it.
    expect(body).not.toMatch(/(?:^|[;\s])(?:width|min-width|max-width)\s*:/);
    const railFrame = Number(/\.fb-rail-anchor:has\(> \.fb-nav-rail\) \{[^}]*padding: 0 (\d+)px 8px;/.exec(navCss)?.[1] ?? "");
    expect(railFrame + 4).toBe(8);
    expect(splitGutters).toMatch(/\.fb-split-detail:has\(> \.fb-chat-workspace\),\s*\.fb-split-detail:has\(> \.fb-chat-empty\) \{\s*padding: 0 8px 8px;/);
    // Every split rule that addresses the collapsed rail is gated on the
    // in-flow rail, so the phone drawer and non-shell routes keep their own
    // geometry.
    const railRules = splitRules.filter(rule => rule.selectors.some(selector => selector.includes(".fb-chat-page.fb-chat-rail")));
    expect(railRules.length).toBeGreaterThan(0);
    for (const rule of railRules) {
      for (const selector of rule.selectors.filter(text => text.includes(".fb-chat-page.fb-chat-rail"))) {
        expect(selector).toContain(".fb-app-viewport:has(.fb-rail-anchor > .fb-nav-rail)");
      }
    }
  });

  it("keeps the selector and declaration helpers honest", () => {
    // CI failed on width:3px vs width: 3px. Spacing is insignificant; value is not.
    expect(declared("width:3px; height:32px;", "width", "3px")).toBe(true);
    expect(declared("width: 3px ; height: 32px ;", "height", "32px")).toBe(true);
    expect(declared("width:4px;", "width", "3px")).toBe(false);
    expect(declared("height:32px;", "width", "3px")).toBe(false);
    expect(declared("min-width:3px;", "width", "3px")).toBe(false);
    // A ring on a hover arm must not satisfy the focus selector.
    const decoy = ".grip:hover::before { box-shadow: 0 0 0 2px var(--fb-focus); }\n"
      + ".grip:focus-visible::before { width:3px; }";
    expect(bodiesFor(cssRules(decoy), ".grip:focus-visible::before").some(body => FOCUS_RING.test(body))).toBe(false);
    // Every rule for the same focus selector is inspected, not just the first.
    const repeated = ".grip:focus-visible::before { width:3px; }\n"
      + ".grip:focus-visible::before { box-shadow: 0 0 0 2px var(--fb-focus); }";
    expect(bodiesFor(cssRules(repeated), ".grip:focus-visible::before").some(body => FOCUS_RING.test(body))).toBe(true);
    expect(FOCUS_RING.test("box-shadow: 0 0 0 1px var(--fb-focus);")).toBe(false);
  });

  it("preserves the panes' existing vertical-only scroll ownership", () => {
    expect(splitCss).toMatch(/\.fb-split-list, \.fb-split-detail \{[^}]*overflow-x: hidden; overflow-y: auto;/);
    expect(chatCss).toMatch(/\.fb-chat-list, \.fb-chat-messages \{[^}]*overflow-x:hidden; overflow-y:auto;/);
  });
});
