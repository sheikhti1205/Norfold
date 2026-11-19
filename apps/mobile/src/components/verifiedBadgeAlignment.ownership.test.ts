// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static contract for where the earned verification mark sits (owner report
 * 2026-11-18 11:14: "the tickmark should be on the same level as the text. Not
 * above like that.").
 *
 * The post identity line used to baseline-align a full-em mark beside the 28px
 * avatar, so the mark's bottom met the name's baseline and its body floated
 * above the word. 0e074973 centres it on the line and sizes it from the name's
 * own type; the surviving -0.06em nudge is optical correction, not a lift.
 *
 * jsdom has no layout engine, so this pins the declared mechanism rather than a
 * measurement. The painted result stays a deployed-browser acceptance item, not
 * a claim made by this file.
 */
type CssRule = { selector: string; body: string };

const badgeCss = readFileSync(new URL("./VerifiedBadge.css", import.meta.url), "utf8");
const anatomyCss = readFileSync(new URL("./PostAnatomy.css", import.meta.url), "utf8");

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

const badgeRules = cssRules(badgeCss);
const anatomyRules = cssRules(anatomyCss);

function bodyOf(rules: CssRule[], selector: string) {
  return rules.find(rule => rule.selector === selector)?.body ?? "";
}

const nameLine = bodyOf(anatomyRules, ".fb-post-name-badge");
const nameLineNudge = bodyOf(anatomyRules, ".fb-post-name-badge .fb-verified-badge");
const baseBadge = bodyOf(badgeRules, ".fb-verified-badge");

/** A declared offset in em, or undefined when the rule does not set one. */
function emValue(body: string, property: string) {
  const value = new RegExp(`(?:^|;)\\s*${property}: (-?[\\d.]+)em;`).exec(body)?.[1];
  return value === undefined ? undefined : Number(value);
}

describe("verified mark placement", () => {
  it("centres the mark on the post name line instead of aligning its baseline", () => {
    expect(nameLine).toContain("align-items: center;");
    expect(nameLine).not.toContain("align-items: baseline;");
    // The 1em box must follow the name's own type, not the header's.
    expect(nameLine).toMatch(/font-size: \.?[\d.]+rem;/);
    const nudge = emValue(nameLineNudge, "top");
    // A hair of optical correction is fine; a visible lift is the reported defect.
    if (nudge !== undefined) expect(nudge).toBeGreaterThanOrEqual(-0.1);
  });

  it("sizes the mark from the surrounding type and never raises its box", () => {
    expect(baseBadge).toContain("width: max(1em, 14px);");
    expect(baseBadge).toContain("height: max(1em, 14px);");
    // Negative drops the box toward the baseline; a positive value would raise it.
    const verticalAlign = emValue(baseBadge, "vertical-align");
    if (verticalAlign !== undefined) expect(verticalAlign).toBeLessThanOrEqual(0);
  });

  it("has no rule in the owning stylesheets that shifts the mark upward", () => {
    for (const [file, rules] of [
      ["VerifiedBadge.css", badgeRules],
      ["PostAnatomy.css", anatomyRules],
    ] as const) {
      for (const rule of rules) {
        if (!rule.selector.includes("fb-verified-badge")) continue;
        const top = emValue(rule.body, "top");
        if (top !== undefined) {
          expect(top, `${file} ${rule.selector} lifts the mark off the text`).toBeGreaterThanOrEqual(-0.1);
        }
        const raised = /(?:^|;)\s*vertical-align: ([\d.]+)em;/.exec(rule.body)?.[1];
        if (raised !== undefined) {
          expect(Number(raised), `${file} ${rule.selector} raises the mark above the baseline`).toBe(0);
        }
      }
    }
  });
});
