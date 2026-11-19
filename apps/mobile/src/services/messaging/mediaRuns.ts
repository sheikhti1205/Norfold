import { parseChatFileMarker } from "./files";
import type { MediaAttachment, StoredHumanMessage } from "./history";
import { isVoiceMime } from "./media";

/**
 * Pure transcript grouping for photos and videos (owner direction 2026-11-19).
 *
 * There is no durable batch identity in the message model. The only value one
 * selection shares is the composition instant already transported as
 * `createdAt`, so that instant - never a wall-clock guess - decides membership.
 * Timestamps are read, never written, and no body or attachment metadata is
 * rewritten here.
 *
 * A run is built from the ordered stored transcript:
 *
 * - Photos are `MEDIA` rows. Attachment metadata never proves bytes exist:
 *   `QUEUED`, `UPLOADING`, `FAILED`, `EVICTED` and a missing record all stay in
 *   the run, so a retrying or re-downloadable photo keeps its place.
 * - Videos are `TEXT` rows whose body parses through the canonical chat-file
 *   marker with kind `video`. Voice (`VOICE`), audio, documents, archives,
 *   file-lane images, stickers and bare GIF links are not part of this model.
 * - Photos and videos mix freely in one run: one selection can contain both.
 *
 * The rolling gap is measured against the previous media item, not the run's
 * first item, and is accepted only when both instants are positive and the gap
 * is at most `MEDIA_RUN_MAX_GAP_MS`. Equal instants therefore group even when
 * upload latency stores or echoes them apart, and a retry that reuses the
 * instant keeps the same run. `createdAt === 0` is the durable "never observed"
 * sentinel written by backup/restore, not a 1970 composition instant, so it is
 * never groupable. The run also breaks on a non-media row, an
 * author/conversation change, a reply-target or report-context change, an
 * unsent row, a missing/invalid/zero/negative instant, and a local
 * calendar-day boundary.
 *
 * Captions never break a run and are never moved: every message keeps its own
 * body, so a grouped renderer must show the caption that belongs to each item
 * instead of promoting one caption to a leader or silently dropping the rest.
 *
 * Every input message appears exactly once, in input order. A non-media row is
 * its own `single` and closes any open group, so a caller can render the whole
 * transcript from these runs without losing text, voice, location or files.
 * A `group` always holds at least two media rows; deleting members can only
 * collapse it back to `single`.
 */

/** Longest accepted gap between two media items in one run. */
export const MEDIA_RUN_MAX_GAP_MS = 60_000;

/** One transcript run: a lone message, or an album of at least two media rows. */
export type MediaRun =
  | { kind: "single"; key: string; messages: StoredHumanMessage[] }
  | { kind: "group"; key: string; messages: StoredHumanMessage[] };

type MediaKind = "photo" | "video";

/**
 * The local calendar day, using the same boundary as `formatChatDay` so a day
 * chip and a run boundary can never disagree. A numeric key avoids locale
 * formatting and keeps the comparison deterministic inside one timezone.
 */
function localDayKey(epochMs: number): number {
  const date = new Date(epochMs);
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();
}

/** A usable composition instant: a positive safe integer in epoch ms.
 *
 * Zero is the durable "never observed" sentinel that backup/restore writes
 * (`createdAt ?? 0`), not a real 1970 composition time. Treating it as valid
 * would group unrelated legacy rows that share the same unknown instant.
 */
function chatInstant(value: number | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function mediaKindOf(
  message: StoredHumanMessage,
  attachment: MediaAttachment | undefined,
): MediaKind | null {
  // An unsent row is a tombstone with an empty body: never media, always a
  // boundary. Its stored position is still preserved as a single.
  if (message.unsentAt !== undefined) return null;
  if (message.messageType === "MEDIA") {
    // Voice travels as VOICE, but a stale record must not turn a photo row into
    // audio. Anything else is a photo even when its bytes are absent.
    return attachment && isVoiceMime(attachment.mime) ? null : "photo";
  }
  if (message.messageType === "VOICE" || message.messageType === "LOCATION") return null;
  // Legacy rows may omit the classification; the canonical marker is the proof.
  return parseChatFileMarker(message.body)?.kind === "video" ? "video" : null;
}

/** Whether `next` continues the run whose last media row is `previous`. */
function joinsRun(previous: StoredHumanMessage, next: StoredHumanMessage): boolean {
  if (previous.conversationId !== next.conversationId) return false;
  if (previous.authorId !== next.authorId) return false;
  // One selection carries one reply target and one report context. A change
  // means a different gesture, even when the instants happen to match.
  if (previous.replyToId !== next.replyToId) return false;
  if (previous.contextReportId !== next.contextReportId) return false;
  const previousAt = chatInstant(previous.createdAt);
  const nextAt = chatInstant(next.createdAt);
  if (previousAt === null || nextAt === null) return false;
  const delta = nextAt - previousAt;
  if (delta < 0 || delta > MEDIA_RUN_MAX_GAP_MS) return false;
  return localDayKey(previousAt) === localDayKey(nextAt);
}

/**
 * Partition an ordered transcript into stable single/group runs.
 *
 * `media` is the attachment metadata read alongside the messages. Its order is
 * irrelevant; only the record's `messageId` and `mime` are consulted, and the
 * first record for a message wins (the durable schema allows one).
 */
export function buildMediaRuns(
  messages: readonly StoredHumanMessage[],
  media: readonly MediaAttachment[],
): MediaRun[] {
  const attachments = new Map<string, MediaAttachment>();
  for (const attachment of media) {
    if (!attachments.has(attachment.messageId)) attachments.set(attachment.messageId, attachment);
  }

  const runs: MediaRun[] = [];
  let open: StoredHumanMessage[] = [];

  function closeOpenRun(): void {
    const first = open[0];
    if (!first) return;
    runs.push(open.length >= 2
      ? { kind: "group", key: `group:${first.id}`, messages: open }
      : { kind: "single", key: `single:${first.id}`, messages: open });
    open = [];
  }

  for (const message of messages) {
    if (mediaKindOf(message, attachments.get(message.id)) === null) {
      closeOpenRun();
      runs.push({ kind: "single", key: `single:${message.id}`, messages: [message] });
      continue;
    }
    const previous = open[open.length - 1];
    if (previous && joinsRun(previous, message)) {
      open.push(message);
      continue;
    }
    closeOpenRun();
    open.push(message);
  }
  closeOpenRun();
  return runs;
}
