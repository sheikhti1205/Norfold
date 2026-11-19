// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatFile } from "./ChatFile";
import type { ChatFileMeta } from "../services/messaging/files";

const chatCss = readFileSync(new URL("./ChatFile.css", import.meta.url), "utf8");

const m = vi.hoisted(() => ({
  download: vi.fn(),
  create: vi.fn(() => "blob:private"),
  revoke: vi.fn(),
}));

vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  downloadChatFile: m.download,
}));

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
function u16le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
/** One-frame GIF with a loop, a comment and a transparency control block. */
function gif(): Uint8Array {
  const comment = ascii("secret-comment");
  return Uint8Array.from([
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
/**
 * A structurally real JPEG header: SOI, an optional EXIF APP1 orientation
 * block, one baseline SOF0 frame and EOI. The probe reads the SOF size while
 * the browser paints the APP1 orientation, which is the difference under test.
 */
function jpeg(width: number, height: number, orientation?: number): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    const tiff = [
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    const payload = [...ascii("Exif"), 0, 0, ...tiff];
    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  }
  bytes.push(
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  );
  return Uint8Array.from(bytes);
}
function html(): Uint8Array {
  return new TextEncoder().encode("<html><script>alert(1)</script></html>");
}
function meta(mime = "image/gif", name = "sticker.gif"): ChatFileMeta {
  return { key: "files/account/chat/x.gif", name, mime, byteSize: gif().length, kind: "document" };
}

/** The style-bearing private image card, not the frame or the file row. */
function imageCard(): HTMLElement {
  const card = screen.getByRole("img").closest(".fb-chat-image");
  if (!(card instanceof HTMLElement)) throw new Error("image card is not mounted");
  return card;
}

let saved: Array<{ href: string | null; name: string }> = [];

beforeEach(() => {
  m.download.mockReset();
  m.create.mockReset();
  m.create.mockImplementation(() => "blob:private");
  m.revoke.mockReset();
  saved = [];
  // The download action hands a blob URL to a real anchor; record it instead of
  // letting jsdom attempt a navigation.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.getAttribute("href"), name: this.getAttribute("download") ?? "" });
  });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: m.create, revokeObjectURL: m.revoke,
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("downloads a private GIF only on View and revokes its URL on Hide", async () => {
  m.download.mockResolvedValue(new Blob([gif()], { type: "image/gif" }));
  render(<ChatFile meta={meta()} />);
  // Nothing is fetched or created because a conversation opened.
  expect(m.download).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
  expect(screen.queryByRole("img")).toBeNull();
  // The download action exists before any press and fetches nothing by itself.
  expect(screen.getByRole("button", { name: "Download sticker.gif" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  expect(m.download).toHaveBeenCalledWith("files/account/chat/x.gif");
  expect(m.create).toHaveBeenCalledTimes(1);
  // The bitmap is mounted inside the reserved frame, not loose in the bubble.
  expect(screen.getByRole("img").closest(".fb-chat-image-frame")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Hide sticker.gif" }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(m.revoke).toHaveBeenCalledWith("blob:private");
});

it("revokes the private URL when the message unmounts while visible", async () => {
  m.download.mockResolvedValue(new Blob([gif()], { type: "image/gif" }));
  const { unmount } = render(<ChatFile meta={meta()} />);
  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  unmount();
  expect(m.revoke).toHaveBeenCalledWith("blob:private");
});

it("still opens under StrictMode's setup → cleanup → setup remount", async () => {
  // The production app is wrapped in StrictMode; the viewer's liveness flag is
  // cleared by the first cleanup, so the second setup must re-arm it or a
  // press would silently drop the preview.
  m.download.mockResolvedValue(new Blob([gif()], { type: "image/gif" }));
  render(<StrictMode><ChatFile meta={meta()} /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  expect(screen.queryByText(/opening/i)).toBeNull();
  expect(m.revoke).not.toHaveBeenCalled();
});

it("keeps an unsupported preview honest and still downloads the fetched bytes", async () => {
  // The declared type lies; only the sniffed container decides, and a file
  // that cannot be previewed is not the same thing as a file that is gone.
  m.download.mockResolvedValue(new Blob([html()], { type: "image/gif" }));
  render(<ChatFile meta={meta()} />);
  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByText(/can't be previewed here/i)).toBeTruthy());
  expect(screen.queryByText(/no longer available/i)).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(m.create).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Download sticker.gif" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  // The bytes already fetched for the failed preview are reused, not refetched.
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(saved[0]).toEqual({ href: "blob:private", name: "sticker.gif" });
});

it("keeps a non-raster file on the download path instead of inline", () => {
  render(<ChatFile meta={meta("image/svg+xml", "art.svg")} />);
  expect(screen.getByRole("button", { name: "Open art.svg" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "View art.svg" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Download art.svg" })).toBeNull();
});

it("orients a quarter-turn JPEG frame without rewriting its bytes", async () => {
  // SOF says 40x20; EXIF orientation 6 paints it as 20x40.
  const bytes = jpeg(40, 20, 6);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  m.download.mockResolvedValue(blob);
  render(<ChatFile meta={meta("image/jpeg", "portrait.jpg")} />);
  fireEvent.click(screen.getByRole("button", { name: "View portrait.jpg" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  expect(imageCard().style.getPropertyValue("--fb-chat-image-ratio")).toBe("0.5");
  // The fetched blob reaches the viewer unchanged; only the frame moved.
  expect(m.create).toHaveBeenCalledWith(blob);
});

it("keeps a first-orientation JPEG at its stored width and height", async () => {
  const bytes = jpeg(40, 20, 1);
  m.download.mockResolvedValue(new Blob([bytes], { type: "image/jpeg" }));
  render(<ChatFile meta={meta("image/jpeg", "wide.jpg")} />);
  fireEvent.click(screen.getByRole("button", { name: "View wide.jpg" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  expect(imageCard().style.getPropertyValue("--fb-chat-image-ratio")).toBe("2");
});

it("reuses one URL when Download follows a visible preview", async () => {
  m.download.mockResolvedValue(new Blob([gif()], { type: "image/gif" }));
  render(<ChatFile meta={meta()} />);
  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Download sticker.gif" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toEqual({ href: "blob:private", name: "sticker.gif" });
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledTimes(1);
});

it("releases the URL on Hide and fetches again only on a new press", async () => {
  m.create.mockReturnValueOnce("blob:one").mockReturnValueOnce("blob:two");
  m.download.mockResolvedValue(new Blob([gif()], { type: "image/gif" }));
  const { unmount } = render(<ChatFile meta={meta()} />);
  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByRole("img")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Hide sticker.gif" }));
  expect(m.revoke).toHaveBeenCalledWith("blob:one");
  expect(screen.queryByRole("img")).toBeNull();
  // Hiding released the bytes: nothing more is fetched until the reader asks.
  expect(m.download).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Download sticker.gif" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(m.download).toHaveBeenCalledTimes(2);
  expect(saved[0]).toEqual({ href: "blob:two", name: "sticker.gif" });

  unmount();
  // Each URL is revoked exactly once, and only its own.
  expect(m.revoke).toHaveBeenCalledTimes(2);
  expect(m.revoke).toHaveBeenNthCalledWith(1, "blob:one");
  expect(m.revoke).toHaveBeenNthCalledWith(2, "blob:two");
});

it("calls a failed fetch missing instead of unsupported", async () => {
  m.download.mockRejectedValue(new Error("gone"));
  render(<ChatFile meta={meta()} />);
  fireEvent.click(screen.getByRole("button", { name: "View sticker.gif" }));
  await waitFor(() => expect(screen.getByText(/no longer available/i)).toBeTruthy());
  expect(screen.queryByText(/can't be previewed/i)).toBeNull();
  expect(m.create).not.toHaveBeenCalled();

  // The download action is the retry: it reports the same honest cause.
  fireEvent.click(screen.getByRole("button", { name: "Download sticker.gif" }));
  await waitFor(() => expect(m.download).toHaveBeenCalledTimes(2));
  expect(saved).toHaveLength(0);
  expect(screen.getByText(/no longer available/i)).toBeTruthy();
});

it("downloads on the first press without opening a preview", async () => {
  m.download.mockResolvedValue(new Blob([gif()], { type: "image/gif" }));
  const { unmount } = render(<ChatFile meta={meta()} />);
  // Mounting the row fetched nothing; the press is the only trigger.
  expect(m.download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download sticker.gif" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(m.download).toHaveBeenCalledTimes(1);
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(saved[0]).toEqual({ href: "blob:private", name: "sticker.gif" });
  // It downloaded; it did not mount a preview the reader never asked for.
  expect(screen.queryByRole("img")).toBeNull();
  unmount();
  expect(m.revoke).toHaveBeenCalledTimes(1);
  expect(m.revoke).toHaveBeenCalledWith("blob:private");
});

/** The declarations of one rule, without its neighbours. */
function rule(selector: string): string {
  const start = chatCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule ${selector}`);
  return chatCss.slice(start, chatCss.indexOf("}", start) + 1);
}

it("sizes the media frame to the picture while the row keeps the useful width", () => {
  // The card no longer scales with the ratio: an extreme portrait (1080x7000)
  // must not collapse the row that holds Hide and Download.
  const image = rule(".fb-chat-image");
  expect(image).toContain("width: var(--fb-chat-media-width, min(22rem, 78vw));");
  expect(image).not.toContain("--fb-chat-image-ratio)");
  const imageFrame = rule(".fb-chat-image-frame");
  expect(imageFrame).toContain("calc(min(30rem, 80vh) * var(--fb-chat-image-ratio))");
  expect(imageFrame).toContain("aspect-ratio: var(--fb-chat-image-ratio);");
  expect(imageFrame).toContain("margin-inline: auto;");

  const video = rule(".fb-chat-video");
  expect(video).toContain("width: var(--fb-chat-media-width, min(22rem, 78vw));");
  expect(video).not.toContain("--fb-chat-video-ratio)");
  const videoFrame = rule('.fb-chat-video-frame[data-active="true"]');
  expect(videoFrame).toContain("calc(min(30rem, 80vh) * var(--fb-chat-video-ratio))");
  expect(videoFrame).toContain("aspect-ratio: var(--fb-chat-video-ratio);");
  expect(videoFrame).toContain("margin-inline: auto;");

  const download = rule(".fb-chat-image-download");
  expect(download).toContain("width: 44px;");
  expect(download).toContain("height: 44px;");
});
