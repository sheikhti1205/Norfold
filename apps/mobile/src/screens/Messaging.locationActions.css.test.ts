// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shared-location sheet's two actions must read as one line each at every
 * supported width and text scale: "Open in Maps" split into two lines at
 * 320 px, and shrinking or ellipsising it is not a fix. These guards pin the
 * layout contract rather than a pixel result — the row keeps two equal columns
 * while both labels fit, and becomes two full-width rows otherwise. Rendered
 * geometry still belongs to the deployed browser.
 */
const css = readFileSync(new URL("./Messaging.css", import.meta.url), "utf8");

/** Strip comments and flatten whitespace, so declarations read as written. */
const flat = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

/** Every declaration block for one exact selector. */
function declarations(selector: string): string[] {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g");
  return [...flat.matchAll(pattern)].map(match => match[1] ?? "");
}

/** The body of the first `@container` block, matched by brace depth. */
function containerBlocks(): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = flat.indexOf("@container", from);
    if (at === -1) return blocks;
    const open = flat.indexOf("{", at);
    if (open === -1) return blocks;
    let depth = 0;
    let end = open;
    for (; end < flat.length; end += 1) {
      if (flat[end] === "{") depth += 1;
      else if (flat[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(flat.slice(at, end + 1));
    from = end + 1;
  }
}

describe("shared location sheet actions", () => {
  it("measures the sheet, not the device, so the row follows its real width", () => {
    const sheet = declarations(".fb-chat-location-sheet");
    expect(sheet.length).toBe(1);
    expect(sheet[0]).toMatch(/container-type:\s*inline-size;/);
  });

  it("never breaks, truncates or shrinks either label", () => {
    const [buttons = ""] = declarations(".fb-chat-location-actions .fb-surface-button");
    expect(buttons).toMatch(/white-space:\s*nowrap;/);
    expect(buttons).not.toMatch(/text-overflow/);
    expect(buttons).not.toMatch(/line-clamp/);
    expect(buttons).not.toMatch(/font-size/);
    // Wrapping is the backstop when a label outgrows the row: better a second
    // full-width row than a broken or clipped label.
    const [row = ""] = declarations(".fb-chat-location-actions");
    expect(row).toMatch(/display:\s*flex;/);
    expect(row).toMatch(/flex-wrap:\s*wrap;/);
  });

  it("stacks both actions as full-width rows below the row's own requirement", () => {
    const [block = ""] = containerBlocks().filter((entry) => entry.includes(".fb-chat-location-actions"));
    expect(block, "no container rule for the action row").not.toBe("");
    expect(block).toMatch(/flex-direction:\s*column;/);
    expect(block).toMatch(/\.fb-chat-location-actions \.fb-surface-button \{[^}]*width:\s*100%/);
    expect(block).toMatch(/\.fb-chat-location-actions \.fb-surface-button \{[^}]*flex:\s*0 0 auto/);
    // The 48 px floor stays with the shared button class: the stacked rows must
    // not shorten it, and the whole row is the target.
    expect(block).not.toMatch(/min-height/);
    expect(block).not.toMatch(/(?:^|[;\s])height:\s*\d+px/);
  });

  it("states the threshold as the row's requirement, so it follows text scale", () => {
    const [block = ""] = containerBlocks().filter((entry) => entry.includes(".fb-chat-location-actions"));
    // Fixed paddings and icons in px, label-plus-gap room in rem: at the
    // Extra large text scale (20 px root) the labels need more room, and the
    // threshold grows with them instead of staying a phone width.
    expect(block).toMatch(/@container \(max-width: ?calc\(\d+px \+ [\d.]+rem\)\)/);
  });
});
