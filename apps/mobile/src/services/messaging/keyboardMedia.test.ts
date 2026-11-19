// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  classifyClipboardImage, createKeyboardMediaSession, readClipboardAnimation,
  verifyKeyboardMedia, KEYBOARD_MEDIA_REJECTED,
} from "./keyboardMedia";
import type { KeyboardMediaArrival } from "../media/nativeMedia";

const m = vi.hoisted(() => ({
  available: true,
  media: null as null | ((event: unknown) => void),
  eligibility: null as null | ((event: unknown) => void),
  rejected: null as null | ((event: unknown) => void),
  setEligibility: vi.fn((_eligible: boolean, _context?: { accountId: string; conversationId: string }) =>
    Promise.resolve(true)),
  read: vi.fn((_requestId: string, _byteLength: number): Promise<Uint8Array> =>
    Promise.resolve(new Uint8Array())),
  release: vi.fn((_requestId: string) => Promise.resolve()),
}));

vi.mock("../media/nativeMedia", () => ({
  isNativeMediaIntakeAvailable: () => m.available,
  setKeyboardMediaEligibility: m.setEligibility,
  readKeyboardMediaBytes: m.read,
  releaseKeyboardMedia: m.release,
  onKeyboardMedia: async (listener: (event: unknown) => void) => {
    m.media = listener;
    return () => { m.media = null; };
  },
  onKeyboardMediaEligibility: async (listener: (event: unknown) => void) => {
    m.eligibility = listener;
    return () => { m.eligibility = null; };
  },
  onKeyboardMediaRejected: async (listener: (event: unknown) => void) => {
    m.rejected = listener;
    return () => { m.rejected = null; };
  },
}));

const REQUEST_ID = "3f7c1a2b-9d4e-4a6f-8b21-5c9e0d7a1b44";
const OWNER = { accountId: "account", conversationId: "chat" };

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
function u16le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function bytes(parts: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(parts);
}
function contains(data: Uint8Array, text: string): boolean {
  return countOf(data, text) > 0;
}
function countOf(data: Uint8Array, text: string): number {
  const needle = ascii(text);
  let found = 0;
  outer: for (let at = 0; at + needle.length <= data.length; at += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (data[at + index] !== needle[index]) continue outer;
    }
    found += 1;
  }
  return found;
}

/** One-frame GIF with a NETSCAPE loop, a comment and a transparency GCE. */
function gif(): Uint8Array<ArrayBuffer> {
  const comment = ascii("secret-comment");
  return bytes([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    ...u16le(1), ...u16le(1), 0x80, 0x00, 0x00,
    0, 0, 0, 255, 255, 255,
    0x21, 0xff, 11, ...ascii("NETSCAPE2.0"), 3, 1, ...u16le(0), 0,
    0x21, 0xfe, comment.length, ...comment, 0,
    0x21, 0xf9, 4, 0x01, ...u16le(10), 0, 0,
    0x2c, ...u16le(0), ...u16le(0), ...u16le(1), ...u16le(1), 0x00,
    0x02, 2, 0x44, 0x01, 0,
    0x3b,
  ]);
}

function webpChunk(fourcc: string, data: number[]): number[] {
  return [...ascii(fourcc), ...u32le(data.length), ...data, ...(data.length % 2 ? [0] : [])];
}
/** VP8X flags byte: animation (0x02) plus alpha (0x10), 1×1 canvas. */
const VP8X_DATA = [0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0];
/** Minimal complete nested VP8L bitstream: 0x2f signature plus header bits. */
const VP8L_DATA = [0x2f, 0, 0, 0, 0];
/** Minimal complete nested VP8 bitstream: frame tag, start code, dimensions. */
const VP8_DATA = [0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0];
/** One ANMF payload: 16-byte frame header plus its own image bitstream. */
function webpFrame(): number[] {
  return [...Array.from({ length: 16 }, () => 0), ...webpChunk("VP8L", VP8L_DATA)];
}
function webpFrames(payloads: number[][], extra: number[] = []): Uint8Array {
  const body = [
    ...webpChunk("VP8X", VP8X_DATA),
    ...webpChunk("ANIM", [0, 0, 0, 0, 0, 0]),
    ...payloads.map((payload) => webpChunk("ANMF", payload)).flat(),
    ...extra,
  ];
  return bytes([...ascii("RIFF"), ...u32le(4 + body.length), ...ascii("WEBP"), ...body]);
}
function webpAnimation(frames: number, extra: number[] = []): Uint8Array {
  return webpFrames(Array.from({ length: frames }, webpFrame), extra);
}
function animatedWebp(): Uint8Array {
  return webpAnimation(1);
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR = pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
/** fcTL payload: sequence, 1×1 frame, origin, delay, dispose, blend. */
function fcTL(sequence: number): number[] {
  return [...u32be(sequence), ...u32be(1), ...u32be(1), ...u32be(0), ...u32be(0), 0, 1, 0, 1, 1, 1];
}
function fdAT(sequence: number): number[] {
  return [...u32be(sequence), 0x78, 0x9c];
}
function pngFile(...chunks: number[][]): Uint8Array {
  return bytes([...PNG_HEADER, ...PNG_IHDR, ...chunks.flat()]);
}
function apng(): Uint8Array {
  return pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("IEND", []),
  );
}
function multiFrameApng(): Uint8Array {
  return pngFile(
    pngChunk("acTL", [...u32be(2), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("fcTL", fcTL(1)),
    pngChunk("fdAT", fdAT(2)),
    pngChunk("IEND", []),
  );
}
function stillPng(): Uint8Array<ArrayBuffer> {
  return bytes([...PNG_HEADER, ...PNG_IHDR, ...pngChunk("IDAT", [0x78, 0x9c]), ...pngChunk("IEND", [])]);
}
function stillJpeg(): Uint8Array {
  return bytes([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function animation(bytesValue: Uint8Array, mime: string) {
  return verifyKeyboardMedia(
    { kind: "animation", mime, width: 1, height: 1, byteLength: bytesValue.length }, bytesValue);
}

beforeEach(() => {
  m.available = true;
  m.media = null;
  m.eligibility = null;
  m.rejected = null;
  m.setEligibility.mockClear();
  m.read.mockReset();
  m.release.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

it("accepts a still derivative the photo lane can carry", () => {
  const jpeg = stillJpeg();
  const media = verifyKeyboardMedia(
    { kind: "still", mime: "image/jpeg", width: 1, height: 1, byteLength: jpeg.length }, jpeg);
  expect(media).toMatchObject({ kind: "still", mime: "image/jpeg", width: 1, height: 1, animated: false });
});

it("refuses a GIF that claims to be a still and any size or dimension mismatch", () => {
  const gifBytes = gif();
  expect(() => verifyKeyboardMedia(
    { kind: "still", mime: "image/gif", width: 1, height: 1, byteLength: gifBytes.length }, gifBytes))
    .toThrow(KEYBOARD_MEDIA_REJECTED);
  expect(() => verifyKeyboardMedia(
    { kind: "still", mime: "image/jpeg", width: 2, height: 1, byteLength: stillJpeg().length }, stillJpeg()))
    .toThrow(KEYBOARD_MEDIA_REJECTED);
  expect(() => verifyKeyboardMedia(
    { kind: "still", mime: "image/jpeg", width: 1, height: 1, byteLength: 999 }, stillJpeg()))
    .toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("refuses malformed and oversized stills instead of staging them", () => {
  expect(() => verifyKeyboardMedia(
    { kind: "still", mime: "image/jpeg", width: 1, height: 1, byteLength: 3 }, Uint8Array.of(1, 2, 3)))
    .toThrow(KEYBOARD_MEDIA_REJECTED);
  const jpeg = stillJpeg();
  const huge = new Uint8Array(2_000_001);
  huge.set(jpeg);
  expect(() => verifyKeyboardMedia(
    { kind: "still", mime: "image/jpeg", width: 1, height: 1, byteLength: huge.length }, huge))
    .toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("rebuilds a GIF with its loop and frame while dropping comment metadata", () => {
  const gifBytes = gif();
  const media = animation(gifBytes, "image/gif");
  expect(media).toMatchObject({ kind: "animation", mime: "image/gif", animated: true, width: 1, height: 1 });
  expect(contains(media.bytes, "secret-comment")).toBe(false);
  expect(contains(media.bytes, "NETSCAPE2.0")).toBe(true);
  expect(media.bytes[media.bytes.length - 1]).toBe(0x3b);
});

it("keeps an animated WebP's animation chunks and an APNG's control chunk", () => {
  const webp = animatedWebp();
  const animated = animation(webp, "image/webp");
  expect(animated.mime).toBe("image/webp");
  expect(contains(animated.bytes, "ANIM")).toBe(true);
  expect(contains(animated.bytes, "VP8L")).toBe(true);

  const png = apng();
  const frames = animation(png, "image/png");
  expect(frames.mime).toBe("image/png");
  expect(contains(frames.bytes, "acTL")).toBe(true);
});

it("preserves every frame, the loop and the alpha flag of a multi-frame animation", () => {
  const webp = webpAnimation(3, webpChunk("EXIF", [1, 2, 3, 4]));
  expect(countOf(webp, "ANMF")).toBe(3);
  const animated = animation(webp, "image/webp");
  expect(countOf(animated.bytes, "ANMF")).toBe(3);
  expect(countOf(animated.bytes, "ANIM")).toBe(1);
  // Every frame keeps its own nested bitstream, not just its header.
  expect(countOf(animated.bytes, "VP8L")).toBe(3);
  expect(countOf(animated.bytes, "EXIF")).toBe(0);
  // VP8X data starts 8 bytes into the chunk that follows the 12-byte header.
  expect(animated.bytes[20]! & 0x02).toBe(0x02);
  expect(animated.bytes[20]! & 0x10).toBe(0x10);

  const png = multiFrameApng();
  const frames = animation(png, "image/png");
  expect(countOf(frames.bytes, "fcTL")).toBe(2);
  expect(countOf(frames.bytes, "fdAT")).toBe(1);
});

it("accepts a WebP frame that carries an ALPH chunk and a VP8 bitstream", () => {
  const frame = [
    ...Array.from({ length: 16 }, () => 0),
    ...webpChunk("ALPH", [0x00]),
    ...webpChunk("VP8 ", VP8_DATA),
  ];
  const media = animation(webpFrames([frame]), "image/webp");
  expect(countOf(media.bytes, "ANMF")).toBe(1);
  expect(countOf(media.bytes, "ALPH")).toBe(1);
  expect(countOf(media.bytes, "VP8 ")).toBe(1);
});

it("refuses a WebP frame that is only a header or whose nested image is cut", () => {
  // A 16-byte ANMF payload is exactly the frame header: no image, no frame.
  const headerOnly = webpFrames([Array.from({ length: 16 }, () => 0)]);
  expect(() => animation(headerOnly, "image/webp")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // The nested VP8L declares five bytes but only three arrived.
  const truncatedNested = webpFrames([[
    ...Array.from({ length: 16 }, () => 0),
    ...ascii("VP8L"), ...u32le(5), 0x2f, 0, 0,
  ]]);
  expect(() => animation(truncatedNested, "image/webp")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // A nested chunk of a kind that cannot be a frame image is refused too.
  const wrongNested = webpFrames([[
    ...Array.from({ length: 16 }, () => 0),
    ...webpChunk("EXIF", [1, 2, 3]),
  ]]);
  expect(() => animation(wrongNested, "image/webp")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("refuses a truncated animation instead of staging a shorter one", () => {
  const webp = animatedWebp();
  // A cut final ANMF frame is shorter than its declared chunk, so the shared
  // stripper would keep a partial animation; admission refuses it.
  const clippedWebp = webp.slice(0, webp.length - 4);
  expect(() => animation(clippedWebp, "image/webp")).toThrow(KEYBOARD_MEDIA_REJECTED);

  const png = multiFrameApng();
  const clippedPng = png.slice(0, png.length - 6);
  expect(() => animation(clippedPng, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("refuses an APNG whose whole trailer chunk is missing", () => {
  const complete = multiFrameApng();
  const withoutIend = complete.slice(0, complete.length - 12);
  expect(countOf(withoutIend, "IEND")).toBe(0);
  expect(() => animation(withoutIend, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("refuses an APNG frame that never received image data", () => {
  // acTL promises two frames; the second fcTL is closed by IEND with no data.
  const emptySecond = pngFile(
    pngChunk("acTL", [...u32be(2), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("fcTL", fcTL(1)),
    pngChunk("IEND", []),
  );
  expect(() => animation(emptySecond, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // A single declared frame with a control chunk and no image at all.
  const neverFilled = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IEND", []),
  );
  expect(() => animation(neverFilled, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("refuses an APNG whose default image carries only empty IDAT chunks", () => {
  // A zero-length IDAT is a legal split, but it carries no pixels. Here the
  // first controlled frame has no other data, so nothing completed it.
  const emptyFirst = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IDAT", []),
    pngChunk("IEND", []),
  );
  expect(() => animation(emptyFirst, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // Same rule when the default image is not part of the animation: the fdAT
  // frame is complete, but the PNG itself has no default-image bytes.
  const emptyDefault = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("IDAT", []),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("fdAT", fdAT(1)),
    pngChunk("IEND", []),
  );
  expect(() => animation(emptyDefault, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("accepts empty IDAT split chunks when the image data is present", () => {
  const splitFirstFrame = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IDAT", []),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("IEND", []),
  );
  expect(animation(splitFirstFrame, "image/png").animated).toBe(true);

  const splitDefaultImage = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("IDAT", []),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("fdAT", fdAT(1)),
    pngChunk("IEND", []),
  );
  expect(animation(splitDefaultImage, "image/png").animated).toBe(true);
});

it("refuses orphan animation data with no controlling frame", () => {
  const orphan = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fdAT", fdAT(0)),
    pngChunk("IEND", []),
  );
  expect(() => animation(orphan, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // fdAT carrying only its sequence number has no pixels either.
  const emptyData = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("fdAT", [...u32be(1)]),
    pngChunk("IEND", []),
  );
  expect(() => animation(emptyData, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("accepts an APNG whose default image is not part of the animation", () => {
  const file = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("fdAT", fdAT(1)),
    pngChunk("IEND", []),
  );
  const media = animation(file, "image/png");
  expect(countOf(media.bytes, "fcTL")).toBe(1);
  expect(countOf(media.bytes, "fdAT")).toBe(1);
});

it("refuses a declared frame count the container never delivers", () => {
  // acTL promises two frames but only one fcTL is present.
  const png = pngFile(
    pngChunk("acTL", [...u32be(2), ...u32be(0)]),
    pngChunk("fcTL", fcTL(0)),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("IEND", []),
  );
  expect(() => animation(png, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("refuses short metadata chunks and a declaration that disagrees with the file", () => {
  const shortControl = pngFile(
    pngChunk("acTL", [...u32be(1), ...u32be(0)]),
    pngChunk("fcTL", [0, 0, 0]),
    pngChunk("IDAT", [0x78, 0x9c]),
    pngChunk("IEND", []),
  );
  expect(() => animation(shortControl, "image/png")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // ANIM below its six-byte minimum: the loop payload can never be complete.
  const shortAnim = (() => {
    const body = [
      ...webpChunk("VP8X", VP8X_DATA),
      ...webpChunk("ANIM", [0, 0]),
      ...webpChunk("ANMF", webpFrame()),
    ];
    return bytes([...ascii("RIFF"), ...u32le(4 + body.length), ...ascii("WEBP"), ...body]);
  })();
  expect(() => animation(shortAnim, "image/webp")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // The RIFF declaration must describe the file exactly.
  const declaredWrong = animatedWebp();
  declaredWrong.set([0, 0, 0, 0], 4);
  expect(() => animation(declaredWrong, "image/webp")).toThrow(KEYBOARD_MEDIA_REJECTED);

  // The arrival's own byte length must match what was pulled.
  const webp = animatedWebp();
  expect(() => verifyKeyboardMedia(
    { kind: "animation", mime: "image/webp", width: 1, height: 1, byteLength: webp.length + 8 }, webp))
    .toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("classifies clipboard images from their bytes and refuses non-images", async () => {
  await expect(classifyClipboardImage(new File([gif()], "a.gif", { type: "image/gif" }))).resolves.toBe("animation");
  await expect(classifyClipboardImage(new File([stillPng()], "a.png", { type: "image/png" }))).resolves.toBe("still");
  await expect(classifyClipboardImage(new File(["hello"], "a.txt", { type: "text/plain" }))).resolves.toBeNull();
});

it("sanitizes a pasted animation and refuses a pasted still in the animation lane", async () => {
  const media = await readClipboardAnimation(new File([gif()], "a.gif", { type: "image/gif" }));
  expect(media.kind).toBe("animation");
  expect(contains(media.bytes, "secret-comment")).toBe(false);
  await expect(readClipboardAnimation(new File([stillPng()], "a.png", { type: "image/png" })))
    .rejects.toThrow(KEYBOARD_MEDIA_REJECTED);
});

it("advertises only while a live owner is synced and withdraws on null", async () => {
  const session = createKeyboardMediaSession({ onMedia: vi.fn(), onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  expect(m.setEligibility).toHaveBeenLastCalledWith(true, OWNER);
  session.sync(null);
  expect(m.setEligibility).toHaveBeenLastCalledWith(false);
  session.destroy();
});

it("stages one verified arrival, in order, and releases the native request", async () => {
  const onMedia = vi.fn();
  const session = createKeyboardMediaSession({ onMedia, onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  const gifBytes = gif();
  m.read.mockResolvedValue(gifBytes);
  const arrival: KeyboardMediaArrival = {
    requestId: REQUEST_ID, kind: "animation", mime: "image/gif", width: 1, height: 1, byteLength: gifBytes.length,
  };
  m.media?.(arrival);
  await flush();
  expect(onMedia).toHaveBeenCalledOnce();
  expect(onMedia.mock.calls[0]?.[0]).toMatchObject({ kind: "animation", mime: "image/gif", requestId: REQUEST_ID });
  expect(m.release).toHaveBeenCalledWith(REQUEST_ID);
  session.destroy();
});

it("ignores a duplicate while the first copy is still being read", async () => {
  const onMedia = vi.fn();
  const session = createKeyboardMediaSession({ onMedia, onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  let finish!: (value: Uint8Array) => void;
  m.read.mockImplementation(() => new Promise<Uint8Array>((resolve) => { finish = resolve; }));
  const gifBytes = gif();
  const arrival: KeyboardMediaArrival = {
    requestId: REQUEST_ID, kind: "animation", mime: "image/gif", width: 1, height: 1, byteLength: gifBytes.length,
  };
  m.media?.(arrival);
  await flush();
  expect(m.read).toHaveBeenCalledTimes(1);

  // The same id again, mid-read: it must not release the file the first read
  // is still pulling, and it must not stage or read a second time.
  m.media?.(arrival);
  await flush();
  expect(m.read).toHaveBeenCalledTimes(1);
  expect(m.release).not.toHaveBeenCalled();

  finish(gifBytes);
  await flush();
  expect(onMedia).toHaveBeenCalledOnce();
  expect(m.release).toHaveBeenCalledTimes(1);
  expect(m.release).toHaveBeenCalledWith(REQUEST_ID);
  session.destroy();
});

it("drops an arrival whose owner changed during the read", async () => {
  const onMedia = vi.fn();
  const session = createKeyboardMediaSession({ onMedia, onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  let finish!: (value: Uint8Array) => void;
  m.read.mockImplementation(() => new Promise<Uint8Array>((resolve) => { finish = resolve; }));
  const gifBytes = gif();
  m.media?.({ requestId: REQUEST_ID, kind: "animation", mime: "image/gif", width: 1, height: 1, byteLength: gifBytes.length });
  await flush();
  session.sync({ accountId: OWNER.accountId, conversationId: "another" });
  await flush();
  finish(gifBytes);
  await flush();
  expect(onMedia).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalled();
  session.destroy();
});

it("never reads or stages an arrival while no composer is advertised", async () => {
  const onMedia = vi.fn();
  const session = createKeyboardMediaSession({ onMedia, onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  session.sync(null);
  m.media?.({ requestId: REQUEST_ID, kind: "still", mime: "image/png", width: 1, height: 1, byteLength: 10 });
  await flush();
  expect(m.read).not.toHaveBeenCalled();
  expect(onMedia).not.toHaveBeenCalled();
  expect(m.release).toHaveBeenCalledWith(REQUEST_ID);
  session.destroy();
});

it("deduplicates a repeated request id and reports one rejection for unreadable bytes", async () => {
  const onMedia = vi.fn();
  const onRejected = vi.fn();
  const session = createKeyboardMediaSession({ onMedia, onRejected });
  session.sync(OWNER);
  await flush();
  m.read.mockResolvedValue(Uint8Array.of(1, 2, 3));
  const arrival = { requestId: REQUEST_ID, kind: "still", mime: "image/jpeg", width: 1, height: 1, byteLength: 3 };
  m.media?.(arrival);
  m.media?.(arrival);
  await flush();
  expect(m.read).toHaveBeenCalledTimes(1);
  expect(onRejected).toHaveBeenCalledOnce();
  expect(onMedia).not.toHaveBeenCalled();
  session.destroy();
});

it("releases in-flight work and stops listening on destroy", async () => {
  const session = createKeyboardMediaSession({ onMedia: vi.fn(), onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  m.read.mockImplementation(() => new Promise<Uint8Array>(() => {}));
  m.media?.({ requestId: REQUEST_ID, kind: "still", mime: "image/png", width: 1, height: 1, byteLength: 4 });
  await flush();
  session.destroy();
  expect(m.release).toHaveBeenCalledWith(REQUEST_ID);
  expect(m.setEligibility).toHaveBeenLastCalledWith(false);
  expect(m.media).toBeNull();
});

it("re-advertises after a native withdrawal only while the page is visible", async () => {
  const session = createKeyboardMediaSession({ onMedia: vi.fn(), onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  m.setEligibility.mockClear();
  m.eligibility?.({ eligible: false });
  await flush();
  expect(m.setEligibility).toHaveBeenLastCalledWith(true, OWNER);

  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  m.setEligibility.mockClear();
  m.eligibility?.({ eligible: false });
  await flush();
  expect(m.setEligibility).not.toHaveBeenCalled();
  session.destroy();
});

it("stays local when the native bridge is unavailable", async () => {
  m.available = false;
  const session = createKeyboardMediaSession({ onMedia: vi.fn(), onRejected: vi.fn() });
  session.sync(OWNER);
  await flush();
  expect(m.setEligibility).not.toHaveBeenCalled();
  session.destroy();
});

it("surfaces a native refusal only while a composer is still advertised", async () => {
  const onRejected = vi.fn();
  const session = createKeyboardMediaSession({ onMedia: vi.fn(), onRejected });
  session.sync(OWNER);
  await flush();
  m.rejected?.({ reason: "unsupported" });
  expect(onRejected).toHaveBeenCalledWith(KEYBOARD_MEDIA_REJECTED);

  onRejected.mockClear();
  session.sync(null);
  m.rejected?.({ reason: "unsupported" });
  expect(onRejected).not.toHaveBeenCalled();
  session.destroy();
});
