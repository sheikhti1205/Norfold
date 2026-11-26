// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * R19-4 compact YouTube card geometry. The bubble already supplies the surface,
 * so these declarations pin the press targets and forbid a second painted card.
 * The domain link is its own in-flow 48px target with the small text centred in
 * it: no pill, no fill, no hidden overlay, so the target can never cover the
 * title line above or follow the pointer. The extra row height at 320px and at
 * large text is accepted accessible flow. Rendered confirmation in
 * light/dark/true-black remains a deployed-browser check.
 */
type CssRule = { selectors: string[]; body: string };

const previewCss = readFileSync(new URL("./YouTubeEmbed.css", import.meta.url), "utf8");

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

function bodies(selector: string): string {
  return cssRules(previewCss).filter(rule => rule.selectors.includes(selector)).map(rule => rule.body).join("\n");
}

function px(body: string, property: string): number {
  return Number(new RegExp(`${property}\\s*:\\s*(-?[\\d.]+)px`).exec(body)?.[1] ?? NaN);
}

/** A painted edge; the media box's own corner radius is not a border. */
const PAINTED_BORDER = /(?:^|[;\s])border(?:-(?:top|right|bottom|left|block|inline)(?:-[a-z]+)?)?\s*:/;

describe("YouTubeEmbed compact press targets", () => {
  it("gives the domain link itself a 48px in-flow target", () => {
    const domain = bodies(".fb-yt-domain");
    // The element, not a pseudo box, owns the target: the extra height is real
    // row space and cannot sit over the title.
    expect(px(domain, "min-height")).toBeGreaterThanOrEqual(48);
    expect(domain).toContain("display: inline-flex;");
    expect(domain).toContain("text-decoration: underline;");
    expect(domain).not.toMatch(/(?:^|[;\s])background(?:-color)?\s*:/);
    expect(domain).not.toMatch(PAINTED_BORDER);
  });

  it("grows no hidden hit area over the title line", () => {
    const rules = cssRules(previewCss);
    expect(rules.some(rule => rule.selectors.some(selector => selector.includes(".fb-yt-domain::"))))
      .toBe(false);
    const domain = bodies(".fb-yt-domain");
    expect(domain).not.toMatch(/(?:^|[;\s])position\s*:\s*(?:absolute|fixed)/);
    expect(domain).not.toMatch(/(?:^|[;\s])transform\s*:/);
    expect(domain).not.toMatch(/(?:^|[;\s])inset(?:-block|-inline)?\s*:/);
    expect(domain).not.toMatch(/(?:^|[;\s])margin(?:-block|-top|-bottom)?\s*:\s*-/);
  });

  it("keeps the play and expand controls at the 48px minimum", () => {
    const play = bodies(".fb-yt-play");
    expect(px(play, "width")).toBeGreaterThanOrEqual(48);
    expect(px(play, "height")).toBeGreaterThanOrEqual(48);

    const expand = bodies(".fb-yt-expand");
    expect(px(expand, "width")).toBeGreaterThanOrEqual(48);
    expect(px(expand, "height")).toBeGreaterThanOrEqual(48);
  });

  it("makes the whole reserved frame the play target", () => {
    const poster = bodies(".fb-yt-poster");
    expect(poster).toContain("position: absolute;");
    expect(poster).toContain("inset: 0;");
    const media = bodies(".fb-yt-media");
    expect(media).toContain("aspect-ratio: 16 / 9;");
  });

  it("reserves metadata space without clipping a long title", () => {
    expect(bodies(".fb-yt-meta")).toContain("min-height: 6rem;");
    const title = bodies(".fb-yt-title");
    expect(title).toContain("overflow-wrap: anywhere;");
    expect(title).not.toContain("line-clamp");
    expect(title).not.toContain("overflow: hidden");
  });

  it("paints no second card inside the bubble", () => {
    for (const selector of [".fb-yt-preview", ".fb-yt-media"]) {
      const body = bodies(selector);
      expect(body).not.toMatch(PAINTED_BORDER);
      expect(body).not.toMatch(/(?:^|[;\s])box-shadow\s*:/);
    }
  });

  it("marks keyboard focus on every control", () => {
    for (const selector of [".fb-yt-poster:focus-visible", ".fb-yt-expand:focus-visible", ".fb-yt-domain:focus-visible"]) {
      expect(bodies(selector)).toContain("outline: 2px solid var(--fb-focus);");
    }
  });
});
