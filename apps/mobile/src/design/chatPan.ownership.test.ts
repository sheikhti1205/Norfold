import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cssFile = (path: string) => readFileSync(path, "utf8");

/**
 * A conversation that can be dragged left and right reads as a broken page:
 * the owner panned the chat sideways, which moved the header and the composer
 * off screen. A panel scrolls vertically; only a deliberately horizontal
 * strip (pins, staged photos) owns a horizontal axis.
 */
describe("a chat pane never pans horizontally", () => {
  it("scrolls the split panes on the vertical axis only", () => {
    const css = cssFile("src/components/adaptiveFoundation.css");
    const body = /\.fb-split-list,\s*\.fb-split-detail\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("overflow-x: hidden");
    expect(body).not.toMatch(/\boverflow:\s*auto/);
  });

  it("scrolls the chat list and transcript on the vertical axis only", () => {
    const css = cssFile("src/screens/Messaging.css");
    const body = /\.fb-chat-list,\s*\.fb-chat-messages\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(body).toContain("overflow-y:auto");
    expect(body).toContain("overflow-x:hidden");
  });
});
