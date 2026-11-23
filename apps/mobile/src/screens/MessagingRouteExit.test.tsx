// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { Capacitor } from "@capacitor/core";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { MessagingThread } from "./Messaging";
import { BackButtonHandler } from "../components/BackButtonHandler";
import { resetBackInterceptors } from "../components/backNavigation";
import { resetModalLayers } from "../hooks/modalLayers";
import { LiveRegion } from "../components/LiveRegion";
import { InlineRailProvider } from "../components/navLayout";
import { readConversationDraft } from "../services/conversationDrafts";
import type { MessagingThreadSync } from "../services/messaging/runtime";

const native = vi.hoisted(() => ({ back: null as null | (() => void) }));

const m = vi.hoisted(() => {
  const view = {
    mode: "CONNECTED", request: "NONE", ownBlocked: false, ownMuted: false,
    ownHidden: false, ownDeclined: false, requestEpoch: null,
    epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[],
  };
  return {
    view,
    watch: vi.fn(),
    chat: {
      accountId: "account", status: "ready", revision: 1,
      threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
      conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }],
      currentProjections: { chat: view } as Record<string, typeof view> | null,
    },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[],
    cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] },
    threadRead: vi.fn(), text: vi.fn(), send: vi.fn(), voice: vi.fn(), location: vi.fn(),
    clear: vi.fn(), remove: vi.fn(), relationship: vi.fn(), refresh: vi.fn(),
    receipt: vi.fn(), observe: vi.fn(), read: vi.fn(), download: vi.fn(),
    recover: vi.fn(), retry: vi.fn(), retryMedia: vi.fn(), mute: vi.fn(), pin: vi.fn(),
    holdIds: vi.fn(), hold: vi.fn(), purgeHold: vi.fn(),
    choose: vi.fn(), import: vi.fn(), file: vi.fn(), prepare: vi.fn(),
  };
});

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (_name: string, listener: () => void) => {
      native.back = listener;
      return Promise.resolve({ remove: vi.fn() });
    },
    exitApp: vi.fn(),
  },
}));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({
  fetchAccountIdentities: async () => new Map(),
  readCachedAccountIdentities: () => new Map(),
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({
  getCachedMessagingThreadState: () => m.cached,
  watchMessagingThread: m.watch,
  sendMessagingText: m.text,
  sendMessagingMedia: m.send,
  sendMessagingVoice: m.voice,
  sendMessagingLocation: m.location,
  clearMessagingConversation: m.clear,
  removeMessagingMessage: m.remove,
  changeMessagingRelationship: m.relationship,
  refreshMessaging: m.refresh,
  readMessagingThreadState: () => m.threadRead(),
  fetchMessagingReceiptView: m.receipt,
  observeMessagingReceipt: m.observe,
  readMessagingMedia: m.read,
  downloadMessagingMedia: m.download,
  recoverMessagingText: m.recover,
  retryMessagingMessage: m.retry,
  retryMessagingMedia: m.retryMedia,
  setMessagingMuted: m.mute,
  pinMessagingMessage: m.pin,
  readMessagingUnsentHoldIds: () => m.holdIds(),
  readMessagingUnsentHold: () => m.hold(),
  purgeMessagingUnsentHold: () => m.purgeHold(),
  markMessagingConversationRead: async () => undefined,
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: vi.fn(),
}));
vi.mock("../services/media/nativeMedia", () => ({
  chooseNativeImage: m.choose, chooseNativeImages: m.choose,
  importNativeImageUri: m.import, importedImageToFile: m.file,
}));

beforeEach(() => {
  localStorage.clear();
  native.back = null;
  // The real platform reports `web` here, which keeps the browser-only paths
  // under test alive. Only the native gate is overridden, so the real Back
  // listener is registered exactly as it is on a device.
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200,
    toJSON: () => ({}),
  } as DOMRect);
  m.view.mode = "CONNECTED";
  m.view.ownMuted = false;
  m.view.pinnedMessageIds = [];
  m.chat.accountId = "account";
  m.chat.status = "ready";
  m.chat.revision = 1;
  m.chat.currentProjections = { chat: m.view };
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.messages = []; m.media = []; m.outbox = []; m.cached = null;
  m.watch.mockReset().mockReturnValue(() => undefined);
  m.threadRead.mockReset().mockImplementation(async () => ({
    messages: m.messages, outbox: m.outbox, media: m.media,
  }));
  m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] });
  m.observe.mockReset().mockResolvedValue(true);
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.purgeHold.mockReset().mockImplementation(async () => undefined);
  m.text.mockReset().mockResolvedValue("saved");
  for (const call of [m.send, m.voice, m.location, m.clear, m.remove, m.relationship,
    m.refresh, m.read, m.download, m.recover, m.retry, m.retryMedia, m.mute, m.pin,
    m.prepare, m.choose, m.import, m.file]) {
    call.mockReset();
  }
});

afterEach(() => {
  cleanup();
  resetBackInterceptors();
  resetModalLayers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function PathProbe() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

/** The real `/chats` parent route, the real thread, and the real Back handler.
 *  The shell normally publishes the in-flow rail; `inlineRail` stands in for it
 *  so a header test can be written without mounting the whole shell. */
function chatApp({ inlineRail = false } = {}) {
  return (
    <MemoryRouter initialEntries={["/chats/chat"]}>
      <InlineRailProvider show={inlineRail}>
        <LiveRegion />
        <PathProbe />
        <BackButtonHandler />
        <Routes>
          <Route path="/chats" element={<p>Chat list</p>} />
          <Route path="/chats/:conversationId" element={<MessagingThread />} />
        </Routes>
      </InlineRailProvider>
    </MemoryRouter>
  );
}

function path() {
  return screen.getByTestId("path").textContent;
}

async function openThread(options: { inlineRail?: boolean } = {}) {
  render(chatApp(options));
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  await waitFor(() => expect(typeof native.back).toBe("function"));
}

/** The press Capacitor delivers for the Android Back button/gesture. */
function pressBack() {
  act(() => native.back!());
}

async function leaveDialog() {
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toMatch(/leave this chat/i);
  return dialog;
}

/** jsdom has no recorder, so only the platform seam is stubbed: the real port,
 *  the real finalize path and the real hash still run. `holdHash` parks the
 *  chain on the digest instead of guessing at it — the last step before the
 *  service owns the note — so a test knows exactly where the send is standing. */
function stubVoiceCapture({ holdHash = false } = {}) {
  let clock = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  let markHash: () => void = () => undefined;
  const hashEntered = new Promise<void>((resolve) => { markHash = resolve; });
  let openDigest: ((digest: ArrayBuffer) => void) | null = null;
  const digestGate = new Promise<ArrayBuffer>((resolve) => { openDigest = resolve; });
  // The browser boundary requires this realm's ArrayBuffer, like the media suite.
  class BrowserBlob extends NodeBlob {
    override async arrayBuffer(): Promise<ArrayBuffer> {
      const source = await super.arrayBuffer();
      const result = new ArrayBuffer(source.byteLength);
      new Uint8Array(result).set(new Uint8Array(source));
      return result;
    }
  }
  vi.stubGlobal("Blob", BrowserBlob);
  vi.stubGlobal("crypto", {
    randomUUID: () => webcrypto.randomUUID(),
    getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array),
    subtle: {
      digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        if (!holdHash) return webcrypto.subtle.digest(algorithm, data);
        markHash();
        return digestGate;
      },
    },
  });
  const track = { enabled: true, readyState: "live", stop: vi.fn() };
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, mediaDevices: {
    getUserMedia: async () => ({ getTracks: () => [track] }),
  } });
  class Recorder {
    static isTypeSupported() { return true; }
    mimeType = "audio/webm";
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    pause() { this.state = "paused"; }
    resume() { this.state = "recording"; }
    requestData() { this.ondataavailable?.({ data: new Blob(["audio"]) }); }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["trailer"]) }); this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  return {
    track,
    advance(ms: number) { clock += ms; },
    /** Resolves once the send has reached the hash, never before it. */
    hashEntered: () => hashEntered,
    /** Releases the parked hash with the digest of the recorder's own trailer,
     *  then resolves only once the resumed send has run past the hash. The
     *  digest resolves two awaited steps: the hash continues with it, then the
     *  send continues with the hash's value — the line where a discarded note
     *  is refused. Resolved promises resume in order, once each, so this is an
     *  exact settlement rather than a timed guess. */
    async releaseHash() {
      const trailer = new TextEncoder().encode("trailer");
      openDigest?.(await webcrypto.subtle.digest("SHA-256", trailer));
      // Registered after the hash's own continuation, so it resumes after it…
      await digestGate;
      // …and this resumes after the send's continuation, which is the guard.
      await Promise.resolve();
    },
  };
}

/** The metadata boundary the screen hands the voice service: the claim under
 *  test is what was measured and what was admitted, not the generated ids. */
type VoiceAttempt = { durationMs: number; mime: string };

it("leaves a clean conversation for the canonical chat list on Escape", async () => {
  await openThread();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Escape" });
  await waitFor(() => expect(path()).toBe("/chats"));
});

it("rests at the chat list, where Escape is a no-op", async () => {
  await openThread();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(path()).toBe("/chats"));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(path()).toBe("/chats");
});

it("leaves with an unsent draft on Escape, keeping the text for the next visit", async () => {
  await openThread();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Unsent words" } });

  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(path()).toBe("/chats"));
  // Text is kept in the session draft store, so leaving asks nothing and
  // discards nothing: one press leaves and the words are still there.
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(readConversationDraft("account", "chat")).toBe("Unsent words");
  // Leaving only navigates: nothing is sent, cleared or changed.
  for (const call of [m.text, m.send, m.voice, m.location, m.remove, m.clear,
    m.relationship, m.refresh]) expect(call).not.toHaveBeenCalled();
});

it("asks before dropping staged photos, even when the press comes from outside the thread", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64),
    mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await openThread();
  fireEvent.change(screen.getByLabelText("Photo file input"), {
    target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText("1 photo ready. Tap one to review.");

  fireEvent.keyDown(document.body, { key: "Escape" });
  const dialog = await leaveDialog();
  expect(dialog.textContent).toMatch(/unsent photos/i);
  expect(path()).toBe("/chats/chat");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(path()).toBe("/chats/chat");
  expect(screen.getByText("1 photo ready. Tap one to review.")).toBeTruthy();

  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.click(within(await leaveDialog()).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(path()).toBe("/chats"));
  expect(m.send).not.toHaveBeenCalled();
});

it("keeps the microphone open until an explicit leave releases it", async () => {
  vi.spyOn(Date, "now").mockImplementation(() => 1_700_000_000_000);
  // The browser boundary requires this realm's ArrayBuffer, like the media suite.
  class BrowserBlob extends NodeBlob {
    override async arrayBuffer(): Promise<ArrayBuffer> {
      const source = await super.arrayBuffer();
      const result = new ArrayBuffer(source.byteLength);
      new Uint8Array(result).set(new Uint8Array(source));
      return result;
    }
  }
  vi.stubGlobal("Blob", BrowserBlob);
  vi.stubGlobal("crypto", webcrypto);
  const track = { enabled: true, readyState: "live", stop: vi.fn() };
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, mediaDevices: {
    getUserMedia: async () => ({ getTracks: () => [track] }),
  } });
  class Recorder {
    static isTypeSupported() { return true; }
    mimeType = "audio/webm";
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; }
    pause() { this.state = "paused"; }
    resume() { this.state = "recording"; }
    requestData() { this.ondataavailable?.({ data: new Blob(["audio"]) }); }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["trailer"]) }); this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);

  await openThread();
  // Voice is its own control beside the expression picker, not a menu row.
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  expect(track.stop).not.toHaveBeenCalled();

  fireEvent.keyDown(document.body, { key: "Escape" });
  const dialog = await leaveDialog();
  expect(dialog.textContent).toMatch(/unsent recording/i);
  expect(path()).toBe("/chats/chat");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("button", { name: "Pause recording" })).toBeTruthy();
  expect(track.stop).not.toHaveBeenCalled();

  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.click(within(await leaveDialog()).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(path()).toBe("/chats"));
  expect(track.stop).toHaveBeenCalled();
  expect(m.voice).not.toHaveBeenCalled();
});

it("sends a live recording that was never paused, once, with its real duration", async () => {
  const capture = stubVoiceCapture();
  await openThread();
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  // Two and a half seconds of take end at the Send press, with no pause first.
  capture.advance(2_500);
  fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
  await waitFor(() => expect(m.voice).toHaveBeenCalledTimes(1));
  const [, , , metadata, bytes] = m.voice.mock.calls[0] as unknown as
    [string, string, string, VoiceAttempt, ArrayBuffer];
  expect(metadata.durationMs).toBe(2_500);
  expect(metadata.mime).toBe("audio/webm");
  expect(bytes.byteLength).toBeGreaterThan(0);
  // The strip gives the row back: nothing is left holding the note to send again.
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy());
  expect(m.voice).toHaveBeenCalledTimes(1);
});

it("leaves at once once the voice send is in flight, keeping the draft", async () => {
  const capture = stubVoiceCapture();
  await openThread();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Unsent words" } });
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  capture.advance(1_500);
  // The service holds the note: it is in the durable outbox now, so no leave can
  // discard or cancel it. The typed text is kept in the session draft store, so
  // nothing at all is at risk and the leave asks nothing.
  m.voice.mockReturnValue(new Promise(() => undefined));
  fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
  await waitFor(() => expect(m.voice).toHaveBeenCalledTimes(1));
  await screen.findByRole("button", { name: "Sending voice message" });

  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(path()).toBe("/chats"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  // Nothing was cancelled or sent twice, and the text waited for the next visit.
  expect(m.voice).toHaveBeenCalledTimes(1);
  expect(readConversationDraft("account", "chat")).toBe("Unsent words");
});

it("keeps a finalizing note as this screen's own until admission, and never sends after an explicit discard", async () => {
  const capture = stubVoiceCapture({ holdHash: true });
  await openThread();
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  capture.advance(2_000);
  fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
  // Finalize and the container read are done and the send is parked on the
  // digest, its last step before the service owns the note.
  await capture.hashEntered();
  await screen.findByRole("group", { name: "Voice message ready" });
  expect(m.voice).not.toHaveBeenCalled();

  fireEvent.keyDown(document.body, { key: "Escape" });
  const dialog = await leaveDialog();
  expect(dialog.textContent).toMatch(/unsent recording/i);
  expect(path()).toBe("/chats/chat");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  // Staying changes nothing: the same prepared note is still waiting to go out.
  expect(screen.getByRole("group", { name: "Voice message ready" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sending voice message" })).toBeTruthy();
  expect(m.voice).not.toHaveBeenCalled();

  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.click(within(await leaveDialog()).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(path()).toBe("/chats"));
  // The note was discarded while parked before admission. Releasing the digest
  // lets the send resume; releaseHash resolves after that resumption, so this
  // asserts once the chain has passed its refusal line, not while it is idle.
  await capture.releaseHash();
  expect(m.voice).not.toHaveBeenCalled();
});

it("lets the attachment sheet consume Escape, keeping the conversation and the draft", async () => {
  await openThread();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Draft stays" } });
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  const menu = screen.getByRole("menu", { name: "Add attachment" });
  fireEvent.keyDown(within(menu).getByRole("menuitem", { name: "Photos" }), { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "Add attachment" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(path()).toBe("/chats/chat");
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Draft stays");
});

it("lets open conversation info consume Escape, keeping the conversation", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
  await openThread();
  const details = await screen.findByRole("complementary", { name: "Conversation info" });
  const search = within(details).getByRole("button", { name: "Search chat" });
  search.focus();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Conversation info" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(path()).toBe("/chats/chat");
});

it("leaves a higher-priority layer in charge of Escape even when focus is outside it", async () => {
  await openThread();
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const close = document.createElement("button");
  close.textContent = "Close";
  modal.append(close);
  document.body.append(modal);
  try {
    // Focus never enters the layer; the press still belongs to it.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(path()).toBe("/chats/chat");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  } finally {
    modal.remove();
  }
});

it("ignores composing, repeated and modified Escape, then asks on a plain press", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64),
    mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await openThread();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Unsent words" } });
  // Real work a leave would discard, so a press that is wrongly honoured has
  // something to raise the question about.
  fireEvent.change(screen.getByLabelText("Photo file input"), {
    target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText("1 photo ready. Tap one to review.");

  fireEvent.keyDown(field, { key: "Escape", isComposing: true });
  fireEvent.keyDown(field, { key: "Escape", repeat: true });
  fireEvent.keyDown(field, { key: "Escape", ctrlKey: true });
  fireEvent.keyDown(field, { key: "Escape", altKey: true });
  fireEvent.keyDown(field, { key: "Escape", metaKey: true });
  fireEvent.keyDown(field, { key: "Escape", shiftKey: true });
  expect(path()).toBe("/chats/chat");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(field).toHaveProperty("value", "Unsent words");

  fireEvent.keyDown(field, { key: "Escape" });
  const dialog = await leaveDialog();
  expect(dialog.textContent).toMatch(/unsent photos/i);
  expect(dialog.textContent).not.toMatch(/message/i);
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(path()).toBe("/chats"));
  expect(m.text).not.toHaveBeenCalled();
  expect(m.voice).not.toHaveBeenCalled();
  expect(m.location).not.toHaveBeenCalled();
  expect(m.remove).not.toHaveBeenCalled();
  expect(m.clear).not.toHaveBeenCalled();
  expect(m.relationship).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
});

it("asks Android Back before leaving work a leave would discard, and keeps it when the reader stays", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64),
    mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await openThread();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Unsent words" } });
  fireEvent.change(screen.getByLabelText("Photo file input"), {
    target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] },
  });
  await screen.findByText("1 photo ready. Tap one to review.");

  pressBack();
  const dialog = await leaveDialog();
  // The question names only what leaving discards: the staged photo, never the
  // text that the session draft store keeps.
  expect(dialog.textContent).toMatch(/unsent photos/i);
  expect(dialog.textContent).not.toMatch(/message/i);
  expect(path()).toBe("/chats/chat");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(path()).toBe("/chats/chat");
  expect(screen.getByText("1 photo ready. Tap one to review.")).toBeTruthy();
  expect(field).toHaveProperty("value", "Unsent words");

  pressBack();
  fireEvent.click(within(await leaveDialog()).getByRole("button", { name: "Leave chat" }));
  await waitFor(() => expect(path()).toBe("/chats"));
  expect(m.text).not.toHaveBeenCalled();
});

it("leaves a clean conversation for the chat list on Android Back", async () => {
  await openThread();
  pressBack();
  await waitFor(() => expect(path()).toBe("/chats"));
});

it("lets an open layer consume Android Back before the leave guard", async () => {
  await openThread();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Unsent words" } });
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("menu", { name: "Add attachment" })).toBeTruthy();

  pressBack();
  expect(screen.queryByRole("menu", { name: "Add attachment" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(path()).toBe("/chats/chat");
  expect(field).toHaveProperty("value", "Unsent words");
});

it("leaves the app name to the shell's rail anchor, not the thread header", async () => {
  await openThread({ inlineRail: true });
  const back = screen.getByRole("link", { name: "Back to chats" });
  const header = back.closest("header.fb-chat-header");
  expect(header).not.toBeNull();
  // The shell owns the one outside wordmark, anchored to the rail itself. A
  // thread header never positions or copies it (owner direction 2026-11-18).
  expect(header!.querySelector(".fb-nav-outside-brand")).toBeNull();
  expect(header!.textContent).not.toContain("Norfold");
  expect(screen.getByRole("heading", { level: 1, name: "Conversation" })).toBeTruthy();
});

it("keeps that header wordmark-free without an in-flow rail", async () => {
  await openThread();
  expect(screen.queryByText("Norfold")).toBeNull();
  expect(screen.getByRole("link", { name: "Back to chats" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Conversation" })).toBeTruthy();
});
