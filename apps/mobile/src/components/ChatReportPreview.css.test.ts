// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Owner correction 2026-11-20: a shared report inside a chat message is one
 * message-integrated preview, not a second card painted inside the bubble. The
 * bubble already supplies the surface, so these declarations pin the compact
 * geometry and forbid a second background, border or corner ring. Rendered
 * confirmation still belongs to the deployed browser.
 */
type CssRule = { selectors: string[]; body: string };

const previewCss = readFileSync(new URL("./ChatReportPreview.css", import.meta.url), "utf8");
const messageTextCss = readFileSync(new URL("./ChatMessageText.css", import.meta.url), "utf8");
const messagingCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");

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

function bodies(css: string, selector: string) {
  return cssRules(css).filter(rule => rule.selectors.includes(selector)).map(rule => rule.body).join("\n");
}

describe("chat report preview surface", () => {
  it("caps the preview without painting a second card inside the bubble", () => {
    const preview = bodies(previewCss, ".fb-chat-report-preview");
    expect(preview).toContain("width: min(320px, 100%);");
    expect(preview).toContain("max-width: 100%;");
    expect(preview).not.toMatch(/(?:^|[;\s])background(?:-color)?\s*:/);
    expect(preview).not.toMatch(/(?:^|[;\s])border(?:-[a-z]+)?\s*:/);
    expect(preview).not.toMatch(/(?:^|[;\s])box-shadow\s*:/);
    // The row, not the preview, owns placement; never pack it to the gutter.
    expect(preview).not.toMatch(/(?:^|[;\s])justify-content\s*:/);
    expect(preview).not.toMatch(/margin-inline-start\s*:\s*auto/);
  });

  it("keeps one fixed cover box that can wrap under the copy at large text", () => {
    const cover = bodies(previewCss, ".fb-chat-report-preview-media");
    expect(cover).toMatch(/width:\s*7[2-9]px;/);
    expect(cover).toMatch(/height:\s*7[2-9]px;/);
    expect(cover).toContain("object-fit: cover;");
    const copy = bodies(previewCss, ".fb-chat-report-preview-copy");
    expect(copy).toContain("flex: 1 1 9rem;");
    expect(copy).toContain("min-width: 0;");
  });

  it("leaves the preview grid capped at the bubble width with no self-alignment", () => {
    const grid = bodies(messageTextCss, ".fb-chat-message-previews");
    expect(grid).toContain("max-width: 100%;");
    expect(grid).not.toMatch(/(?:^|[;\s])justify-content\s*:/);
  });

  it("removes the old second-owner report card rules from the screen stylesheet", () => {
    expect(messagingCss).not.toContain(".fb-chat-report-card");
    expect(messagingCss).not.toContain(".fb-chat-report-copy");
    expect(messagingCss).not.toContain(".fb-chat-report-meta");
  });
});
