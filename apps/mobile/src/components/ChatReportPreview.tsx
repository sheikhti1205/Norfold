import type { PostItem } from "@norfold/shared";
import { PostLink } from "./PostNavigation";
import { StatusChip } from "./StatusChip";
import { formatEventDate } from "../utils/dates";
import "./ChatReportPreview.css";

export interface ChatReportPreviewProps {
  /** Already authorized by the parent session; this component never fetches. */
  post: PostItem;
  reportId: string;
  /** Media URL already resolved by the parent; no second media owner here. */
  coverSrc?: string | null;
}

/**
 * R19 owner correction 2026-11-20: a shared report inside a chat message reads
 * as one compact, message-integrated preview - picture, report kind, real title,
 * place/status/date and host - instead of a second painted card nested inside
 * the bubble. The bubble already owns the surface, so this adds no background,
 * border or corner of its own, and the whole preview is one link: no nested
 * buttons.
 */
export function ChatReportPreview({ post, reportId, coverSrc }: ChatReportPreviewProps) {
  const resolved = post.status === "MATCHED" || post.status === "RECOVERED" || post.status === "CLOSED";
  return <PostLink className="fb-chat-report-preview" to={`/posts/${encodeURIComponent(reportId)}`}
    data-chat-report={reportId}>
    {coverSrc ? <img className="fb-chat-report-preview-media" src={coverSrc} alt="" loading="lazy" />
      : <span className="fb-chat-report-preview-media" aria-hidden="true" />}
    <span className="fb-chat-report-preview-copy">
      <span className="fb-chat-report-preview-kind">{post.type === "LOST" ? "Lost report" : "Found report"}</span>
      <strong className="fb-chat-report-preview-title" dir="auto">{post.title}</strong>
      {post.locationLabel && <span className="fb-chat-report-preview-place" dir="auto">{post.locationLabel}</span>}
      <span className="fb-chat-report-preview-meta">
        {resolved && <StatusChip post={post} />}
        {post.eventDate && <time dateTime={post.eventDate}>{formatEventDate(post.eventDate)}</time>}
      </span>
    </span>
  </PostLink>;
}
