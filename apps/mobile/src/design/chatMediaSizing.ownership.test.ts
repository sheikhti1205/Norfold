// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for R19 photo sizing.
 *
 * jsdom has no layout engine, so this file cannot measure a rendered photo.
 * It pins the declared mechanism and evaluates its bounds as a paint model:
 * a photo-only preferred width inside the existing 34rem bubble cap, the
 * unitless inline ratio that shrinks the box until it fits the shared height
 * cap (so the contain-fitted picture paints edge to edge with no letterbox
 * bars), a flush bubble whose width owner is the picture box rather than the
 * bitmap's intrinsic width, a compact status branch that keeps the old media
 * width and no intrinsic ratio, the unchanged shared token read by files, video,
 * stickers and the grouped grid, the existing parent width chain, and the
 * unchanged group arrangements. Rendered geometry remains a deployed browser
 * acceptance item, not a claim from this file.
 */
type CssRule = { selectors: string[]; body: string };

const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");
const messagingTsx = readFileSync(new URL("../screens/Messaging.tsx", import.meta.url), "utf8");
const transcriptHook = readFileSync(new URL("../hooks/useTranscriptAnchor.ts", import.meta.url), "utf8");
const peerComposerCss = readFileSync(new URL("../components/peerComposer.css", import.meta.url), "utf8");

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

/**
 * One exported function's full source, from its declaration through the brace
 * that closes its body. A lazy `\n}` match ends on the first line-final `}`,
 * which is the parameter object's own closing brace here, so the guards in the
 * body were never read; counting from the body brace to its match cannot stop
 * early on a multi-line signature.
 */
function functionSource(source: string, name: string) {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) return "";
  let cursor = source.indexOf("(", start);
  if (cursor < 0) return "";
  let parens = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === "(") parens += 1;
    else if (source[cursor] === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  const open = source.indexOf("{", cursor);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

const rules = cssRules(chatCss);
const peerComposerRules = cssRules(peerComposerCss);

function bodies(selector: string) {
  return bodiesFor(rules, selector);
}

function withWidth(selector: string) {
  return bodies(selector).find(body => body.includes("width:var(--fb-chat-media-width);")) ?? "";
}

/** The single photo box: its own wider preference and the ratio-aware shrink. */
function photoRule() {
  return bodies(".fb-chat-photo").find(body => body.includes("width:min(var(--fb-chat-photo-width")) ?? "";
}

/** Bounds read from the source, not measured pixels. */
const REM_PX = 16;
const WIDTH_PATTERN = /--fb-chat-media-width\s*:\s*min\(([\d.]+)rem,\s*([\d.]+)vw\)\s*;/;
const PHOTO_WIDTH_PATTERN = /--fb-chat-photo-width\s*:\s*([\d.]+)rem\s*;/;
const CAP_PATTERN = /max-height:\s*min\(([\d.]+)rem,\s*([\d.]+)vh\)\s*;/;
const width = WIDTH_PATTERN.exec(chatCss);
const photoWidth = PHOTO_WIDTH_PATTERN.exec(chatCss);
const cap = CAP_PATTERN.exec(photoRule());
const preferredRem = Number(width?.[1] ?? 0);
const preferredVwPercent = Number(width?.[2] ?? 0);
const photoPreferredRem = Number(photoWidth?.[1] ?? 0);
const capRem = Number(cap?.[1] ?? 0);
const capVhPercent = Number(cap?.[2] ?? 0);

/**
 * The paint model of the declared photo bounds: ratio is width / height. The
 * photo preference, the bubble's content box (100%) and the height cap times
 * the inline ratio compete, and the smallest wins. A tall picture therefore
 * narrows until it fits the cap, so the box and the contain-fitted image agree
 * and no letterbox bars remain. This is arithmetic on CSS values, not layout
 * measurement; the parent chain can only reduce the box width further.
 */
function photoPaint(viewportWidth: number, viewportHeight: number, ratio: number) {
  const heightCap = Math.min(capRem * REM_PX, (capVhPercent / 100) * viewportHeight);
  // A flush media bubble owns no inline padding; only the transcript gutter
  // stays outside the photo, and the 34rem bubble cap bounds the rest.
  const availableWidth = Math.min(viewportWidth - 2 * 0.8 * REM_PX, 34 * REM_PX);
  const boxWidth = Math.min(photoPreferredRem * REM_PX, availableWidth, heightCap * ratio);
  return { boxWidth, availableWidth, heightCap, width: boxWidth, height: boxWidth / ratio };
}

describe("R19 chat photo sizing ownership", () => {
  it("keeps the shared media width and gives photos their own wider preference", () => {
    expect(chatCss.match(/--fb-chat-media-width\s*:/g)).toHaveLength(1);
    expect(bodies(".fb-chat-page").some(body => WIDTH_PATTERN.test(body))).toBe(true);
    expect(preferredRem).toBe(22);
    expect(preferredVwPercent).toBe(78);
    // Photos opt into their own preference without editing the token that
    // video, files, stickers and the grouped grid read, and they stay under the
    // existing 34rem bubble/surface cap.
    expect(chatCss.match(/--fb-chat-photo-width\s*:/g)).toHaveLength(1);
    expect(photoPreferredRem).toBe(32);
    expect(photoPreferredRem).toBeLessThan(34);
    expect(withWidth(".fb-chat-photo-grid")).toContain("var(--fb-chat-media-width)");
    expect(photoRule()).not.toContain("--fb-chat-media-width");
    expect(chatCss).not.toMatch(/min\(15rem, 65vw\)/);
    expect(chatCss).not.toMatch(/min\(18rem, 78vw\)/);
  });

  it("gives a single photo its own preference without losing its bounds", () => {
    const single = photoRule();
    expect(single).toContain("max-width:100%;");
    expect(single).toContain("max-height:min(");
    expect(single).toContain("100%,");
    expect(single).toContain("var(--fb-chat-photo-ratio");
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

  it("shrinks the box by the inline ratio so the height cap never letterboxes", () => {
    const single = photoRule();
    // --fb-chat-photo-ratio is the unitless width/height number ChatPhoto
    // publishes on the same inline style as attachment.width / attachment.height;
    // the 1 default matches its invalid-dimensions fallback.
    expect(single).toContain("--fb-chat-photo-ratio: 1;");
    expect(single).toMatch(/width:min\(var\(--fb-chat-photo-width, 32rem\), 100%, calc\(min\(30rem, 80vh\) \* var\(--fb-chat-photo-ratio\)\)\)/);
    expect(messagingTsx).toContain("aspectRatio: `${attachment.width} / ${attachment.height}`");
    expect(capRem).toBe(30);
    expect(capVhPercent).toBe(80);
  });

  it("paints a 3:4 portrait larger than the old 240x320 box at desktop", () => {
    const desktop = photoPaint(1440, 900, 3 / 4);
    // The 30rem cap times 3/4 gives a 22.5rem (360px) box: wider than the old
    // 352px preference and taller than its 469px letterboxed rendering, and the
    // contain-fitted picture now fills the box exactly.
    expect(desktop.boxWidth).toBeCloseTo(360, 5);
    expect(desktop.width).toBeCloseTo(desktop.boxWidth, 5);
    expect(desktop.height).toBeCloseTo(480, 5);
    expect(desktop.width).toBeGreaterThan(240);
    expect(desktop.height).toBeGreaterThan(320);
    expect(Math.abs(desktop.width / desktop.height - 3 / 4)).toBeLessThan(1e-9);
  });

  it("keeps a 320px phone inside the viewport without overflowing the bubble", () => {
    const phone = photoPaint(320, 640, 3 / 4);
    // The bubble no longer reserves width beside it for the menu control, so
    // the phone's whole content box holds the photo. The paddings are read from
    // source rather than assumed: list padding, then bubble padding.
    const list = bodies(".fb-chat-messages").find(body => body.includes("padding:.5rem .8rem;")) ?? "";
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    const listInline = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(list)?.[1] ?? 0);
    const bubbleInline = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(bubble)?.[1] ?? 0);
    expect(listInline).toBe(0.8);
    expect(bubbleInline).toBe(0.8);
    expect(bodies(".fb-chat-message-surface").join(" ")).toContain("max-width:min(100%, 34rem);");
    expect(bodies(".fb-chat-message-surface").join(" ")).not.toContain("2.75rem");
    // A flush media bubble owns no inline padding of its own: 320 - 2*0.8rem =
    // 294.4px. That parent 100% term is narrower than the photo preference and
    // the 3:4 height solve, so it wins and nothing overflows sideways.
    const flushAvailable = 320 - listInline * 2 * REM_PX;
    const paddedAvailable = flushAvailable - bubbleInline * 2 * REM_PX;
    expect(flushAvailable).toBeCloseTo(294.4, 5);
    expect(paddedAvailable).toBeCloseTo(268.8, 5);
    expect(phone.boxWidth).toBeCloseTo(flushAvailable, 5);
    expect(phone.boxWidth).toBeLessThan(320);
    expect(phone.height).toBeLessThan(640);
    // The no-bytes status card keeps the old compact media width inside the
    // padded bubble instead of growing to the photo preference.
    const compact = bodies('.fb-chat-message .fb-chat-photo:not(.fb-chat-photo-grouped):has(> div[role="status"])').join("\n");
    expect(compact).toContain("width:var(--fb-chat-media-width);");
    expect((preferredVwPercent / 100) * 320).toBeLessThanOrEqual(paddedAvailable);
    expect(photoRule()).not.toMatch(/min-width\s*:/);
    expect(bubble).toContain("min-width:0;");
  });

  it("bounds a short viewport with the viewport term", () => {
    const short = photoPaint(1024, 400, 3 / 4);
    expect(short.heightCap).toBeCloseTo(0.8 * 400, 5);
    expect(short.height).toBeCloseTo(short.heightCap, 5);
    expect(short.width).toBeCloseTo(short.heightCap * (3 / 4), 5);
    expect(short.height).toBeLessThan(photoPaint(1024, 900, 3 / 4).height);
  });

  it("bounds a very tall image without stretching it or painting bars", () => {
    const tall = photoPaint(1440, 900, 9 / 16);
    expect(tall.height).toBeCloseTo(capRem * REM_PX, 5);
    expect(tall.width).toBeCloseTo(tall.height * (9 / 16), 5);
    expect(tall.boxWidth).toBeLessThan(photoPreferredRem * REM_PX);
    expect(tall.width / tall.height).toBeCloseTo(9 / 16, 5);
    // The box itself is the picture: 270x480 at the 480px cap, not a 512px
    // frame carrying 121px of background on each side.
    expect(tall.boxWidth).toBeCloseTo(tall.width, 5);
  });

  it("does not clamp a square or a 4:3 landscape at a tall viewport", () => {
    const square = photoPaint(1440, 900, 1);
    expect(square.width).toBeCloseTo(480, 5);
    expect(square.height).toBeCloseTo(480, 5);
    const landscape = photoPaint(1440, 900, 4 / 3);
    expect(landscape.width).toBeCloseTo(512, 5);
    expect(landscape.height).toBeCloseTo(384, 5);
  });

  it("keeps the inline intrinsic ratio and the contain/cover fitting", () => {
    // ChatPhoto's frozen style publishes both the CSS aspect ratio and the
    // numeric ratio the width solve multiplies by; neither key is renamed.
    expect(messagingTsx).toContain("aspectRatio: `${attachment.width} / ${attachment.height}`");
    expect(messagingTsx).toContain('"--fb-chat-photo-ratio": ratio');
    expect(messagingTsx).toContain("const ratio = chatPhotoRatio(attachment);");
    const helper = /function chatPhotoRatio\([\s\S]*?\n\}/.exec(messagingTsx)?.[0] ?? "";
    expect(helper).toContain("const ratio = attachment.width / attachment.height;");
    expect(helper).toContain("Number.isFinite(ratio) && ratio > 0 ? ratio : 1");
    expect(photoRule()).toContain("var(--fb-chat-photo-ratio");
    expect(bodies(".fb-chat-photo img").join("\n")).toContain("object-fit:contain;");
    expect(bodies(".fb-chat-photo-grouped img").join("\n")).toContain("object-fit:cover;");
  });

  it("keeps a wide panorama uncropped, unletterboxed and unclamped", () => {
    const panorama = photoPaint(1440, 900, 4);
    // The preference is a width, not an aspect clamp: a 4:1 picture takes the
    // full 32rem and keeps its ratio, with no invented minimum height.
    expect(panorama.width).toBeCloseTo(512, 5);
    expect(panorama.height).toBeCloseTo(128, 5);
    expect(panorama.height).toBeLessThan(panorama.heightCap);
    expect(Math.abs(panorama.width / panorama.height - 4)).toBeLessThan(1e-9);
    // No invented minimum height and no CSS aspect clamp: the inline ratio and
    // the height cap are the only bounds.
    expect(photoRule()).not.toMatch(/(?:^|[;\s])min-height\s*:/);
    expect(photoRule()).not.toMatch(/aspect-ratio\s*:/);
  });

  it("shrinks through the existing parent chain instead of a fixed minimum", () => {
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    expect(bubble).toContain("min-width:0;");
    const surface = bodies(".fb-chat-message-surface").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    expect(surface).toContain("min-width:0;");
    // The photo box carries its own 100% parent guard beside the preference.
    expect(photoRule()).toContain(", 100%, calc(");
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
    const single = photoRule();
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
    expect(chatCss).toContain('.fb-chat-photo:has(> div[role="status"]) { aspect-ratio:auto !important; }');
    // A standalone no-bytes card keeps the shared media width instead of the
    // wider photo preference, so loading/missing/retry states stay compact and
    // padded. Grouped cells and the gallery own their box and are excluded.
    const compactWidth = bodies('.fb-chat-message .fb-chat-photo:not(.fb-chat-photo-grouped):has(> div[role="status"])').join("\n");
    expect(compactWidth).toContain("width:var(--fb-chat-media-width);");
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

/**
 * R19 flush photo width ownership (deployed 7c5e6489). The surface sizes to
 * `max-content` and the bubble declares no width, so the bubble takes the
 * in-flow photo's contribution. The base photo width carries a percentage,
 * which cannot resolve during intrinsic sizing: the contribution fell back to
 * the bitmap's own width, the 34rem cap set the bubble to 544, and the photo
 * resolved to 512 inside it. The corner chip then anchored to the bubble strip
 * (chip right 1414.4 against the picture right 1387.2). A flush bubble restates
 * the width without that percentage, so the picture owns the width; the
 * absolutely positioned long-press anchor is asserted as the reason no sibling
 * competes for it. Declarations only: rendered acceptance stays in the deployed
 * browser.
 */
describe("R19 flush photo width ownership", () => {
  const flushPhotoSelector = ".fb-chat-message-media:has(> .fb-chat-photo > button) > .fb-chat-photo";
  const flushPhoto = bodies(flushPhotoSelector).join("\n");
  const base = photoRule();
  const surface = bodies(".fb-chat-message-surface").join("\n");
  const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
  const flushBubble = /\.fb-chat-message-media:has\(> \.fb-chat-photo > button\)\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const longPressCss = readFileSync(new URL("../components/longPress.css", import.meta.url), "utf8");

  it("restates a definite photo width inside a flush bubble only", () => {
    expect(flushPhoto).toContain("width:min(var(--fb-chat-photo-width, 32rem), calc(min(30rem, 80vh) * var(--fb-chat-photo-ratio)))");
    // The percentage is the term intrinsic sizing cannot resolve; leaving it in
    // is what let the bitmap, not the box, size the bubble.
    expect(flushPhoto).not.toContain("100%,");
    // Scoped to a flush bubble: captions, status cards, the gallery and the
    // grouped cells keep the base guard.
    expect(flushPhotoSelector).toContain(".fb-chat-message-media:has(> .fb-chat-photo > button)");
    expect(flushPhotoSelector).not.toContain(".fb-chat-gallery");
    expect(base).toContain("width:min(var(--fb-chat-photo-width, 32rem), 100%, calc(min(30rem, 80vh) * var(--fb-chat-photo-ratio)))");
    // The override must win by cascade as well as by specificity. The same
    // selector already exists for `border-radius`, so compare the declaration.
    const overrideAt = chatCss.indexOf("width:min(var(--fb-chat-photo-width, 32rem), calc(");
    const baseAt = chatCss.indexOf(".fb-chat-photo { --fb-chat-photo-ratio");
    expect(overrideAt).toBeGreaterThan(baseAt);
    expect((flushPhotoSelector.match(/\./g) ?? []).length)
      .toBeGreaterThan((".fb-chat-photo".match(/\./g) ?? []).length);
  });

  it("leaves the picture as the only width owner in the flush chain", () => {
    // Surface: max-content context. Bubble: no width of its own. Flush bubble:
    // no width and no padding. The long-press/menu anchor is out of flow.
    expect(surface).toContain("width:max-content;");
    expect(bubble).not.toMatch(/(?:^|[;\s])width\s*:/);
    expect(flushBubble).toContain("padding:0;");
    expect(flushBubble).not.toMatch(/(?:^|[;\s])width\s*:/);
    expect(longPressCss).toMatch(/\.fb-longpress-anchor\s*\{[^}]*position:\s*absolute;/);
    expect(longPressCss).toMatch(/\.fb-longpress-anchor\s*\{[^}]*inset:\s*0;/);
  });

  it("keeps the 34rem figure a maximum and the narrow-pane clamp intact", () => {
    expect(surface).toContain("max-width:min(100%, 34rem);");
    expect(bubble).toContain("max-width:min(100%, 34rem);");
    expect(base).toContain("max-width:100%;");
    // 320px phone: the parent clamp still wins over the definite width, so the
    // flush bubble can never overflow its pane.
    const narrow = photoPaint(320, 640, 1672 / 941);
    expect(narrow.boxWidth).toBeCloseTo(294.4, 5);
    expect(narrow.boxWidth).toBeLessThan(320);
  });

  it("keeps the accepted 1672x941 photo at 512 with no second width", () => {
    const accepted = photoPaint(1440, 900, 1672 / 941);
    expect(accepted.boxWidth).toBeCloseTo(512, 5);
    expect(accepted.height).toBeCloseTo(512 / (1672 / 941), 5);
    expect(accepted.height).toBeGreaterThan(288);
    expect(accepted.height).toBeLessThan(289);
    // The picture box and the bubble now share the one definite width, so the
    // chip's inline-end inset and the picture edge are the same edge.
    expect(flushPhoto).toContain("var(--fb-chat-photo-width, 32rem)");
  });
});

/**
 * R19 inside-corner message menu. The control is a transparent 44px press
 * target, the project's house minimum, anchored flush inside the bubble's
 * top-inline-end corner; a 20px glyph is centred in it. These are declarations
 * read from source, not measured pixels: the reveal may change paint only, the
 * clearance is a fixed paragraph inset scoped to the same fine-pointer query,
 * and the glyph never leaves the bubble. Rendered corners at 320px, wide, RTL,
 * dark and large text remain a deployed-browser check.
 */
describe("R19 inside-corner message menu ownership", () => {
  const options = /\.fb-chat-message-options\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const glyph = /\.fb-chat-message-options > svg\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const disc = /\.fb-chat-message-options::before\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const discPaint = /\.fb-chat-message-options:hover::before[^{}]*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const focus = /\.fb-chat-message > \.fb-chat-message-options:focus-visible\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const fine = /@media \(hover:hover\) and \(pointer:fine\)\s*\{([\s\S]*?)\n\}/.exec(chatCss)?.[1] ?? "";
  const coarse = /@media \(hover: none\), \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/.exec(chatCss)?.[1] ?? "";
  /** Only the reveal rule's declarations; the same query also carries clearance. */
  const reveal = /\.fb-chat-line:hover \.fb-chat-message-options,[\s\S]*?\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";

  /** A rem declaration; a unitless zero (inset:0) still parses as 0. */
  const rem = (body: string, property: string) =>
    Number(new RegExp(`${property}\\s*:\\s*(-?[\\d.]+)(?:rem)?`).exec(body)?.[1] ?? NaN);
  const px = (body: string, property: string) =>
    Number(new RegExp(`${property}\\s*:\\s*(-?[\\d.]+)px`).exec(body)?.[1] ?? NaN);

  it("anchors a 44px press target flush inside the bubble", () => {
    expect(options).toContain("position:absolute;");
    expect(rem(options, "inset-block-start")).toBeGreaterThanOrEqual(0);
    expect(rem(options, "inset-inline-end")).toBeGreaterThanOrEqual(0);
    expect(options).not.toMatch(/inset-(?:block-start|inline-end)\s*:\s*-/);
    expect(rem(options, "width") * 16).toBeGreaterThanOrEqual(44);
    expect(rem(options, "height") * 16).toBeGreaterThanOrEqual(44);
  });

  it("keeps the glyph at 20px and paints no 44px circle", () => {
    expect(rem(glyph, "width") * 16).toBe(20);
    expect(rem(glyph, "height") * 16).toBe(20);
    expect(options).toContain("background:transparent;");
    // No hover paint on the 44px box itself.
    expect(chatCss).not.toMatch(/\.fb-chat-message-options:hover\s*\{[^{}]*background:/);
    // The only hover paint is the glyph-sized disc inside the target.
    expect(disc).toContain("pointer-events:none");
    expect(discPaint).toContain("background:");
    const discHalf = Number(/calc\(50% - ([\d.]+)rem\)/.exec(disc)?.[1] ?? NaN);
    expect(discHalf * 2).toBeCloseTo(rem(glyph, "width"), 5);
  });

  it("no longer moves an emoji or GIF control outside the bubble", () => {
    expect(chatCss).not.toMatch(/\.fb-chat-message-emoji > \.fb-chat-message-options/);
    expect(chatCss).not.toMatch(/\.fb-chat-message-klipy > \.fb-chat-message-options/);
    expect(chatCss).not.toMatch(/\.fb-chat-message-options[^{}]*\{[^{}]*inset-inline-end\s*:\s*-/);
  });

  it("reveals on hover and focus without moving anything", () => {
    expect(reveal).toContain("opacity:1");
    expect(reveal).toContain("pointer-events:auto");
    expect(reveal).not.toMatch(/(?:^|[;{\s])(?:width|height|padding|margin|inset|top|right|left|bottom)\s*:/);
  });

  it("keeps the focused target inside the bubble", () => {
    expect(focus).toContain("outline");
    expect(px(focus, "outline-offset")).toBeLessThan(0);
  });

  it("reserves a fixed paragraph clearance wide enough for the glyph", () => {
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    const bubbleInline = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(bubble)?.[1] ?? 0);
    const box = rem(options, "width") * 16;
    const glyphPx = rem(glyph, "width") * 16;
    // The glyph is centred in the target; only its inner edge reaches the text.
    const intrusion = (box - glyphPx) / 2 + glyphPx - bubbleInline * 16;
    const clearance = Number(/\.fb-chat-message > p:not\(\.fb-chat-emoji-only\)\s*\{\s*padding-right:\s*([\d.]+)rem;/.exec(chatCss)?.[1] ?? NaN) * 16;
    expect(bubbleInline).toBeCloseTo(0.8, 5);
    expect(intrusion).toBeGreaterThan(0);
    expect(clearance).toBeGreaterThanOrEqual(intrusion);
    // The clearance lives in the same fine-pointer query as the reveal, so a
    // touch screen reserves no inset for a control it does not render, and the
    // inset cannot move on hover because it is fixed while the query matches.
    expect(fine).toContain(".fb-chat-message > p:not(.fb-chat-emoji-only) { padding-right:1.25rem; }");
    expect(fine).toContain('[dir="rtl"] .fb-chat-message > p:not(.fb-chat-emoji-only) { padding-right:0; padding-left:1.25rem; }');
    expect(chatCss.match(/\.fb-chat-message > p:not\(\.fb-chat-emoji-only\)/g)).toHaveLength(2);
    // No unconditional copy survives outside the query.
    expect(chatCss.replace(/@media \(hover:hover\) and \(pointer:fine\)\s*\{[\s\S]*?\n\}/, ""))
      .not.toMatch(/\.fb-chat-message > p:not\(\.fb-chat-emoji-only\)/);
    // Emoji-only text is exempt: its sizing and bubble stay untouched.
    expect(chatCss).toMatch(/\.fb-chat-message > p:not\(\.fb-chat-emoji-only\)/);
  });

  it("hides the control from touch and keeps both clearances query-scoped", () => {
    expect(chatCss).toMatch(/@media \(hover: none\), \(pointer: coarse\) \{\s*\.fb-chat-message-options \{ display: none; \}/);
    expect(coarse).toContain("display: none;");
    // A coarse pointer gets no reserve anywhere: the hide block carries no padding.
    expect(coarse).not.toMatch(/padding/);
    expect(chatCss.match(/\[dir="rtl"\] \.fb-chat-message > p:not\(\.fb-chat-emoji-only\)/g)).toHaveLength(1);
  });
});

/**
 * R19 media-only bubble. A photo with no caption, quote, report, location or
 * status control is the message, so it owns the bubble's padding, fill and
 * tail; every other state keeps the readable padded bubble. The flush paint is
 * additionally gated on ChatPhoto actually having bytes to show, so a loading,
 * missing or downloadable photo keeps its in-flow status row instead of a
 * control painted over the picture. These are declarations read from source;
 * rendered pixels remain a deployed-browser check.
 */
describe("R19 media-only bubble ownership", () => {
  const flushSelector = ".fb-chat-message-media:has(> .fb-chat-photo > button)";
  const flush = /\.fb-chat-message-media:has\(> \.fb-chat-photo > button\)\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const flushOwn = /\.fb-chat-message-media:has\(> \.fb-chat-photo > button\)\.fb-chat-message-own\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const overlay = /\.fb-chat-message-media:has\(> \.fb-chat-photo > button\) > \.fb-chat-message-status\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";

  it("takes the padding ring, the fill and the mismatched tail off a bare photo", () => {
    expect(flush).toContain("padding:0;");
    expect(flush).toContain("background:transparent;");
    expect(flush).toContain("overflow:hidden;");
    expect(flush).toContain("border-radius:1rem;");
    expect(flush).not.toContain(".25rem");
    expect(flushOwn).toContain("background:transparent;");
    // The picture inherits the bubble's rounded edge instead of carrying a
    // second, visibly smaller radius inside it.
    expect(chatCss).toContain(`${flushSelector} > .fb-chat-photo { border-radius:inherit; }`);
  });

  it("paints the flush surface only when the picture really exists", () => {
    // A status box (no bytes yet, evicted, failed) or a download control renders
    // no direct `button`, so CSS keeps the ordinary padded bubble there.
    expect(flushSelector).toContain(":has(> .fb-chat-photo > button)");
    expect(bodies(".fb-chat-message").join("\n")).toContain("padding:.6rem .8rem;");
    expect(chatCss).toContain('.fb-chat-photo:has(> div[role="status"]) { aspect-ratio:auto !important; }');
  });

  it("overlays only the passive time and receipt ticks", () => {
    expect(overlay).toContain("position:absolute;");
    expect(overlay).toContain("background:rgb(0 0 0 / .55);");
    expect(overlay).toContain("pointer-events:none;");
    expect(overlay).not.toMatch(/button/);
    // Every padded state keeps the in-flow status row it already had.
    expect(bodies(".fb-chat-message-status").join("\n")).toContain("margin-top:.25rem;");
    expect(chatCss).toContain(`${flushSelector} .fb-chat-ticks.is-read { color:#a9d4ff; }`);
  });

  it("gives the class only to a bare, accepted, control-free photo", () => {
    expect(messagingTsx).toContain('${mediaOnly ? " fb-chat-message-media" : ""}');
    expect(messagingTsx).toContain("const mediaOnly = isMediaOnlyMessage(message, attachment, {");
    expect(messagingTsx)
      .toContain("actionable: !!localFailed || !!reviewMember || !!failedMember || removableMembers.length > 0,");
    const predicate = functionSource(messagingTsx, "isMediaOnlyMessage");
    expect(predicate).toContain('message.messageType !== "MEDIA"');
    expect(predicate).toContain("if (status.actionable) return false;");
    expect(predicate).toContain('attachment.state === "READY" || attachment.state === "EVICTED"');
    expect(predicate).toContain("message.replyToId");
    expect(predicate).toContain("message.contextReportId");
  });

  it("bounds a Klipy sticker without cropping it or rewriting its source", () => {
    const klipy = /\.fb-chat-message \.fb-chat-klipy\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
    expect(klipy).toContain("max-width:min(100%, var(--fb-chat-media-width));");
    expect(klipy).toContain("width:auto;");
    expect(klipy).toContain("height:auto;");
    expect(klipy).not.toContain("object-fit");
    expect(klipy).not.toContain("aspect-ratio");
    // The same 78vw term keeps a sticker inside the gutters of a 320px phone.
    expect((preferredVwPercent / 100) * 320 + 2 * 0.8 * REM_PX).toBeLessThanOrEqual(320);
    expect(messagingTsx).toContain("src={message.body.trim()}");
  });
});

/**
 * R19 flush-photo affordance paint. The photo button fills the flush bubble, so
 * a positive-offset focus ring is clipped by the bubble's overflow guard; the
 * ring moves inside the picture edge with a white backplate so it survives a
 * same-coloured photo. The corner menu keeps its 20px glyph disc and takes the
 * compact time-chip scrim instead of painting the 44px target. The passive
 * metadata keeps the .75rem scale. Declarations only: rendered paint remains a
 * deployed-browser check.
 */
describe("R19 flush photo focus and menu contrast", () => {
  const flushSelector = ".fb-chat-message-media:has(> .fb-chat-photo > button)";
  const photoFocus = bodies(".fb-chat-page .fb-chat-photo > button:focus-visible").join("\n");
  const photoRing = bodies(".fb-chat-page .fb-chat-photo > button:focus-visible img").join("\n");
  const disc = bodies(`${flushSelector} .fb-chat-message-options::before`).join("\n");
  const discHover = bodies(`${flushSelector} .fb-chat-message-options:hover::before`).join("\n");
  const discFocus = bodies(`${flushSelector} .fb-chat-message-options:focus-visible::before`).join("\n");
  const glyph = bodies(`${flushSelector} .fb-chat-message-options`).join("\n");
  const glyphFocus = bodies(`${flushSelector} .fb-chat-message-options:focus-visible`).join("\n");
  const overlay = bodies(`${flushSelector} > .fb-chat-message-status`).join("\n");

  it("draws the photo focus ring inside the clipped picture edge", () => {
    expect(photoFocus).toContain("outline:2px solid var(--fb-focus)");
    expect(photoFocus).toContain("outline-offset:-3px");
    expect(photoFocus).toContain("border-radius:inherit");
    // The white contrast ring rides on the image, above the picture pixels.
    expect(photoRing).toContain("outline:1px solid rgb(255 255 255 / .85)");
    expect(photoRing).toContain("outline-offset:-1px");
    expect(photoRing).toContain("border-radius:inherit");
    // The app-wide ring still serves every other control.
    expect(chatCss).toContain(".fb-chat-page :is(button,a,textarea):focus-visible { outline:2px solid var(--fb-focus); outline-offset:2px; }");
    expect(photoFocus).not.toMatch(/outline\s*:\s*none/);
    // The picture keeps the house minimum press target.
    expect(bodies(".fb-chat-photo > button").join("\n")).toContain("min-width:44px;");
    expect(bodies(".fb-chat-photo > button").join("\n")).toContain("min-height:44px;");
  });

  it("keeps the 20px menu disc and gives it the time-chip scrim on a photo", () => {
    expect(glyph).toContain("color:#fff;");
    expect(disc).toContain("background:rgb(0 0 0 / .55);");
    // The scrim never resizes or repaints the 44px press target.
    expect(disc).not.toMatch(/(?:^|[;\s])(?:inset|width|height|padding)\s*:/);
    expect(discHover).toContain("background:");
    expect(discFocus).toContain("background:");
    expect(glyphFocus).toContain("box-shadow:inset");
    const base = /\.fb-chat-message-options::before\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
    expect(base).toContain("inset:calc(50% - .625rem)");
    expect(chatCss).not.toMatch(/\.fb-chat-message-options:hover\s*\{[^{}]*background:/);
    expect(bodies(".fb-chat-message-options").join("\n")).toContain("background:transparent;");
  });

  it("keeps the overlay metadata on the existing .75rem type scale", () => {
    expect(overlay).toContain("font-size:.75rem;");
    expect(overlay).toContain("background:rgb(0 0 0 / .55);");
    expect(overlay).toContain("pointer-events:none;");
    expect(chatCss).toContain(`${flushSelector} .fb-chat-ticks.is-read { color:#a9d4ff; }`);
  });
});

/**
 * R19 programmatic heading focus. ChatIdentity focuses its h1 on mount so
 * assistive tech announces the conversation; that is not keyboard navigation,
 * so it must not paint the global ring across the whole flexible heading row.
 * The identity link inside the heading and every real control keep their rings.
 * Mirrors the app bar and Settings heading exception.
 */
describe("R19 chat heading focus exception", () => {
  const headingFocus = bodies('.fb-chat-heading h1[tabindex="-1"]:focus').join("\n");
  const headingFocusVisible = bodies('.fb-chat-heading h1[tabindex="-1"]:focus-visible').join("\n");
  const chatIdentityTsx = readFileSync(new URL("../components/ChatIdentity.tsx", import.meta.url), "utf8");

  it("suppresses only the programmatic heading ring", () => {
    expect(headingFocus).toContain("outline:none;");
    expect(headingFocusVisible).toContain("outline:none;");
    expect(chatCss).not.toMatch(/\.fb-chat-heading[^{}]*:is\([^)]*button/);
    expect(chatCss).not.toMatch(/\.fb-chat-identity[^{]*\{[^{}]*outline\s*:\s*none/);
    // The heading, its announcement focus and the identity link are unchanged.
    expect(chatIdentityTsx).toContain('className="fb-chat-heading"');
    expect(chatIdentityTsx).toContain("tabIndex={-1}");
    expect(chatIdentityTsx).toContain("focus({ preventScroll: true })");
    expect(chatIdentityTsx).toContain("UserIdentityTrigger");
    expect(chatCss).toContain(".fb-chat-page :is(button,a,textarea):focus-visible { outline:2px solid var(--fb-focus); outline-offset:2px; }");
  });
});

/**
 * R19 transcript alignment area. The transcript spans the thread's own inline
 * gutters instead of a centred 48rem rail; the 34rem bubble cap still bounds the
 * readable measure. The composer is not part of this rail: its own stylesheet
 * gives the real root `width: 100%`, so the screen must not clamp it.
 */
describe("R19 transcript alignment area", () => {
  it("lets the transcript own the pane gutters", () => {
    expect(chatCss).not.toContain(".fb-chat-messages > * { width: 100%;");
    expect(chatCss)
      .toContain(".fb-chat-messages > *:not(.fb-chat-transcript) { width: 100%; max-width: var(--fb-chat-rail-width); margin-inline: auto; }");
    expect(chatCss).toContain(".fb-chat-transcript { width: 100%; }");
  });

  it("keeps the readable text cap and the composer's own full width", () => {
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    expect(bubble).toContain("padding:.6rem .8rem;");
    expect(chatCss).toContain(".fb-chat-page { --fb-chat-rail-width: 48rem; }");
    // The composer root is the authority on composer width: `peerComposer.css`
    // declares 100% of the pane and no max-width, so a wide screen keeps the
    // composer full width. Chat only styles the transcript, and the retired
    // `.fb-composer-shell` selector never matched the real `form.fb-peer-composer`.
    const composerRoot = bodiesFor(peerComposerRules, ".fb-peer-composer").join("\n");
    expect(composerRoot).toContain("width: 100%;");
    expect(composerRoot).not.toMatch(/(?:^|[;\s])max-width\s*:/);
    expect(chatCss).not.toContain("fb-composer-shell");
    expect(chatCss).not.toMatch(/\.fb-chat-page\s*>\s*\.fb-peer-composer/);
  });
});

/**
 * R19 surface fit, scroll ownership and the read tick. The long-press surface
 * is the shared box the menu anchors to, so it may not run wider than the
 * bubble it wraps; the transcript owner lives in its own hook module and keeps
 * its fallback listener outside the ResizeObserver branch; and the media-only
 * read tick has to stay legible on the worst scrim without relying on colour
 * alone. Declarations and arithmetic only: pixels remain a browser check.
 */
describe("R19 surface fit and scroll ownership", () => {
  function luminance(hex: string) {
    const digits = hex.replace("#", "");
    const linear = [0, 2, 4].map((index) => {
      const channel = parseInt(digits.slice(index, index + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  }
  function contrast(foreground: string, background: string) {
    const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
    return (values[0]! + 0.05) / (values[1]! + 0.05);
  }

  it("fits the shared long-press surface to the bubble it wraps", () => {
    const surface = bodies(".fb-chat-message-surface").join("\n");
    expect(surface).toContain("width:max-content;");
    expect(surface).toContain("max-width:min(100%, 34rem);");
    expect(surface).toContain("min-width:0;");
    expect(surface).toContain("display:flex;");
    // The child bubble keeps the same cap, so the anchor box and the painted
    // bubble can never disagree about how wide the message is.
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    expect(bubble).toContain("padding:.6rem .8rem;");
    // Voice sets its own width and a short text bubble keeps its natural width,
    // because max-content beats stretching to the cap.
    expect(chatCss).toContain("max-width:min(100%, 34rem);");
  });

  it("keeps one scroll owner in a hook module, not in the screen", () => {
    expect(messagingTsx).toContain('"../hooks/useTranscriptAnchor"');
    expect(messagingTsx).not.toContain("export function useTranscriptAnchor");
    expect(transcriptHook).toContain("export function useTranscriptAnchor");
    expect(transcriptHook).toContain("export const FOLLOW_PX");
    expect(transcriptHook).toContain("export const JUMP_PX");
  });

  it("adopts every owned write as the scroll baseline", () => {
    const writes = transcriptHook.match(/lastScrollTop\.current = area\.scrollTop;/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(3);
    // The restore pads its own write before the browser can echo it back.
    const restoreAt = transcriptHook.indexOf("const restore = useCallback");
    const restoreWrite = transcriptHook.indexOf("lastScrollTop.current = area.scrollTop;", restoreAt);
    expect(restoreWrite).toBeGreaterThan(restoreAt);
    // A queued frame folds in an unobserved move before it restores anything.
    const frameAt = transcriptHook.indexOf("frame = window.requestAnimationFrame");
    const intentAt = transcriptHook.indexOf("readScrollIntent(true);", frameAt);
    const distanceAt = transcriptHook.indexOf("distanceListener.current?.(restore());", frameAt);
    expect(intentAt).toBeGreaterThan(frameAt);
    expect(distanceAt).toBeGreaterThan(intentAt);
  });

  it("attaches the image-load fallback even without ResizeObserver", () => {
    const loadAt = transcriptHook.indexOf('area.addEventListener("load", settle, true)');
    const observerAt = transcriptHook.indexOf('typeof ResizeObserver === "function"');
    expect(loadAt).toBeGreaterThan(-1);
    expect(observerAt).toBeGreaterThan(loadAt);
    expect(transcriptHook).toContain("observer?.disconnect();");
  });

  it("keeps the media read tick legible and never colour-only", () => {
    // Worst case is the scrim over a white photo: .55 black over #fff.
    const scrim = Math.round(255 * 0.45).toString(16).padStart(2, "0");
    const worstScrim = `#${scrim}${scrim}${scrim}`;
    expect(contrast("#a9d4ff", worstScrim)).toBeGreaterThanOrEqual(3);
    expect(contrast("#ffffff", worstScrim)).toBeGreaterThanOrEqual(4.5);
    // The glyph keeps the second check and its spoken label.
    expect(messagingTsx).toContain("{read && <path");
    expect(messagingTsx).toContain('aria-label={read ? "Read" : "Sent"}');
  });
});
