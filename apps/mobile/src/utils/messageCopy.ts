import { isKlipyMediaUrl } from "../services/klipy";
import {
  CHAT_FILE_MARKER_PREFIX,
  chatFileCaption,
  parseChatFileMarker,
} from "../services/messaging/files";

/** The slice of a stored message the Copy policy needs. */
export interface CopyableMessage {
  body: string;
  unsentAt?: number;
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
