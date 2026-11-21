// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static ownership contract for the one media shape (owner report, desktop
 * Home): a report photo is a squircle, not a sharp rectangle, and every frame
 * reads one token instead of carrying its own radius.
 *
 * `mediaShape.css` owns the token and the two-arm shape. Feed, masonry, the
 * classic/compact/list frames and the report hero carry the shared class; the
 * chat media frames cannot (their renderer is out of this change) so they read
 * the same token in their own rule, and the shape arm still reaches them. The
 * `+N` count chip takes a derived one-third corner so it stops being the last
 * hard corner on the tile. Declarations only: the rendered silhouette remains
 * a deployed-browser check.
 */
const mediaCss = readFileSync(new URL("../components/mediaShape.css", import.meta.url), "utf8");
const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const chatCss = readFileSync(new URL("../screens/Messaging.css", import.meta.url), "utf8");
const carousel = readFileSync(new URL("../components/FeedMediaCarousel.tsx", import.meta.url), "utf8");
const cardContent = readFileSync(new URL("../components/PostCardContent.tsx", import.meta.url), "utf8");
const hero = readFileSync(new URL("../components/detail/DetailHeroGallery.tsx", import.meta.url), "utf8");
const reportPreviewCss = readFileSync(new URL("../components/ReportPhotoPreview.css", import.meta.url), "utf8");
const chatReportCss = readFileSync(new URL("../components/ChatReportPreview.css", import.meta.url), "utf8");
const chatReportTsx = readFileSync(new URL("../components/ChatReportPreview.tsx", import.meta.url), "utf8");
const linkPreviewCss = readFileSync(new URL("../components/GenericLinkPreview.css", import.meta.url), "utf8");
const linkPreviewTsx = readFileSync(new URL("../components/GenericLinkPreview.tsx", import.meta.url), "utf8");
const youTubeCss = readFileSync(new URL("../components/YouTubeEmbed.css", import.meta.url), "utf8");
const youTubeTsx = readFileSync(new URL("../components/YouTubeEmbed.tsx", import.meta.url), "utf8");
const videoPlayerCss = readFileSync(new URL("../components/media/videoPlayer.css", import.meta.url), "utf8");

/** The `@supports (...)` body for `query`, found by brace matching. */
function supportsBody(css: string, query: string) {
  const start = css.indexOf(query);
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

/** One flat rule body by exact selector. */
function body(css: string, selector: string) {
  return new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

describe("one media shape", () => {
  it("declares the radius once, outside Tailwind's layers", () => {
    expect(mediaCss.match(/--fb-media-radius\s*:/g)).toHaveLength(1);
    expect(mediaCss).toMatch(/:root \{[^}]*--fb-media-radius: 1\.125rem;/);
    expect(body(mediaCss, ".fb-media-shape")).toContain(
      "border-radius: var(--fb-media-radius, 1.125rem);",
    );
    expect(mediaCss).not.toContain("@layer");
    // Every surface loads the one file: index.css is the app-wide stylesheet.
    expect(indexCss).toContain('@import "./components/mediaShape.css";');
    // A length, not the avatar's 32% glyph-box proportion: a percentage of a
    // 270px tile would be a blob, not the squircle on an avatar.
    expect(body(mediaCss, ".fb-media-shape")).not.toContain("%");
  });

  it("upgrades the silhouette with one squircle arm", () => {
    expect(mediaCss.match(/@supports \(corner-shape: squircle\)/g)).toHaveLength(1);
    expect(mediaCss.match(/corner-shape: squircle;/g)).toHaveLength(1);
    const arm = supportsBody(mediaCss, "@supports (corner-shape: squircle)");
    expect(arm).toContain(".fb-media-shape");
    expect(arm).toContain(".fb-chat-message-media");
    expect(arm).toContain(".fb-chat-message-video");
    // The count chip is a capsule, not a squircle: it stays out of the arm.
    expect(arm).not.toContain(".fb-masonry-more");
    // The arm adds the shape only; no engine loses the token radius, and no
    // second radius source competes with it.
    expect(arm).not.toContain("border-radius");
  });

  it("puts every feed, masonry and report hero frame on the shared class", () => {
    expect(carousel).toContain('className="fb-home-media-viewport fb-media-shape relative w-full overflow-hidden"');
    expect(carousel.match(/className="fb-feed-img fb-media-shape"/g)).toHaveLength(2);
    expect(cardContent).toContain('variant === "thumb" ? "fb-thumb fb-media-shape" : "fb-img-frame fb-media-shape"');
    expect(cardContent).toContain("fb-post-photo fb-masonry-media fb-media-shape");
    expect(hero).toContain('className="fb-media-shape relative w-full overflow-hidden"');
    // The literal 18px Tailwind corner is gone: the token is the only owner.
    expect(hero).not.toContain("rounded-[18px]");
  });

  it("leaves no media frame with a hard-coded radius in index.css", () => {
    for (const selector of [".fb-img-frame", ".fb-thumb", ".fb-feed-img", ".fb-masonry-media"]) {
      expect(body(indexCss, selector)).not.toContain("border-radius");
    }
    // The viewport's old 12px rule is retired with the class application.
    expect(indexCss).not.toContain(".fb-home-media-viewport {");
    // A failed photo keeps the frame's own corner instead of inventing 8px
    // inside an 18px clip.
    expect(body(indexCss, ".fb-img-fallback")).toContain("border-radius: inherit;");
  });

  it("keeps the chat frames on the same token without changing their size", () => {
    expect(body(chatCss, ".fb-chat-message-media:has(> .fb-chat-photo)")).toContain(
      "border-radius:var(--fb-media-radius, 1.125rem);",
    );
    expect(body(chatCss, ".fb-chat-message-video")).toContain(
      "border-radius:var(--fb-media-radius, 1.125rem);",
    );
    // The album keeps its flattened cells: no album tile starts drawing this
    // single-frame corner.
    expect(body(chatCss, ".fb-chat-run .fb-chat-message-media:has(> .fb-chat-photo > button) > .fb-chat-photo"))
      .toContain("border-radius:0;");
  });

  it("keeps the +N count chip a capsule, outside the squircle arm", () => {
    expect(body(mediaCss, ".fb-masonry-more")).toContain("border-radius: 999px;");
    expect(body(mediaCss, ".fb-masonry-more")).not.toContain("calc(");
    expect(body(indexCss, ".fb-masonry-more")).not.toContain("border-radius");
    // The chip is not part of the corner-shape arm: a capsule is already round.
    const arm = supportsBody(mediaCss, "@supports (corner-shape: squircle)");
    expect(arm).not.toContain(".fb-masonry-more");
    // Colour, position, size and the aria-hidden marker stay with the chip.
    expect(cardContent).toContain('className="fb-masonry-more" aria-hidden');
  });

  it("converts the remaining report, search, link, video and chat media frames", () => {
    // Search hover card: the report panel's more specific rule owns the shared
    // token (the shared .fb-popover base keeps its own 16px radius).
    expect(body(reportPreviewCss, ".fb-popover.fb-report-preview-panel")).toContain(
      "border-radius: var(--fb-media-radius, 1.125rem);",
    );
    // Chat report and generic-link preview thumbnails carry the shared class;
    // their hard-coded corner is retired so nothing competes with it.
    expect(chatReportTsx).toContain('className="fb-chat-report-preview-media fb-media-shape"');
    expect(linkPreviewTsx).toContain('className="fb-linkp-thumb fb-media-shape"');
    expect(body(chatReportCss, ".fb-chat-report-preview-media")).not.toContain("border-radius");
    expect(body(linkPreviewCss, ".fb-linkp-thumb")).not.toContain("border-radius");
    // YouTube embed media frame carries the shared class.
    expect(youTubeTsx).toContain('className="fb-yt-media fb-media-shape"');
    expect(body(youTubeCss, ".fb-yt-media")).not.toContain("border-radius");
    // Expanded video-player stage reads the shared token.
    expect(videoPlayerCss).toContain("border-radius: var(--fb-media-radius, 1.125rem);");
  });
});
