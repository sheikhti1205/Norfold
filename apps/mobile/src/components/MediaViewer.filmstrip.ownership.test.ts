// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for the app-owned photo-viewer filmstrip.
 *
 * Owner requirement 2026-11-20: "Opening an image shouldn't show only the next
 * thing and prev thing like we're doing rn about photo preview. It should show
 * all the prevs and next ones to allow people to easily scroll and check things
 * as they want."
 *
 * The library's Thumbnails plugin renders a window of three (`calculatePreload`
 * caps its loop at `carousel.preload`, which must stay at 1 so full-size slides
 * are not all preloaded) and its stylesheet hid the strip on phones. The viewer
 * now owns the row: every slide, one horizontally scrollable track, present on
 * phones, with the photo area padded clear of it. jsdom has no layout engine, so
 * this file pins the declared mechanism; rendered geometry and touch scrolling
 * stay a deployed-browser acceptance item, not a claim made here.
 */
type CssRule = { selectors: string[]; body: string };

const stripCss = readFileSync(new URL("./ViewerFilmstrip.css", import.meta.url), "utf8");
const stripTsx = readFileSync(new URL("./ViewerFilmstrip.tsx", import.meta.url), "utf8");
const viewerCss = readFileSync(new URL("./MediaViewer.css", import.meta.url), "utf8");
const viewerTsx = readFileSync(new URL("./MediaViewer.tsx", import.meta.url), "utf8");

/** Comments removed; every brace-free body is paired with its selector list. */
function cssRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules: CssRule[] = [];
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectorText = "", body = ""] = match;
    rules.push({ selectors: selectorText.split(",").map(selector => selector.replace(/\s+/g, " ").trim()), body });
  }
  return rules;
}

/** The declarations of one `@media (max-width: 600px)` block, brace-counted so
 * a rule body that ends a line cannot cut the block short. */
function phoneBlock(css: string) {
  const start = css.indexOf("@media (max-width: 600px)");
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return "";
}

const stripRules = cssRules(stripCss.replace(phoneBlock(stripCss), ""));
const phoneStripRules = cssRules(phoneBlock(stripCss));
const viewerRules = cssRules(viewerCss.replace(phoneBlock(viewerCss), ""));
const phoneViewerRules = cssRules(phoneBlock(viewerCss));

function bodies(rules: CssRule[], selector: string) {
  return rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.body).join("\n");
}

const plainPx = (body: string, property: string) =>
  Number(new RegExp(`(?:^|;)\\s*${property}:\\s*(\\d+)px;`).exec(body)?.[1] ?? NaN);

/** A safe-area declaration: `max(Npx, env(...))` or `calc(Npx + env(...))`. */
const envPx = (body: string, property: string) =>
  Number(new RegExp(`(?:^|;)\\s*${property}:\\s*(?:max|calc)\\((\\d+)px(?:,|\\s*\\+)\\s*env\\(safe-area-inset-[a-z]+\\)\\)`).exec(body)?.[1] ?? NaN);

describe("viewer filmstrip ownership", () => {
  it("is one horizontal scroller that lists every slide, not a window", () => {
    const track = bodies(stripRules, ".fb-viewer-filmstrip-track");
    expect(track).toContain("display: flex;");
    expect(track).toContain("overflow-x: auto;");
    expect(track).toContain("overflow-y: hidden;");
    expect(track).toContain("overscroll-behavior-x: contain;");
    // The viewer container disables browser gestures; the scroll container that
    // owns this pan has to re-enable it, or a phone cannot drag the strip.
    expect(track).toContain("touch-action: pan-x;");
    expect(stripTsx).toContain("{slides.map((slide, index) =>");
    expect(stripTsx).not.toContain(".slice(");
    expect(stripTsx).toContain("if (slides.length < 2) return null;");
    expect(stripTsx).toContain("data-viewer-keep");
    expect(stripTsx).toContain('behavior: reduced ? "auto" : "smooth"');
    expect(stripTsx).toContain('block: "nearest", inline: "center"');
  });

  it("keeps the strip visible on a phone and compact enough to scroll", () => {
    expect(phoneBlock(stripCss)).not.toBe("");
    expect(phoneBlock(viewerCss)).not.toBe("");
    for (const [file, rules] of [["ViewerFilmstrip.css", phoneStripRules], ["MediaViewer.css", phoneViewerRules]] as const) {
      for (const rule of rules) {
        if (!rule.selectors.some(selector => selector.includes("fb-viewer-filmstrip"))) continue;
        expect(rule.body, `${file} ${rule.selectors.join(", ")} hides the strip on a phone`).not.toContain("display: none");
      }
    }
    // Compact phone sizing: a 56x40 picture in a 44px press target, 6px gap.
    const phoneThumb = bodies(phoneStripRules, ".fb-viewer-filmstrip-thumb");
    expect(phoneThumb).toContain("width: 60px;");
    expect(phoneThumb).toContain("height: 44px;");
    expect(bodies(phoneStripRules, ".fb-viewer-filmstrip-track")).toContain("gap: 6px;");
  });

  it("leaves the photo area clear of the strip on both layouts", () => {
    const strip = bodies(stripRules, ".fb-viewer-filmstrip");
    const thumb = bodies(stripRules, ".fb-viewer-filmstrip-thumb");
    const slide = bodies(viewerRules, ".fb-media-viewer .yarl__slide");
    expect(slide).toMatch(/padding-bottom:\s*calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/);

    const desktopStrip = plainPx(strip, "padding-top") + plainPx(thumb, "height") + envPx(strip, "padding-bottom");
    const desktopSlide = envPx(slide, "padding-bottom");
    expect(desktopStrip).toBe(8 + 52 + 8);
    expect(desktopSlide).toBeGreaterThanOrEqual(desktopStrip);

    const phoneStrip = bodies(phoneStripRules, ".fb-viewer-filmstrip");
    const phoneThumb = bodies(phoneStripRules, ".fb-viewer-filmstrip-thumb");
    const phoneSlide = bodies(phoneViewerRules, ".fb-media-viewer .yarl__slide");
    expect(phoneSlide).toMatch(/padding-bottom:\s*calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/);
    const compactStrip = plainPx(phoneStrip, "padding-top") + plainPx(phoneThumb, "height") + envPx(phoneStrip, "padding-bottom");
    const compactSlide = envPx(phoneSlide, "padding-bottom");
    expect(compactStrip).toBe(6 + 44 + 6);
    expect(compactSlide).toBeGreaterThanOrEqual(compactStrip);
  });

  it("replaced the Thumbnails plugin without leaving its registration behind", () => {
    expect(viewerTsx).not.toContain("plugins/thumbnails");
    expect(viewerTsx).not.toContain("import Thumbnails");
    expect(viewerTsx).toContain("const plugins = [Zoom, Fullscreen, containFocus];");
    expect(viewerTsx).not.toMatch(/thumbnails=\{|thumbnail: \(\{ slide \}\)/);
    const controls = /controls: \(\) => <>([\s\S]*?)<\/>/.exec(viewerTsx)?.[1] ?? "";
    expect(controls).toContain("<OverlayStackBridge onClose={onClose} />");
    expect(controls).toContain("<ViewerFilmstrip />");
  });

  it("publishes the engine's own navigation and paints the grid thumbnail", () => {
    expect(stripTsx).toContain('<nav className="fb-viewer-filmstrip-track" aria-label="Thumbnails">');
    expect(stripTsx).toContain("publish(ACTION_NEXT, { count: index - currentIndex })");
    expect(stripTsx).toContain("publish(ACTION_PREV, { count: currentIndex - index })");
    expect(stripTsx).toContain("aria-current={active ? \"true\" : undefined}");
    expect(stripTsx).toContain("slide.thumbnail ?? slide.src");
    expect(stripTsx).toContain('alt=""');
    expect(stripTsx).toContain('<ImageOff size={20} aria-hidden="true" />');
    // Every slide is in the strip and callers never pass a thumbnail source, so
    // the thumb paints the full-size src: lazy + async keep off-screen albums
    // from decoding every bitmap on open.
    expect(stripTsx).toMatch(/<img src=\{src\} alt="" className="fb-viewer-thumbnail" loading="lazy" decoding="async" onError=/);
    expect(bodies(stripRules, ".fb-viewer-thumbnail")).toContain("object-fit: cover;");
  });
});
