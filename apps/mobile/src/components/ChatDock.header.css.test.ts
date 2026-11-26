// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dock conversation header, narrow-width contract.
 *
 * The served 320px / root16 and root32 screenshots wrapped the identity row
 * with three controls and left "Close chat" alone on a third line. These
 * assertions pin the replacement geometry in the real declarations: the dock
 * header is its own container, and only below its 19rem content width — the
 * 304px a single row actually needs (80px heading floor, four 48px controls
 * and four 8px gaps) — does the canonical identity own line one and every dock
 * control start a right-aligned group on line two, at 48px, with the wrap
 * spacing the dock already uses. The full-page header keeps its own rule
 * untouched.
 *
 * Static declarations only. Rendered proof (the 60-68px one-row header, no
 * overflow, no dead band, both root sizes, light/dark/true-black) is a
 * deployed-browser check and is not claimed here.
 */
type CssRule = { context: string | null; selectors: string[]; body: string };

const dockCss = readFileSync(new URL("./ChatDock.css", import.meta.url), "utf8");
const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");

/** Rules paired with the at-rule prelude they live under, so blocks stay scoped. */
function cssRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules: CssRule[] = [];
  const walk = (text: string, context: string | null) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open === -1) break;
      let depth = 0;
      let close = -1;
      for (let cursor = open; cursor < text.length; cursor += 1) {
        if (text.charAt(cursor) === "{") depth += 1;
        else if (text.charAt(cursor) === "}") {
          depth -= 1;
          if (depth === 0) { close = cursor; break; }
        }
      }
      if (close === -1) break;
      const prelude = text.slice(index, open).replace(/\s+/g, " ").trim();
      const body = text.slice(open + 1, close);
      if (prelude.startsWith("@")) walk(body, prelude);
      else rules.push({ context, selectors: prelude.split(",").map(part => part.replace(/\s+/g, " ").trim()), body });
      index = close + 1;
    }
  };
  walk(clean, null);
  return rules;
}

const dockRules = cssRules(dockCss);
const chatRules = cssRules(chatCss);

function declaration(body: string, property: string): string | null {
  return new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;
}

/** CSS length in px at the 16px root the assertion is written against. */
function px(value: string | null): number {
  const match = /^(-?[\d.]+)(px|rem)$/.exec(value?.trim() ?? "");
  if (!match) return NaN;
  const [, amount = "", unit = ""] = match;
  return Number(amount) * (unit === "rem" ? 16 : 1);
}

function rulesFor(rules: CssRule[], selector: string): CssRule[] {
  return rules.filter(rule => rule.selectors.includes(selector));
}

/** The one rule for a selector; the assertion names the missing or doubled one. */
function singleRule(rules: CssRule[], selector: string): CssRule {
  const matches = rulesFor(rules, selector);
  expect(matches, selector).toHaveLength(1);
  const [match] = matches;
  if (!match) throw new Error(`No CSS rule for ${selector}`);
  return match;
}

const HEADER = ".fb-chat-dock .fb-chat-header";
const HEADING = ".fb-chat-dock .fb-chat-header > .fb-chat-heading";
const FIRST_CONTROL = ".fb-chat-dock .fb-chat-header > :nth-child(2)";
const CONTAINER_QUERY = "@container fb-chat-dock-header (max-width: 19rem)";

describe("ChatDock header, narrow two-row contract", () => {
  it("makes the dock header its own container and keeps the wrap spacing", () => {
    const body = singleRule(dockRules, HEADER).body;
    expect(declaration(body, "container-type")).toBe("inline-size");
    expect(declaration(body, "container-name")).toBe("fb-chat-dock-header");
    expect(declaration(body, "flex-wrap")).toBe("wrap");
    // 4px between the two rows and the canonical 8px between controls.
    const rowGap = px(declaration(body, "row-gap"));
    expect(rowGap).toBeGreaterThanOrEqual(4);
    expect(rowGap).toBeLessThanOrEqual(8);
    const canonicalGap = px(declaration(singleRule(chatRules, ".fb-chat-header").body, "gap"));
    expect(canonicalGap).toBeGreaterThanOrEqual(4);
    expect(canonicalGap).toBeLessThanOrEqual(8);
  });

  it("scopes the compact header to a 19rem dock container query", () => {
    const narrowRules = dockRules.filter(rule => rule.context?.startsWith("@container"));
    expect(narrowRules.length).toBeGreaterThan(0);
    const contexts = [...new Set(narrowRules.map(rule => rule.context ?? ""))];
    expect(contexts).toEqual([CONTAINER_QUERY]);
    const [context = ""] = contexts;
    const limit = /max-width\s*:\s*([\d.]+)rem/.exec(context);
    // 19rem is exactly the 304px one row occupies (80px heading floor, four
    // 48px controls, four 8px gaps); wrapping at 22rem cost a second control
    // row at the 366px phone window even though the row fit.
    expect(Number(limit?.[1] ?? NaN)).toBe(19);
    // Only the dock header is a container: the full chat page is never queried.
    const containers = dockRules.filter(rule => /container-type\s*:/.test(rule.body));
    expect(containers.flatMap(rule => rule.selectors)).toEqual([HEADER]);
  });

  it("gives the identity the whole first line below the threshold", () => {
    const compact = dockRules.filter(rule => rule.context === CONTAINER_QUERY);
    const heading = compact.filter(rule => rule.selectors.includes(HEADING));
    expect(heading).toHaveLength(1);
    const body = heading[0]?.body ?? "";
    const [grow = "", shrink = "", basis = "", ...rest] = (declaration(body, "flex") ?? "").split(/\s+/);
    // Grow into the line, refuse to shrink off it, and claim its full width.
    expect(Number(grow)).toBeGreaterThan(0);
    expect(shrink).toBe("0");
    expect(basis).toBe("100%");
    expect(rest).toHaveLength(0);
    expect(declaration(body, "min-width")).toBe("0");
    // Above the threshold the identity still shrinks beside the controls.
    const baseHeading = dockRules.filter(rule => rule.context === null && rule.selectors.includes(HEADING));
    expect(baseHeading).toHaveLength(1);
    expect(declaration(baseHeading[0]?.body ?? "", "flex")).toBe("1 1 5rem");
  });

  it("starts the control group at the inline end of the second line", () => {
    const compact = dockRules.filter(rule => rule.context === CONTAINER_QUERY);
    const first = compact.filter(rule => rule.selectors.includes(FIRST_CONTROL));
    expect(first).toHaveLength(1);
    expect(declaration(first[0]?.body ?? "", "margin-inline-start")).toBe("auto");
    // The group keeps the canonical 8px column gap rather than new spacing.
    for (const rule of compact) {
      expect(declaration(rule.body, "gap"), rule.selectors.join(", ")).toBeNull();
      expect(declaration(rule.body, "column-gap"), rule.selectors.join(", ")).toBeNull();
    }
  });

  it("keeps every dock header control at the 48px minimum", () => {
    const icon = singleRule(chatRules, ".fb-chat-icon").body;
    expect(px(declaration(icon, "min-width"))).toBeGreaterThanOrEqual(48);
    expect(px(declaration(icon, "min-height"))).toBeGreaterThanOrEqual(48);

    const controlRules = dockRules.filter(rule => rule.selectors.some(selector =>
      selector.includes(".fb-chat-icon") || selector.includes(FIRST_CONTROL)));
    for (const rule of controlRules) {
      for (const property of ["width", "height", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size", "flex-basis"]) {
        const value = declaration(rule.body, property);
        if (value === null || value === "auto") continue;
        expect(px(value), `${rule.selectors.join(", ")} ${property}`).toBeGreaterThanOrEqual(48);
      }
    }
  });

  it("leaves the full-page chat header rules alone", () => {
    for (const rule of dockRules) {
      for (const selector of rule.selectors) {
        if (!selector.includes(".fb-chat-header")) continue;
        expect(selector.startsWith(HEADER), selector).toBe(true);
      }
    }
    const canonical = singleRule(chatRules, ".fb-chat-header").body;
    expect(canonical).toContain("display:flex;");
    expect(canonical).toContain("align-items:flex-start;");
    expect(canonical).toContain("gap:.5rem;");
    expect(canonical).toContain("flex:none;");
    expect(canonical).toContain("padding:.4rem .6rem;");
    expect(canonical).not.toContain("container-type");
    expect(canonical).not.toContain("flex-wrap");
    expect(canonical).not.toContain("row-gap");
  });

  it("hides or collapses no header control", () => {
    const hiding = /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/;
    const zeroed = /(?:^|[;\s])(?:width|min-width|max-width|inline-size|flex-basis)\s*:\s*0(?:px|rem|%)?(?:\s*;|\s*$)/;
    // Selectors that can match a dock header control; the identity heading is
    // not one and keeps its own deliberate `min-width: 0`.
    const control = (selector: string) =>
      selector.includes(".fb-chat-icon") || selector.includes("nth-child") || selector.includes("button");
    for (const rule of dockRules) {
      if (!hiding.test(rule.body) && !zeroed.test(rule.body)) continue;
      for (const selector of rule.selectors) {
        if (!selector.includes(".fb-chat-dock")) continue;
        expect(control(selector), selector).toBe(false);
      }
    }
    // The dock's only hiding rules remove the `hidden` launcher, host or
    // window. None narrows a control.
    const hidingSelectors = dockRules.filter(rule => hiding.test(rule.body)).flatMap(rule => rule.selectors);
    expect(hidingSelectors).toEqual(expect.arrayContaining([
      ".fb-chat-dock-rail-launcher[hidden]",
      ".fb-chat-dock[hidden]",
      ".fb-chat-dock-window[hidden]",
    ]));
    for (const selector of hidingSelectors) {
      expect(selector).toMatch(/\[hidden\]|:not\(header\)|\.fb-chat-details/);
    }
  });

  it("starts the 48px identity row and every header control on one top line", () => {
    const canonical = singleRule(chatRules, ".fb-chat-header").body;
    expect(declaration(canonical, "align-items")).toBe("flex-start");
    // The dock reuses this header inside its own wrap container, so it must
    // inherit the top line instead of centring the controls again.
    const dockHeader = singleRule(dockRules, HEADER).body;
    expect(declaration(dockHeader, "align-items")).toBeNull();
    // One 48px line: the avatar/name identity and every icon control.
    expect(px(declaration(singleRule(chatRules, ".fb-chat-identity").body, "min-height"))).toBe(48);
    const icon = singleRule(chatRules, ".fb-chat-icon").body;
    expect(px(declaration(icon, "min-width"))).toBe(48);
    expect(px(declaration(icon, "min-height"))).toBe(48);
  });

  it("dresses only the dock surface with the Messenger chrome", () => {
    const dockHeader = singleRule(chatRules, '[data-surface="dock"] .fb-chat-header').body;
    const headerHeight = px(declaration(dockHeader, "min-height"));
    expect(headerHeight).toBeGreaterThanOrEqual(60);
    expect(headerHeight).toBeLessThanOrEqual(68);

    const name = singleRule(chatRules, '[data-surface="dock"] .fb-chat-heading h1').body;
    const nameSize = px(declaration(name, "font-size"));
    expect(nameSize).toBeGreaterThanOrEqual(15.2);
    expect(nameSize).toBeLessThanOrEqual(16);
    // Weight stays the canonical 650 from the shared heading rule.
    expect(declaration(singleRule(chatRules, ".fb-chat-header h1").body, "font-weight")).toBe("650");

    const identity = singleRule(chatRules, '[data-surface="dock"] .fb-chat-identity').body;
    expect(px(declaration(identity, "gap"))).toBe(8);

    // The name stays one clipped line in both surfaces.
    const nameLine = singleRule(chatRules, ".fb-chat-identity-name").body;
    expect(declaration(nameLine, "white-space")).toBe("nowrap");
    expect(declaration(nameLine, "text-overflow")).toBe("ellipsis");
    expect(declaration(nameLine, "overflow")).toBe("hidden");

    const secondary = singleRule(chatRules, '[data-surface="dock"] .fb-chat-heading .fb-chat-secondary').body;
    const secondarySize = px(declaration(secondary, "font-size"));
    expect(secondarySize).toBeGreaterThanOrEqual(12);
    expect(secondarySize).toBeLessThanOrEqual(13);
    expect(declaration(secondary, "white-space")).toBe("nowrap");
    expect(declaration(secondary, "text-overflow")).toBe("ellipsis");
    expect(declaration(secondary, "overflow")).toBe("hidden");
    expect(declaration(secondary, "min-width")).toBe("0");

    // The dock folds that status into the heading link, so it would inherit the
    // 650 name weight; the relationship line keeps the page's regular weight.
    const stacked = singleRule(dockRules, ".fb-chat-dock .fb-chat-identity-copy .fb-chat-secondary").body;
    expect(declaration(stacked, "font-weight")).toBe("400");

    // Chrome only: no new paint, elevation, glass or gradient in the scoped rules.
    for (const body of [dockHeader, name, identity, secondary, stacked]) {
      expect(body).not.toMatch(/(?:^|[;\s])(?:background(?:-color)?|box-shadow|color|filter|backdrop-filter|linear-gradient|radial-gradient)\s*:/);
    }
  });
});
