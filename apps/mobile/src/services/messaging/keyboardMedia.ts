import {
  IMPORT_MAX_DERIVATIVE_BYTES, probeDimensions, sniffImage, stripGifMetadata, stripPngExIfChunk,
  stripWebpExifChunk, type SniffedKind,
} from "../media/importImage";
import {
  isNativeMediaIntakeAvailable, onKeyboardMedia, onKeyboardMediaEligibility, onKeyboardMediaRejected,
  readKeyboardMediaBytes, releaseKeyboardMedia, setKeyboardMediaEligibility, type KeyboardMediaArrival,
} from "../media/nativeMedia";

/**
 * R19 admission owner for keyboard/provider and image-only paste arrivals.
 *
 * One place decides whether an arrival belongs to the live composer, pulls the
 * native-owned bytes in bounded chunks, verifies the sniffed container and
 * returns a sanitized staged item. Nothing here uploads or sends: the chat
 * tray owns that boundary. The native side owns the content URI and its
 * permission; this module only ever sees an opaque request id.
 */

/** Existing private file-lane ceiling. Animation candidates never exceed it. */
export const KEYBOARD_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
/** A still derivative is already bounded by canonical native preparation. */
export const KEYBOARD_MEDIA_MAX_STILL_BYTES = IMPORT_MAX_DERIVATIVE_BYTES;
/** Longest edge accepted for either lane; the tray and viewer rely on it. */
export const KEYBOARD_MEDIA_MAX_EDGE = 8192;
const MAX_SEEN_REQUESTS = 32;
const REQUEST_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export const KEYBOARD_MEDIA_REJECTED =
  "That image or GIF couldn't be added. Try a different one.";

export type StagedImageKind = "still" | "animation";

export interface VerifiedKeyboardMedia {
  kind: StagedImageKind;
  /** Sniffed container type, never the declared or provider string. */
  mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  bytes: Uint8Array;
  width: number;
  height: number;
  animated: boolean;
}

export interface KeyboardMediaOwner {
  accountId: string;
  conversationId: string;
}

export interface KeyboardMediaSession {
  /** Advertise the live composer, or withdraw when `null`. Idempotent. */
  sync(owner: KeyboardMediaOwner | null): void;
  /** Withdraw, release outstanding requests and drop native listeners. */
  destroy(): void;
}

export interface KeyboardMediaSessionOptions {
  onMedia: (media: VerifiedKeyboardMedia & { requestId: string }) => void | Promise<void>;
  onRejected: (message: string) => void;
}

/** Any GIF travels the file lane so a single-frame sticker never becomes a JPEG. */
export function classifyStagedKind(kind: SniffedKind | null): StagedImageKind | null {
  if (kind === null) return null;
  if (kind === "gif" || kind === "gif-animated") return "animation";
  if (kind === "webp-animated" || kind === "png-animated") return "animation";
  if (kind === "jpeg" || kind === "png" || kind === "webp") return "still";
  return null;
}

function mimeOf(_bytes: Uint8Array, kind: SniffedKind): VerifiedKeyboardMedia["mime"] {
  if (kind === "jpeg") return "image/jpeg";
  if (kind === "gif" || kind === "gif-animated") return "image/gif";
  if (kind === "webp" || kind === "webp-animated") return "image/webp";
  return "image/png";
}

/**
 * Metadata-free animation rebuild using the canonical photo-intake strippers,
 * so frames, delays, loop count and transparency survive while comments,
 * EXIF/XMP, ICC and unknown extensions are discarded.
 */
export function sanitizeAnimatedImage(bytes: Uint8Array, kind: SniffedKind): Uint8Array | null {
  if (kind === "gif" || kind === "gif-animated") return stripGifMetadata(bytes);
  if (kind === "webp-animated") return stripWebpExifChunk(bytes);
  if (kind === "png-animated") return stripPngExIfChunk(bytes);
  return null;
}

function dimensionsOf(bytes: Uint8Array, kind: SniffedKind): { width: number; height: number } | null {
  const size = probeDimensions(bytes, kind);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  if (size.width > KEYBOARD_MEDIA_MAX_EDGE || size.height > KEYBOARD_MEDIA_MAX_EDGE) return null;
  return size;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string | null {
  if (offset < 0 || offset + length > bytes.length) return null;
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[offset + index]!);
  return out;
}

function u32beAt(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16)
    + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function u32leAt(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (bytes[offset]! | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

/**
 * One ANMF frame payload must carry its own image bitstream: an optional ALPH
 * chunk, then exactly one VP8 or VP8L chunk long enough to hold its required
 * header. The nested walk must end exactly at the frame's declared data end, so
 * a frame header with no image, a truncated nested chunk or a nested chunk of
 * the wrong kind is not a preserved frame.
 */
function webpFrameImageComplete(bytes: Uint8Array, start: number, end: number): boolean {
  let offset = start;
  let hasAlpha = false;
  let sawImage = false;
  while (offset < end) {
    const fourcc = asciiAt(bytes, offset, 4);
    const size = u32leAt(bytes, offset + 4);
    if (fourcc === null || size === null) return false;
    const dataStart = offset + 8;
    const padded = size + (size % 2);
    if (dataStart + padded > end) return false;
    if (fourcc === "ALPH") {
      if (hasAlpha || sawImage || size === 0) return false;
      hasAlpha = true;
    } else if (fourcc === "VP8 ") {
      // Frame tag (3) + keyframe start code (3) + 16-bit dimensions (4).
      if (sawImage || size < 10) return false;
      if (bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01 || bytes[dataStart + 5] !== 0x2a) {
        return false;
      }
      sawImage = true;
    } else if (fourcc === "VP8L") {
      // 0x2f signature + 14-bit dimensions and alpha flag.
      if (sawImage || size < 5 || bytes[dataStart] !== 0x2f) return false;
      sawImage = true;
    } else {
      // Nothing else is legal inside a frame payload.
      return false;
    }
    offset = dataStart + padded;
  }
  return offset === end && sawImage;
}

/**
 * Frame count of a structurally complete animated WebP, or null.
 *
 * The shared WebP stripper keeps whatever chunks it could read and rebuilds the
 * container, so a truncated ANMF would become a shorter animation. This walk
 * refuses that input instead: the RIFF declaration must match the file
 * exactly, every chunk must fit its declared size, the animation must carry its
 * VP8X flag, its ANIM chunk and at least one frame, and every frame must carry
 * a complete image bitstream.
 */
function webpFrameCount(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  if (asciiAt(bytes, 0, 4) !== "RIFF" || asciiAt(bytes, 8, 4) !== "WEBP") return null;
  const declared = u32leAt(bytes, 4);
  if (declared === null || bytes.length !== 8 + declared) return null;
  let offset = 12;
  let sawCanvas = false;
  let sawAnimation = false;
  let frames = 0;
  while (offset < bytes.length) {
    const fourcc = asciiAt(bytes, offset, 4);
    const size = u32leAt(bytes, offset + 4);
    if (fourcc === null || size === null) return null;
    const dataStart = offset + 8;
    const padded = size + (size % 2);
    if (dataStart + padded > bytes.length) return null;
    if (fourcc === "VP8X") {
      if (size < 10) return null;
      if ((bytes[dataStart]! & 0x02) === 0) return null;
      sawCanvas = true;
    } else if (fourcc === "ANIM") {
      if (size < 6) return null;
      sawAnimation = true;
    } else if (fourcc === "ANMF") {
      // 16 bytes of frame header precede the frame's own image data.
      if (size < 16) return null;
      if (!webpFrameImageComplete(bytes, dataStart + 16, dataStart + size)) return null;
      frames += 1;
    }
    offset = dataStart + padded;
  }
  if (offset !== bytes.length || !sawCanvas || !sawAnimation || frames === 0) return null;
  return frames;
}

/**
 * Frame count of a structurally complete APNG, or null.
 *
 * The shared PNG stripper keeps whatever chunks it could read, so a missing
 * IEND, an orphan fcTL or a frame whose data never arrived would become a
 * partial animation. This walk refuses each of those: every chunk must fit,
 * IEND must be present and last, `acTL` must declare at least one frame, each
 * `fcTL` must have received image data (the first frame may be carried by
 * `IDAT`, later frames by one or more `fdAT`), `fdAT` may not appear without an
 * open frame and may not be empty, the `fcTL`/`fdAT` sequence numbers must be a
 * gapless run from zero, and the delivered frame count must equal the
 * declaration. Both legal layouts are accepted: the default image as the first
 * animated frame, or a default image that is not part of the animation. A
 * zero-length IDAT is a legal split but not image data, and the default image
 * itself must carry bytes in either layout.
 */
function apngFrameCount(bytes: Uint8Array): number | null {
  if (bytes.length < 8) return null;
  if (asciiAt(bytes, 0, 8) !== "\u0089PNG\r\n\u001a\n") return null;
  let offset = 8;
  let sawHeader = false;
  let declaredFrames: number | null = null;
  let nextSequence = 0;
  let completedFrames = 0;
  let openFrame = false;
  let frameHasData = false;
  let defaultImageHasData = false;
  let sawIEND = false;
  while (offset < bytes.length) {
    const length = u32beAt(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    if (length === null || type === null) return null;
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return null;
      sawHeader = true;
    } else if (type === "IHDR") {
      return null;
    }
    if (type === "acTL") {
      if (length !== 8 || declaredFrames !== null) return null;
      declaredFrames = u32beAt(bytes, offset + 8);
      if (declaredFrames === null || declaredFrames < 1) return null;
    } else if (type === "fcTL") {
      if (length !== 26 || declaredFrames === null) return null;
      // A new control chunk closes the previous frame, which must have been
      // given image data: a bare fcTL is an empty frame.
      if (openFrame) {
        if (!frameHasData) return null;
        completedFrames += 1;
      }
      const sequence = u32beAt(bytes, offset + 8);
      if (sequence !== nextSequence) return null;
      nextSequence += 1;
      openFrame = true;
      frameHasData = false;
    } else if (type === "fdAT") {
      // Orphan animation data (no fcTL) and an fdAT that carries only its
      // sequence number are both refused; several fdAT chunks may feed one
      // frame, so data is tracked per frame rather than per chunk.
      if (length <= 4 || declaredFrames === null || !openFrame) return null;
      const sequence = u32beAt(bytes, offset + 8);
      if (sequence !== nextSequence) return null;
      nextSequence += 1;
      frameHasData = true;
    } else if (type === "IDAT") {
      if (declaredFrames === null) return null;
      if (openFrame) {
        // Only the first controlled frame may be carried by IDAT, and it may
        // span several IDAT chunks. An empty chunk is a legal split but holds
        // no pixels, so only real data completes the frame.
        if (completedFrames !== 0) return null;
        if (length > 0) {
          frameHasData = true;
          defaultImageHasData = true;
        }
      } else if (completedFrames > 0) {
        // Image data with no controlling fcTL.
        return null;
      } else if (length > 0) {
        // The default image is not part of the animation, but it still has to
        // exist: an APNG with no default-image bytes is incomplete.
        defaultImageHasData = true;
      }
    } else if (type === "IEND") {
      if (length !== 0 || declaredFrames === null) return null;
      if (openFrame) {
        if (!frameHasData) return null;
        completedFrames += 1;
        openFrame = false;
        frameHasData = false;
      }
      if (completedFrames !== declaredFrames || !defaultImageHasData) return null;
      sawIEND = true;
      offset = end;
      break;
    }
    offset = end;
  }
  // A container that simply stops after its last frame has lost its trailer
  // and is not a complete animation.
  if (!sawHeader || !sawIEND || offset !== bytes.length) return null;
  return completedFrames;
}

/** Structural frame count for the two containers that can be silently shortened. */
function preservedFrameCount(bytes: Uint8Array, kind: SniffedKind): number | null {
  if (kind === "webp-animated") return webpFrameCount(bytes);
  if (kind === "png-animated") return apngFrameCount(bytes);
  return null;
}

/**
 * Verify one request's bytes against its arrival descriptor. The descriptor is
 * untrusted metadata; the sniffed container is the authority. A mismatch, a
 * flattened animation, a malformed or incomplete container throws instead of
 * staging.
 */
export function verifyKeyboardMedia(
  arrival: { kind: StagedImageKind; mime: string; width: number; height: number; byteLength: number },
  bytes: Uint8Array,
): VerifiedKeyboardMedia {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error(KEYBOARD_MEDIA_REJECTED);
  if (arrival.byteLength > 0 && arrival.byteLength !== bytes.length) throw new Error(KEYBOARD_MEDIA_REJECTED);
  if (bytes.length > KEYBOARD_MEDIA_MAX_BYTES) throw new Error(KEYBOARD_MEDIA_REJECTED);
  const sniffed = sniffImage(bytes);
  const kind = classifyStagedKind(sniffed);
  if (sniffed === null || kind === null || kind !== arrival.kind) throw new Error(KEYBOARD_MEDIA_REJECTED);
  const dimensions = dimensionsOf(bytes, sniffed);
  if (!dimensions) throw new Error(KEYBOARD_MEDIA_REJECTED);
  if (arrival.width > 0 && arrival.width !== dimensions.width) throw new Error(KEYBOARD_MEDIA_REJECTED);
  if (arrival.height > 0 && arrival.height !== dimensions.height) throw new Error(KEYBOARD_MEDIA_REJECTED);
  const mime = mimeOf(bytes, sniffed);
  if (arrival.mime && arrival.mime.startsWith("image/") && arrival.mime !== mime) throw new Error(KEYBOARD_MEDIA_REJECTED);

  if (kind === "still") {
    if (bytes.length > KEYBOARD_MEDIA_MAX_STILL_BYTES) throw new Error(KEYBOARD_MEDIA_REJECTED);
    return { kind, mime, bytes, width: dimensions.width, height: dimensions.height, animated: false };
  }

  // WebP and APNG can be silently shortened by the canonical strippers (they
  // rebuild whatever chunks they could read). Refuse a structurally incomplete
  // container before stripping, so no animation loses frames or its trailer.
  const shortenedKinds = sniffed === "webp-animated" || sniffed === "png-animated";
  const sourceFrames = shortenedKinds ? preservedFrameCount(bytes, sniffed) : null;
  if (shortenedKinds && sourceFrames === null) throw new Error(KEYBOARD_MEDIA_REJECTED);

  const sanitized = sanitizeAnimatedImage(bytes, sniffed);
  if (!sanitized || sanitized.length === 0 || sanitized.length > KEYBOARD_MEDIA_MAX_BYTES) throw new Error(KEYBOARD_MEDIA_REJECTED);
  const cleanKind = sniffImage(sanitized);
  // The rebuilt container must still be the same animated format with the same
  // canvas: a stripper that flattened or corrupted it is a refusal, not a send.
  if (cleanKind === null || classifyStagedKind(cleanKind) !== "animation" || mimeOf(sanitized, cleanKind) !== mime) {
    throw new Error(KEYBOARD_MEDIA_REJECTED);
  }
  if (cleanKind === "webp-animated" || cleanKind === "png-animated") {
    // Same frame count after the rebuild: the stripper may drop metadata, never
    // a frame or the container's trailer.
    const cleanFrames = preservedFrameCount(sanitized, cleanKind);
    if (cleanFrames === null || cleanFrames !== sourceFrames) throw new Error(KEYBOARD_MEDIA_REJECTED);
  }
  const cleanSize = dimensionsOf(sanitized, cleanKind);
  if (!cleanSize || cleanSize.width !== dimensions.width || cleanSize.height !== dimensions.height) {
    throw new Error(KEYBOARD_MEDIA_REJECTED);
  }
  return { kind, mime, bytes: sanitized, width: dimensions.width, height: dimensions.height, animated: true };
}

/** Classify a pasted image without reading its full body. */
export async function classifyClipboardImage(file: File): Promise<StagedImageKind | null> {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > 100 * 1024 * 1024) return null;
  const type = (file.type || "").toLowerCase();
  if (type !== "" && !type.startsWith("image/")) return null;
  const header = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  return classifyStagedKind(sniffImage(header));
}

/** Read and sanitize an animation pasted as a DOM File. */
export async function readClipboardAnimation(file: File): Promise<VerifiedKeyboardMedia> {
  if (file.size <= 0 || file.size > KEYBOARD_MEDIA_MAX_BYTES) throw new Error(KEYBOARD_MEDIA_REJECTED);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return verifyKeyboardMedia(
    { kind: "animation", mime: file.type.toLowerCase(), width: 0, height: 0, byteLength: bytes.length },
    bytes,
  );
}

function sameOwner(a: KeyboardMediaOwner | null, b: KeyboardMediaOwner | null): boolean {
  return a !== null && b !== null && a.accountId === b.accountId && a.conversationId === b.conversationId;
}

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function validArrival(value: unknown): value is KeyboardMediaArrival {
  if (!value || typeof value !== "object") return false;
  const arrival = value as Partial<KeyboardMediaArrival>;
  if (typeof arrival.requestId !== "string" || !REQUEST_ID.test(arrival.requestId)) return false;
  if (arrival.kind !== "still" && arrival.kind !== "animation") return false;
  if (typeof arrival.mime !== "string") return false;
  if (!Number.isInteger(arrival.width) || !Number.isInteger(arrival.height)
    || (arrival.width ?? 0) < 0 || (arrival.height ?? 0) < 0) return false;
  if (!Number.isSafeInteger(arrival.byteLength) || (arrival.byteLength ?? 0) <= 0
    || (arrival.byteLength ?? 0) > KEYBOARD_MEDIA_MAX_BYTES) return false;
  return true;
}

/**
 * One session per mounted conversation. Call `sync` whenever eligibility,
 * focus, visibility or route changes; call `destroy` on unmount. Every
 * asynchronous completion re-checks the session token, so a late read from a
 * previous owner can never stage into the new one.
 */
export function createKeyboardMediaSession(options: KeyboardMediaSessionOptions): KeyboardMediaSession {
  let alive = true;
  let token = 0;
  let desired: KeyboardMediaOwner | null = null;
  let enabled: KeyboardMediaOwner | null = null;
  let registered = false;
  let registering = false;
  const seen = new Set<string>();
  /** Ids this session currently owns: queued for handling or being read. */
  const owned = new Set<string>();
  const inFlight = new Set<string>();
  const removers: Array<() => void> = [];
  let pending: Promise<void> = Promise.resolve();

  const available = (): boolean => {
    try {
      return typeof isNativeMediaIntakeAvailable === "function" && isNativeMediaIntakeAvailable();
    } catch {
      return false;
    }
  };

  function releaseAll(): void {
    for (const id of inFlight) void releaseKeyboardMedia(id);
    inFlight.clear();
  }

  /** Native may already be gone; a withdrawn advertisement is not an error. */
  function advertise(next: KeyboardMediaOwner | null): void {
    const call = next === null
      ? setKeyboardMediaEligibility(false)
      : setKeyboardMediaEligibility(true, next);
    call.catch(() => undefined);
  }

  function forgetSeen(id: string): void {
    seen.add(id);
    if (seen.size <= MAX_SEEN_REQUESTS) return;
    const oldest = seen.values().next();
    if (!oldest.done) seen.delete(oldest.value);
  }

  function apply(): void {
    if (!alive || !registered) return;
    if (desired === null) {
      if (enabled === null) return;
      enabled = null;
      token += 1;
      releaseAll();
      advertise(null);
      return;
    }
    if (sameOwner(enabled, desired)) return;
    enabled = { ...desired };
    token += 1;
    releaseAll();
    advertise(enabled);
  }

  async function register(): Promise<void> {
    if (registered || registering || !alive || !available()) return;
    registering = true;
    let offMedia: (() => void) | null = null;
    let offEligibility: (() => void) | null = null;
    let offRejected: (() => void) | null = null;
    try {
      offMedia = await onKeyboardMedia((arrival) => { enqueue(arrival); });
      offEligibility = await onKeyboardMediaEligibility((event) => {
        // Native revokes ownership on foreground loss. Drop the advertisement
        // at once, then re-check after the current task: a genuine pause has
        // already made the document hidden by then, while a same-process
        // withdrawal (for example a restored WebView) is re-advertised.
        if (!alive || event?.eligible !== false) return;
        enabled = null;
        token += 1;
        releaseAll();
        if (desired === null) return;
        setTimeout(() => {
          if (!alive || desired === null || !documentVisible()) return;
          enabled = { ...desired };
          token += 1;
          advertise(enabled);
        }, 0);
      });
      offRejected = await onKeyboardMediaRejected((event) => {
        // Native refused the item before it ever became a request, so there is
        // no bytes path to fail: the visible rejection is the only signal. A
        // composer that already withdrew must not surface it late.
        if (!alive || desired === null || typeof event !== "object" || event === null) return;
        options.onRejected(KEYBOARD_MEDIA_REJECTED);
      });
      if (!alive) {
        offMedia?.(); offEligibility?.(); offRejected?.();
        return;
      }
      removers.push(offMedia, offEligibility, offRejected);
      registered = true;
      apply();
    } catch {
      // Bridge unavailable: a partial registration must not outlive the retry.
      offMedia?.(); offEligibility?.(); offRejected?.();
    } finally {
      registering = false;
    }
  }

  /** One arrival at a time, in commit order; no interleaved chunk reads. */
  function enqueue(arrival: KeyboardMediaArrival): void {
    if (!alive || !validArrival(arrival)) return;
    // A duplicate of an arrival this session still owns is the same insert:
    // ignore it outright. Releasing here would delete the native file the
    // original read is still pulling, mid-chunk.
    if (owned.has(arrival.requestId)) return;
    // A replay of a request this session already finished is dead weight: free
    // the native copy and stage nothing.
    if (seen.has(arrival.requestId)) { void releaseKeyboardMedia(arrival.requestId); return; }
    forgetSeen(arrival.requestId);
    owned.add(arrival.requestId);
    pending = pending.then(() => handleArrival(arrival)).catch(() => undefined);
  }

  async function handleArrival(arrival: KeyboardMediaArrival): Promise<void> {
    const owner = enabled ? { ...enabled } : null;
    const capture = token;
    try {
      if (!alive || !owner || desired === null) return;
      inFlight.add(arrival.requestId);
      const bytes = await readKeyboardMediaBytes(arrival.requestId, arrival.byteLength);
      if (!alive || capture !== token || !sameOwner(owner, enabled)) return;
      const media = verifyKeyboardMedia(arrival, bytes);
      if (!alive || capture !== token || !sameOwner(owner, enabled)) return;
      await options.onMedia({ ...media, requestId: arrival.requestId });
    } catch {
      if (alive && capture === token) options.onRejected(KEYBOARD_MEDIA_REJECTED);
    } finally {
      // Exactly one release per arrival, on every path: staged, refused, owner
      // changed or session destroyed. The id stops being owned only here, so a
      // duplicate can never free the bytes an unfinished read still needs.
      inFlight.delete(arrival.requestId);
      owned.delete(arrival.requestId);
      void releaseKeyboardMedia(arrival.requestId);
    }
  }

  return {
    sync(owner) {
      if (!alive) return;
      desired = owner && documentVisible() ? { ...owner } : null;
      if (!registered) { void register(); return; }
      apply();
    },
    destroy() {
      if (!alive) return;
      alive = false;
      desired = null;
      enabled = null;
      token += 1;
      releaseAll();
      for (const remove of removers.splice(0)) remove();
      if (registered) advertise(null);
      registered = false;
    },
  };
}
