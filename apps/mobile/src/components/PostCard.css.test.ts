// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./PostCard.css", import.meta.url), "utf8");

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
});
