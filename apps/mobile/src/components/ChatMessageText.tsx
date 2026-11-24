import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { segmentChatTextLinks } from "../utils/chatTextLinks";
import { parseReportLink } from "../utils/reportLinks";
import { isPreviewableLink, normalizePreviewUrl } from "../services/linkPreview";
import { GenericLinkPreview } from "./GenericLinkPreview";
import { YouTubeEmbed } from "./YouTubeEmbed";
import "./ChatMessageText.css";

export interface ChatMessageTextProps {
  body: string;
  /** Passed to the existing bubble paragraph (for example `fb-chat-emoji-only`). */
  className?: string;
  /** A report already shown by this message; its link and card are suppressed. */
  contextReportId?: string;
  /** The parent owns the live report card, including its safety key. */
  renderReportPreview: (reportId: string) => ReactNode;
}

/** Punctuation that already separates a removed link from its neighbour. */
const JOINS_AFTER = "([{<\"'“‘,;:.";
const JOINS_BEFORE = ")]}>\"'”’.,;:!?…»›—–-";
/** Horizontal gap plus any line breaks the author put at the link hole. */
const LEADING_WHITESPACE = /^[ \t]*(?:\r?\n[ \t]*)*/;

/** One space only when dropping a link would otherwise glue two words. */
function needsSeparator(previous: string, next: string): boolean {
  if (/\s$/.test(previous)) return false;
  const before = previous[previous.length - 1] ?? "";
  const after = next[0] ?? "";
  return !JOINS_AFTER.includes(before) && !JOINS_BEFORE.includes(after);
}

/**
 * R19-2 chat body rendering: exact visible prose with safe native links, plus
 * compact secondary previews.
 *
 * A report, video or ordinary previewable link that
 * already has a preview on screen must not also print its raw URL above it. A
 * segment is omitted only when this render produced (or the parent already
 * shows) a representation; an unrepresented link keeps its safe anchor, and an
 * ordinary safe URL always stays clickable. This shell never fetches: report
 * cards come from the parent callback on every render, YouTubeEmbed owns
 * playback, and the generic card owns its own metadata request. A link is hidden
 * only when `GenericLinkPreview` is mounted for it, which is exactly the
 * addresses where that component always renders its own safe anchor. HTTP, local
 * and otherwise non-previewable addresses keep the inline anchor instead.
 *
 * Removing a link must not rewrite the author's body. Only the horizontal gap
 * the link used to sit against is closed; a line break they wrote survives, so
 * `before URL\nafter` still reads as two lines.
 */
export function ChatMessageText({ body, className, contextReportId, renderReportPreview }: ChatMessageTextProps) {
  const segments = segmentChatTextLinks(body);
  const suppressedReport = contextReportId?.toLowerCase();
  const seenReports = new Set<string>();
  /** Reports whose parent preview was empty in this render; their anchor stays. */
  const unrepresentedReports = new Set<string>();
  const seenVideos = new Set<string>();
  /** Normalized destinations that already own one generic card. */
  const seenLinks = new Set<string>();
  const previewNodes: ReactNode[] = [];
  /** Link segment indexes whose raw URL is represented by a preview. */
  const represented = new Set<number>();

  // One linear pass in body order: each report card, player and generic card
  // appears at its first occurrence only, and every represented URL is hidden
  // from the prose.
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment.kind !== "link") continue;
    if (segment.reportId) {
      // The parent's own card above the body already represents this report.
      if (segment.reportId === suppressedReport) {
        represented.add(index);
        continue;
      }
      // A repeated id never gets a second card, but it is still represented.
      if (seenReports.has(segment.reportId)) {
        represented.add(index);
        continue;
      }
      // No card means no representation: keep the safe anchor so the reader can
      // still reach the report instead of losing navigation to a hidden URL.
      // The callback is asked once per id, never once per occurrence.
      if (unrepresentedReports.has(segment.reportId)) continue;
      const preview = renderReportPreview(segment.reportId);
      if (preview === null || preview === undefined || preview === false) {
        unrepresentedReports.add(segment.reportId);
        continue;
      }
      seenReports.add(segment.reportId);
      represented.add(index);
      previewNodes.push(<Fragment key={`report:${segment.reportId}`}>{preview}</Fragment>);
      continue;
    }
    if (segment.youtubeId) {
      represented.add(index);
      if (seenVideos.has(segment.youtubeId)) continue;
      seenVideos.add(segment.youtubeId);
      previewNodes.push(<YouTubeEmbed key={`video:${segment.youtubeId}`} url={segment.href} compact />);
      continue;
    }
    // An ordinary previewable link gets one card, deduped by its normalized
    // destination. Only the destinations where GenericLinkPreview always renders
    // its own safe anchor are represented; everything else keeps the anchor.
    if (!isPreviewableLink(segment.href)) continue;
    const target = normalizePreviewUrl(segment.href);
    if (target === null) continue;
    represented.add(index);
    if (seenLinks.has(target)) continue;
    seenLinks.add(target);
    previewNodes.push(<GenericLinkPreview key={`link:${target}`} href={segment.href} />);
  }

  type Piece = { kind: "text"; text: string } | { kind: "node"; node: ReactNode };
  const pieces: Piece[] = [];
  /** Trailing characters of the last thing this paragraph actually shows. */
  let lastTail = "";
  /** A represented link sits between the previous piece and whatever comes next. */
  let holePending = false;
  /** The hole was followed only by a line break; the next visible item owns it. */
  let pendingBreak = "";

  const pushText = (text: string) => {
    if (text === "") return;
    pieces.push({ kind: "text", text });
    lastTail = text;
  };

  /** Close the horizontal gap that sat beside the removed link. */
  const trimLinkGap = () => {
    const last = pieces[pieces.length - 1];
    if (last?.kind !== "text") return;
    last.text = last.text.replace(/[ \t]+$/, "");
    lastTail = last.text;
  };

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment.kind === "link" && represented.has(index)) {
      holePending = true;
      continue;
    }
    if (segment.kind === "link") {
      // A visible, unrepresented link is real prose. A break or one needed space
      // still separates it from whatever the hidden link used to sit between.
      if (pendingBreak !== "") {
        if (!/[\r\n][ \t]*$/.test(lastTail)) pushText(pendingBreak);
        pendingBreak = "";
      }
      if (holePending) {
        trimLinkGap();
        if (lastTail.trim() !== "" && !/[\r\n][ \t]*$/.test(lastTail)
          && needsSeparator(lastTail, segment.text)) pushText(" ");
        holePending = false;
      }
      const report = segment.reportId ? parseReportLink(segment.href) : null;
      pieces.push({
        kind: "node",
        node: report
          ? <Link key={`link:${index}`} className="fb-chat-message-link" to={report.route}>{segment.text}</Link>
          : <a key={`link:${index}`} className="fb-chat-message-link" href={segment.href}
            target="_blank" rel="noopener noreferrer">{segment.text}</a>,
      });
      lastTail = segment.text;
      continue;
    }
    let text = segment.text;
    if (!holePending && pendingBreak === "") {
      pushText(text);
      continue;
    }
    pendingBreak = "";
    const leading = LEADING_WHITESPACE.exec(text)?.[0] ?? "";
    const rest = text.slice(leading.length);
    if (holePending) {
      trimLinkGap();
      holePending = false;
      if (lastTail.trim() === "") {
        // A link that opened the message leaves no invented blank first line.
        pushText(rest);
        continue;
      }
      const previousHasBreak = /[\r\n][ \t]*$/.test(lastTail);
      // Keep the author's own line breaks verbatim; only the horizontal gap
      // around the link is the hole we close.
      const firstBreak = leading.search(/[\r\n]/);
      const breakPrefix = firstBreak === -1 ? "" : leading.slice(firstBreak);
      if (rest === "") {
        // Only spacing followed the link. A break is deferred to the next
        // visible item so a hidden link at the end leaves no trailing blank.
        if (breakPrefix !== "" && !previousHasBreak) pendingBreak = breakPrefix;
        else if (breakPrefix === "") holePending = true;
        continue;
      }
      if (previousHasBreak) text = rest;
      else if (breakPrefix !== "") text = `${breakPrefix}${rest}`;
      else text = needsSeparator(lastTail, rest) ? ` ${rest}` : rest;
    }
    pushText(text);
  }

  // A represented link at the very end owns no trailing blank: the whitespace
  // before it only separated the URL. A deferred break at the end is dropped.
  if (holePending) {
    const last = pieces[pieces.length - 1];
    if (last?.kind === "text") last.text = last.text.replace(/\s+$/, "");
  }

  const children = pieces.flatMap((piece) => piece.kind === "node"
    ? [piece.node]
    : piece.text === "" ? [] : [piece.text]);

  return <>
    {children.length > 0 && <p className={className ? `fb-chat-message-text ${className}` : "fb-chat-message-text"} dir="auto">
      {children}
    </p>}
    {previewNodes.length > 0 && <div className="fb-chat-message-previews">{previewNodes}</div>}
  </>;
}
