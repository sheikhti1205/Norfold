// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./PostCard.css", import.meta.url), "utf8");

type Block = { start: number; end: number; body: string };

/** Every media block whose query starts with `@media <query>`, with its span. */
function mediaBlocks(query: string): Block[] {
  const needle = `@media ${query}`;
  const blocks: Block[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(needle, from);
    if (start === -1) return blocks;
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css.charAt(end) === "{") depth += 1;
      else if (css.charAt(end) === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ start, end, body: css.slice(open + 1, end) });
    from = end + 1;
  }
}

/** The stylesheet with the given media blocks removed, i.e. the unconditional layer. */
function withoutBlocks(blocks: Block[]): string {
  return blocks.reduceRight((acc, { start, end }) => acc.slice(0, start) + acc.slice(end + 1), css);
}

const finePointer = mediaBlocks("(hover: hover) and (pointer: fine)");
const noFinePointer = mediaBlocks("(hover: none), (pointer: coarse)");

describe("report put-away target", () => {
  it("reserves a separate 44px target beside the report overflow", () => {
    const hide = css.match(/\.fb-report-hide\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(hide).toMatch(/width:\s*44px/);
    expect(hide).toMatch(/height:\s*44px/);
    expect(css).toMatch(/\.fb-report-card\[data-hideable="true"\] \.fb-post-identity\s*\{\s*padding-inline-end:\s*44px/);
  });

  it("plays the toss only while hovering the cross and respects reduced motion", () => {
    expect(css).toMatch(/:has\(\.fb-report-hide:hover\) \.fb-report-toss\s*\{\s*animation:\s*fb-report-toss/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).not.toMatch(/\.fb-report-card:hover\s+\.fb-report-toss/);
  });

  it("only reveals the cross where a fine pointer can hover it", () => {
    const reveals = finePointer.filter(({ body }) => /\.fb-report-card:hover \.fb-report-hide\s*\{[^}]*opacity:\s*1/.test(body));
    expect(reveals.length).toBeGreaterThan(0);
    // A tap leaves :hover stuck on touch, so the reveal must not exist outside
    // the fine-pointer block that also reserves its 44px slot.
    expect(withoutBlocks(finePointer)).not.toMatch(/\.fb-report-card:hover \.fb-report-hide/);
    // Keyboard reachability stays: focus-visible is the only unconditional reveal.
    expect(withoutBlocks(finePointer)).toMatch(/\.fb-report-hide:focus-visible\s*\{[^}]*opacity:\s*1/);
    expect(withoutBlocks(finePointer)).not.toMatch(/\.fb-report-hide:focus-visible\s*\{[^}]*display:\s*none/);
  });

  it("keeps the cross out of the touch layout entirely", () => {
    const guards = noFinePointer.filter(({ body }) => /\.fb-report-hide\s*\{[^}]*display:\s*none/.test(body));
    expect(guards.length).toBeGreaterThan(0);
  });
});
