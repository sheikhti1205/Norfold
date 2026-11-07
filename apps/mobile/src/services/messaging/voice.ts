/**
 * Voice-note contract shared by the recorder, the composer, the attachment
 * metadata and the transcript bubble.
 *
 * A voice note is a real audio attachment: its bytes ride the same verified
 * upload/download path as a photo, its row is the same one-image-per-message
 * contract, and only the media type, the duration and the renderer differ.
 * Nothing here records or plays by itself; those owners are separate so the
 * contract can be validated without a microphone or an audio element.
 */

/** Longest note a human can record in one gesture. */
export const VOICE_MAX_MS = 5 * 60_000;

/** Anything shorter is an accidental tap, not a message. */
export const VOICE_MIN_MS = 500;

/**
 * Containers the gateway accepts, in preference order. Chromium (including the
 * Android WebView) records WebM/Opus; Safari records MP4/AAC. Both are real
 * MediaRecorder outputs, so the list is a capability probe rather than a wish.
 */
export const VOICE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;
export type VoiceMime = (typeof VOICE_MIME_TYPES)[number];

/**
 * The stored form always drops the codecs parameter: the container is what the
 * server validates and what playback needs, and a `;codecs=opus` suffix would
 * become part of the stored, signed identity.
 */
export function storedVoiceMime(recorded: string): string {
  return recorded.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isVoiceMime(value: unknown): value is VoiceMime | string {
  if (typeof value !== "string") return false;
  const stored = storedVoiceMime(value);
  return stored === "audio/webm" || stored === "audio/mp4";
}

/** Whole seconds plus tenths, e.g. `1:04`. Used on the bubble and while recording. */
export function formatVoiceDuration(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Bound a measured duration to the accepted window and round to milliseconds. */
export function normalizeVoiceDuration(milliseconds: number): number {
  if (!Number.isFinite(milliseconds)) throw new Error("Invalid voice duration");
  return Math.min(VOICE_MAX_MS, Math.max(VOICE_MIN_MS, Math.round(milliseconds)));
}

/** The one sentence a blocked microphone shows. Never developer copy. */
export const VOICE_PERMISSION_DENIED =
  "Microphone access is off for Norfold. Allow it in your browser or system settings to send voice messages.";
export const VOICE_UNAVAILABLE = "Voice messages aren’t available on this device.";
export const VOICE_RECORD_FAILED = "That recording didn’t save. Try again.";
