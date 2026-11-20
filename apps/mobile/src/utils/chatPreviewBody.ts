import { isPreviewableLink, normalizePreviewUrl } from "../services/linkPreview";
import { segmentChatTextLinks } from "./chatTextLinks";

/**
 * True when a body is nothing but whitespace and links that the transcript
 * turns into a preview card.
 *
 * A mixed send used to make a bare YouTube link the caption of the first photo
 * or file, producing one oversized composite bubble. Such a body is its own
 * text message instead. The link policy is the renderer's own: a card exists
 * for a report id, a YouTube id, or the shared previewable-URL rule
 * (`isPreviewableLink` plus a normalized destination), and a bare anchor alone
 * is not a card. The body is read, never trimmed or rewritten.
 */
export function isStandalonePreviewBody(body: string): boolean {
  let links = 0;
  let previewBearing = false;
  for (const segment of segmentChatTextLinks(body)) {
    if (segment.kind === "text") {
      if (segment.text.trim() !== "") return false;
      continue;
    }
    links += 1;
    if (!previewBearing && (segment.reportId !== undefined || segment.youtubeId !== undefined
      || (isPreviewableLink(segment.href) && normalizePreviewUrl(segment.href) !== null))) {
      previewBearing = true;
    }
  }
  return links > 0 && previewBearing;
}
