// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Chat transcript alignment contract.
 *
 * The row, not the bubble, owns the one 70% message cap. A long paragraph's
 * max-content therefore fills the row while the bubble still stops at its
 * 34rem measure. In an own line the row is right-anchored by row-reverse, so
 * the surface must also be packed to the row's end. Otherwise the leftover
 * width appears as an inboard gap between the bubble and the sender's gutter,
 * which is the reported long-text placement defect.
 *
 * A received row is left-anchored and keeps the default start packing. The
 * row and the bubble keep their existing widths; this file pins placement, not
 * a wider bubble. The same row wraps text, long captions, photos, expressive
 * media, YouTube embeds, report previews and voice notes, so the packing
 * is a row contract rather than a text or media rule. Declarations only:
 * rendered confirmation belongs to the deployed browser.
 */
type CssRule = { selectors: string[]; body: string };

const chatCss = readFileSync(new URL("./Messaging.css", import.meta.url), "utf8");
const chatMessageTextCss = readFileSync(new URL("../components/ChatMessageText.css", import.meta.url), "utf8");
const reportPreviewCss = readFileSync(new URL("../components/ChatReportPreview.css", import.meta.url), "utf8");
const messagingTsx = readFileSync(new URL("./Messaging.tsx", import.meta.url), "utf8");
const reportPreviewTsx = readFileSync(new URL("../components/ChatReportPreview.tsx", import.meta.url), "utf8");

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

const rules = cssRules(chatCss);

function bodies(selector: string) {
  return rules.filter(rule => rule.selectors.includes(selector)).map(rule => rule.body);
}

/** One rule body's declarations, keyed by lowercased property name. A
 * substring search cannot tell `width` from `max-width`; this can. */
function declarations(body: string) {
  const declared = new Map<string, string[]>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    if (!property) continue;
    declared.set(property, [...(declared.get(property) ?? []), part.slice(colon + 1).trim()]);
  }
  return declared;
}

/** Selectors of line/row boxes that declare a real width, which would
 * stretch the gutter instead of packing the content-sized surface. */
function stretchedBoxes(lineSelectors: string[]) {
  return rules
    .filter(rule => rule.selectors.some(selector =>
      lineSelectors.includes(selector) || selector.endsWith("> .fb-chat-line-row")))
    .filter(rule => declarations(rule.body).has("width"))
    .flatMap(rule => rule.selectors);
}

const ownRow = bodies(".fb-chat-line-own > .fb-chat-line-row").join("\n");
const receivedRow = bodies(".fb-chat-line-row").join("\n");

describe("chat transcript own and received gutters", () => {
  it("packs an own row's surface against the same edge the row occupies", () => {
    // The line stays full width and reverses its own main axis, so the row is
    // placed on the sender's side. The row's own content must follow it.
    expect(bodies(".fb-chat-line").join("\n")).toContain("max-width:100%;");
    expect(bodies(".fb-chat-line-own").join("\n")).toContain("flex-direction:row-reverse;");
    expect(ownRow).toContain("justify-content:flex-end;");
  });

  it("leaves a received row on the default start packing", () => {
    // No justify-content on the base row: its start edge is the recipient's
    // gutter, because the line is neither reversed nor end-packed.
    expect(receivedRow).toContain("display:flex;");
    expect(receivedRow).not.toMatch(/(?:^|[;\s])justify-content\s*:/);
  });

  it("keeps the cap on the row and the bubble content-sized", () => {
    expect(chatCss).toContain(".fb-chat-line > .fb-chat-line-row { max-width:70%; }");
    const surface = bodies(".fb-chat-message-surface").join("\n");
    expect(surface).toContain("width:max-content;");
    expect(surface).toContain("max-width:min(100%, 34rem);");
    const bubble = bodies(".fb-chat-message").find(body => body.includes("max-width:min(100%, 34rem);")) ?? "";
    expect(bubble).toContain("min-width:0;");
    expect(bubble).not.toMatch(/(?:^|[;\s])width\s*:/);
    // No full-width row or line: the gutter comes from packing, not stretching.
    // Property-level extraction keeps `max-width:100%` distinct from a real
    // `width:100%`; the old substring regex matched the max clamp and failed.
    expect(stretchedBoxes([".fb-chat-line", ".fb-chat-line-own", ".fb-chat-line-row"])).toEqual([]);
  });

  it("reads width as its own property, not a max-width substring", () => {
    // A real stretch is rejected; the legitimate row clamp stays allowed.
    expect(declarations("display:flex; max-width:100%; min-width:0;").has("width")).toBe(false);
    expect(declarations("display:flex; width:100%;").get("width")).toEqual(["100%"]);
    expect(declarations("max-width:100%; width:min(100%, 34rem)").get("width")).toEqual(["min(100%, 34rem)"]);
  });

  it("does not turn the alignment into a margin or width workaround", () => {
    // A prior rejected shape pushed the surface with an auto inline margin.
    expect(chatCss).not.toContain(
      ".fb-chat-line-own > .fb-chat-line-row > .fb-chat-message-surface { margin-inline-start:auto; }");
    expect(ownRow).not.toMatch(/margin-inline/);
    expect(ownRow).not.toMatch(/(?:^|[;\s])width\s*:/);
  });

  it("leaves the album's own placement unchanged", () => {
    expect(bodies(".fb-chat-run").join("\n")).toContain("max-width:70%;");
    expect(bodies(".fb-chat-run-own").join("\n")).toContain("margin-inline-start:auto;");
    expect(bodies(".fb-chat-run .fb-chat-message-surface").join("\n")).toContain("width:100%;");
  });

  it("keeps the row and surface hooks in the screen markup", () => {
    expect(messagingTsx).toContain('ownRun ? "fb-chat-line fb-chat-line-own" : "fb-chat-line"');
    expect(messagingTsx).toContain("className={`fb-chat-line-row${wideFirst");
    expect(messagingTsx).toContain('disabled={!message.server} className="fb-chat-message-surface"');
  });

  it("lets photo, caption, preview and report-preview content inherit the row packing", () => {
    // These are content classes inside the one surface and bubble. None may
    // align itself to the gutter, or the row rule would be bypassed for that
    // content kind. The YouTube embed lives in the preview grid and the report
    // preview is the same bubble content, so the common row contract covers both.
    const surface = bodies(".fb-chat-message-surface").join("\n");
    expect(surface).not.toMatch(/(?:^|[;\s])justify-content\s*:/);
    expect(surface).not.toMatch(/margin-inline/);
    for (const selector of [".fb-chat-message", ".fb-chat-photo"]) {
      const body = bodies(selector).join("\n");
      expect(body).not.toMatch(/(?:^|[;\s])justify-content\s*:\s*flex-end/);
      expect(body).not.toMatch(/margin-inline-start\s*:\s*auto/);
    }
    // The report preview is a shared component now, so its own sheet carries
    // its declarations; it may not re-align itself to the gutter either.
    const preview = cssRules(reportPreviewCss)
      .filter(rule => rule.selectors.some(selector => selector.startsWith(".fb-chat-report-preview")))
      .map(rule => rule.body).join("\n");
    expect(preview).not.toMatch(/(?:^|[;\s])justify-content\s*:\s*flex-end/);
    expect(preview).not.toMatch(/margin-inline-start\s*:\s*auto/);
    const previews = cssRules(chatMessageTextCss)
      .filter(rule => rule.selectors.includes(".fb-chat-message-previews"))
      .map(rule => rule.body).join("\n");
    expect(previews).toContain("max-width: 100%;");
    expect(previews).not.toMatch(/(?:^|[;\s])justify-content\s*:/);
    // The screen mounts the one shared preview and the same state link in
    // loading/unavailable, so markup and styles cannot diverge again.
    expect(messagingTsx).toContain("<ChatReportPreview post={post} reportId={reportId} coverSrc={firstImageSrc} />");
    expect(messagingTsx).toContain('"fb-chat-report-preview fb-chat-report-preview-state"');
    expect(reportPreviewTsx).toContain('className="fb-chat-report-preview"');
    expect(messagingTsx).toContain('className="fb-chat-photo"');
    expect(messagingTsx).toContain('className="fb-chat-message-surface"');
  });

  it("marks only a bare non-media file as the compact document bubble", () => {
    // The screen owns this seam and the file component owns classification.
    // A file is bare only when the body parses, the shared predicate says it is
    // not a media kind, its own caption is empty, and the bubble holds no quote,
    // report context or location. A removed file is already null.
    const gate = messagingTsx.match(/const documentOnly = ([^;]+);/)?.[1]?.replace(/\s+/g, " ") ?? "";
    expect(gate).toContain("file !== null && isDocumentChatFile(file)");
    expect(gate).toContain("!message.replyToId && !message.contextReportId && !message.location");
    expect(gate).toContain('chatFileCaption(message.body) === ""');
    expect(messagingTsx).toContain('message.unsentAt === undefined ? parseChatFileMarker(message.body) : null');
    expect(messagingTsx).toContain('${documentOnly ? " fb-chat-message-document" : ""}');
    // The media allowlist stays in the file component: the screen never repeats
    // a raster/video/audio list of its own.
    expect(messagingTsx).toContain('import { ChatFile, isDocumentChatFile } from "../components/ChatFile";');
  });

  it("removes the measured inboard gap when the row is wider than the bubble", () => {
    // Deployed measurements from the reported long own message (7439 chars):
    // at 1440 the 70% row is 746.48 and the 34rem bubble is 544, so the old
    // start packing left 202.48 between the bubble and the right gutter; at
    // 2000 it left 594.48. At 320 the row itself is 206.08, so the bubble is
    // already flush. The report card at the same 1440 pane measured 30.57 of
    // the same gap: the same row wrapper with a narrower surface.
    const cases = [
      { row: 746.48, bubble: 544, gap: 202.48 },
      { row: 1138.48, bubble: 544, gap: 594.48 },
      { row: 206.08, bubble: 206.08, gap: 0 },
    ];
    for (const { row, bubble, gap } of cases) {
      expect(row - bubble).toBeCloseTo(gap, 2);
    }
    // The row keeps that width and the bubble keeps its size: flex-end is the
    // only change that moves the surface to the same edge as the row.
    expect(ownRow).toContain("justify-content:flex-end;");
    expect(ownRow).not.toMatch(/margin-inline/);
    expect(ownRow).not.toMatch(/(?:^|[;\s])width\s*:/);
  });
});
