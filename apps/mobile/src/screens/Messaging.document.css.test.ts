// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Owner correction 2026-11-20: a bare document is one message surface. The
 * bubble keeps its fill and tightens its own inset; the file row inside it is
 * transparent. These guards read the actual declarations so a later edit cannot
 * reintroduce a nested painted frame or a second gutter. Rendered geometry still
 * belongs to the deployed browser, not to this file.
 */
type CssRule = { selectors: string[]; body: string };

const messageCss = readFileSync(new URL("./Messaging.css", import.meta.url), "utf8");
const fileCss = readFileSync(new URL("../components/ChatFile.css", import.meta.url), "utf8");

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

const documentBubble = ".fb-chat-message.fb-chat-message-document";
const documentStatus = `${documentBubble} > .fb-chat-message-status`;

describe("document message surface", () => {
  it("tightens only the bare document bubble's own inset", () => {
    const bubble = bodies(messageCss, documentBubble);
    expect(bubble).toContain("padding:.5rem;");
    // The scoped rule is an inset, not a second layout: the shared bubble width,
    // fill and gutter keep their existing owners.
    expect(bubble).not.toMatch(/(?:^|[;\s])width\s*:/);
    expect(bubble).not.toMatch(/(?:^|[;\s])max-width\s*:/);
    expect(bubble).not.toMatch(/(?:^|[;\s])margin(?:-[a-z]+)?\s*:/);
    expect(bubble).not.toMatch(/(?:^|[;\s])background(?:-color)?\s*:/);
    expect(bubble).not.toMatch(/(?:^|[;\s])border(?:-[a-z]+)?\s*:/);
  });

  it("keeps the document receipt line in normal flow and close to the row", () => {
    const status = bodies(messageCss, documentStatus);
    expect(status).toContain("margin-top:.125rem;");
    expect(status).not.toMatch(/(?:^|[;\s])(?:position|inset|top|right|bottom|left)\s*:/);
    expect(status).not.toMatch(/(?:^|[;\s])(?:min-height|padding)\s*:/);
    // Every other kind keeps the shared receipt contract.
    expect(bodies(messageCss, ".fb-chat-message-status")).toContain("margin-top:.25rem;");
  });

  it("leaves the ordinary bubble gutter untouched", () => {
    const bubble = bodies(messageCss, ".fb-chat-message");
    expect(bubble).toContain("padding:.6rem .8rem;");
    expect(bubble).toContain("max-width:min(100%, 34rem);");
  });

  it("keeps the file row transparent inside the bubble", () => {
    const row = bodies(fileCss, ".fb-chat-document");
    expect(row).toContain("width: 320px;");
    expect(row).toContain("max-width: 100%;");
    expect(row).toContain("padding: 0;");
    expect(row).toContain("border: 0;");
    expect(row).toContain("border-radius: 0;");
    expect(row).toContain("background: transparent;");
  });
});
