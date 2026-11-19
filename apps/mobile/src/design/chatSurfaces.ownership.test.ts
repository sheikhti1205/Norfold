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
 */
const splitCss = readFileSync(new URL("../components/adaptiveFoundation.css", import.meta.url), "utf8");
const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");
const detailsCss = readFileSync(new URL("../components/chatDetailsLayout.css", import.meta.url), "utf8");

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
    const splitGrip = /\.fb-split-view:has\(\.fb-chat-page\) > \.fb-split-resize::before \{([^}]*)\}/.exec(splitCss)?.[1] ?? "";
    expect(splitGrip).toContain("width: 3px;");
    expect(splitGrip).toContain("height: 32px;");
    const detailsGrip = /\.fb-chat-details-resize::before \{([^}]*)\}/.exec(detailsCss)?.[1] ?? "";
    expect(detailsGrip).toContain("width: 3px;");
    expect(detailsGrip).toContain("height: 32px;");
    expect(detailsCss).not.toMatch(/height:\s*50%/);
  });

  it("replaces only the chat splitter's full-height focus outline with the pill ring", () => {
    expect(splitCss).toMatch(/\.fb-split-resize:focus-visible \{ outline: 2px solid var\(--fb-focus\); outline-offset: -2px; \}/);
    expect(splitCss).toMatch(/\.fb-split-view:has\(\.fb-chat-page\) > \.fb-split-resize:focus-visible \{ outline: 0; \}/);
    const focusPill = /\.fb-split-view:has\(\.fb-chat-page\) > \.fb-split-resize:focus-visible::before \{([^}]*)\}/.exec(splitCss)?.[1] ?? "";
    expect(focusPill).toContain("box-shadow: 0 0 0 2px var(--fb-focus);");
    expect(detailsCss).toMatch(/\.fb-chat-details-resize:focus-visible \{ outline:none; \}/);
    expect(detailsCss).toMatch(/\.fb-chat-details-resize:focus-visible::before \{[^}]*box-shadow:0 0 0 2px var\(--fb-focus\);/);
  });

  it("keeps the collapsed rail at its 64px bound and outside the inset", () => {
    expect(CHAT_PANE.collapsedWidth).toBe(64);
    const listInset = /\.fb-split-list:has\(> \.fb-chat-page:not\(\.fb-chat-rail\)\) \{([^}]*)\}/.exec(splitCss)?.[1] ?? "";
    expect(listInset).toContain("padding: 0 8px 8px;");
  });

  it("preserves the panes' existing vertical-only scroll ownership", () => {
    expect(splitCss).toMatch(/\.fb-split-list, \.fb-split-detail \{[^}]*overflow-x: hidden; overflow-y: auto;/);
    expect(chatCss).toMatch(/\.fb-chat-list, \.fb-chat-messages \{[^}]*overflow-x:hidden; overflow-y:auto;/);
  });
});
