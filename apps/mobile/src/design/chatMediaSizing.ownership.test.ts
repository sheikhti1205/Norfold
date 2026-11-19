// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for R19 photo sizing.
 *
 * jsdom has no layout engine, so this file cannot measure a rendered photo.
 * It pins the declared mechanism and evaluates its bounds as a paint model:
 * one chat-scoped preferred width shared by a single photo and a grouped grid,
 * a height bound that clears an ordinary 3:4 portrait, a viewport term for
 * short screens, a compact status branch with no intrinsic ratio, the inline
 * intrinsic ratio for real content, the existing parent width chain, and the
 * unchanged group arrangements. Rendered geometry remains a deployed browser
 * acceptance item, not a claim from this file.
 */
type CssRule = { selectors: string[]; body: string };

const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");
const messagingTsx = readFileSync(new URL("../screens/Messaging.tsx", import.meta.url), "utf8");

/** Comments removed; every brace-free body is paired with its selector list. */
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

/** All bodies for one exact selector, including members of a selector list. */
function bodiesFor(rules: CssRule[], selector: string) {
  return rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.body);
}

const rules = cssRules(chatCss);

function bodies(selector: string) {
  return bodiesFor(rules, selector);
}

function withWidth(selector: string) {
  return bodies(selector).find(body => body.includes("width:var(--fb-chat-media-width);")) ?? "";
}

/** Bounds read from the source, not measured pixels. */
const REM_PX = 16;
const WIDTH_PATTERN = /--fb-chat-media-width\s*:\s*min\(([\d.]+)rem,\s*([\d.]+)vw\)\s*;/;
const CAP_PATTERN = /max-height:\s*min\(([\d.]+)rem,\s*([\d.]+)vh\)\s*;/;
const width = WIDTH_PATTERN.exec(chatCss);
const cap = CAP_PATTERN.exec(withWidth(".fb-chat-photo"));
const preferredRem = Number(width?.[1] ?? 0);
const preferredVwPercent = Number(width?.[2] ?? 0);
const capRem = Number(cap?.[1] ?? 0);
const capVhPercent = Number(cap?.[2] ?? 0);

/**
 * The paint model of the declared bounds: ratio is width / height, the box is
 * the preferred width capped by the viewport, and contain fits the image into
 * the height cap, so a clamp preserves the intrinsic ratio instead of
 * stretching or cropping it. This is arithmetic on the CSS values, not layout
 * measurement; the parent max-width can only reduce the box width.
 */
function photoPaint(viewportWidth: number, viewportHeight: number, ratio: number) {
  const boxWidth = Math.min(preferredRem * REM_PX, (preferredVwPercent / 100) * viewportWidth);
  const heightCap = Math.min(capRem * REM_PX, (capVhPercent / 100) * viewportHeight);
  const height = Math.min(boxWidth / ratio, heightCap);
  return { boxWidth, heightCap, width: height * ratio, height };
}

describe("R19 chat photo sizing ownership", () => {
  it("declares one chat-scoped preferred width for every sent photo", () => {
    expect(chatCss.match(/--fb-chat-media-width\s*:/g)).toHaveLength(1);
    expect(bodies(".fb-chat-page").some(body => WIDTH_PATTERN.test(body))).toBe(true);
    expect(preferredRem).toBe(22);
    expect(preferredVwPercent).toBe(78);
    expect(chatCss).not.toMatch(/min\(15rem, 65vw\)/);
    expect(chatCss).not.toMatch(/min\(18rem, 78vw\)/);
  });

  it("gives a single photo the shared width without losing its bounds", () => {
    const single = withWidth(".fb-chat-photo");
    expect(single).toContain("max-width:100%;");
    expect(single).toContain("max-height:min(");
    expect(single).not.toContain("max-height:20rem;");
    expect(single).not.toMatch(/max-height\s*:\s*none/);
    expect(single).not.toMatch(/min-width\s*:/);
    expect(single.match(/(?:^|[;\s])width\s*:/g)).toHaveLength(1);
    // The details gallery keeps its own 20rem cap, so the taller photo bound
    // only changes photos inside message bubbles.
    expect(bodies(".fb-chat-gallery .fb-chat-photo").join("\n")).toContain("max-height:20rem;");
  });

  it("gives the grouped grid the same width and keeps its frame", () => {
    const grid = withWidth(".fb-chat-photo-grid");
    expect(grid).toContain("max-width:100%;");
    expect(grid).toContain("gap:2px;");
    expect(grid).toContain("overflow:hidden;");
    expect(grid).toContain("border-radius:.6rem;");
    expect(grid).not.toMatch(/min-width\s*:/);
    expect(grid).not.toMatch(/aspect-ratio\s*:/);
  });

  it("makes the rem cap tall enough for a full-width 3:4 portrait", () => {
    expect(capRem).toBeGreaterThan(0);
    expect(capVhPercent).toBeGreaterThan(0);
    expect(capVhPercent).toBeLessThan(100);
    // height = width / (3 / 4); the rem part must not clamp that portrait.
    expect(capRem).toBeGreaterThanOrEqual(preferredRem / (3 / 4));
  });

  it("paints a 3:4 portrait beyond the old 240x320 box at desktop", () => {
    const desktop = photoPaint(1440, 900, 3 / 4);
    expect(desktop.boxWidth).toBeCloseTo(352, 5);
    expect(desktop.width).toBeCloseTo(desktop.boxWidth, 5);
    expect(desktop.height).toBeCloseTo(352 / (3 / 4), 5);
    expect(desktop.width).toBeGreaterThan(240);
    expect(desktop.height).toBeGreaterThan(320);
  });

  it("keeps a 320px phone inside the viewport", () => {
    const phone = photoPaint(320, 640, 3 / 4);
    expect(phone.boxWidth).toBeCloseTo(320 * 0.78, 5);
    expect(phone.boxWidth).toBeLessThan(320);
    // The bubble is narrower than the preference at this width, so the photo's
    // max-width:100% is what holds it inside. The paddings and the options
    // reserve are read from source rather than assumed: list padding, surface
    // reserve, bubble padding, then the bubble's own content box.
    const list = bodies(".fb-chat-messages").find(body => body.includes("padding:.5rem .8rem;")) ?? "";
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    const listInline = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(list)?.[1] ?? 0);
    const bubbleInline = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(bubble)?.[1] ?? 0);
    const reserve = Number(/max-width:calc\(100% - ([\d.]+)rem\);/
      .exec(bodies(".fb-chat-message-surface").join(" "))?.[1] ?? 0);
    expect(listInline).toBe(0.8);
    expect(bubbleInline).toBe(0.8);
    expect(reserve).toBe(2.75);
    const available = 320 - (listInline * 2 + reserve + bubbleInline * 2) * REM_PX;
    expect(available).toBeCloseTo(224.8, 5);
    // The preference overflows that box; max-width:100% is the clamp.
    expect(phone.boxWidth).toBeGreaterThan(available);
    expect(withWidth(".fb-chat-photo")).toContain("max-width:100%;");
    expect(withWidth(".fb-chat-photo")).not.toMatch(/min-width\s*:/);
    expect(bubble).toContain("min-width:0;");
    expect(available / (3 / 4)).toBeLessThan(640);
  });

  it("bounds a short viewport with the viewport term", () => {
    const short = photoPaint(1024, 400, 3 / 4);
    expect(short.heightCap).toBeCloseTo(0.8 * 400, 5);
    expect(short.height).toBeLessThanOrEqual(short.heightCap + 1e-9);
    expect(short.height).toBeLessThan(photoPaint(1024, 900, 3 / 4).height);
  });

  it("bounds a very tall image without stretching it", () => {
    const tall = photoPaint(1440, 900, 9 / 16);
    expect(tall.height).toBeCloseTo(capRem * REM_PX, 5);
    expect(tall.width).toBeCloseTo(tall.height * (9 / 16), 5);
    expect(tall.width).toBeLessThan(tall.boxWidth);
    expect(tall.width / tall.height).toBeCloseTo(9 / 16, 5);
  });

  it("does not clamp a square or a 4:3 landscape at a tall viewport", () => {
    const square = photoPaint(1440, 900, 1);
    expect(square.width).toBeCloseTo(352, 5);
    expect(square.height).toBeCloseTo(352, 5);
    const landscape = photoPaint(1440, 900, 4 / 3);
    expect(landscape.width).toBeCloseTo(352, 5);
    expect(landscape.height).toBeCloseTo(264, 5);
  });

  it("keeps the inline intrinsic ratio and the contain/cover fitting", () => {
    expect(messagingTsx).toMatch(
      /style=\{\{\s*aspectRatio:\s*`\$\{attachment\.width\} \/ \$\{attachment\.height\}`\s*\}\}/,
    );
    expect(bodies(".fb-chat-photo img").join("\n")).toContain("object-fit:contain;");
    expect(bodies(".fb-chat-photo-grouped img").join("\n")).toContain("object-fit:cover;");
  });

  it("shrinks through the existing parent chain instead of a fixed minimum", () => {
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    expect(bubble).toContain("min-width:0;");
    const surface = bodies(".fb-chat-message-surface").find(body => body.includes("max-width:calc(100% - 2.75rem);")) ?? "";
    expect(surface).toContain("min-width:0;");
    const cell = bodies(".fb-chat-photo-cell").join("\n");
    expect(cell).toContain("min-width:0;");
    expect(cell).toContain("min-height:0;");
  });

  it("keeps the 2-up, tall-left 3-up and 2x2 arrangements unchanged", () => {
    const two = bodies(".fb-chat-photo-grid-2").join("\n");
    expect(two).toContain("grid-template-columns:repeat(2, minmax(0,1fr));");
    expect(two).toContain("aspect-ratio:3 / 2;");
    const three = bodies(".fb-chat-photo-grid-3").join("\n");
    expect(three).toContain("grid-template-columns:repeat(2, minmax(0,1fr));");
    expect(three).toContain("grid-template-rows:repeat(2, minmax(0,1fr));");
    expect(three).toContain("aspect-ratio:1 / 1;");
    expect(bodies(".fb-chat-photo-grid-3 .fb-chat-photo-cell:first-child").join("\n")).toContain("grid-row:span 2;");
    const four = bodies(".fb-chat-photo-grid-4").join("\n");
    expect(four).toContain("grid-template-columns:repeat(2, minmax(0,1fr));");
    expect(four).toContain("grid-template-rows:repeat(2, minmax(0,1fr));");
    expect(four).toContain("aspect-ratio:1 / 1;");
  });

  it("keeps the grouped cells absolute, clipped and cover-fitted", () => {
    const grouped = bodies(".fb-chat-photo-grouped").join("\n");
    expect(grouped).toContain("position:absolute;");
    expect(grouped).toContain("inset:0;");
    expect(grouped).toContain("width:100%;");
    expect(grouped).toContain("height:100%;");
    expect(grouped).toContain("max-height:none;");
    expect(grouped).toContain("border-radius:0;");
    const inner = bodies(".fb-chat-photo-grouped > div").join("\n");
    expect(inner).toContain("width:100%;");
    expect(inner).toContain("height:100%;");
    expect(inner).toContain("min-height:0;");
    expect(bodies(".fb-chat-photo-cell").join("\n")).toContain("overflow:hidden;");
  });

  it("adds no placeholder-only height or padding to the photo box", () => {
    const single = withWidth(".fb-chat-photo");
    expect(single).not.toMatch(/(?:^|[;\s])min-height\s*:/);
    expect(single).not.toMatch(/(?:^|[;\s])padding\s*:/);
    const status = bodies(".fb-chat-photo > div").join("\n");
    expect(status).toContain("min-height:5rem;");
    expect(status).toContain("padding:.5rem;");
  });

  it("keeps a photo with no bytes compact instead of reserving the ratio", () => {
    const compact = bodies('.fb-chat-photo:has(> div[role="status"])').join("\n");
    expect(compact).toContain("aspect-ratio:auto");
    expect(compact).toContain("!important");
    // ChatPhoto is the only owner of this root: a painted photo renders a
    // button, the no-bytes branch renders the div this selector requires.
    expect(messagingTsx).toContain('className="fb-chat-photo"');
    expect(messagingTsx).toContain('<div role="status">');
    expect(messagingTsx).toContain('{content ? <button type="button" aria-label="View photo"');
    // The compact branch keeps its existing minimum and the base box keeps no
    // filler height of its own.
    expect(bodies(".fb-chat-photo > div").join("\n")).toContain("min-height:5rem;");
    expect(bodies(".fb-chat-photo").join("\n")).not.toMatch(/(?:^|[;\s])min-height\s*:/);
    // Fail closed: a loose aspect-ratio reset on the base box is not this rule.
    expect(bodiesFor(cssRules(".fb-chat-photo { aspect-ratio:auto !important; }"),
      '.fb-chat-photo:has(> div[role="status"])')).toHaveLength(0);
  });

  it("keeps the selector and cap readers honest", () => {
    const decoy = ".fb-chat-photo:hover { width:var(--fb-chat-media-width); }\n"
      + ".fb-chat-photo { width:min(15rem, 65vw); }";
    expect(bodiesFor(cssRules(decoy), ".fb-chat-photo")
      .some(body => body.includes("width:var(--fb-chat-media-width);"))).toBe(false);
    const repeated = ".fb-chat-photo { width:1px; }\n"
      + ".fb-chat-photo { width:var(--fb-chat-media-width); }";
    expect(bodiesFor(cssRules(repeated), ".fb-chat-photo")
      .some(body => body.includes("width:var(--fb-chat-media-width);"))).toBe(true);

    const capDecoy = ".fb-chat-photo:hover { max-height:min(30rem, 80vh); }\n"
      + ".fb-chat-photo { max-height:20rem; }";
    const base = bodiesFor(cssRules(capDecoy), ".fb-chat-photo")[0] ?? "";
    expect(base).toContain("max-height:20rem;");
    expect(base).not.toContain("30rem");

    const minHeightDecoy = ".fb-chat-photo { min-height:min(30rem, 80vh); }";
    expect(CAP_PATTERN.exec(bodiesFor(cssRules(minHeightDecoy), ".fb-chat-photo")[0] ?? "")).toBeNull();
  });
});
