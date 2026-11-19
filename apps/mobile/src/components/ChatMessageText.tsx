import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { segmentChatTextLinks } from "../utils/chatTextLinks";
import { parseReportLink } from "../utils/reportLinks";
import { YouTubeEmbed } from "./YouTubeEmbed";
import "./ChatMessageText.css";

export interface ChatMessageTextProps {
  body: string;
  /** Passed to the existing bubble paragraph (for example `fb-chat-emoji-only`). */
  className?: string;
  /** A report already shown by this message; its link stays, its card is suppressed. */
  contextReportId?: string;
  /** The parent owns the live report card, including its safety key. */
  renderReportPreview: (reportId: string) => ReactNode;
}

/**
 * R19-2 chat body rendering: exact visible text with safe native links, plus
 * compact secondary previews. The component never fetches, caches or decides
 * report authority; report cards come from the parent callback on every render,
 * and the canonical YouTubeEmbed owns playback.
 */
export function ChatMessageText({ body, className, contextReportId, renderReportPreview }: ChatMessageTextProps) {
  const segments = segmentChatTextLinks(body);
  const suppressedReport = contextReportId?.toLowerCase();
  const seenReports = new Set<string>();
  const seenVideos = new Set<string>();
  const previewNodes: ReactNode[] = [];

  // One linear pass in body order: links all stay visible, each report card and
  // player appears at its first occurrence only. A preview that produces no
  // content is not given an empty slot, so the container only exists for real
  // canonical content.
  for (const segment of segments) {
    if (segment.kind !== "link") continue;
    if (segment.reportId) {
      if (segment.reportId === suppressedReport || seenReports.has(segment.reportId)) continue;
      seenReports.add(segment.reportId);
      const preview = renderReportPreview(segment.reportId);
      if (preview !== null && preview !== undefined && preview !== false) {
        previewNodes.push(<Fragment key={`report:${segment.reportId}`}>{preview}</Fragment>);
      }
      continue;
    }
    if (segment.youtubeId && !seenVideos.has(segment.youtubeId)) {
      seenVideos.add(segment.youtubeId);
      previewNodes.push(<YouTubeEmbed key={`video:${segment.youtubeId}`} url={segment.href} />);
    }
  }

  return <>
    <p className={className ? `fb-chat-message-text ${className}` : "fb-chat-message-text"} dir="auto">
      {segments.map((segment, index) => {
        if (segment.kind === "text") return segment.text;
        const report = segment.reportId ? parseReportLink(segment.href) : null;
        if (report) {
          return <Link key={`link:${index}`} className="fb-chat-message-link" to={report.route}>
            {segment.text}
          </Link>;
        }
        return <a key={`link:${index}`} className="fb-chat-message-link" href={segment.href}
          target="_blank" rel="noopener noreferrer">{segment.text}</a>;
      })}
    </p>
    {previewNodes.length > 0 && <div className="fb-chat-message-previews">{previewNodes}</div>}
  </>;
}
