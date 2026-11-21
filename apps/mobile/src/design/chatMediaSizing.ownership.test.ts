// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for R19 photo, GIF and sticker sizing.
 *
 * jsdom has no layout engine, so this file cannot measure a rendered photo.
 * It pins the declared mechanism and evaluates its bounds as a paint model:
 * one 70% message cap written once against the usable transcript, a compact
 * shared preview whose caps are lengths (so a 200% text setting cannot inflate
 * them), a photo-only width preference inside the same bubble cap, the unitless
 * inline ratio that shrinks the box until it fits the shared height bound (so
 * the contain-fitted picture paints edge to edge with no letterbox bars), a
 * flush bubble whose width owner is the picture box rather than the bitmap's
 * intrinsic width, a direct-child message photo override that gives a padded,
 * captioned bubble that same definite width, an expressive bubble whose own
 * plain-length cap bounds the max-content measurement that a percentage cap
 * could not, a compact status branch that keeps the shared preview width and
 * no intrinsic ratio, the existing parent width chain, and the unchanged group
 * arrangements.
 *
 * The deployed page is `border-box` everywhere: `src/main.tsx` imports
 * `src/index.css`, whose first line is `@import "tailwindcss"`, and Tailwind
 * Preflight's base layer declares `*,:after,:before,::backdrop{box-sizing:border-box}`.
 * Every declared max-width below is therefore a border box. A padded bubble
 * hands its picture the cap minus its own side padding, so a captioned photo's
 * definite width is clamped by the base `max-width:100%`; a flush media-only
 * bubble declares `padding:0` and takes the whole cap. Rendered geometry
 * remains a deployed browser acceptance item, not a claim from this file.
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

/** The single photo box: its own preference and the ratio-aware shrink. */
function photoRule() {
  return bodies(".fb-chat-photo").find(body => body.includes("width:min(var(--fb-chat-photo-width")) ?? "";
}

/** Bounds read from the source, not measured pixels. */
const REM_PX = 16;
const MEDIA_WIDTH_PATTERN = /--fb-chat-media-width\s*:\s*([\d.]+)px\s*;/;
const PHOTO_WIDTH_PATTERN = /--fb-chat-photo-width\s*:\s*([\d.]+)px\s*;/;
const PHOTO_HEIGHT_PATTERN = /--fb-chat-photo-height\s*:\s*min\(([\d.]+)px,\s*([\d.]+)vh\)\s*;/;
const KLIPY_WIDTH_PATTERN = /--fb-chat-klipy-width\s*:\s*([\d.]+)px\s*;/;
const KLIPY_HEIGHT_PATTERN = /--fb-chat-klipy-height\s*:\s*min\(([\d.]+)px,\s*([\d.]+)vh\)\s*;/;
const STICKER_WIDTH_PATTERN = /--fb-chat-sticker-width\s*:\s*([\d.]+)px\s*;/;
const STICKER_HEIGHT_PATTERN = /--fb-chat-sticker-height\s*:\s*min\(([\d.]+)px,\s*([\d.]+)vh\)\s*;/;
const MESSAGE_CAP_PATTERN = /\.fb-chat-line > \.fb-chat-line-row \{ max-width:([\d.]+)%; \}/;

const mediaWidth = MEDIA_WIDTH_PATTERN.exec(chatCss);
const photoWidth = PHOTO_WIDTH_PATTERN.exec(chatCss);
const photoHeight = PHOTO_HEIGHT_PATTERN.exec(chatCss);
const klipyWidth = KLIPY_WIDTH_PATTERN.exec(chatCss);
const klipyHeight = KLIPY_HEIGHT_PATTERN.exec(chatCss);
const stickerWidth = STICKER_WIDTH_PATTERN.exec(chatCss);
const stickerHeight = STICKER_HEIGHT_PATTERN.exec(chatCss);
const messageCap = MESSAGE_CAP_PATTERN.exec(chatCss);

const mediaWidthPx = Number(mediaWidth?.[1] ?? 0);
const photoWidthPx = Number(photoWidth?.[1] ?? 0);
const photoHeightPx = Number(photoHeight?.[1] ?? 0);
const photoHeightVh = Number(photoHeight?.[2] ?? 0);
const klipyWidthPx = Number(klipyWidth?.[1] ?? 0);
const klipyHeightPx = Number(klipyHeight?.[1] ?? 0);
const klipyHeightVh = Number(klipyHeight?.[2] ?? 0);
const stickerWidthPx = Number(stickerWidth?.[1] ?? 0);
const stickerHeightPx = Number(stickerHeight?.[1] ?? 0);
const stickerHeightVh = Number(stickerHeight?.[2] ?? 0);
const messageCapPercent = Number(messageCap?.[1] ?? 0);

/** The transcript's inline padding, read from `.fb-chat-messages`. */
const listRule = bodies(".fb-chat-messages").find(body => body.includes("padding:.5rem .8rem;")) ?? "";
const listPaddingRem = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(listRule)?.[1] ?? 0);

/** The expressive bubble's side padding, read from `.fb-chat-message-klipy`. */
const klipyBubbleRule = bodies(".fb-chat-message-klipy").find(body => body.includes("padding:0 .1rem;")) ?? "";
const klipyPaddingPx = Number(/padding:0 ([\d.]+)rem;/.exec(klipyBubbleRule)?.[1] ?? 0) * REM_PX;

/**
 * The padded bubble's side padding, read from `.fb-chat-message`. Tailwind
 * Preflight (`src/index.css` imports `tailwindcss`, whose base layer declares
 * `* { box-sizing:border-box }`) makes this padding part of the declared
 * max-width, so a 544px bubble carries 518.4px of picture width, not 544.
 */
const bubbleRule = bodies(".fb-chat-message").find(body => body.includes("padding:.6rem .8rem;")) ?? "";
const bubblePaddingPx = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(bubbleRule)?.[1] ?? 0) * REM_PX;

/**
 * What a message may occupy. `scrollerWidth` is the message scroller's
 * clientWidth, the number the deployed pane reports: the 70% cap resolves
 * against the transcript's content box, never the window, so a split pane, a
 * phone and a full-width monitor all read the same rule.
 */
function transcript(scrollerWidth: number) {
  const usable = scrollerWidth - 2 * listPaddingRem * REM_PX;
  return { usable, cap: (usable * messageCapPercent) / 100 };
}

/**
 * The paint model of the declared photo bounds: ratio is width / height.
 * The deployed page is `border-box` everywhere (Tailwind Preflight), so a
 * declared max-width bounds the bubble's border box. A bare painted photo
 * bubble is the flush media-only bubble, `.fb-chat-message-media:has(>
 * .fb-chat-photo > button)`, which declares `padding:0`: the cap is all picture,
 * which is why `flush` is the default. A captioned or otherwise padded bubble
 * keeps the base `.fb-chat-message` padding, so the definite photo width is
 * clamped by that content box; a no-bytes card instead takes the shared media
 * width and no ratio solve. The photo preference, the one 70% message cap, the
 * readable 34rem measure, that padding and the height bound times the inline
 * ratio compete, and the smallest wins. A tall picture therefore narrows until
 * it fits the bound, so the box and the contain-fitted image agree. This is
 * arithmetic on declared values, not layout measurement.
 */
function photoPaint(scrollerWidth: number, viewportHeight: number, ratio: number, flush = true) {
  const { usable, cap } = transcript(scrollerWidth);
  const heightCap = Math.min(photoHeightPx, (photoHeightVh / 100) * viewportHeight);
  const bubbleCap = Math.min(cap, 34 * REM_PX);
  const content = flush ? bubbleCap : bubbleCap - 2 * bubblePaddingPx;
  const boxWidth = Math.min(photoWidthPx, content, heightCap * ratio);
  return { boxWidth, bubbleCap, content, heightCap, usable, width: boxWidth, height: boxWidth / ratio };
}

/** The caps an expressive picture may read, per the kind the sender preserved. */
function expressiveCaps(viewportHeight: number) {
  const height = (px: number, vh: number) => Math.min(px, (vh / 100) * viewportHeight);
  return {
    unknown: { width: klipyWidthPx, height: height(klipyHeightPx, klipyHeightVh) },
    gif: { width: photoWidthPx, height: height(photoHeightPx, photoHeightVh) },
    sticker: { width: stickerWidthPx, height: height(stickerHeightPx, stickerHeightVh) },
  };
}

/**
 * The paint model of one bare Klipy picture. The page is `border-box`
 * everywhere, so the bubble's plain-length cap is a border-box width: a 192px
 * cap leaves 188.8px of picture after the declared 0.1rem side padding. That
 * plain length is what bounds the max-content measurement, because a percentage
 * cap cannot resolve there; the picture's own percentage then only shrinks it
 * inside a narrow pane. A replaced element under a max-height bound shrinks
 * along its own ratio, so nothing is squashed. This is arithmetic on declared
 * values, not a layout measurement.
 */
function klipyPaint(
  scrollerWidth: number,
  natural: { width: number; height: number },
  cap: { width: number; height: number },
) {
  const { usable, cap: messageCapPx } = transcript(scrollerWidth);
  const rowMax = Math.min(messageCapPx, 34 * REM_PX);
  const bubbleMax = Math.min(cap.width, 34 * REM_PX);
  const outerLimit = Math.min(bubbleMax, rowMax);
  // The cap is the border box; the row may clamp it further.
  const needed = Math.min(natural.width, cap.width) + 2 * klipyPaddingPx;
  const bubble = Math.min(needed, outerLimit);
  const content = bubble - 2 * klipyPaddingPx;
  let width = Math.min(natural.width, cap.width, content);
  let height = (width * natural.height) / natural.width;
  if (height > cap.height) {
    height = cap.height;
    width = (height * natural.width) / natural.height;
  }
  return { usable, rowMax, bubbleMax, outerLimit, content, bubble, width, height };
}

describe("R19 chat photo sizing ownership", () => {
  it("keeps one shared preview scale and a photo preference that matches it", () => {
    expect(chatCss.match(/--fb-chat-media-width\s*:/g)).toHaveLength(1);
    expect(bodies(".fb-chat-page").some(body => MEDIA_WIDTH_PATTERN.test(body))).toBe(true);
    expect(mediaWidthPx).toBe(320);
    // 20rem at the default root: the owner's compact preview, written as a
    // length so a 200% text setting cannot inflate it past the row it must fit.
    expect(mediaWidthPx).toBe(20 * REM_PX);
    // Photos opt into their own preference without editing the token that video,
    // files, stickers and the grouped grid read, and they stay under the
    // existing 34rem bubble/surface cap.
    expect(chatCss.match(/--fb-chat-photo-width\s*:/g)).toHaveLength(1);
    expect(photoWidthPx).toBe(320);
    expect(photoWidthPx).toBeLessThan(34 * REM_PX);
    expect(withWidth(".fb-chat-photo-grid")).toContain("var(--fb-chat-media-width)");
    expect(photoRule()).not.toContain("--fb-chat-media-width");
    // The superseded sizing is gone: no viewport-fraction preview, no wider
    // photo preference that outgrew the bubble beside it, and no 30rem/80vh
    // height cap that let one picture fill the screen.
    expect(chatCss).not.toMatch(/min\(15rem, 65vw\)/);
    expect(chatCss).not.toMatch(/min\(18rem, 78vw\)/);
    expect(chatCss).not.toMatch(/--fb-chat-photo-width:\s*32rem/);
    expect(chatCss).not.toMatch(/min\(30rem, 80vh\)/);
    expect(chatCss).not.toMatch(/--fb-chat-media-width:\s*min\(/);
  });

  it("gives a single photo its own preference without losing its bounds", () => {
    const single = photoRule();
    expect(single).toContain("max-width:100%;");
    expect(single).toContain("max-height:var(--fb-chat-photo-height");
    expect(single).toContain("100%,");
    expect(single).toContain("var(--fb-chat-photo-ratio");
    expect(single).not.toContain("max-height:20rem;");
    expect(single).not.toMatch(/max-height\s*:\s*none/);
    expect(single).not.toMatch(/min-width\s*:/);
    expect(single.match(/(?:^|[;\s])width\s*:/g)).toHaveLength(1);
    // The details gallery keeps its own 20rem cap, so the shared photo bound
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

  it("shrinks the box by the inline ratio so the height bound never letterboxes", () => {
    const single = photoRule();
    // --fb-chat-photo-ratio is the unitless width/height number ChatPhoto
    // publishes on the same inline style as attachment.width / attachment.height;
    // the 1 default matches its invalid-dimensions fallback.
    expect(single).toContain("--fb-chat-photo-ratio: 1;");
    expect(single).toContain("width:min(var(--fb-chat-photo-width, 320px), 100%, calc(var(--fb-chat-photo-height, min(320px, 50vh)) * var(--fb-chat-photo-ratio)))");
    expect(messagingTsx).toContain("aspectRatio: String(ratio)");
    expect(photoHeightPx).toBe(320);
    expect(photoHeightVh).toBe(50);
  });

  it("bounds a 3:4 portrait to the shared height bound at desktop", () => {
    const desktop = photoPaint(804, 727, 3 / 4);
    // The 320px bound times 3/4 gives a 240x320 box: the owner's compact
    // preview, and the contain-fitted picture fills the box exactly.
    expect(desktop.boxWidth).toBeCloseTo(240, 5);
    expect(desktop.height).toBeCloseTo(320, 5);
    expect(desktop.width).toBeCloseTo(desktop.boxWidth, 5);
    expect(Math.abs(desktop.width / desktop.height - 3 / 4)).toBeLessThan(1e-9);
    // The row's 70% and the readable 34rem measure are both maxima above it.
    expect(desktop.usable).toBeCloseTo(778.4, 5);
    // The 34rem cap is a border box. A painted photo bubble is flush and
    // declares no padding, so the picture gets all 544px; the base bubble's
    // 12.8px gutter each side would leave 518.4px, which only a padded
    // no-bytes card sees.
    expect(desktop.bubbleCap).toBeCloseTo(544, 5);
    expect(desktop.content).toBeCloseTo(544, 5);
    expect(desktop.bubbleCap - 2 * bubblePaddingPx).toBeCloseTo(518.4, 5);
  });

  it("keeps a 320px phone inside the viewport without overflowing the bubble", () => {
    const phone = photoPaint(320, 640, 3 / 4);
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    const bubbleInline = Number(/padding:[\d.]+rem ([\d.]+)rem;/.exec(bubble)?.[1] ?? 0);
    expect(listPaddingRem).toBe(0.8);
    expect(bubbleInline).toBe(0.8);
    expect(bodies(".fb-chat-message-surface").join(" ")).toContain("max-width:min(100%, 34rem);");
    expect(bodies(".fb-chat-message-surface").join(" ")).not.toContain("2.75rem");
    // The deployed 320 base: a 320 scroller with its 0.8rem gutters leaves
    // 294.4px and the one 70% cap is 206.08px of border box. A painted photo
    // bubble is the flush media-only bubble, so `padding:0` leaves the picture
    // the whole 206.08px. Only a no-bytes card keeps the base 12.8px gutter
    // each side, and its content bound is 180.48px; the card takes the shared
    // media width and is clamped by that bound, it never runs the ratio solve.
    expect(phone.usable).toBeCloseTo(294.4, 5);
    expect(phone.bubbleCap).toBeCloseTo(206.08, 5);
    expect(phone.boxWidth).toBeCloseTo(206.08, 5);
    expect(phone.boxWidth).toBeLessThan(320);
    expect(phone.height).toBeLessThan(640);
    const padded = photoPaint(320, 640, 3 / 4, false);
    expect(padded.bubbleCap - 2 * bubblePaddingPx).toBeCloseTo(180.48, 5);
    expect(padded.content).toBeCloseTo(180.48, 5);
    // The no-bytes status card keeps the shared preview width inside the padded
    // bubble instead of growing to the photo preference.
    const compact = bodies('.fb-chat-message .fb-chat-photo:not(.fb-chat-photo-grouped):has(> div[role="status"])').join("\n");
    expect(compact).not.toContain("width:var(--fb-chat-media-width);");
    expect(mediaWidthPx).toBe(320);
    expect(photoRule()).not.toMatch(/min-width\s*:/);
    expect(bubble).toContain("min-width:0;");
  });

  it("bounds a short viewport with the viewport term", () => {
    const short = photoPaint(1024, 400, 3 / 4);
    expect(short.heightCap).toBeCloseTo((photoHeightVh / 100) * 400, 5);
    expect(short.height).toBeCloseTo(short.heightCap, 5);
    expect(short.width).toBeCloseTo(short.heightCap * (3 / 4), 5);
    expect(short.height).toBeLessThan(photoPaint(1024, 900, 3 / 4).height);
  });

  it("bounds a very tall image without stretching it or painting bars", () => {
    const tall = photoPaint(1440, 900, 9 / 16);
    expect(tall.height).toBeCloseTo(photoHeightPx, 5);
    expect(tall.width).toBeCloseTo(180, 5);
    expect(tall.boxWidth).toBeLessThan(photoWidthPx);
    expect(tall.width / tall.height).toBeCloseTo(9 / 16, 5);
    // The box itself is the picture: 180x320 at the 320px bound, not a 320px
    // frame carrying background on each side.
    expect(tall.boxWidth).toBeCloseTo(tall.width, 5);
  });

  it("does not clamp a square or a 4:3 landscape at a tall viewport", () => {
    const square = photoPaint(1440, 900, 1);
    expect(square.width).toBeCloseTo(320, 5);
    expect(square.height).toBeCloseTo(320, 5);
    const landscape = photoPaint(1440, 900, 4 / 3);
    expect(landscape.width).toBeCloseTo(320, 5);
    expect(landscape.height).toBeCloseTo(240, 5);
  });

  it("keeps the inline intrinsic ratio and the contain/cover fitting", () => {
    // ChatPhoto's frozen style publishes both the CSS aspect ratio and the
    // numeric ratio the width solve multiplies by; neither key is renamed.
    expect(messagingTsx).toContain("aspectRatio: String(ratio)");
    expect(messagingTsx).toContain('"--fb-chat-photo-ratio": ratio');
    expect(messagingTsx).toContain("const ratio = chatPhotoRatio(attachment);");
    const helper = /function chatPhotoRatio\([\s\S]*?\n\}/.exec(messagingTsx)?.[0] ?? "";
    expect(helper).toContain("const ratio = attachment.width / attachment.height;");
    expect(helper).toContain("attachment.width > 0 && attachment.height > 0 && Number.isFinite(ratio) ? ratio : 4 / 3");
    expect(photoRule()).toContain("var(--fb-chat-photo-ratio");
    expect(bodies(".fb-chat-photo img").join("\n")).toContain("object-fit:contain;");
    expect(bodies(".fb-chat-photo-grouped img").join("\n")).toContain("object-fit:cover;");
  });

  it("keeps a wide panorama uncropped, unletterboxed and unclamped", () => {
    const panorama = photoPaint(1440, 900, 4);
    // The preference is a width, not an aspect clamp: a 4:1 picture takes the
    // full preview width and keeps its ratio, with no invented minimum height.
    expect(panorama.width).toBeCloseTo(320, 5);
    expect(panorama.height).toBeCloseTo(80, 5);
    expect(panorama.height).toBeLessThan(panorama.heightCap);
    expect(Math.abs(panorama.width / panorama.height - 4)).toBeLessThan(1e-9);
    // No invented minimum height and no CSS aspect clamp: the inline ratio and
    // the height bound are the only bounds.
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
    expect(status).toContain("min-height:0;");
    expect(status).toContain("overflow:auto;");
    expect(status).toContain("padding:.5rem;");
  });

  it("keeps a photo with no bytes compact instead of reserving the ratio", () => {
    const compact = bodies('.fb-chat-photo:has(> div[role="status"])').join("\n");
    expect(compact).not.toContain("aspect-ratio:auto");
    // A standalone no-bytes card keeps the shared preview width instead of a
    // photo-shaped box, so loading/missing/retry states stay compact and padded.
    // Grouped cells and the gallery own their box and are excluded.
    const compactWidth = bodies('.fb-chat-message .fb-chat-photo:not(.fb-chat-photo-grouped):has(> div[role="status"])').join("\n");
    expect(compactWidth).not.toContain("width:var(--fb-chat-media-width);");
    // ChatPhoto is the only owner of this root: a painted photo renders a
    // button, the no-bytes branch renders the div this selector requires.
    expect(messagingTsx).toContain('className="fb-chat-photo"');
    expect(messagingTsx).toContain('<div role="status">');
    expect(messagingTsx).toContain('<button type="button" aria-label={openLabel}');
    expect(messagingTsx).toContain('const openLabel = overflowCount && overflowCount > 0 ? `View photo, ${overflowCount} more` : "View photo";');
    expect(messagingTsx).not.toContain('"aria-label": `View photo');
    // The compact branch keeps its existing minimum and the base box keeps no
    // filler height of its own.
    expect(bodies(".fb-chat-photo > div").join("\n")).toContain("overflow:auto;");
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

    // The height bound is read from the token, so a decoy declaration on the
    // box itself can never satisfy it.
    const capDecoy = ".fb-chat-photo:hover { max-height:min(30rem, 80vh); }\n"
      + ".fb-chat-photo { max-height:20rem; }";
    const base = bodiesFor(cssRules(capDecoy), ".fb-chat-photo")[0] ?? "";
    expect(base).toContain("max-height:20rem;");
    expect(PHOTO_HEIGHT_PATTERN.test(base)).toBe(false);

    const minHeightDecoy = ".fb-chat-photo { min-height:min(320px, 50vh); }";
    expect(PHOTO_HEIGHT_PATTERN.test(minHeightDecoy)).toBe(false);
    expect(MESSAGE_CAP_PATTERN.test(".fb-chat-line-row { max-width:100%; }")).toBe(false);
  });
});

/**
 * R19 one 70% message cap. The row is the only element that reads the
 * percentage, and its containing block is the full-width line, so the cap
 * resolves once against the usable transcript. The line keeps the pane width so
 * an own message still ends on the opposite edge, and every box below the row
 * reads 100% of what it is given, so the cap cannot compound.
 */
describe("R19 one 70% message cap", () => {
  it("writes the cap once, on the row whose containing block is the line", () => {
    expect(messageCapPercent).toBe(70);
    expect(chatCss.match(/max-width:70%/g)).toHaveLength(2);
    // The line keeps the full pane width and the own/received edges.
    expect(bodies(".fb-chat-line").join("\n")).toContain("max-width:100%;");
    expect(bodies(".fb-chat-line-own").join("\n")).toContain("flex-direction:row-reverse;");
    // Nothing inside the row repeats the percentage.
    expect(bodies(".fb-chat-message-surface").join("\n")).not.toContain("70%");
    expect(bodies(".fb-chat-message").join("\n")).not.toContain("70%");
    expect(bodies(".fb-chat-photo").join("\n")).not.toContain("70%");
    expect(bodies(".fb-chat-photo-grid").join("\n")).not.toContain("70%");
  });

  it("gives an album the same single cap and keeps its cells at 100%", () => {
    expect(withWidth(".fb-chat-run")).toContain("max-width:70%;");
    expect(bodies(".fb-chat-run > .fb-chat-line-row").join("\n")).toContain("align-items:flex-start;");
    expect(bodies(".fb-chat-run .fb-chat-message-surface").join("\n")).toContain("width:100%;");
    expect(chatCss).not.toMatch(/\.fb-chat-run > \.fb-chat-line-row \{[^}]*max-width:70%/);
    expect(bodies(".fb-chat-run-own").join("\n")).toContain("margin-inline-start:auto;");
  });

  it("resolves the cap against the transcript at every pane width", () => {
    for (const scroller of [320, 390, 804, 1112]) {
      const { usable, cap } = transcript(scroller);
      expect(usable).toBeCloseTo(scroller - 25.6, 5);
      expect(cap).toBeCloseTo(usable * 0.7, 5);
      expect(cap).toBeLessThanOrEqual(usable);
    }
    // The deployed numbers: a 320 pane allows 294.4px and 206.08px per message;
    // the 1440 desktop pane allows 778.4px and 544.88px, where the readable
    // 34rem (544px) measure binds first.
    expect(transcript(320).cap).toBeCloseTo(206.08, 5);
    expect(transcript(390).cap).toBeCloseTo(255.08, 5);
    expect(transcript(804).cap).toBeCloseTo(544.88, 5);
    expect(transcript(1112).cap).toBeCloseTo(760.48, 5);
    const desktop = photoPaint(804, 727, 1672 / 941, true);
    const wide = photoPaint(1112, 727, 1672 / 941, true);
    const full = photoPaint(2000, 1250, 1672 / 941, true);
    // A preview stops at its own cap: a wider pane never inflates it.
    expect(desktop.boxWidth).toBe(320);
    expect(wide.boxWidth).toBe(320);
    expect(full.boxWidth).toBe(320);
  });
});

/**
 * R19 flush photo width ownership (deployed 7c5e6489). The surface sizes to
 * `max-content` and the bubble declares no width, so the bubble takes the
 * in-flow photo's contribution. The base photo width carries a percentage,
 * which cannot resolve during intrinsic sizing: the contribution fell back to
 * the bitmap's own width, the 34rem cap set the bubble to 544, and the photo
 * resolved inside it. A 512px picture sat in a 544px bubble with a blank strip
 * beside it. A flush bubble restates the width without that percentage, so the
 * picture owns the width; the absolutely positioned long-press anchor is
 * asserted as the reason no sibling competes for it. Declarations only:
 * rendered acceptance stays in the deployed browser.
 */
describe("R19 flush photo width ownership", () => {
  const flushPhotoSelector = ".fb-chat-message-media:has(> .fb-chat-photo > button) > .fb-chat-photo";
  const flushPhoto = bodies(flushPhotoSelector).join("\n");
  const base = photoRule();
  const surface = bodies(".fb-chat-message-surface").join("\n");
  const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
  const flushBubble = /\.fb-chat-message-media:has\(> \.fb-chat-photo\)\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const longPressCss = readFileSync(new URL("../components/longPress.css", import.meta.url), "utf8");

  it("restates a definite photo width inside a flush bubble", () => {
    expect(flushPhoto).toContain("width:min(var(--fb-chat-photo-width, 320px), calc(var(--fb-chat-photo-height, min(320px, 50vh)) * var(--fb-chat-photo-ratio)))");
    // The percentage is the term intrinsic sizing cannot resolve; leaving it in
    // is what let the bitmap, not the box, size the bubble.
    expect(flushPhoto).not.toContain("100%,");
    // Scoped to the flush bubble alone: a padded or captioned bubble takes the
    // direct-child message override below, and the gallery, the grouped cells
    // and the no-bytes card keep their own width owners.
    expect(flushPhotoSelector).toContain(".fb-chat-message-media:has(> .fb-chat-photo > button)");
    expect(flushPhotoSelector).not.toContain(".fb-chat-gallery");
    expect(base).toContain("width:min(var(--fb-chat-photo-width, 320px), 100%, calc(var(--fb-chat-photo-height, min(320px, 50vh)) * var(--fb-chat-photo-ratio)))");
    // The override must win by cascade as well as by specificity. The same
    // selector already exists for `border-radius`, so compare the declaration.
    const overrideAt = chatCss.indexOf("width:min(var(--fb-chat-photo-width, 320px), calc(");
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
    // 320px phone: the 70% row still wins over the definite photo width, so the
    // flush bubble can never overflow its pane. A flush bubble declares no
    // padding, so the whole 206.08px border box is picture.
    const narrow = photoPaint(320, 640, 1672 / 941, true);
    expect(narrow.boxWidth).toBeCloseTo(206.08, 5);
    expect(narrow.boxWidth).toBeLessThan(320);
  });

  it("brings the accepted 1672x941 photo down to the shared preview width", () => {
    const accepted = photoPaint(804, 727, 1672 / 941, true);
    expect(accepted.boxWidth).toBeCloseTo(320, 5);
    expect(accepted.height).toBeCloseTo(320 / (1672 / 941), 5);
    expect(accepted.height).toBeGreaterThan(179);
    expect(accepted.height).toBeLessThan(181);
    // The picture box and the bubble share the one definite width, so the
    // chip's inline-end inset and the picture edge are the same edge.
    expect(flushPhoto).toContain("var(--fb-chat-photo-width, 320px)");
  });
});

/**
 * R19 captioned photo width ownership (deployed acceptance, 2026-11-20). A
 * MEDIA message that pairs a 320px photo with a bare YouTube-link caption
 * rendered a 544x452 padded bubble at 1600, with the photo (320x145) and the
 * 320x266 preview card both ending short of the bubble edge. The surface sizes
 * to `max-content` and the base photo width carries a percentage that intrinsic
 * sizing cannot resolve, so the bitmap's own width measured the bubble and the
 * 34rem cap won. The direct-child override restates the flush pair's definite
 * width for every message photo, while the base `max-width:100%` keeps the
 * narrow-pane clamp. Declarations and arithmetic only: rendered geometry stays
 * in the deployed browser.
 */
describe("R19 captioned photo width ownership", () => {
  const messagePhotoSelector = ".fb-chat-message > .fb-chat-photo";
  const messagePhoto = bodies(messagePhotoSelector).join("\n");
  const compactSelector = '.fb-chat-message .fb-chat-photo:not(.fb-chat-photo-grouped):has(> div[role="status"])';
  const surface = bodies(".fb-chat-message-surface").join("\n");
  const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";

  /**
   * Specificity as [ids, classes, types] for the flat selectors this file reads:
   * `:not`/`:is`/`:has` contribute their argument, `:where()` contributes
   * nothing, and an attribute shares the class bucket.
   */
  function specificity(selector: string): [number, number, number] {
    const flatten = (part: string) => part
      .replace(/:where\([^()]*\)/g, " ")
      .replace(/:(?:not|is|has)\(([^()]*)\)/g, " $1 ");
    let flat = selector;
    for (let next = flatten(flat); next !== flat; next = flatten(flat)) flat = next;
    const ids = (flat.match(/#[\w-]+/g) ?? []).length;
    const classes = (flat.match(/\.[\w-]+/g) ?? []).length
      + (flat.match(/\[[^\]]+\]/g) ?? []).length
      + (flat.match(/:(?!:)[\w-]+/g) ?? []).length;
    const types = (flat.replace(/\[[^\]]+\]/g, " ").match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
    return [ids, classes, types];
  }

  it("gives every direct message photo the definite flush width", () => {
    expect(messagePhoto).toContain("width:min(var(--fb-chat-photo-width, 320px), calc(var(--fb-chat-photo-height, min(320px, 50vh)) * var(--fb-chat-photo-ratio)));");
    // The percentage is the term intrinsic sizing cannot resolve; leaving it in
    // is what let the bitmap, and then the 34rem cap, size a captioned bubble.
    expect(messagePhoto).not.toContain("100%,");
    expect(messagePhoto).not.toContain("100%");
    // The base rule keeps the percentage-guarded preference and the narrow-pane
    // clamp; this override replaces neither.
    expect(photoRule()).toContain("width:min(var(--fb-chat-photo-width, 320px), 100%, calc(var(--fb-chat-photo-height, min(320px, 50vh)) * var(--fb-chat-photo-ratio)))");
    expect(photoRule()).toContain("max-width:100%;");
    // The flush pair keeps its own copy of the same value.
    expect(bodies(".fb-chat-message-media:has(> .fb-chat-photo > button) > .fb-chat-photo").join("\n"))
      .toContain("width:min(var(--fb-chat-photo-width, 320px), calc(");
  });

  it("scopes the override to direct children and leaves the other owners alone", () => {
    expect(messagePhotoSelector).toContain(".fb-chat-message > .fb-chat-photo");
    expect(messagePhotoSelector).not.toContain(".fb-chat-gallery");
    expect(messagePhotoSelector).not.toContain(".fb-chat-photo-grouped");
    // Cascade order: the base box, then the message override, then the album
    // owners. An album cell is still a message bubble, so its later rule keeps
    // the cell at 100% of the album column instead of the single-photo width.
    const baseAt = chatCss.indexOf(".fb-chat-photo { --fb-chat-photo-ratio");
    const messageAt = chatCss.indexOf(".fb-chat-message > .fb-chat-photo {");
    const runAt = chatCss.indexOf(".fb-chat-run .fb-chat-photo,");
    expect(baseAt).toBeGreaterThan(-1);
    expect(messageAt).toBeGreaterThan(baseAt);
    expect(runAt).toBeGreaterThan(messageAt);
    // The gallery and the grouped cell still own their full-width box.
    expect(bodies(".fb-chat-gallery .fb-chat-photo").join("\n")).toContain("width:100%;");
    expect(bodies(".fb-chat-gallery .fb-chat-photo").join("\n")).toContain("max-height:20rem;");
    expect(bodies(".fb-chat-photo-grouped").join("\n")).toContain("width:100%;");
    expect(bodies(".fb-chat-photo-grouped").join("\n")).toContain("max-height:none;");
  });

  it("keeps the no-bytes card at the shared media width, more specific and later", () => {
    const compact = bodies(compactSelector).join("\n");
    expect(compact).not.toContain("width:var(--fb-chat-media-width);");
    expect(compactSelector).toContain(":not(.fb-chat-photo-grouped)");
    expect(compactSelector).toContain(':has(> div[role="status"])');
    // (0,4,1) beats the direct-child override's (0,2,0), and the compact rule
    // also comes later in the sheet, so neither specificity nor order can let
    // the photo preference resize a loading or missing card.
    expect(specificity(compactSelector)).toEqual([0, 4, 1]);
    expect(specificity(messagePhotoSelector)).toEqual([0, 2, 0]);
    expect(chatCss.indexOf(compactSelector)).toBe(-1);
  });

  it("keeps the bubble, surface and row caps unchanged", () => {
    expect(surface).toContain("max-width:min(100%, 34rem);");
    expect(bubble).toContain("max-width:min(100%, 34rem);");
    expect(messageCapPercent).toBe(70);
    expect(chatCss).toContain(".fb-chat-line > .fb-chat-line-row { max-width:70%; }");
    expect(chatCss.match(/max-width:70%/g)).toHaveLength(2);
    // The 320px photo plus the padded bubble's two 12.8px gutters is 345.6px,
    // well under the 544px cap: no strip beside the picture or the preview card.
    expect(photoWidthPx + 2 * bubblePaddingPx).toBeCloseTo(345.6, 5);
    expect(photoWidthPx + 2 * bubblePaddingPx).toBeLessThan(34 * REM_PX);
    // On a phone the one 70% row cap still wins, so the bubble cannot overflow.
    expect(transcript(320).cap).toBeCloseTo(206.08, 5);
    expect(transcript(390).cap).toBeCloseTo(255.08, 5);
    expect(Math.min(photoWidthPx + 2 * bubblePaddingPx, transcript(320).cap)).toBeCloseTo(206.08, 5);
    expect(Math.min(photoWidthPx + 2 * bubblePaddingPx, transcript(390).cap)).toBeCloseTo(255.08, 5);
  });
});

/**
 * R19 expressive preview bounds. A bare Klipy URL stores no kind, so the picture
 * must stay compact and the bubble must be the picture. Where the sender did
 * preserve a kind, `data-media-kind` on the `img.fb-chat-klipy` may take a
 * different cap: a GIF is preview media and reads like a photo, a sticker is
 * expression and stays smaller. The CSS never generates the label or the kind; it
 * only sizes what the renderer states.
 *
 * The bubble states its cap as a plain length because a percentage cap is
 * unreadable while the max-content surface measures it, which is what let a
 * 480px bitmap size a 483px bubble. The picture keeps the percentage only as the
 * guard that shrinks it inside a narrow pane.
 */
describe("R19 expressive preview bounds", () => {
  const unknownRule = /\.fb-chat-message \.fb-chat-klipy\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const gifRule = /\.fb-chat-message \.fb-chat-klipy\[data-media-kind="gif"\]\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const stickerRule = /\.fb-chat-message \.fb-chat-klipy\[data-media-kind="sticker"\]\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const unknownBubble = /\.fb-chat-message\.fb-chat-message-klipy\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const gifBubble = /\.fb-chat-message\.fb-chat-message-klipy:has\(\.fb-chat-klipy\[data-media-kind="gif"\]\)\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const stickerBubble = /\.fb-chat-message\.fb-chat-message-klipy:has\(\.fb-chat-klipy\[data-media-kind="sticker"\]\)\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";

  it("bounds the bubble with a plain length the measurement can read", () => {
    // A percentage max-width cannot resolve against a max-content surface, so
    // the browser dropped the whole cap and the bitmap sized the bubble. The
    // bubble therefore states only a plain length, and the picture keeps the
    // percentage as its own narrow-pane guard.
    expect(unknownBubble).toContain("max-width:var(--fb-chat-klipy-width, 192px);");
    expect(unknownBubble).not.toContain("100%");
    expect(gifBubble).toContain("max-width:var(--fb-chat-photo-width, 320px);");
    expect(gifBubble).not.toContain("100%");
    expect(stickerBubble).toContain("max-width:var(--fb-chat-sticker-width, 176px);");
    expect(stickerBubble).not.toContain("100%");
    // One attribute location: the picture states its kind, the bubble reads it.
    // A bare URL keeps the compact fallback rather than guessing from a URL path,
    // a file extension or an alpha channel.
    expect(chatCss).not.toMatch(/\.fb-chat-message-klipy\[data-media-kind/);
    expect(chatCss).not.toMatch(/\.fb-chat-klipy\[href/);
    expect(chatCss).not.toMatch(/data-media-kind="(?:image|photo|unknown)"/);
    // The row keeps no stated width: a fixed row outlived a small sticker and
    // left the status line on an empty strip. The line keeps the pane width and
    // the row keeps the one 70% cap, so a content-sized row still ends on the
    // sender's edge.
    expect(chatCss).not.toMatch(/\.fb-chat-line[^{}]*\{[^{}]*width:min\(var\(--fb-chat-(?:klipy|photo|sticker)-width/);
    expect(chatCss).not.toContain(
      ".fb-chat-line-own > .fb-chat-line-row > .fb-chat-message-surface { margin-inline-start:auto; }");
    expect(bodies(".fb-chat-line").join("\n")).toContain("max-width:100%;");
    expect(bodies(".fb-chat-line-own").join("\n")).toContain("flex-direction:row-reverse;");
    expect(MESSAGE_CAP_PATTERN.test(chatCss)).toBe(true);
  });

  it("caps an unknown bare Klipy picture at the compact scale", () => {
    expect(klipyWidthPx).toBe(192);
    expect(klipyWidthPx).toBe(12 * REM_PX);
    expect(klipyHeightPx).toBe(224);
    expect(klipyHeightVh).toBe(40);
    expect(unknownRule).toContain("max-width:100%;");
    expect(unknownRule).toContain("width:var(--fb-chat-klipy-width, 192px);");
    expect(unknownRule).toContain("height:auto;");
    expect(unknownRule).toContain("object-fit:contain;");
    expect(unknownRule).toContain("aspect-ratio:1;");
    // The renderer states the kind on the picture element and answers `unknown`
    // for pre-marker history, which is exactly the compact branch above: CSS
    // never guesses a kind from a URL path, an extension or an alpha channel.
    expect(messagingTsx).toContain('data-media-kind={klipyKind ?? "unknown"}');
    expect(messagingTsx).toContain("src={klipyMessageUrl(message.body)}");
    expect(messagingTsx).toContain("? klipyMessageKind(message.body) : null");
    expect(chatCss).not.toMatch(/\[data-media-kind="unknown"\]/);
  });

  it("makes the bubble the picture instead of the picture's intrinsic width", () => {
    const caps = expressiveCaps(727);
    // The measured defect: a 480px source painted at 352 inside a 483px bubble
    // at 1440, and at 249.59 inside a full-width 294.4px bubble at 320.
    const desktop = klipyPaint(804, { width: 480, height: 480 }, caps.unknown);
    // Border-box: the declared 192px cap is the bubble, so the picture receives
    // 192 - 2 x 1.6 = 188.8. The picture and the bubble still share one edge.
    expect(desktop.bubbleMax).toBe(192);
    expect(desktop.bubble).toBeCloseTo(192, 5);
    expect(desktop.width).toBeCloseTo(188.8, 5);
    expect(desktop.height).toBeCloseTo(188.8, 5);
    expect(desktop.bubble).toBeCloseTo(desktop.width + 2 * klipyPaddingPx, 5);
    expect(desktop.bubble).toBeLessThan(400);
    const phone = klipyPaint(320, { width: 480, height: 480 }, caps.unknown);
    expect(phone.bubble).toBeCloseTo(desktop.bubble, 5);
    expect(phone.bubble).toBeLessThanOrEqual(phone.rowMax);
    expect(phone.rowMax).toBeCloseTo(206.08, 5);
    // Small art is never upscaled: the picture keeps its own size and the bubble
    // shrinks to it.
    const small = klipyPaint(804, { width: 96, height: 96 }, caps.unknown);
    expect(small.width).toBe(96);
    expect(small.bubble).toBeCloseTo(99.2, 5);
    expect(small.bubble).toBeCloseTo(small.width + 2 * klipyPaddingPx, 5);
  });

  it("keeps a tall expressive picture inside the height bound without squashing it", () => {
    const caps = expressiveCaps(727);
    const tall = klipyPaint(804, { width: 300, height: 800 }, caps.unknown);
    // Only the declared bounds are asserted. Whether Chromium's max-content
    // contribution also transfers the max-height back into the bubble's width
    // (narrowing it toward the 84px picture instead of leaving it at its 192px
    // cap) is a rendered-geometry question this file cannot answer, so no
    // assertion claims the bubble hugs a tall picture: the picture is proven
    // only to stay inside both declared bounds at its own ratio.
    expect(tall.height).toBeCloseTo(224, 5);
    expect(tall.width).toBeCloseTo((224 * 300) / 800, 5);
    expect(tall.width / tall.height).toBeCloseTo(300 / 800, 5);
    expect(tall.height).toBeLessThanOrEqual(caps.unknown.height);
    expect(tall.width).toBeLessThanOrEqual(caps.unknown.width);
    const short = expressiveCaps(400);
    // The viewport term owns a short window: 40% of 400 is 160.
    expect(short.unknown.height).toBeCloseTo(160, 5);
  });

  it("lets only a preserved kind take a different cap", () => {
    const caps = expressiveCaps(727);
    expect(caps.unknown.width).toBe(192);
    expect(caps.gif.width).toBe(photoWidthPx);
    expect(caps.gif.height).toBe(photoHeightPx);
    expect(caps.sticker.width).toBe(176);
    expect(caps.sticker.width).toBe(11 * REM_PX);
    // A sticker stays clearly smaller than a GIF, and both stay under the photo
    // preference, so the three never compete visually.
    expect(caps.sticker.width).toBeLessThan(caps.gif.width);
    expect(caps.gif.width).toBeLessThanOrEqual(photoWidthPx);
    expect(gifRule).toContain("width:var(--fb-chat-photo-width, 320px);");
    expect(gifRule).toContain("max-height:var(--fb-chat-photo-height, min(320px, 50vh));");
    expect(stickerRule).toContain("width:var(--fb-chat-sticker-width, 176px);");
    expect(stickerRule).toContain("max-height:var(--fb-chat-sticker-height, min(176px, 34vh));");
    // A known GIF is preview media, so at a 320 phone the single 70% cap is what
    // bounds it: the bubble and the picture agree exactly, with no strip left
    // for the status line and no overflow past the pane.
    const narrowGif = klipyPaint(320, { width: 480, height: 270 }, caps.gif);
    expect(narrowGif.bubble).toBeCloseTo(206.08, 5);
    expect(narrowGif.width).toBeCloseTo(202.88, 5);
    expect(narrowGif.bubble).toBeCloseTo(narrowGif.width + 2 * klipyPaddingPx, 5);
    expect(narrowGif.bubble).toBeLessThanOrEqual(narrowGif.rowMax);
    // On a wide pane the same GIF takes its own cap; border-box leaves 316.8px
    // of picture inside the declared 320px bubble.
    const wideGif = klipyPaint(1112, { width: 480, height: 270 }, caps.gif);
    expect(wideGif.bubble).toBeCloseTo(320, 5);
    expect(wideGif.width).toBeCloseTo(316.8, 5);
    expect(wideGif.height).toBeCloseTo((316.8 * 270) / 480, 5);
    const wideSticker = klipyPaint(804, { width: 480, height: 480 }, caps.sticker);
    expect(wideSticker.bubble).toBeCloseTo(176, 5);
    expect(wideSticker.width).toBeCloseTo(172.8, 5);
  });

  it("holds its caps when the reader doubles the text size", () => {
    // Every preview cap is a px length, so a doubled root font size cannot
    // inflate a preview. The rem gutter and the percentage row cap do scale, and
    // they only shrink the box the preview resolves against: at a 32px root a
    // 320 pane has 268.8px usable and a 188.16px message cap, so the row binds
    // before the preview cap can. The paint model itself runs at the 16px root;
    // the doubled-root cap below is the smaller one that would bind.
    const caps = expressiveCaps(1400);
    expect(caps.gif.width).toBe(320);
    expect(caps.unknown.width).toBe(192);
    expect(caps.sticker.width).toBe(176);
    for (const scroller of [320, 390, 804, 1112]) {
      const doubledUsable = scroller - 2 * listPaddingRem * 2 * REM_PX;
      const doubledCap = (doubledUsable * messageCapPercent) / 100;
      expect(doubledCap).toBeLessThanOrEqual(transcript(scroller).cap);
      if (scroller === 320) expect(doubledCap).toBeCloseTo(188.16, 5);
    }
    expect(chatCss).not.toMatch(/--fb-chat-(?:media|photo|klipy|sticker)-(?:width|height):\s*[\d.]+rem/);
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
  const flush = /\.fb-chat-message-media:has\(> \.fb-chat-photo\)\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const flushOwn = /\.fb-chat-message-media:has\(> \.fb-chat-photo\)\.fb-chat-message-own\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
  const overlay = /\.fb-chat-message-media:has\(> \.fb-chat-photo\) > \.fb-chat-message-status\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";

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
    expect(chatCss).not.toContain('.fb-chat-photo:has(> div[role="status"]) { aspect-ratio:auto !important; }');
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

  it("keeps the expressive bubble free of a second surface", () => {
    // A bare Klipy picture is the message: no padding ring, no fill, no tail,
    // and its receipt line keeps the reader's own text colour.
    const klipyBubble = /\.fb-chat-message-klipy\s*\{([^{}]*)\}/.exec(chatCss)?.[1] ?? "";
    expect(klipyBubble).toContain("padding:0 .1rem;");
    expect(klipyBubble).toContain("background:transparent;");
    expect(klipyBubble).toContain("border-radius:0;");
    expect(chatCss).toContain(".fb-chat-message-klipy .fb-chat-message-status { color:var(--fb-on-surface-variant); }");
    // The label the owner asked for sits after the timestamp in the existing
    // status row, so CSS adds no badge, no pill and no generated text.
    expect(chatCss).not.toContain("fb-chat-expressive-kind");
    expect(chatCss).not.toMatch(/content:\s*["'](?:GIF|Sticker)["']/);
    // The renderer supplies the plain text; it inherits the status row's .75rem
    // scale and end alignment, and `.fb-chat-time`'s inline-end margin already
    // separates it from the time.
    expect(messagingTsx).toContain('<span className="fb-chat-expressive-kind">');
    expect(bodies(".fb-chat-message-status").join("\n")).toContain("text-align:end;");
    expect(bodies(".fb-chat-time").join("\n")).toContain("margin-inline-end:.35rem;");
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
  const overlay = bodies(".fb-chat-message-media:has(> .fb-chat-photo) > .fb-chat-message-status").join("\n");

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
 * gutters instead of a centred 48rem rail; the 70% message cap and the 34rem
 * bubble cap still bound the readable measure. The composer is not part of this
 * rail: its own stylesheet gives the real root `width: 100%`, so the screen must
 * not clamp it.
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
    // The row's one 70% cap bounds that measure without repeating it below.
    expect(chatCss).toContain(".fb-chat-line > .fb-chat-line-row { max-width:70%; }");
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
