// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dock conversation header, narrow-width contract.
 *
 * The served 320px / root16 and root32 screenshots wrapped the identity row
 * with three controls and left "Close chat" alone on a third line. These
 * assertions pin the replacement geometry in the real declarations: below the
 * dock header's own 22rem container width the canonical identity owns line one
 * and every dock control starts a right-aligned group on line two, at 44px,
 * with the wrap spacing the dock already uses. The full-page header keeps its
 * own rule untouched.
 *
 * Static declarations only. Rendered proof (no overflow, no dead band, both
 * root sizes, light/dark/true-black) is a deployed-browser check and is not
 * claimed here.
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
const CONTAINER_QUERY = "@container fb-chat-dock-header (max-width: 22rem)";

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

  it("scopes the compact header to a 22rem dock container query", () => {
    const narrowRules = dockRules.filter(rule => rule.context?.startsWith("@container"));
    expect(narrowRules.length).toBeGreaterThan(0);
    const contexts = [...new Set(narrowRules.map(rule => rule.context ?? ""))];
    expect(contexts).toEqual([CONTAINER_QUERY]);
    const [context = ""] = contexts;
    const limit = /max-width\s*:\s*([\d.]+)rem/.exec(context);
    expect(Number(limit?.[1] ?? NaN)).toBeLessThanOrEqual(22);
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

  it("keeps every dock header control at the 44px minimum", () => {
    const icon = singleRule(chatRules, ".fb-chat-icon").body;
    expect(px(declaration(icon, "min-width"))).toBeGreaterThanOrEqual(44);
    expect(px(declaration(icon, "min-height"))).toBeGreaterThanOrEqual(44);

    const controlRules = dockRules.filter(rule => rule.selectors.some(selector =>
      selector.includes(".fb-chat-icon") || selector.includes(FIRST_CONTROL)));
    for (const rule of controlRules) {
      for (const property of ["width", "height", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size", "flex-basis"]) {
        const value = declaration(rule.body, property);
        if (value === null || value === "auto") continue;
        expect(px(value), `${rule.selectors.join(", ")} ${property}`).toBeGreaterThanOrEqual(44);
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
    expect(canonical).toContain("align-items:center;");
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
    // The dock's only hiding rules remove the `hidden` panel, the alternate
    // details pane, or minimized page content. None narrows a control.
    const hidingSelectors = dockRules.filter(rule => hiding.test(rule.body)).flatMap(rule => rule.selectors);
    expect(hidingSelectors).toEqual(expect.arrayContaining([
      ".fb-chat-launcher[hidden]",
      ".fb-chat-dock[hidden]",
      '.fb-chat-dock[data-phase="minimized"] .fb-chat-page > :not(header)',
    ]));
    for (const selector of hidingSelectors) {
      expect(selector).toMatch(/\[hidden\]|:not\(header\)|\.fb-chat-details/);
    }
  });
});
