import { isKlipyMediaUrl } from "../services/klipy";
import {
  CHAT_FILE_MARKER_PREFIX,
  chatFileCaption,
  parseChatFileMarker,
} from "../services/messaging/files";
import { segmentChatTextLinks, type ChatTextLinkOptions, type ChatTextSegment } from "./chatTextLinks";
import { parseReportLink, sharePreviewLink } from "./reportLinks";

/** The slice of a stored message the Copy policy needs. */
export interface CopyableMessage {
  body: string;
  unsentAt?: number;
  /**
   * The report this message is about. Only the canonical public share URL
   * derived from a validated id may be copied; the id itself never is.
   */
  contextReportId?: string;
}

/**
 * Root of every reserved file-marker version (`norfold-file:`). Derived from
 * the canonical v1 prefix so a new marker version stays covered without a
 * second literal.
 */
const CHAT_FILE_MARKER_FAMILY = CHAT_FILE_MARKER_PREFIX.replace(/v\d+:$/, "");

/**
 * True when the whole body opens a reserved file-marker envelope, valid or
 * not. Rendering uses this to keep a malformed/future marker as plain text
 * instead of letting a URL trapped in its payload become a chat link.
 */
export function isChatFileMarkerBody(body: string): boolean {
  return body.trim().startsWith(CHAT_FILE_MARKER_FAMILY);
}

/**
 * True when the whole body is one bare KLIPY media URL and nothing else.
 * `URL` tolerates spaces inside a path, so a prose line that merely starts
 * with a provider URL still parses; raw whitespace anywhere in the trimmed
 * body disqualifies it. Percent-encoded path spaces are not raw whitespace and
 * stay bare. The host itself is still validated by the canonical
 * `isKlipyMediaUrl` allowlist.
 */
export function isBareKlipyMediaBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed !== "" && !/\s/.test(trimmed) && isKlipyMediaUrl(trimmed);
}

/**
 * What "Copy text" may write for one chat message, or null when Copy is
 * disabled (R19-1).
 *
 * - Ordinary text is returned byte-for-byte; whitespace, newlines, emoji and
 *   pasted URLs included. Prose that merely contains a Klipy URL stays text.
 * - A conversation file returns only its visible caption, via the canonical
 *   parser, so the serialized marker can never be copied as text.
 * - A body that starts with a reserved marker but does not parse (truncated,
 *   malformed, future version) returns null instead of leaking the payload.
 * - A bare Klipy GIF or sticker body returns null. Rendering treats it as
 *   media, and native media clipboard support is not established, so its
 *   provider URL must not be copied as text.
 * - An unsent message returns null; its body is never copyable.
 *
 * The message menu uses `messageCopyActions`, which keeps this exact text
 * policy for ordinary prose and captions and additionally offers a distinct
 * link action instead of copying a URL as text.
 */
export function copyableMessageText(message: CopyableMessage): string | null {
  if (message.unsentAt !== undefined) return null;
  const body = message.body;
  // Rendering and the canonical marker parser both trim before classifying.
  const normalized = body.trim();
  if (normalized === "") return null;
  if (normalized.startsWith(CHAT_FILE_MARKER_FAMILY)) {
    if (!parseChatFileMarker(normalized)) return null;
    // Read the caption from the marker-first body: on the raw body a leading
    // blank line would land the marker itself in the caption.
    const caption = chatFileCaption(normalized);
    return caption === "" ? null : caption;
  }
  if (isBareKlipyMediaBody(normalized)) return null;
  return body;
}

/**
 * One safe link a message exposes to Copy. `url` is the exact slice the
 * canonical segmenter recognized: never normalized, rebuilt or re-encoded, so
 * a share URL keeps the form the sender pasted. The message menu and any
 * future preview renderer consume this same projection: a renderer may hide
 * only the inline link text it actually previews (a report card, a player, a
 * future safe card) and must keep every text/caption segment, while Copy link
 * still writes this exact `url`.
 */
export interface CopyableMessageLink {
  /** Stable menu identity, assigned in first-occurrence order. */
  id: string;
  url: string;
  /** Present when the link is a canonical Norfold report share URL. */
  reportId?: string;
  /** Present when the link is a validated, playable YouTube URL. */
  youtubeId?: string;
}

/**
 * What the message menu offers for Copy, in display order.
 *
 * - Plain prose: one "Copy text" action with the body exactly as stored.
 * - One bare safe URL: one "Copy link" action, never "Copy text" for the URL.
 * - Prose and link(s): "Copy text" carries the visible prose only (the URL is
 *   not a hidden payload) and every distinct link gets its own exact action.
 *   Two or more distinct links use the app's one compact chooser (`link-menu`)
 *   rather than an ambiguous first-only action or a joined URL blob.
 * - A report context (`contextReportId`) adds the canonical public share URL
 *   for that report. That link is a known public route for a validated id, not
 *   the id itself, and it is not duplicated when the body already shows a link
 *   for the same report.
 * - A file message exposes only its human caption, never the serialized marker
 *   (and the caption follows the same prose/link rules).
 * - A bare GIF/sticker body exposes nothing, except the report link above when
 *   the message also carries a report context.
 * - An unsent message, an empty body without a report context and a malformed
 *   reserved marker expose nothing.
 *
 * A visible Norfold share URL is copied exactly as written because it is
 * already the canonical, user-reusable URL.
 */
export type MessageCopyAction =
  | { id: "copy-text"; kind: "text"; label: string; text: string }
  | { id: "copy-link"; kind: "link"; label: string; url: string }
  | { id: "copy-links"; kind: "link-menu"; label: string; links: readonly CopyableMessageLink[] };

const COPY_TEXT = "Copy text";
const COPY_LINK = "Copy link";

/** A context report link before it joins the body projection. */
interface ContextReportLink {
  url: string;
  reportId: string;
}

/**
 * The canonical public share URL for the report a message is about, or null
 * when the id is unknown, malformed, or the public origin is not configured.
 *
 * The URL is the canonical public share link for that report
 * (`sharePreviewLink`), validated back through `parseReportLink`, so a
 * non-UUID id, a lookalike origin or an unset/invalid origin can never produce
 * a link. Nothing is fetched, and no origin is borrowed from `window.location`
 * or a private app route.
 */
function contextReportLink(contextReportId: string | undefined): ContextReportLink | null {
  const id = contextReportId?.trim() ?? "";
  if (id === "") return null;
  try {
    const url = sharePreviewLink(id);
    const parsed = parseReportLink(url);
    if (!parsed || parsed.postId !== id.toLowerCase()) return null;
    return { url, reportId: parsed.postId };
  } catch {
    return null;
  }
}

/** Project display-safe links from canonical segments, first occurrence wins. */
function linkProjection(segments: readonly ChatTextSegment[]): CopyableMessageLink[] {
  const seen = new Set<string>();
  const links: CopyableMessageLink[] = [];
  for (const segment of segments) {
    if (segment.kind !== "link" || seen.has(segment.href)) continue;
    seen.add(segment.href);
    links.push({
      id: `copy-link-${links.length + 1}`,
      url: segment.href,
      ...(segment.reportId ? { reportId: segment.reportId } : {}),
      ...(segment.youtubeId ? { youtubeId: segment.youtubeId } : {}),
    });
  }
  return links;
}

/**
 * Add the context report link unless the body already shows a link for that
 * same report. The body URL wins because it is the exact string the sender
 * pasted, and one report never yields two identical copy actions.
 */
function withContextLink(
  links: CopyableMessageLink[],
  context: ContextReportLink | null,
): CopyableMessageLink[] {
  if (!context) return links;
  if (links.some((link) => link.reportId === context.reportId)) return links;
  return [...links, { id: `copy-link-${links.length + 1}`, url: context.url, reportId: context.reportId }];
}

function linkAction(links: readonly CopyableMessageLink[]): MessageCopyAction {
  if (links.length === 1) {
    return { id: "copy-link", kind: "link", label: COPY_LINK, url: links[0]!.url };
  }
  return { id: "copy-links", kind: "link-menu", label: COPY_LINK, links };
}

/**
 * The exact safe links a visible body exposes, repeats removed in
 * first-occurrence order. Pure and network-free: this is the canonical
 * segmentation the transcript already uses (`segmentChatTextLinks`), not a
 * second URL parser. A serialized marker or a bare GIF/sticker body exposes
 * no link, because neither has visible link text. A report context is not
 * part of the body projection; the screen renders it separately.
 */
export function copyableMessageLinks(body: string, options: ChatTextLinkOptions = {}): CopyableMessageLink[] {
  const normalized = body.trim();
  if (normalized === "") return [];
  if (isChatFileMarkerBody(normalized)) {
    const caption = parseChatFileMarker(normalized) ? chatFileCaption(normalized) : "";
    return caption === "" ? [] : linkProjection(segmentChatTextLinks(caption, options));
  }
  if (isBareKlipyMediaBody(normalized)) return [];
  return linkProjection(segmentChatTextLinks(body, options));
}

/**
 * The visible prose left when each recognized link token is removed. The
 * body's own slices stay exact, including line breaks, emoji and punctuation;
 * only the URL characters the canonical segmenter classified as a link are
 * absent. When both sides of that hole are whitespace, one side is dropped so
 * the result reads the way the paragraph reads once a preview hides the link
 * text. Outer whitespace is trimmed because a clipboard value needs no gap.
 */
function proseText(segments: readonly ChatTextSegment[]): string {
  let text = "";
  let afterLink = false;
  for (const segment of segments) {
    if (segment.kind === "link") { afterLink = true; continue; }
    let slice = segment.text;
    if (afterLink) {
      text = text.replace(/[ \t]+$/, "");
      if (/[\r\n][ \t]*$/.test(text)) slice = slice.replace(/^[ \t]*\r?\n/, "");
      else if (!/^[ \t]*\r?\n/.test(slice) && text !== "") {
        slice = slice.replace(/^[ \t]*/, "");
        if (slice && !`)]}>"'”’.,;:!?…»›—–-`.includes(slice[0]!)
          && !/\s$/.test(text) && !`([{<"'“‘,;:.`.includes(text[text.length - 1]!)) slice = ` ${slice}`;
      }
    }
    text += slice;
    afterLink = false;
  }
  return text.trim();
}

/**
 * Punctuation a link scan can strand on its own, plus whitespace. Anything
 * outside this set - a letter, a number, an emoji, a symbol - is content a
 * user typed and can ask for again, so it keeps the Copy text action.
 */
const LINK_RESIDUE = /^[\s.,!;:?…»›’“”"'()<>[\]{}]+$/u;

/** True when the prose carries real content, not just stray link punctuation. */
function hasProse(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== "" && !LINK_RESIDUE.test(trimmed);
}

function actionsForVisibleText(
  body: string,
  options: ChatTextLinkOptions,
  context: ContextReportLink | null,
): MessageCopyAction[] {
  const segments = segmentChatTextLinks(body, options);
  const links = withContextLink(linkProjection(segments), context);
  if (links.length === 0) {
    return body.trim() === "" ? [] : [{ id: "copy-text", kind: "text", label: COPY_TEXT, text: body }];
  }
  const prose = proseText(segments);
  const actions: MessageCopyAction[] = [];
  if (hasProse(prose)) actions.push({ id: "copy-text", kind: "text", label: COPY_TEXT, text: prose });
  actions.push(linkAction(links));
  return actions;
}

/**
 * The one Copy policy the message menu renders (R19-1). Visible text only, no
 * hidden payload, no serialized marker and no bare media URL.
 */
export function messageCopyActions(message: CopyableMessage, options: ChatTextLinkOptions = {}): MessageCopyAction[] {
  if (message.unsentAt !== undefined) return [];
  const normalized = message.body.trim();
  const context = contextReportLink(message.contextReportId);
  if (isChatFileMarkerBody(normalized)) {
    if (!parseChatFileMarker(normalized)) return [];
    const caption = chatFileCaption(normalized);
    return actionsForVisibleText(caption, options, context);
  }
  if (isBareKlipyMediaBody(normalized)) {
    // The media URL is never copyable, but a visible report context still has
    // its own canonical public route.
    return context ? [linkAction([{ id: "copy-link-1", ...context }])] : [];
  }
  return actionsForVisibleText(message.body, options, context);
}
