// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_PANE } from "../components/panePreference";

/**
 * Static ownership contract for the R19-3 chat surfaces.
 *
 * jsdom has no layout engine, so these assertions cannot measure a rounded
 * corner or a gutter. What they pin is the mechanism that decides who moves:
 * the inset stays scoped to Chat, the 64px avatar rail is never narrowed, the
 * details gap only exists with the open grid class, and the shared Settings
 * split, chat scroll ownership and content dividers are not rewritten.
 * Rendered geometry remains the lead's deployed-browser acceptance item.
 *
 * Rule bodies are read by exact selector, not by the first match in the file:
 * a shared selector list or a second rule for the same selector must not hide
 * the declaration under test. Declaration checks tolerate insignificant
 * whitespace but keep the numeric value exact.
 */
type CssRule = { selectors: string[]; body: string };

const splitCss = readFileSync(new URL("../components/adaptiveFoundation.css", import.meta.url), "utf8");
const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");
const detailsCss = readFileSync(new URL("../components/chatDetailsLayout.css", import.meta.url), "utf8");

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

  it("rounds the chat canvases with the existing 20px language", () => {
    expect(chatSurfaces).toMatch(/border-radius: 20px;/);
    expect(chatSurfaces).toMatch(/\.fb-split-detail > \.fb-chat-empty \{[^}]*background: var\(--fb-surface\);[^}]*min-height: 100%;/);
    expect(detailsSurfaces).toMatch(/\.fb-chat-details \{\s*border-radius: 20px;/);
    expect(chatCss).not.toContain(".fb-settings-root");
    expect(splitCss).not.toContain(".fb-nav-rail");
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

  it("centres the details grip in the 8px gap on its 9px target", () => {
    expect(detailsCss).toMatch(/\.fb-chat-details-resize \{[^}]*right:calc\(var\(--fb-details-w, 320px\) - \.5px\);[^}]*width:9px;/);
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
    expect(focusPill.some(body => FOCUS_RING.test(body))).toBe(true);
    const detailsOutline = bodiesFor(detailsRules, ".fb-chat-details-resize:focus-visible");
    expect(detailsOutline.some(body => /outline\s*:\s*none/.test(body))).toBe(true);
    const detailsRing = bodiesFor(detailsRules, ".fb-chat-details-resize:focus-visible::before");
    expect(detailsRing.some(body => FOCUS_RING.test(body))).toBe(true);
  });

  it("keeps the collapsed rail at its 64px bound and outside the inset", () => {
    expect(CHAT_PANE.collapsedWidth).toBe(64);
    const listInset = /\.fb-split-list:has\(> \.fb-chat-page:not\(\.fb-chat-rail\)\) \{([^}]*)\}/.exec(splitCss)?.[1] ?? "";
    expect(listInset).toContain("padding: 0 8px 8px;");
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
