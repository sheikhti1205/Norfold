// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static geometry contract for the two feed links measured under the 48px
 * floor at 390 and 320: the author identity link (`120.5 x 28`) and the post
 * title link (`272.3 x 21.6`).
 *
 * jsdom has no layout engine, so these assertions pin the declared mechanism
 * rather than a box: each link is its own 48px-tall in-flow element, not a
 * `::after` hit-area expander, which is what keeps it from reaching the status
 * chip, the identity row above or the description below. Rendered heights,
 * five-point probes and the per-width screenshots remain a deployed-browser
 * acceptance item.
 */
type CssRule = { selector: string; body: string };

const anatomyCss = readFileSync(new URL("./PostAnatomy.css", import.meta.url), "utf8");
const identityCss = readFileSync(new URL("./UserIdentityTrigger.css", import.meta.url), "utf8");
const profileCss = readFileSync(new URL("../screens/Profile.css", import.meta.url), "utf8");

/** Comments removed; every brace-free body is paired with its selector list. */
function cssRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules: CssRule[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selector: (match[1] ?? "").replace(/\s+/g, " ").trim(),
      body: match[2] ?? "",
    });
  }
  return rules;
}

const anatomyRules = cssRules(anatomyCss);
const identityRules = cssRules(identityCss);
const profileRules = cssRules(profileCss);

function bodyOf(rules: CssRule[], selector: string) {
  return rules.find(rule => rule.selector === selector)?.body ?? "";
}

describe("feed link targets", () => {
  it("gives the post identity link a 48px row and centres its avatar and name", () => {
    const identityLink = bodyOf(anatomyRules, ".fb-post-identity .fb-identity-link");
    expect(identityLink).toMatch(/min-height:\s*48px/);
    expect(identityLink).toContain("align-items: center;");
    // The shared owner stays a plain inline row: comment rows and the chat
    // header keep their own layout and another surface owns their geometry.
    const shared = bodyOf(identityRules, ".fb-identity-link");
    expect(shared).not.toMatch(/min-height/);
    expect(shared).not.toMatch(/height:\s*48px/);
  });

  it("gives the title link a 48px box that stretches the heading it wraps", () => {
    const titleLink = bodyOf(anatomyRules, ".fb-post-title-link");
    expect(titleLink).toMatch(/min-height:\s*48px/);
    expect(titleLink).toContain("display: flex;");
    expect(titleLink).toContain("align-items: center;");
    // The heading takes the link's width, so line breaks and the two-line clamp
    // are identical to the old block link; only the vertical box grows.
    const titleChild = bodyOf(anatomyRules, ".fb-post-title-link > *");
    expect(titleChild).toMatch(/flex:\s*1 1 auto;/);
    expect(titleChild).toMatch(/min-width:\s*0;/);
  });

  it("uses no pseudo-element expander that could reach a neighbouring control", () => {
    for (const rule of anatomyRules) {
      if (!/\.fb-(?:post-title-link|identity-link)\b/.test(rule.selector)) continue;
      expect(rule.selector).not.toContain("::after");
      expect(rule.selector).not.toContain("::before");
      expect(rule.body).not.toMatch(/(?:^|;)\s*position:\s*absolute/);
    }
  });

  it("keeps the owning containers from clipping or fixing the taller rows", () => {
    for (const selector of [
      ".fb-post-content",
      ".fb-post-identity",
      ".fb-post-identity-line",
      ".fb-post-heading",
      ".fb-post-title-row",
      ".fb-post-title-main",
    ]) {
      const body = bodyOf(anatomyRules, selector);
      expect(body, selector).not.toMatch(/overflow:\s*hidden/);
      expect(body, selector).not.toMatch(/(?:^|;)\s*(?:max-)?height:\s*\d+px/);
    }
  });

  it("keeps every density on the same base rule, never a shorter override", () => {
    // `.fb-post-home-feed`, `.fb-post-compact` and `.fb-post-masonry` all use
    // the base link rules. Any later density selector that shrinks one of them
    // below 48px would silently exempt that card from the floor.
    for (const rule of anatomyRules) {
      if (!/\.fb-(?:post-title-link|identity-link)\b/.test(rule.selector)) continue;
      const minHeight = /min-height:\s*([\d.]+)px/.exec(rule.body)?.[1];
      if (minHeight !== undefined) {
        expect(Number(minHeight), rule.selector).toBeGreaterThanOrEqual(48);
      }
      expect(rule.body, rule.selector).not.toMatch(/(?:^|;)\s*height:\s*(?:[0-3]?\d(?:\.\d+)?)px/);
    }
  });
});

describe("profile expanders still supply the 48px hit area", () => {
  it("keeps the portrait and name edit expanders at an 8px outset", () => {
    expect(bodyOf(profileRules, ".fb-profile-portrait-edit::after")).toMatch(/inset:\s*-8px/);
    expect(bodyOf(profileRules, ".fb-profile-name-edit::after")).toMatch(/inset:\s*-8px/);
  });

  it("keeps the 28px action chip expanded to 48px tall", () => {
    expect(bodyOf(profileRules, ".fb-profile-chip--action::after")).toMatch(/inset:\s*-10px 0/);
  });
});
