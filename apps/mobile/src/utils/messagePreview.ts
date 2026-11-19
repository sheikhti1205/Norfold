import type { MessageType } from "../services/messaging/history";
import { chatFilePreview } from "../services/messaging/files";
import { klipyMessageKind, type KlipyMessageKind } from "../services/klipy";
import { isBareKlipyMediaBody, isChatFileMarkerBody } from "./messageCopy";

/** The slice of a stored chat message a one-line preview needs. */
export interface MessagePreviewSource {
  body: string;
  messageType?: MessageType;
  unsentAt?: number;
}

/**
 * The one visible name for a picked sticker or GIF (owner direction
 * 2026-11-19). A new send proves its kind in the body fragment; a body that
 * predates the marker proves nothing, so it is named "Sticker/GIF" instead of
 * guessing from an extension, its bytes or the URL shape. Every preview in the
 * app reads this mapping, so the conversation list, the message pill, chat
 * search and a quoted message cannot disagree.
 */
export function klipyPreviewLabel(kind: KlipyMessageKind | null): string {
  return kind === "sticker" ? "Sticker" : kind === "gif" ? "GIF" : "Sticker/GIF";
}

/**
 * The one-line text a chat list or the new-message pill shows for a message.
 *
 * Pure and synchronous: no fetch, no parser of its own, no stored-data change.
 * A reserved file marker resolves through the canonical parser to its visible
 * name, and a marker that does not parse (malformed, truncated, future
 * version) reads as "File" - the encoded payload is never shown. Everything
 * else mirrors the existing row semantics: visible text is returned exactly,
 * a bare KLIPY body reads as its proven kind (Sticker, GIF, or the honest
 * "Sticker/GIF" for a body that predates the kind marker), and only an empty
 * body falls back to the message type's consumer copy.
 */
export function messagePreview(message: MessagePreviewSource): string {
  if (message.unsentAt !== undefined) return "Message unsent";
  const { body } = message;
  // The classifier trims, so a marker after leading blank lines still counts.
  if (isChatFileMarkerBody(body)) return chatFilePreview(body) ?? "File";
  if (isBareKlipyMediaBody(body)) return klipyPreviewLabel(klipyMessageKind(body));
  // Ordinary bodies keep their whitespace, newlines and pasted URLs verbatim.
  if (body !== "") return body;
  if (message.messageType === "MEDIA") return "Photo";
  if (message.messageType === "VOICE") return "Voice message";
  if (message.messageType === "LOCATION") return "Location shared";
  return "Message";
}
