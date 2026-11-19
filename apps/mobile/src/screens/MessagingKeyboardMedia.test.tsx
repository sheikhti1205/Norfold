// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { webcrypto } from "node:crypto";
import { MessagingThread } from "./Messaging";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import type { MessagingThreadSync } from "../services/messaging/runtime";

const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return {
    view, watch: vi.fn(),
    chat: { accountId: "account", status: "ready", revision: 1,
      threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
      conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }],
      currentProjections: { chat: view } },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[], cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] },
    threadRead: vi.fn(), text: vi.fn(), send: vi.fn(), upload: vi.fn(), removeFile: vi.fn(),
    available: true,
    mediaListener: null as null | ((event: unknown) => void),
    eligibilityListener: null as null | ((event: unknown) => void),
    rejectListener: null as null | ((event: unknown) => void),
    setEligibility: vi.fn((_eligible: boolean, _context?: { accountId: string; conversationId: string }) => Promise.resolve(true)),
    read: vi.fn((_requestId: string, _byteLength: number) => Promise.resolve(new Uint8Array())),
    release: vi.fn((_requestId: string) => Promise.resolve()),
  };
});

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: async () => new Map(), readCachedAccountIdentities: () => new Map() }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({
  getCachedMessagingThreadState: () => m.cached, watchMessagingThread: m.watch,
  sendMessagingVoice: vi.fn(), sendMessagingLocation: vi.fn(), setMessagingMuted: vi.fn(), pinMessagingMessage: vi.fn(),
  readMessagingThreadState: () => m.threadRead(), fetchMessagingReceiptView: vi.fn(async () => ({ context: "authority", readIds: [] })),
  observeMessagingReceipt: vi.fn(async () => true), markMessagingConversationRead: async () => {}, refreshMessaging: vi.fn(async () => undefined),
  sendMessagingText: m.text, sendMessagingMedia: m.send, readMessagingMedia: vi.fn(async () => null), downloadMessagingMedia: vi.fn(async () => undefined),
  changeMessagingRelationship: vi.fn(async () => undefined), clearMessagingConversation: async () => {}, removeMessagingMessage: vi.fn(async () => undefined),
  recoverMessagingText: vi.fn(async () => undefined), retryMessagingMessage: vi.fn(async () => undefined),
  readMessagingUnsentHoldIds: async () => [], readMessagingUnsentHold: async () => null, purgeMessagingUnsentHold: async () => undefined,
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: vi.fn() }));
vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  uploadChatFile: m.upload,
  removeChatFile: m.removeFile,
}));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: async () => ({ reportId: "receipt" }),
}));
vi.mock("../services/media/nativeMedia", () => ({
  isNativeMediaIntakeAvailable: () => m.available,
  setKeyboardMediaEligibility: m.setEligibility,
  readKeyboardMediaBytes: m.read,
  releaseKeyboardMedia: m.release,
  onKeyboardMedia: async (listener: (event: unknown) => void) => {
    m.mediaListener = listener;
    return () => { m.mediaListener = null; };
  },
  onKeyboardMediaEligibility: async (listener: (event: unknown) => void) => {
    m.eligibilityListener = listener;
    return () => { m.eligibilityListener = null; };
  },
  onKeyboardMediaRejected: async (listener: (event: unknown) => void) => {
    m.rejectListener = listener;
    return () => { m.rejectListener = null; };
  },
}));

const REQUEST_ID = "3f7c1a2b-9d4e-4a6f-8b21-5c9e0d7a1b44";

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
function u16le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
/** One-frame GIF with a loop, a comment and a transparency control block. */
function gif(): Uint8Array<ArrayBuffer> {
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
function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}
function stillPng(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]),
    ...pngChunk("IDAT", [0x78, 0x9c]),
    ...pngChunk("IEND", []),
  ]);
}

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}),
  });
  m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.view.revision = 1;
  m.chat.accountId = "account"; m.chat.status = "ready"; m.chat.revision = 1;
  m.chat.currentProjections = { chat: m.view };
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.messages = []; m.media = []; m.outbox = []; m.cached = null;
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
  m.text.mockReset().mockResolvedValue("saved");
  m.send.mockReset().mockResolvedValue("saved");
  m.upload.mockReset().mockResolvedValue({
    key: "files/account/chat/sticker.gif", name: "norfold-sticker.gif",
    mime: "image/gif", byteSize: gif().length, kind: "document",
  });
  m.removeFile.mockReset().mockResolvedValue(undefined);
  m.available = true;
  m.mediaListener = null; m.eligibilityListener = null;
  m.rejectListener = null;
  m.setEligibility.mockClear();
  m.read.mockReset().mockImplementation(async () => new Uint8Array());
  m.release.mockReset().mockResolvedValue(undefined);
  m.watch.mockReset().mockReturnValue(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function thread() {
  return <MemoryRouter initialEntries={["/connections/chat"]}><LiveRegion /><MessagingRestoration />
    <Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes></MemoryRouter>;
}
async function open() {
  const rendered = render(thread());
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  return rendered;
}
async function advertise() {
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.focus(field);
  await waitFor(() => expect(m.setEligibility).toHaveBeenLastCalledWith(true,
    { accountId: "account", conversationId: "chat" }));
  return field;
}

it("stages an inserted GIF and sends it only on Send, reusing its identity on retry", async () => {
  const gifBytes = gif();
  m.read.mockResolvedValue(gifBytes);
  await open();
  const field = await advertise();
  await act(async () => {
    m.mediaListener?.({ requestId: REQUEST_ID, kind: "animation", mime: "image/gif", width: 1, height: 1, byteLength: gifBytes.length });
  });
  await screen.findByText(/1 attachment ready/i);
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.text).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: "Look at this" } });
  m.text.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("saved");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledOnce());
  expect(m.upload).toHaveBeenCalledOnce();
  const firstBody = String(m.text.mock.calls[0]?.[3]);
  expect(firstBody.startsWith("norfold-file:v1:")).toBe(true);
  expect(firstBody).toContain("Look at this");
  const identity = m.text.mock.calls[0]?.[6];
  await waitFor(() => expect(screen.getByText(/could not all be saved/i)).toBeTruthy());
  // The refused send removed the object it uploaded; the attachment is still here.
  expect(m.removeFile).toHaveBeenCalledOnce();
  expect(screen.getByText(/1 attachment ready/i)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[6]).toBe(identity);
  expect(String(m.text.mock.calls[1]?.[3])).toContain("Look at this");
});

it("stages an inserted still through the photo lane and never through the file lane", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const pngBytes = stillPng();
  m.read.mockResolvedValue(pngBytes);
  await open();
  await advertise();
  await act(async () => {
    m.mediaListener?.({ requestId: REQUEST_ID, kind: "still", mime: "image/png", width: 1, height: 1, byteLength: pngBytes.length });
  });
  await screen.findByText(/1 photo ready/i);
  expect(m.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.send).toHaveBeenCalledOnce());
  expect(m.send.mock.calls[0]?.[4]).toMatchObject({ mime: "image/png", width: 1, height: 1 });
  expect(m.upload).not.toHaveBeenCalled();
});

it("admits an image-only paste once and leaves plain or mixed text paste native", async () => {
  await open();
  const field = await advertise();
  const gifFile = new File([gif()], "a.gif", { type: "image/gif" });

  fireEvent.paste(field, { clipboardData: { getData: (type: string) => type === "text/plain" ? "hello" : "", files: [gifFile] } });
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText(/attachment ready/i)).toBeNull();

  fireEvent.paste(field, { clipboardData: { getData: () => "", files: [] } });
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText(/attachment ready/i)).toBeNull();

  fireEvent.paste(field, { clipboardData: { getData: () => "", files: [gifFile] } });
  await screen.findByText(/1 attachment ready/i);
  // Nothing is uploaded or sent by the paste itself.
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.text).not.toHaveBeenCalled();
});

it("withdraws insertion when the composer is not the live target and drops a late arrival", async () => {
  await open();
  const field = await advertise();
  fireEvent.blur(field);
  await waitFor(() => expect(m.setEligibility).toHaveBeenLastCalledWith(false));
  await act(async () => {
    m.mediaListener?.({ requestId: REQUEST_ID, kind: "animation", mime: "image/gif", width: 1, height: 1, byteLength: gif().length });
  });
  expect(m.read).not.toHaveBeenCalled();
  expect(screen.queryByText(/attachment ready/i)).toBeNull();
});

it("advertises on the composer press before focus lands and withdraws when focus goes elsewhere", async () => {
  await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  expect(m.setEligibility).not.toHaveBeenCalled();

  // The press precedes focus: the flag is set while the IME is still opening.
  fireEvent.pointerDown(field);
  await waitFor(() => expect(m.setEligibility).toHaveBeenLastCalledWith(true,
    { accountId: "account", conversationId: "chat" }));

  // Focus landing on any other control ends the provisional advertisement.
  fireEvent.focus(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.setEligibility).toHaveBeenLastCalledWith(false));
});

it("never prearms from a press on another control or from mounting alone", async () => {
  await open();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Add attachment" }));
  await act(async () => { await Promise.resolve(); });
  expect(m.setEligibility).not.toHaveBeenCalled();

  // A prearm withdrawn by a press on another control stays withdrawn.
  fireEvent.pointerDown(screen.getByRole("textbox", { name: "Message" }));
  await waitFor(() => expect(m.setEligibility).toHaveBeenLastCalledWith(true,
    { accountId: "account", conversationId: "chat" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Add attachment" }));
  await waitFor(() => expect(m.setEligibility).toHaveBeenLastCalledWith(false));
});

it("shows a visible error when native refuses an inserted item", async () => {
  await open();
  await advertise();
  await act(async () => { m.rejectListener?.({ reason: "unsupported" }); });
  expect(screen.getByText(/couldn't be added/i)).toBeTruthy();
});
