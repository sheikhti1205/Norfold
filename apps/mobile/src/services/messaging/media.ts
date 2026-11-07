/**
 * Chat media metadata: the transport-independent record both storage adapters
 * agree on, plus the byte-level checks they must never delegate to a caller.
 *
 * The bytes themselves never live here. They live in the IndexedDB byte store
 * (`mediaBytes.ts`) on every platform, because the messaging SQLite bridge
 * cannot carry binary and a second native owner would be a new durable store to
 * get wrong. This module owns only the metadata that must be identical on
 * Android and web, so a record written by one adapter can be reasoned about by
 * the other.
 */
import { uuid } from "./validation";

/** Server-side upload ceiling per attachment (chat-media gateway). */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Owner-approved logical per-account budget of decoded bytes, 2026-10-28.
 * Logical: IndexedDB and page overhead mean real disk use is higher, so the UI
 * must never present this as a disk quota.
 */
export const MEDIA_BUDGET_BYTES = 100 * 1024 * 1024;

/** The only still-image containers the chat gateway accepts. */
export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMime = (typeof MEDIA_MIME_TYPES)[number];

/**
 * The audio containers the chat gateway accepts. The codecs parameter is never
 * stored: the container is the validated, signed identity and what playback
 * needs, so `audio/webm;codecs=opus` is normalised before it reaches a record.
 */
export const VOICE_MIME_TYPES = ["audio/webm", "audio/mp4"] as const;
export type VoiceMime = (typeof VOICE_MIME_TYPES)[number];

export type MediaMime = ImageMime | VoiceMime;

/**
 * How long freshly stored bytes are exempt from the orphan sweep.
 *
 * The store and the history adapter are two durable stores, so "bytes exist but
 * no attachment row yet" is a legitimate transient state during a send, not
 * proof of an orphan. Without a grace window the sweep could delete the only
 * copy of a photo between `put` and the row write, and the row would then claim
 * bytes that do not exist. Fifteen minutes is far longer than the gap between
 * those two writes, and the sweep is bounded and repeatable, so a genuinely
 * orphaned entry is still reclaimed on a later pass.
 */
export const MEDIA_SWEEP_GRACE_MS = 15 * 60_000;

/**
 * `QUEUED`, `UPLOADING` and `FAILED` are outgoing-only. `READY` means the
 * object is on the server *and* the delivery ACK was recorded — never merely
 * that the text echo arrived.
 */
export const MEDIA_STATES = [
  "QUEUED", "UPLOADING", "FAILED", "AWAITING_ACK", "READY", "EVICTED",
] as const;
export type MediaState = (typeof MEDIA_STATES)[number];

export type MediaDirection = "OUT" | "IN";

export const MEDIA_MAX_EDGE = 8192;

const SHA256 = /^[0-9a-f]{64}$/;

export interface MediaMetadata {
  /** Attachment id: server-issued for inbound, client-issued for outbound. */
  id: string;
  messageId: string;
  direction: MediaDirection;
  /** Lowercase hex. Recomputed locally before any byte is stored or sent. */
  sha256: string;
  mime: MediaMime;
  byteSize: number;
  width: number;
  height: number;
  /**
   * Voice-note length in milliseconds. `null` for a still image.
   *
   * A voice note keeps the attachment contract's dimension columns with the
   * sentinel `1 x 1`, because every layer (local SQLite CHECK, server CHECK,
   * peer manifest) requires positive dimensions and a second nullable triple
   * would be a second shape to keep in step. `isVoiceMime` is the discriminator;
   * no renderer reads width/height for audio.
   */
  durationMs: number | null;
  /** Server retention boundary in epoch milliseconds, when known. */
  expiresAt: number | null;
}

export interface MediaRecord extends MediaMetadata {
  state: MediaState;
  attempts: number;
  lastAccessAt: number;
  token?: string;
  leaseUntil?: number;
}

/** The lease a caller may hold over one attachment upload. */
export interface MediaUploadAttempt {
  attachmentId: string;
  messageId: string;
  sha256: string;
  token: string;
  attempt: number;
}

export function isMediaSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

export function isImageMime(value: unknown): value is ImageMime {
  return typeof value === "string" && (MEDIA_MIME_TYPES as readonly string[]).includes(value);
}

export function isVoiceMime(value: unknown): value is VoiceMime {
  return typeof value === "string" && (VOICE_MIME_TYPES as readonly string[]).includes(value);
}

export function isMediaMime(value: unknown): value is MediaMime {
  return isImageMime(value) || isVoiceMime(value);
}

/** Normalise a recorded container type to its stored form. */
export function storedMediaMime(recorded: string): string {
  return recorded.split(";")[0]?.trim().toLowerCase() ?? "";
}

export const VOICE_MIN_DURATION_MS = 500;
export const VOICE_MAX_DURATION_MS = 5 * 60_000;

/** The sentinel dimensions a voice attachment carries. */
export const VOICE_SENTINEL_EDGE = 1;

function boundedInteger(value: unknown, maximum: number, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Invalid media ${what}`);
  }
  return value;
}

/**
 * Validate and copy untrusted metadata. Every field is checked because a
 * record that reaches storage has already crossed a network or caller boundary;
 * the adapters call this rather than trusting their arguments.
 */
export function copyMediaMetadata(value: unknown): MediaMetadata {
  const input = value as Partial<MediaMetadata> | null | undefined;
  if (!input || typeof input !== "object") throw new Error("Invalid media metadata");
  if (input.direction !== "OUT" && input.direction !== "IN") throw new Error("Invalid media direction");
  if (!isMediaSha256(input.sha256)) throw new Error("Invalid media digest");
  if (!isMediaMime(input.mime)) throw new Error("Unsupported media type");
  const byteSize = boundedInteger(input.byteSize, MEDIA_MAX_BYTES, "byte size");
  const voice = isVoiceMime(input.mime);
  const width = voice ? VOICE_SENTINEL_EDGE : boundedInteger(input.width, MEDIA_MAX_EDGE, "width");
  const height = voice ? VOICE_SENTINEL_EDGE : boundedInteger(input.height, MEDIA_MAX_EDGE, "height");
  if (voice && (input.width !== VOICE_SENTINEL_EDGE || input.height !== VOICE_SENTINEL_EDGE)) {
    throw new Error("Invalid voice dimensions");
  }
  let durationMs: number | null = null;
  if (voice) {
    const duration = input.durationMs;
    if (typeof duration !== "number" || !Number.isSafeInteger(duration)
      || duration < VOICE_MIN_DURATION_MS || duration > VOICE_MAX_DURATION_MS) {
      throw new Error("Invalid voice duration");
    }
    durationMs = duration;
  } else if (input.durationMs !== null && input.durationMs !== undefined) {
    throw new Error("Invalid media duration");
  }
  let expiresAt: number | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    if (typeof input.expiresAt !== "number" || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
      throw new Error("Invalid media expiry");
    }
    expiresAt = input.expiresAt;
  }
  return {
    id: uuid(input.id as string),
    messageId: uuid(input.messageId as string),
    direction: input.direction,
    sha256: input.sha256,
    mime: input.mime,
    byteSize,
    width,
    height,
    durationMs,
    expiresAt,
  };
}

/** Immutable identity: everything except expiry and the mutable state fields. */
export function sameMediaIdentity(a: MediaMetadata, b: MediaMetadata): boolean {
  return a.id === b.id && a.messageId === b.messageId && a.direction === b.direction
    && a.sha256 === b.sha256 && a.mime === b.mime && a.byteSize === b.byteSize
    && a.width === b.width && a.height === b.height && a.durationMs === b.durationMs;
}

/**
 * Whether eviction must refuse to touch this record.
 *
 * This is the exact complement of `isMediaEvictable`, so `EVICTED` is
 * "protected" as well — it is simply not a candidate, because its bytes are
 * already gone. Callers must not read this predicate as "the bytes exist";
 * that is `has()` on the byte store.
 */
export function isMediaProtected(state: MediaState): boolean {
  return state !== "READY";
}

/** Only a committed `READY` inbound record may be evicted and re-downloaded. */
export function isMediaEvictable(state: MediaState): boolean {
  return state === "READY";
}

/**
 * Hex SHA-256 of the exact bytes about to be stored or sent. Both adapters and
 * the transport call this instead of trusting a caller-supplied digest.
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Invalid media bytes");
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error("Media digest unavailable on this platform");
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Verify exact length and digest; never partially accept a byte stream. */
export async function verifyMediaBytes(metadata: MediaMetadata, bytes: ArrayBuffer): Promise<void> {
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Invalid media bytes");
  if (bytes.byteLength !== metadata.byteSize) throw new Error("Media byte length mismatch");
  if ((await sha256Hex(bytes)) !== metadata.sha256) throw new Error("Media digest mismatch");
}
