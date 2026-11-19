// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { Connections, MessagingThread, presentationProjection, replyPreview } from "./Messaging";
import type { ConversationProjection } from "../services/messaging/conversationIndex";
import { ConversationInfo } from "../components/ConversationInfo";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import { Capacitor } from "@capacitor/core";
import { PhotoUnavailableError } from "../services/messaging/mediaTransport";
import type { MessagingThreadSync } from "../services/messaging/runtime";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { sha256Hex } from "../services/messaging/media";
import { EXPRESSION_RECENTS_KEY } from "../services/expressionRecents";

const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return { view, watch: vi.fn(), chat: { accountId: "account", status: "ready", revision: 1,
    threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
    conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }], currentProjections: { chat: view },
    displayProjections: undefined as Record<string, ConversationProjection | typeof view> | null | undefined },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[], cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] }, threadRead: vi.fn(),
    voice: vi.fn(), location: vi.fn(), mute: vi.fn(), pin: vi.fn(), prepare: vi.fn(), relationship: vi.fn(), text: vi.fn(), send: vi.fn(), read: vi.fn(), download: vi.fn(), remove: vi.fn(), recover: vi.fn(), retry: vi.fn(), receipt: vi.fn(), observe: vi.fn(), refresh: vi.fn(), choose: vi.fn(), import: vi.fn(), file: vi.fn(), upload: vi.fn(), removeFile: vi.fn(),
    holdIds: vi.fn(async () => [] as string[]), hold: vi.fn(async (): Promise<Record<string, unknown> | null> => null), purgeHold: vi.fn(async () => undefined),
    report: vi.fn(async (_input: unknown, _signal?: AbortSignal) => ({ reportId: "receipt" })) };
});
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: async () => new Map([
  ["localized-peer", { id: "localized-peer", username: "rowan", displayName: "Rowan Lee" }],
]), readCachedAccountIdentities: () => new Map() }));
vi.mock("../services/people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/people")>()),
  searchPeople: async () => ({ items: [], nextCursor: null }),
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({ getCachedMessagingThreadState: () => m.cached, watchMessagingThread: m.watch, sendMessagingVoice: m.voice, sendMessagingLocation: m.location, setMessagingMuted: m.mute, pinMessagingMessage: m.pin, readMessagingThreadState: () => m.threadRead(), fetchMessagingReceiptView: m.receipt, observeMessagingReceipt: m.observe, markMessagingConversationRead: async () => {}, refreshMessaging: m.refresh, sendMessagingText: m.text, sendMessagingMedia: m.send, readMessagingMedia: m.read, downloadMessagingMedia: m.download, changeMessagingRelationship: m.relationship, clearMessagingConversation: async () => {}, removeMessagingMessage: m.remove, recoverMessagingText: m.recover, retryMessagingMessage: m.retry, readMessagingUnsentHoldIds: m.holdIds, readMessagingUnsentHold: m.hold, purgeMessagingUnsentHold: m.purgeHold }));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  uploadChatFile: m.upload,
  removeChatFile: m.removeFile,
}));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: (input: unknown, signal?: AbortSignal) => m.report(input, signal),
}));
vi.mock("../services/media/nativeMedia", () => ({ chooseNativeImages: m.choose, importNativeImageUri: m.import, importedImageToFile: m.file }));
beforeEach(() => { vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() })); m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.chat.revision = 1; m.messages = []; m.media = []; m.outbox = []; m.prepare.mockReset(); m.send.mockReset(); m.read.mockReset().mockResolvedValue(null); m.download.mockReset().mockResolvedValue(undefined); m.remove.mockReset().mockResolvedValue(undefined); m.recover.mockReset().mockResolvedValue(undefined); m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] }); m.observe.mockReset().mockResolvedValue(true); m.refresh.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}) });
  m.choose.mockReset(); m.import.mockReset(); m.file.mockReset();
  m.retry.mockReset().mockResolvedValue(undefined);
  m.upload.mockReset();
  m.removeFile.mockReset().mockResolvedValue(undefined);
  m.text.mockReset().mockResolvedValue("saved");
  m.location.mockReset().mockResolvedValue("shared"); m.chat.accountId = "account";
  m.relationship.mockReset().mockResolvedValue(undefined);
  m.mute.mockReset().mockResolvedValue(undefined); m.view.ownMuted = false; m.chat.status = "ready";
  m.pin.mockReset().mockResolvedValue(undefined); m.view.pinnedMessageIds = [];
  m.view.epoch = "relationship-a"; m.view.revision = 1; m.chat.currentProjections = { chat: m.view };
  m.chat.displayProjections = undefined;
  m.chat.conversations = [{ conversationId: "chat", peerId: "peer", cachedProjection: m.view }];
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.watch.mockReset().mockReturnValue(() => {});
  m.cached = null;
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.purgeHold.mockReset().mockImplementation(async () => undefined);
  m.report.mockReset().mockImplementation(async () => ({ reportId: "receipt" }));
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.removeItem(EXPRESSION_RECENTS_KEY); });

it("replaces the composer with recording/review, resumes, and sends only the finalized note", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  // Node's Blob returns a Node-realm buffer; the browser boundary correctly
  // requires this realm's ArrayBuffer. Keep the fake browser-shaped too.
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
  await expect(sha256Hex(await new Blob(["audio"]).arrayBuffer())).resolves.toHaveLength(64);
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
  m.voice.mockReset().mockResolvedValue("voice-saved");
  await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Keep my text draft" } });
  // Voice is its own control beside the expression picker, not a menu row.
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  now += 3_000;
  fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
  fireEvent.click(await screen.findByRole("button", { name: "Resume recording" }));
  now += 2_000;
  fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send voice message" }));
  await waitFor(() => expect(m.voice).toHaveBeenCalledOnce());
  expect(m.voice.mock.calls[0]?.[3]).toMatchObject({ durationMs: 5_000, byteSize: 17 });
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Keep my text draft");
  expect(track.stop).toHaveBeenCalled();
});

/** A browser-shaped recorder whose trailer or stop event can be withheld to hold
 *  the "pausing" phase, or the finalize itself, open as a slow container flush
 *  does on a real device. */
function fakeVoiceRecorder(options: { deferTrailer?: boolean; deferStop?: boolean } = {}) {
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
    /** The one recorder the app constructs, kept on the fake itself so the
     *  harness can drive its trailer and stop without aliasing `this`. */
    static latest: Recorder | null = null;
    mimeType = "audio/webm";
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() { Recorder.latest = this; }
    start() { this.state = "recording"; }
    pause() { this.state = "paused"; }
    resume() { this.state = "recording"; }
    requestData() { if (!options.deferTrailer) this.ondataavailable?.({ data: new Blob(["audio"]) }); }
    // The stop is delivered in one place, so a test can hold it open and see what
    // the strip offers while the container is still settling.
    deliverStop() { this.ondataavailable?.({ data: new Blob(["trailer"]) }); this.onstop?.(); }
    stop() { this.state = "inactive"; if (!options.deferStop) this.deliverStop(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  return {
    track,
    deliver: () => Recorder.latest?.ondataavailable?.({ data: new Blob(["audio"]) }),
    deliverStop: () => Recorder.latest?.deliverStop(),
  };
}
it("keeps the measured capture clock while the preview is still settling", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const recorder = fakeVoiceRecorder({ deferTrailer: true });
  m.voice.mockReset().mockResolvedValue("voice-saved");
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  now += 3_000;
  // Let the recorder publish its measured capture first, exactly as its 200 ms
  // tick does on a device; the pause itself carries no clock of its own.
  await act(async () => { await new Promise((done) => setTimeout(done, 250)); });
  fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
  // Pausing has no clock of its own. The last measured capture time must stay
  // on screen instead of flashing back to 0:00 while the trailer arrives.
  expect(await screen.findByText("0:03")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Recording voice message" })).toBeTruthy();
  await act(async () => { recorder.deliver(); });
  expect(await screen.findByRole("group", { name: "Voice message ready" })).toBeTruthy();
  expect(screen.getByText("0:03")).toBeTruthy();
  expect(m.voice).not.toHaveBeenCalled();
});
it("stops at the five-minute ceiling for review instead of sending", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  fakeVoiceRecorder();
  m.voice.mockReset().mockResolvedValue("voice-saved");
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  now += 300_000;
  fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
  await screen.findByRole("group", { name: "Voice message ready" });
  expect(screen.getByText("5:00")).toBeTruthy();
  // The ceiling stops the take; it never sends it.
  expect(screen.getByText(/5-minute limit reached/i)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Send voice message" }) as HTMLButtonElement).disabled).toBe(false);
  expect(m.voice).not.toHaveBeenCalled();
});
it("locks the strip behind a send that starts while the take is still open", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const recorder = fakeVoiceRecorder({ deferStop: true });
  m.voice.mockReset().mockResolvedValue("voice-saved");
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Voice message" }));
  await screen.findByRole("button", { name: "Pause recording" });
  now += 3_000;
  // Send works during the take: one press stops what has been recorded so far.
  fireEvent.click(screen.getByRole("button", { name: "Send voice message" }));
  // Until that take settles, the send owns the note. Pause, discard and a second
  // send are unavailable, so no press can throw away or fork the take that is
  // already being finalized, and the strip says what is happening.
  const sending = await screen.findByRole("button", { name: "Sending voice message" });
  expect((sending as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Pause recording" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Discard recording" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("group", { name: "Recording voice message" }).getAttribute("aria-busy")).toBe("true");
  expect(m.voice).not.toHaveBeenCalled();
  await act(async () => { recorder.deliverStop(); });
  await waitFor(() => expect(m.voice).toHaveBeenCalledTimes(1));
  // The press that owned the note is the only one that sent it, and the strip
  // leaves the screen once the note is admitted.
  await waitFor(() => expect(screen.queryByRole("group", { name: "Recording voice message" })).toBeNull());
});

it("collapses desktop conversation details without replacing the transcript or draft", async () => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
  sentText();
  await open();
  const details = screen.getByRole("complementary", { name: "Conversation info" });
  expect(within(details).getByRole("button", { name: "Search chat" })).toBeTruthy();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Keep this draft" } });
  const transcript = screen.getByRole("list", { name: "Messages" });
  const toggle = screen.getByRole("button", { name: "Hide conversation details" });
  toggle.focus(); fireEvent.click(toggle);
  expect(screen.queryByRole("complementary", { name: "Conversation info" })).toBeNull();
  expect(screen.getByRole("list", { name: "Messages" })).toBe(transcript);
  expect(field).toHaveProperty("value", "Keep this draft");
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Show conversation details" }));
  const opened = screen.getByRole("complementary", { name: "Conversation info" });
  const search = within(opened).getByRole("button", { name: "Search chat" });
  search.focus(); fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(document.activeElement).toBe(toggle);
  localStorage.clear();
});

it("remembers only the desktop details habit and reflows to compact options without losing focus or draft", async () => {
  localStorage.clear();
  let width = 960;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  const first = await open();
  fireEvent.click(screen.getByRole("button", { name: "Hide conversation details" }));
  first.unmount();
  await open();
  expect(screen.queryByRole("complementary")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show conversation details" }));
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Preserved through reflow" } });
  within(screen.getByRole("complementary")).getByRole("button", { name: "Search chat" }).focus();
  width = 320; fireEvent(window, new Event("resize"));
  expect(screen.queryByRole("complementary")).toBeNull();
  const options = screen.getByRole("button", { name: "Conversation options" });
  expect(document.activeElement).toBe(options);
  expect(field).toHaveProperty("value", "Preserved through reflow");
  fireEvent.click(options);
  expect(within(screen.getByRole("dialog", { name: "Conversation info" })).getByRole("button", { name: "Search chat" })).toBeTruthy();
  localStorage.clear();
});

it("uses the compact details sheet when enlarged text makes a third pane unreadable", async () => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
  await open();
  expect(screen.getByRole("complementary")).toBeTruthy();
  document.documentElement.style.fontSize = "32px";
  try {
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(screen.getByRole("button", { name: "Conversation options" })).toBeTruthy();
  } finally { document.documentElement.style.fontSize = ""; localStorage.clear(); }
});

async function open() {
  const rendered = render(thread());
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  return rendered;
}

/** The composer's one attachment control opens every real capability. */
function chooseAttachment(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  fireEvent.click(within(screen.getByRole("menu", { name: "Add attachment" })).getByRole("menuitem", { name }));
}

it("shows a pending outgoing message immediately and offers retry on admission failure", async () => {
  let reject!: (error: Error) => void;
  m.text.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Instant hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Instant hello")).toHaveLength(1);
  expect(screen.getByText("Sending…")).toBeTruthy();
  await act(async () => reject(new Error("offline")));
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Instant hello")).toHaveLength(1);
  expect(screen.getByText("Not sent")).toBeTruthy();
  m.text.mockResolvedValueOnce("saved");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[6]).toBe(m.text.mock.calls[0]?.[6]);
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Instant hello")).toHaveLength(1);
});

it("reconciles the local echo with the durable server row without duplication", async () => {
  let finish!: (value: string) => void;
  m.text.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const rendered = await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Reconciled" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const id = m.text.mock.calls[0]?.[6];
  m.messages = [{ id, conversationId: "chat", authorId: "account", recipientId: "peer",
    body: "Reconciled", messageType: "TEXT", createdAt: Date.now(), server: { eventId: "event", sequence: 1 } }];
  m.chat.revision++;
  rendered.rerender(thread());
  await screen.findByLabelText("Sent");
  expect(document.querySelectorAll(`[data-chat-message="${id}"]`)).toHaveLength(1);
  await act(async () => finish(id));
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Reconciled")).toHaveLength(1);
});

it("clears an admitted draft and reports a stale view without inviting a resend", async () => {
  m.text.mockResolvedValue({ id: "saved", viewStale: true });
  await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Saved once" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(field).toHaveProperty("value", ""));
  expect(m.text).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/could not be saved/i)).toBeNull();
  expect(screen.getByText(/view may be out of date/i)).toBeTruthy();
});

it("keeps a failed message on screen and retries it with the same identity", async () => {
  m.text.mockRejectedValueOnce(new Error("admission failed")).mockResolvedValueOnce("saved");
  await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Try again" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Your message was not sent. Tap Retry on it.");
  // The bubble owns the text now; the field does not keep a second copy.
  expect(field).toHaveProperty("value", "");
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Try again")).toHaveLength(1);
  expect(screen.getByText("Not sent")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[0]?.[6]).toBe(m.text.mock.calls[1]?.[6]);
  await waitFor(() => expect(screen.queryByText("Not sent")).toBeNull());
});

it("ignores two synchronous sends of the same draft", async () => {
  let finish!: (value: string) => void;
  m.text.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
  await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Once" } });
  const button = screen.getByRole("button", { name: "Send message" });
  act(() => { button.click(); button.click(); });
  expect(m.text).toHaveBeenCalledTimes(1);
  await act(async () => finish("saved"));
});

it("preserves a new draft typed while the first send is in flight", async () => {
  let finish!: (value: string) => void;
  m.text.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "First" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  fireEvent.change(field, { target: { value: "Second" } });
  await act(async () => finish("saved"));
  expect(field).toHaveProperty("value", "Second");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
});
function RouteState() { return <output data-testid="query">{useLocation().search}</output>; }
function thread(search = "") { return <MemoryRouter initialEntries={[`/connections/chat${search}`]}><LiveRegion /><MessagingRestoration /><Routes><Route path="/connections/:conversationId" element={<><MessagingThread /><RouteState /></>} /></Routes></MemoryRouter>; }

it("leases active thread catch-up without restarting it on snapshot refresh and releases it on close", async () => {
  const detach = vi.fn(); m.watch.mockReturnValue(detach);
  const rendered = await open(); expect(m.watch).toHaveBeenCalledWith("account", "chat");
  m.chat.revision++; rendered.rerender(thread());
  expect(m.watch).toHaveBeenCalledTimes(1);
  rendered.unmount(); expect(detach).toHaveBeenCalledTimes(1);
});
it("saves a new message without waiting for a failed thread refresh", async () => {
  sentText(); const rendered = await open();
  m.chat.threadSync = { conversationId: "chat", mode: "error", missing: null };
  m.chat.status = "offline"; m.chat.currentProjections = null as unknown as typeof m.chat.currentProjections;
  rendered.rerender(thread());
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Continue offline" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledWith("account", "chat", "peer", "Continue offline", undefined, undefined, expect.any(String), expect.any(Function)));
  await waitFor(() => expect(field).toHaveProperty("value", ""));
});

it("holds the screen on a blurred restore pop-up while a large gap fills in", async () => {
  sentText(); const rendered = await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Keep this draft" } });
  m.chat.threadSync = { conversationId: "chat", mode: "blocking", missing: 11, reason: "gap" }; rendered.rerender(thread());
  // Owner direction 2026-11-06: more than ten missing messages is a restore, not
  // a status line. The reader is held on a non-dismissible pop-up, with the page
  // blurred behind it, until reconciliation publishes its durable result.
  const dialog = screen.getByRole("dialog", { name: "Restoring messages" });
  expect(within(dialog).getByRole("status").textContent).toContain("up to date");
  expect(dialog.closest(".fixed")?.querySelector("[data-testid='bottom-sheet-backdrop']")?.className)
    .toContain("backdrop-blur");
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 }; rendered.rerender(thread());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Keep this draft");
});
it("silently leaves a small harmless gap usable and offers a safe retry only after catch-up fails", async () => {
  m.chat.threadSync = { conversationId: "chat", mode: "soft", missing: 10 };
  const rendered = await open(); const field = screen.getByRole("textbox", { name: "Message" });
  expect(field).toHaveProperty("readOnly", false); expect(screen.queryByText("Updating…")).toBeNull();
  fireEvent.change(field, { target: { value: "Still here" } });
  m.chat.threadSync = { conversationId: "chat", mode: "error", missing: null }; rendered.rerender(thread());
  expect(screen.getByText(/Showing your saved messages/)).toBeTruthy();
  expect(field).toHaveProperty("readOnly", false); expect(field).toHaveProperty("value", "Still here");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(m.refresh).toHaveBeenCalledWith("account");
});
it.each([null, { conversationId: "chat", mode: "checking", missing: null },
  { conversationId: "chat", mode: "blocking", missing: 10, reason: "gap" }])("does not announce routine synchronization %j", async sync => {
  sentText(); m.chat.threadSync = sync as MessagingThreadSync | null;
  await open();
  expect(screen.getByText("Already read")).toBeTruthy();
  expect(screen.queryByText("Updating…")).toBeNull();
  expect(screen.queryByText(/Showing your saved messages/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps the rendered transcript visible while the reconciled copy is read", async () => {
  sentText(); const rendered = await open();
  m.chat.threadSync = { conversationId: "chat", mode: "blocking", missing: 1 }; rendered.rerender(thread());
  let finish!: (value: { messages: unknown[]; outbox: unknown[]; media: unknown[] }) => void;
  m.threadRead.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  m.chat.revision = 2; m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0, appliedRevision: 2 };
  rendered.rerender(thread());
  // The already-rendered body stays readable instead of blanking behind a lock.
  expect(screen.getByText("Already read")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("readOnly", false);
  expect(document.querySelector(".fb-chat-messages")?.hasAttribute("inert")).toBe(false);
  await act(async () => { finish({ messages: [], outbox: [], media: [] }); });
  await waitFor(() => expect(screen.queryByText("Already read")).toBeNull());
});
it("offers retry when a reconciled transcript cannot be read instead of remaining stuck updating", async () => {
  sentText(); const rendered = await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Preserve my draft" } });
  m.threadRead.mockRejectedValue(new Error("local read failed"));
  m.chat.revision = 2; m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0, appliedRevision: 2 };
  rendered.rerender(thread());
  await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
  // A failed local read is recoverable without taking the draft or the history.
  expect(field).toHaveProperty("readOnly", false); expect(field).toHaveProperty("value", "Preserve my draft");
  expect(screen.getByText("Already read")).toBeTruthy();
  m.threadRead.mockResolvedValue({ messages: [], outbox: [], media: [] });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(m.refresh).toHaveBeenCalledWith("account");
  await waitFor(() => expect(screen.queryByText("Already read")).toBeNull());
});

it("keeps the composer usable and preserves newer typing while a text is still being admitted", async () => {
  const admissions: Array<() => void> = [];
  const resolvers: Array<(value: string) => void> = [];
  m.text.mockReset().mockImplementation((...args: unknown[]) => {
    admissions.push(args[7] as () => void);
    return new Promise<string>((resolve) => { resolvers.push(resolve); });
  });
  await open();
  const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "First" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  expect(field.disabled).toBe(false);
  fireEvent.change(field, { target: { value: "Second" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  // Typing and editing stay available, but a second durable admission waits for
  // the first one's committed boundary, which is still inside the runtime.
  expect(m.text).toHaveBeenCalledTimes(1);
  expect(field.value).toBe("Second");
  // The durable callback fires before the blocked view read resolves; only then
  // does the next deliberate send become admissible.
  await act(async () => { admissions[0]!(); });
  expect(field.value).toBe("Second");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text).toHaveBeenLastCalledWith("account", "chat", "peer", "Second", undefined, undefined, expect.any(String), expect.any(Function));
  // The first view read is still unresolved; the second admission is legitimate.
  await act(async () => { resolvers[0]!("saved"); });
  await waitFor(() => expect(field.value).toBe("Second"));
  await act(async () => { admissions[1]!(); });
  await waitFor(() => expect(field.value).toBe(""));
  await act(async () => { resolvers[1]!("saved"); });
  expect(screen.queryAllByText("Message saved. Sending.")).toHaveLength(0);
});
it("preserves a newer draft even when its text equals the in-flight admission", async () => {
  let finish!: (value: string) => void;
  m.text.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Same words" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  fireEvent.change(field, { target: { value: "A different thought" } });
  fireEvent.change(field, { target: { value: "Same words" } });
  await act(async () => { finish("saved"); });
  expect(field).toHaveProperty("value", "Same words");
});

it("accepts an incoming request before the reply leaves", async () => {
  // Replying is the recipient's decision: the accept goes through the canonical
  // relationship action first, and the text only leaves after it lands.
  m.view.mode = "REQUEST"; m.view.request = "INCOMING";
  m.chat.currentProjections = { chat: m.view };
  await open();
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "Happy to help" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.relationship).toHaveBeenCalledWith("account", "chat", "accept"));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  expect(m.relationship.mock.invocationCallOrder[0]).toBeLessThan(m.text.mock.invocationCallOrder[0]!);
  await waitFor(() => expect(field).toHaveProperty("value", ""));
});

function sentText() {
  m.messages = [{ id: "sent", conversationId: "chat", authorId: "account", recipientId: "peer", body: "Already read", messageType: "TEXT", server: { sequence: 1 } }];
}
it("renders an emoji-only message without bubble chrome", async () => {
  m.messages = [{ id: "emoji", conversationId: "chat", authorId: "account", recipientId: "peer", body: "😞", messageType: "TEXT", server: { sequence: 1 } }];
  await open();
  const bubble = document.querySelector('[data-chat-message="emoji"] .fb-chat-message');
  expect(bubble?.className).toContain("fb-chat-message-emoji");
  expect(screen.getByText("😞").className).toContain("fb-chat-emoji-only");
});
it("does not strip the bubble from ordinary text", async () => {
  sentText();
  await open();
  const bubble = document.querySelector('[data-chat-message="sent"] .fb-chat-message');
  expect(bubble?.className).not.toContain("fb-chat-message-emoji");
});
it("renders a reopened cached thread and Read before any asynchronous refresh settles", () => {
  sentText(); m.messages = m.messages.map(message => ({ ...message as object, readByPeer: true }));
  m.cached = { messages: m.messages, outbox: [], media: [] };
  m.threadRead.mockReturnValue(new Promise(() => {}));
  render(thread());
  expect(screen.getByText("Already read")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  expect(screen.queryByText("Opening messages…")).toBeNull();
});
it("reopens durable Read offline without receipt lookups for confirmed messages", async () => {
  sentText(); m.messages = m.messages.map(message => ({ ...message as object, readByPeer: true }));
  const rendered = await open();
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  m.chat.status = "offline"; m.chat.currentProjections = null as never; rendered.rerender(thread());
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  m.chat.status = "ready"; m.chat.currentProjections = { chat: { ...m.view } }; m.chat.revision++;
  rendered.rerender(thread());
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(m.receipt).not.toHaveBeenCalled();
});
it("keeps known Read through transcript refresh, projection copies and a failed receipt lookup", async () => {
  sentText(); m.receipt.mockResolvedValue({ context: "authority", readIds: ["sent"] });
  const rendered = await open(); await screen.findByRole("img", { name: "Read" });
  m.receipt.mockRejectedValue(new Error("temporary network failure"));
  m.chat.currentProjections = { chat: { ...m.view } }; m.chat.revision++;
  rendered.rerender(thread());
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy(); expect(screen.queryByRole("img", { name: "Sent" })).toBeNull();
  m.messages = [...m.messages]; m.chat.revision++; rendered.rerender(thread());
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(m.receipt).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
});
it("keeps Read across mute-only member revisions without rechecking it", async () => {
  sentText(); m.receipt.mockResolvedValue({ context: "authority", readIds: ["sent"] });
  const rendered = await open(); await screen.findByRole("img", { name: "Read" });
  m.chat.currentProjections = { chat: { ...m.view, ownMuted: true, revision: 2 } };
  rendered.rerender(thread());
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(m.receipt).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
});
it.each([null, "new-consent"])("keeps historical Read when a new message gets receipt context %s", async context => {
  sentText(); m.receipt.mockResolvedValue({ context: "authority", readIds: ["sent"] });
  const rendered = await open(); await screen.findByRole("img", { name: "Read" });
  m.receipt.mockResolvedValue({ context, readIds: [] });
  m.messages = [...m.messages, { id: "new", conversationId: "chat", authorId: "account", recipientId: "peer", body: "New message", messageType: "TEXT", server: { sequence: 2 } }];
  m.chat.revision++; rendered.rerender(thread());
  await screen.findByText("New message");
  await waitFor(() => expect(m.receipt).toHaveBeenCalledTimes(2));
  expect(m.receipt.mock.calls[1]?.[2]).toEqual(["new"]);
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Sent" })).toBeTruthy();
});
it("retains historical Read across relationship changes without using it as receipt permission", async () => {
  sentText(); m.receipt.mockResolvedValue({ context: "authority", readIds: ["sent"] });
  const rendered = await open(); await screen.findByRole("img", { name: "Read" });
  m.receipt.mockImplementation(() => new Promise(() => {}));
  m.chat.currentProjections = { chat: { ...m.view, epoch: "relationship-b", revision: 2 } };
  rendered.rerender(thread());
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  expect(m.observe).not.toHaveBeenCalled();
});
it("keeps historical Read while offline", async () => {
  sentText(); m.receipt.mockResolvedValue({ context: "authority", readIds: ["sent"] });
  const rendered = await open(); await screen.findByRole("img", { name: "Read" });
  m.chat.status = "offline"; rendered.rerender(thread());
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy(); expect(screen.queryByRole("img", { name: "Sent" })).toBeNull();
  m.chat.status = "ready";
  m.receipt.mockResolvedValue({ context: "authority", readIds: [] });
  rendered.rerender(thread()); await screen.findByRole("img", { name: "Read" });
});

it("attaches a report-origin subject to the first text only", async () => {
  const report = "00000000-0000-4000-8000-000000000007";
  render(thread(`?report=${report}`)); await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  const field = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: "About this report" } }); fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledExactlyOnceWith("account", "chat", "peer", "About this report", report, undefined, expect.any(String), expect.any(Function)));
  await waitFor(() => expect(field).toHaveProperty("value", ""));
  await waitFor(() => expect(screen.getByTestId("query").textContent).toBe(""));
  fireEvent.change(field, { target: { value: "Now ordinary text" } }); fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenLastCalledWith("account", "chat", "peer", "Now ordinary text", undefined, undefined, expect.any(String), expect.any(Function)));
});

function geolocation() {
  let success: PositionCallback = () => {}, failure: PositionErrorCallback = () => {};
  const request = vi.fn((yes: PositionCallback, no: PositionErrorCallback) => { success = yes; failure = no; });
  vi.stubGlobal("navigator", new Proxy(navigator, { get: (target, key) => key === "geolocation"
    ? { getCurrentPosition: request } : Reflect.get(target, key, target) }));
  return { request, resolve: (accuracy = 25) => success({ coords: { latitude: 23, longitude: 90, accuracy } } as GeolocationPosition),
    reject: () => failure({ code: 1 } as GeolocationPositionError) };
}
async function locationPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  fireEvent.click(await screen.findByRole("button", { name: "Share location" }));
  return await screen.findByRole("dialog", { name: "Share a location" });
}
it("reviews an approximate or exact pin and sends only on a separate activation, keeping the draft", async () => {
  const geo = geolocation(); await open();
  const field = screen.getByRole("textbox", { name: "Message" }); fireEvent.change(field, { target: { value: "Keep draft" } });
  const picker = await locationPicker(); expect(geo.request).not.toHaveBeenCalled();
  expect(within(picker).getByRole("button", { name: "Send location" })).toHaveProperty("disabled", true);
  fireEvent.click(within(picker).getByRole("button", { name: "Use my location once" }));
  await waitFor(() => expect(geo.request).toHaveBeenCalledTimes(1));
  await act(async () => geo.resolve());
  expect(m.location).not.toHaveBeenCalled();
  fireEvent.click(within(picker).getByRole("button", { name: "Use exact pin" }));
  expect(within(picker).getByText(/shared in this chat/)).toBeTruthy();
  fireEvent.click(within(picker).getByRole("button", { name: "Send location" }));
  await waitFor(() => expect(m.location).toHaveBeenCalledExactlyOnceWith("account", "chat", "peer", { lat: 23, lng: 90, accuracy: 25 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(field).toHaveProperty("value", "Keep draft"); expect(m.text).not.toHaveBeenCalled();
  expect(screen.queryAllByText("Location shared.")).toHaveLength(0);
});
it.each([0, -1, Number.NaN])("does not invent an accuracy estimate for location %s", async (accuracy) => {
  const geo = geolocation(); await open(); const picker = await locationPicker();
  fireEvent.click(within(picker).getByRole("button", { name: "Use my location once" }));
  await waitFor(() => expect(geo.request).toHaveBeenCalledTimes(1));
  await act(async () => geo.resolve(accuracy)); expect(m.location).not.toHaveBeenCalled();
  expect(within(picker).getByRole("button", { name: "Send location" })).toHaveProperty("disabled", true);
});
it.each(["account", "relationship", "blocked"])("drops a delayed location result after %s changes", async (change) => {
  const geo = geolocation(); const rendered = await open();
  const picker = await locationPicker(); fireEvent.click(within(picker).getByRole("button", { name: "Use my location once" }));
  await waitFor(() => expect(geo.request).toHaveBeenCalledTimes(1));
  if (change === "account") m.chat.accountId = "another";
  else if (change === "relationship") m.view.mode = "REQUEST";
  else m.view.ownBlocked = true;
  rendered.rerender(thread()); await act(async () => geo.resolve()); expect(m.location).not.toHaveBeenCalled();
});
it("shows a location permission failure without sending or losing the draft", async () => {
  const geo = geolocation(); await open(); const picker = await locationPicker();
  fireEvent.click(within(picker).getByRole("button", { name: "Use my location once" }));
  await waitFor(() => expect(geo.request).toHaveBeenCalledTimes(1));
  await act(async () => geo.reject()); expect(m.location).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/Location permission/);
});
it("shares a manual approximate pin without a permission request or invented accuracy", async () => {
  const geo = geolocation(); await open(); const picker = await locationPicker();
  fireEvent.change(within(picker).getByRole("textbox", { name: "Approximate location" }), { target: { value: "23.810332, 90.412518" } });
  expect(within(picker).getByText("Pin rounded to ~100 m precision.")).toBeTruthy();
  fireEvent.click(within(picker).getByRole("button", { name: "Send location" }));
  await waitFor(() => expect(m.location).toHaveBeenCalledExactlyOnceWith("account", "chat", "peer", { lat: 23.81, lng: 90.413, accuracy: null }));
  expect(geo.request).not.toHaveBeenCalled();
});
it("cancels the location picker without sending and rejects duplicate send activation", async () => {
  await open(); let picker = await locationPicker();
  fireEvent.change(within(picker).getByRole("textbox", { name: "Approximate location" }), { target: { value: "23, 90" } });
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(m.location).not.toHaveBeenCalled();
  picker = await locationPicker();
  expect(within(picker).getByRole("button", { name: "Send location" })).toHaveProperty("disabled", true);
  fireEvent.change(within(picker).getByRole("textbox", { name: "Approximate location" }), { target: { value: "23, 90" } });
  let done!: () => void; m.location.mockReturnValue(new Promise<void>(resolve => { done = resolve; }));
  const send = within(picker).getByRole("button", { name: "Send location" }); fireEvent.click(send); fireEvent.click(send);
  expect(m.location).toHaveBeenCalledTimes(1); await act(async () => done());
});
it("sets mute explicitly without replacing the draft or optimistically claiming a saved preference", async () => {
  let finish:()=>void=()=>{};m.mute.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const rendered=await open();fireEvent.change(screen.getByRole("textbox",{name:"Message"}),{target:{value:"Keep this draft"}});
  fireEvent.click(screen.getByRole("button",{name:"Conversation options"}));
  const control=screen.getByRole("switch",{name:"Mute notifications"});
  expect(control.getAttribute("aria-checked")).toBe("false");fireEvent.click(control);
  expect(m.mute).toHaveBeenCalledExactlyOnceWith("account","chat",true);
  expect(control).toHaveProperty("disabled",true);expect(control.getAttribute("aria-checked")).toBe("false");
  await act(async()=>{m.view.ownMuted=true;finish();});rendered.rerender(thread());
  await waitFor(()=>expect(control.getAttribute("aria-checked")).toBe("true"));
  fireEvent.keyDown(document,{key:"Escape"});await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("textbox",{name:"Message"})).toHaveProperty("value","Keep this draft");
  expect(screen.getByLabelText("Notifications muted")).toBeTruthy();
});
it("keeps mute failure in conversation info without showing a saved state",async()=>{
  m.mute.mockRejectedValue(new Error("refused"));await open();fireEvent.click(screen.getByRole("button",{name:"Conversation options"}));
  const dialog=screen.getByRole("dialog",{name:"Conversation info"});fireEvent.click(within(dialog).getByRole("switch",{name:"Mute notifications"}));
  await waitFor(()=>expect(within(dialog).getByRole("alert").textContent).toMatch(/notifications.*could not be saved/i));
  expect(within(dialog).getByRole("switch").getAttribute("aria-checked")).toBe("false");
});
it("keeps a cached mute indication but disables changes while offline",async()=>{
  m.view.ownMuted=true;m.chat.status="offline";await open();fireEvent.click(screen.getByRole("button",{name:"Conversation options"}));
  const control=screen.getByRole("switch",{name:"Mute notifications"});expect(control.getAttribute("aria-checked")).toBe("true");expect(control).toHaveProperty("disabled",true);
  fireEvent.click(control);expect(m.mute).not.toHaveBeenCalled();
});
it("searches saved text without exposing unsent bodies and returns focus to the actual message", async () => {
  m.messages = [
    { ...received("TEXT"), id:"first", body:"The blue wallet is safe" },
    { ...received("TEXT"), id:"removed", body:"Secret blue wallet", unsentAt:1 },
    { ...received("TEXT"), id:"other", body:"Meet at the station" },
  ];
  await open();fireEvent.click(screen.getByRole("button", { name:"Conversation options" }));
  fireEvent.click(screen.getByRole("button", { name:"Search chat" }));
  const dialog=screen.getByRole("dialog", {name:"Search chat"});
  fireEvent.change(within(dialog).getByRole("searchbox", {name:"Search saved messages"}), {target:{value:"BLUE WALLET"}});
  expect(within(dialog).getByRole("status").textContent).toBe("1 message found");
  expect(within(dialog).queryByText("Secret blue wallet")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", {name:/The blue wallet is safe/}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement?.textContent).toContain("The blue wallet is safe");
  expect(document.activeElement?.closest('ol[aria-label="Messages"]')).toBeTruthy();
});
it.each([['CONNECTED','Archive','hide'],['REQUEST','Hide request','hide']])("uses existing visibility semantics from %s conversation info", async (mode,label,action) => {
  m.view.mode=mode;await open();fireEvent.click(screen.getByRole("button", { name:"Conversation options" }));
  const dialog=screen.getByRole("dialog",{name:"Conversation info"});
  fireEvent.click(within(dialog).getByRole("button",{name:label}));
  await waitFor(()=>expect(m.relationship).toHaveBeenCalledExactlyOnceWith("account","chat",action));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
});
it("keeps failed destructive operations in a labelled confirmation with their error", async () => {
  m.messages=[received("TEXT")];m.remove.mockRejectedValue(new Error("refused"));await open();
  fireEvent.click(screen.getByRole("button",{name:"Options for received message"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete for me"}));
  const dialog=screen.getByRole("alertdialog",{name:"Delete for me?"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Delete for me"}));
  await waitFor(()=>expect(within(dialog).getByRole("alert").textContent).toMatch(/Could not confirm/));
  expect(screen.getByText("Caption")).toBeTruthy();
});
it("shows shared pins under the header and rings the message it jumps to", async () => {
  m.messages = [
    { ...received("TEXT"), id: "pinned", body: "Bring the charger" },
    { ...received("TEXT"), id: "later", body: "See you", server: { eventId: "event-2", sequence: 2 } },
  ];
  m.view.pinnedMessageIds = ["pinned"];
  await open();
  const strip = screen.getByRole("region", { name: "Pinned messages" });
  fireEvent.click(within(strip).getByRole("button", { name: /Pinned message from/ }));
  const row = document.querySelector<HTMLElement>('[data-chat-message="pinned"]');
  await waitFor(() => expect(row?.querySelector(".fb-chat-message")?.className).toMatch(/fb-chat-flash-[ab]/));
  expect(document.activeElement).toBe(row);
});
it("pins and unpins from the existing message menu and stops at three", async () => {
  m.messages = [
    { ...received("TEXT"), id: "one" }, { ...received("TEXT"), id: "two" },
    { ...received("TEXT"), id: "three" }, { ...received("TEXT"), id: "four", server: { eventId: "event-4", sequence: 4 } },
  ];
  m.view.pinnedMessageIds = ["one", "two", "three"];
  await open();
  fireEvent.click(screen.getAllByRole("button", { name: "Options for received message" })[0]!);
  fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
  await waitFor(() => expect(m.pin).toHaveBeenCalledWith("account", "chat", "one", false));
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getAllByRole("button", { name: "Options for received message" })[3]!);
  expect(screen.getByRole("menuitem", { name: "Pin" }).getAttribute("aria-disabled")).toBe("true");
});
it("drops a pin whose message is unsent or no longer on this device", async () => {
  m.messages = [{ ...received("TEXT"), id: "gone", unsentAt: 1 }];
  m.view.pinnedMessageIds = ["gone", "missing"];
  await open();
  expect(screen.queryByRole("region", { name: "Pinned messages" })).toBeNull();
});
it("reports the participant directly instead of reusing a previously selected message", async () => {
  m.messages=[received("TEXT")];await open();
  fireEvent.click(screen.getByRole("button",{name:"Options for received message"}));
  fireEvent.keyDown(document,{key:"Escape"});await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"Conversation options"}));
  fireEvent.click(screen.getByRole("button",{name:"Report account"}));
  const dialog=screen.getByRole("dialog",{name:"Report a problem"});
  expect(within(dialog).getByText("Tell us what is wrong with this person.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("radio",{name:/harassment/i}));
  fireEvent.click(within(dialog).getByRole("button",{name:/send report/i}));
  await waitFor(()=>expect(m.report).toHaveBeenCalledWith(expect.objectContaining({
    targetType: "USER", targetId: "peer", conversationId: "chat",
    evidence: [{ id: "message", body: "Caption" }],
  }), expect.anything()));
});
it("reports the held copy of an unsent message, then stops offering it", async () => {
  const held = "00000000-0000-4000-8000-0000000000aa";
  m.messages = [{ ...received("TEXT"), id: held, body: "", unsentAt: 5 }];
  m.holdIds.mockImplementation(async () => [held]);
  m.hold.mockImplementation(async () => ({ messageId: held, conversationId: "chat", authorId: "peer",
    recipientId: "account", body: "the removed words", heldAt: 5, expiresAt: Date.now() + 60_000 }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Options for received message" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Report message" }));
  const dialog = await screen.findByRole("dialog", { name: "Report a problem" });
  fireEvent.click(within(dialog).getByRole("radio", { name: /harassment/i }));
  fireEvent.click(within(dialog).getByRole("button", { name: /send report/i }));
  await waitFor(() => expect(m.report).toHaveBeenCalledWith(expect.objectContaining({
    targetType: "MESSAGE", targetId: held, accountId: "account", body: "the removed words",
  }), expect.anything()));
  await waitFor(() => expect(m.purgeHold).toHaveBeenCalledWith("account", held));
});
it("does not offer a report for an unsent message whose hidden copy has expired", async () => {
  m.messages = [{ ...received("TEXT"), id: "00000000-0000-4000-8000-0000000000ab", body: "", unsentAt: 5 }];
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Options for received message" }));
  expect(screen.queryByRole("menuitem", { name: "Report message" })).toBeNull();
});
it("sends desktop Enter once but preserves Shift+Enter and IME composition", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: fine"), addEventListener() {}, removeEventListener() {} }));
  await open();const field=screen.getByRole("textbox",{name:"Message"});
  fireEvent.change(field,{target:{value:"Hello"}});
  fireEvent.keyDown(field,{key:"Enter",shiftKey:true});expect(m.text).not.toHaveBeenCalled();
  fireEvent.compositionStart(field);fireEvent.keyDown(field,{key:"Enter"});expect(m.text).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);fireEvent.keyDown(field,{key:"Enter"});
  await waitFor(()=>expect(m.text).toHaveBeenCalledExactlyOnceWith("account","chat","peer","Hello",undefined,undefined,expect.any(String),expect.any(Function)));
  await waitFor(()=>expect(field).toHaveProperty("value",""));
});
it("offers an accessible photo picker in a connected conversation", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  const menu = screen.getByRole("menu", { name: "Add attachment" });
  expect((within(menu).getByRole("menuitem", { name: "Photos" }) as HTMLButtonElement).disabled).toBe(false);
  expect((within(menu).getByRole("menuitem", { name: "Camera" }) as HTMLButtonElement).disabled).toBe(false);
});
it("does not offer an active photo picker in a request", async () => {
  m.view.mode = "REQUEST"; await open();
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  const menu = screen.getByRole("menu", { name: "Add attachment" });
  expect((within(menu).getByRole("menuitem", { name: "Photos" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(menu).getByRole("menuitem", { name: "Camera" }) as HTMLButtonElement).disabled).toBe(true);
});
it("prepares a selected web photo and allows removing the draft", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 1, height: 1 });
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeTruthy());
  expect(m.prepare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
  expect(screen.queryByRole("button", { name: /remove photo/i })).toBeNull();
});
it("keeps the same photo and caption on retry after uncertain admission", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 1, height: 1 });
  m.send.mockRejectedValueOnce(new Error("uncertain")).mockResolvedValueOnce("saved");
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(screen.getByText("1 photo ready. Tap one to review.")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "caption" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.send).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.send).toHaveBeenCalledTimes(2));
  expect(m.send.mock.calls[1]).toEqual(m.send.mock.calls[0]);
});
it("shows an image-only message as a loading photo until metadata arrives", async () => {
  m.messages = [{ id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body: "", messageType: "MEDIA", server: { eventId: "event", sequence: 1 } }];
  await open();
  expect(screen.getByText("Photo loading…")).toBeTruthy();
});
it("does not claim a photo was sent while its attachment is uploading", async () => {
  m.messages = [{ id: "message", conversationId: "chat", authorId: "account", recipientId: "peer", body: "caption", messageType: "MEDIA", server: { eventId: "event", sequence: 1 } }];
  m.media = [{ id: "photo", messageId: "message", direction: "OUT", state: "UPLOADING", width: 2, height: 1, mime: "image/jpeg" }];
  await open();
  expect(screen.queryByRole("img", { name: "Sent" })).toBeNull();
  expect(screen.getByText(/sending/i)).toBeTruthy();
});

it("shows and opens the correlated local photo with an accessible label", async () => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() });
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  m.messages = [{ id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body: "caption", messageType: "MEDIA", server: { eventId: "event", sequence: 1 } }];
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg", expiresAt: Date.now() + 100000 }];
  await open();
  await waitFor(() => expect(screen.getByRole("button", { name: /view photo/i })).toBeTruthy());
  expect(m.read).toHaveBeenCalledWith("account", "photo");
  fireEvent.click(screen.getByRole("button", { name: /view photo/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeTruthy());
  expect(screen.getByText("caption")).toBeTruthy();
});
it("offers Download again when a photo is evicted", async () => {
  m.messages = [{ id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body: "", messageType: "MEDIA", server: { eventId: "event", sequence: 1 } }];
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "EVICTED", width: 2, height: 1, mime: "image/jpeg", expiresAt: Date.now() + 100000 }];
  await open();
  fireEvent.click(await screen.findByRole("button", { name: /download again/i }));
  await waitFor(() => expect(m.download).toHaveBeenCalledWith("account", "chat", "photo"));
});
it("allows removing a locally pending photo without unsending", async () => {
  m.messages = [{ id: "message", conversationId: "chat", authorId: "account", recipientId: "peer", body: "", messageType: "MEDIA" }];
  m.media = [{ id: "photo", messageId: "message", direction: "OUT", state: "QUEUED", width: 2, height: 1, mime: "image/jpeg" }];
  await open();
  fireEvent.click(screen.getByRole("button", { name: /remove pending photo/i }));
  await waitFor(() => expect(m.remove).toHaveBeenCalledWith("account", "chat", "message", false));
});
function photoRun(count: number, start = 1_000) {
  const messages: Array<Record<string, unknown>> = Array.from({ length: count }, (_, index) => ({
    id: `photo-${index + 1}`, conversationId: "chat", authorId: "account", recipientId: "peer",
    body: index === 0 ? "Two shots" : "", messageType: "MEDIA",
    createdAt: start + index * 1_000, server: { eventId: `event-${index}`, sequence: index + 1 },
  }));
  const media: Array<Record<string, unknown>> = messages.map((message, index) => ({
    id: `media-${index + 1}`, messageId: message.id, direction: "OUT", state: "READY", width: 2, height: 1, mime: "image/jpeg" }));
  return { messages, media };
}
it("shows only live image attachments from photo or legacy messages in shared photos", async () => {
  m.messages = [
    { id: "photo", messageType: "MEDIA" }, { id: "legacy" },
    { id: "voice", messageType: "VOICE" }, { id: "audio-media", messageType: "MEDIA" },
    { id: "text", messageType: "TEXT" }, { id: "unsent", messageType: "MEDIA", unsentAt: 1 },
  ];
  m.media = [
    ["photo", "image/jpeg"], ["legacy", "image/png"], ["voice", "audio/webm"],
    ["audio-media", "audio/webm"], ["text", "image/jpeg"], ["unsent", "image/jpeg"],
  ].map(([messageId, mime]) => ({ id: messageId, messageId, mime, width: 2, height: 1 }));
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  render(<MemoryRouter><ConversationInfo accountId="account" conversationId="chat" peer={{ id: "peer", username: "peer", name: "Peer" }} /></MemoryRouter>);
  const gallery = screen.getByRole("region", { name: "Shared photos" });
  await waitFor(() => expect(within(gallery).getByText("2")).toBeTruthy());
  await waitFor(() => expect(within(gallery).getAllByRole("button", { name: "View photo" })).toHaveLength(2));
  expect(m.read.mock.calls.map((call) => call[1]).sort()).toEqual(["legacy", "photo"]);
});
it("groups nearby photos from one selection while each keeps its own actions", async () => {
  const run = photoRun(3); run.messages[2]!.readByPeer = true;
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  expect(screen.getByRole("listitem", { name: "3 photos" })).toBeTruthy();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(3);
  expect(screen.getAllByText("Two shots")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  // Every member still owns its own menu target.
  expect(screen.getAllByRole("button", { name: "Options for your message" })).toHaveLength(3);
  expect(document.querySelector('[data-chat-message="photo-2"]')).toBeTruthy();
});
it("deletes only the selected sent photo inside a grouped selection", async () => {
  const run = photoRun(2);
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const second = document.querySelector<HTMLElement>('[data-chat-message="photo-2"]')!;
  fireEvent.click(within(second).getByRole("button", { name: "Options for your message" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete for me" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete for me?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete for me" }));
  await waitFor(() => expect(m.remove.mock.calls).toEqual([["account", "chat", "photo-2", false]]));
});
it("keeps each grouped photo's own caption instead of promoting one", async () => {
  const run = photoRun(1);
  m.messages = [...run.messages,
    { id: "second", conversationId: "chat", authorId: "account", recipientId: "peer", body: "And this",
      messageType: "MEDIA", createdAt: 1_500, server: { eventId: "event-second", sequence: 2 } }];
  m.media = [...run.media, { id: "media-2", messageId: "second", direction: "OUT", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // The second send is inside the rolling window, so both share one bounded
  // group; a caption never breaks the run, and never moves to another item.
  expect(screen.getByRole("listitem", { name: "2 photos" })).toBeTruthy();
  expect(screen.getAllByText("Two shots")).toHaveLength(1);
  expect(screen.getByText("And this")).toBeTruthy();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(2);
});
it("does not preview a quoted photo while the conversation hides photos", async () => {
  m.view.mode = "REQUEST";
  m.messages = [
    { id: "quoted", conversationId: "chat", authorId: "account", recipientId: "peer", body: "", messageType: "MEDIA",
      createdAt: 1_000, server: { eventId: "event-q", sequence: 1 } },
    { id: "reply", conversationId: "chat", authorId: "peer", recipientId: "account", body: "Which one?", messageType: "TEXT",
      createdAt: 2_000, replyToId: "quoted", server: { eventId: "event-r", sequence: 2 } },
  ];
  m.media = [{ id: "media-q", messageId: "quoted", direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const quote = screen.getByRole("button", { name: /Quoted message/ });
  expect(quote.querySelector("img.fb-chat-quote-thumb")).toBeNull();
  expect(within(quote).getByText("Photo")).toBeTruthy();
});
it("keeps a long selection whole inside one bounded album", async () => {
  const run = photoRun(5);
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // Five photos from one selection are one album, not five separate cards, and
  // no member is hidden: every message keeps its own surface and its own menu.
  expect(screen.getByRole("listitem", { name: "5 photos" })).toBeTruthy();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(5);
  expect(screen.getAllByRole("button", { name: "Options for your message" })).toHaveLength(5);
});
it("jumps a quote to the exact photo and rings it", async () => {
  const run = photoRun(3);
  m.messages = [...run.messages, { id: "reply", conversationId: "chat", authorId: "peer", recipientId: "account",
    body: "Which one?", messageType: "TEXT", createdAt: 9_000, replyToId: "photo-2",
    server: { eventId: "reply", sequence: 9 } }];
  m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const quote = screen.getByRole("button", { name: /Quoted message from you/ });
  await waitFor(() => expect(quote.querySelector("img.fb-chat-quote-thumb")).toBeTruthy());
  fireEvent.click(quote);
  const leader = document.querySelector<HTMLElement>('[data-chat-message="photo-2"]');
  await waitFor(() => expect(leader?.querySelector(".fb-chat-message")?.className).toMatch(/fb-chat-flash-[ab]/));
  expect(document.activeElement).toBe(leader);
});
it("removes only the selected pending photo", async () => {
  const run = photoRun(2);
  for (const message of run.messages) delete message.server;
  for (const attachment of run.media) attachment.state = "QUEUED";
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const second = document.querySelector<HTMLElement>('[data-chat-message="photo-2"]')!;
  fireEvent.click(within(second).getByRole("button", { name: "Remove pending photo" }));
  await waitFor(() => expect(m.remove.mock.calls).toEqual([["account", "chat", "photo-2", false]]));
});
it("shows a prepared draft preview and revokes it when removed", async () => {
  const create = vi.fn(() => "blob:draft"), revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg")] } });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Review photo 1 of 1$/ })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:draft"));
});
it("does not allow replacing or silently discarding an uncertain admission", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  m.send.mockRejectedValue(new Error("uncertain"));
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg")] } });
  await waitFor(() => expect(screen.getByText("1 photo ready. Tap one to review.")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.send).toHaveBeenCalledTimes(1));
  // An uncertain admission owns the attachment controls: neither the sheet nor
  // the staged photo can be used to replace or discard it.
  expect((screen.getByRole("button", { name: "Add attachment" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /remove photo/i }) as HTMLButtonElement).disabled).toBe(true);
});
it("does not show a deleted photo caption, image or send status", async () => {
  m.messages = [{ id: "message", conversationId: "chat", authorId: "account", recipientId: "peer", body: "old caption", unsentAt: 123, server: { eventId: "event", sequence: 1 } }];
  m.media = [{ id: "photo", messageId: "message", direction: "OUT", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  await open();
  expect(screen.getByText("Message unsent")).toBeTruthy();
  expect(screen.queryByText("old caption")).toBeNull();
  expect(screen.queryByRole("img", { name: "Sent" })).toBeNull();
  expect(m.read).not.toHaveBeenCalled();
});
it("shows unavailable without downloading after known expiry", async () => {
  m.messages = [{ id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body: "", messageType: "MEDIA", server: { eventId: "event", sequence: 1 } }];
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "EVICTED", width: 2, height: 1, mime: "image/jpeg", expiresAt: 1 }];
  await open();
  expect(await screen.findByText("Photo unavailable")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /download again/i })).toBeNull();
});
it("does not display a photo draft after the connection becomes a request", async () => {
  m.prepare.mockResolvedValue({ bytes: new Uint8Array([1]).buffer, sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  const app = <MemoryRouter initialEntries={["/connections/chat"]}><Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes></MemoryRouter>;
  const rendered = render(app);
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg")] } });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Review photo 1 of 1$/ })).toBeTruthy());
  m.view.mode = "REQUEST"; rendered.rerender(<MemoryRouter initialEntries={["/connections/chat"]}><Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes></MemoryRouter>);
  expect(screen.queryByRole("button", { name: /^Review photo/ })).toBeNull();
});
it("lets a request-mode user remove a retained photo draft before sending text", async () => {
  m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  const rendered = await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg")] } });
  await screen.findByRole("button", { name: /^Review photo 1 of 1$/ });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello again" } });
  m.view.mode = "REQUEST"; rendered.rerender(thread());
  expect(screen.queryByRole("button", { name: /^Review photo/ })).toBeNull();
  expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
  expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(false);
  expect(m.send).not.toHaveBeenCalled();
});

const received = (messageType?: string) => ({ id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body: "Caption", messageType, server: { eventId: "event", sequence: 1 } });
async function settleGeometry() { await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); }
it.each([undefined, "MEDIA"])("never observes a caption as TEXT when classification is %s and metadata is absent", async (type) => {
  m.messages = [received(type)]; await open(); await settleGeometry();
  expect(m.receipt).not.toHaveBeenCalled(); // No eligible geometry, so no context lookup either.
  expect(m.observe).not.toHaveBeenCalled();
  expect(document.querySelector("[data-receipt-message]")).toBeNull();
});
it("observes authoritative TEXT geometry", async () => {
  m.messages = [received("TEXT")]; await open();
  await waitFor(() => expect(m.observe).toHaveBeenCalledWith("account", "chat", "authority", "message", expect.any(AbortSignal)));
});
it("observes MEDIA only after READY bytes have actually loaded, without a scroll", async () => {
  m.messages = [received("MEDIA")]; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  await open(); const button = await screen.findByRole("button", { name: "View photo" });
  await settleGeometry(); expect(m.observe).not.toHaveBeenCalled();
  fireEvent.load(button.querySelector("img")!);
  await waitFor(() => expect(m.observe).toHaveBeenCalledWith("account", "chat", "authority", "message", expect.any(AbortSignal)));
});
it("offers honest review instead of Sending or automatic retry for an unknown queued message", async () => {
  m.messages = [{ ...received(), authorId: "account", recipientId: "peer", server: undefined }];
  m.outbox = [{ messageId: "message", status: "NEEDS_REVIEW", attempts: 0 }];
  await open();
  expect(screen.queryByText("Sending…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review message" }));
  expect(m.recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send text only" }));
  await waitFor(() => expect(m.recover).toHaveBeenCalledWith("account", "chat", "message"));
  expect(screen.queryAllByText("Text saved. Sending.")).toHaveLength(0);
});
it("lets the user remove an unknown queued message without sending it", async () => {
  m.messages = [{ ...received(), authorId: "account", recipientId: "peer", server: undefined }];
  m.outbox = [{ messageId: "message", status: "NEEDS_REVIEW", attempts: 0 }]; await open();
  fireEvent.click(screen.getByRole("button", { name: "Review message" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete for me" }));
  await waitFor(() => expect(m.remove).toHaveBeenCalledWith("account", "chat", "message", false));
  expect(m.recover).not.toHaveBeenCalled();
});
it("allows retrying a failed photo upload after the text echo already arrived", async () => {
  m.messages = [{ ...received("MEDIA"), authorId: "account", recipientId: "peer" }];
  m.media = [{ id: "photo", messageId: "message", direction: "OUT", state: "FAILED", width: 2, height: 1, mime: "image/jpeg" }];
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalledWith("account"));
  expect(m.send).not.toHaveBeenCalled();
  expect(m.retry).not.toHaveBeenCalled();
});
it("retries the failed message's stable identity only after an explicit click, not a generic sync", async () => {
  m.messages = [{ ...received("TEXT"), authorId: "account", recipientId: "peer", server: undefined }];
  m.outbox = [{ messageId: "message", status: "FAILED", attempts: 2 }];
  await open();
  expect(m.retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(m.retry).toHaveBeenCalledWith("account", "chat", "message"));
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.recover).not.toHaveBeenCalled();
  expect(screen.getByText("Caption")).toBeTruthy();
});
it("keeps a refused explicit retry failed and explains the failure without duplicating a send", async () => {
  m.messages = [{ ...received("TEXT"), authorId: "account", recipientId: "peer", server: undefined }];
  m.outbox = [{ messageId: "message", status: "FAILED", attempts: 2 }];
  m.retry.mockRejectedValue(new Error("synthetic boundary refusal"));
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Could not retry. Try syncing again.")).toBeTruthy();
  expect(screen.getByText("Message saved")).toBeTruthy();
  expect(screen.getByText("Caption")).toBeTruthy();
  expect(m.retry).toHaveBeenCalledTimes(1);
  expect(m.send).not.toHaveBeenCalled();
  expect(m.recover).not.toHaveBeenCalled();
});
it.each(["QUEUED", "FAILED"])("does not offer a remote download for an unuploaded %s photo with missing local bytes", async (state) => {
  m.messages = [{ ...received("MEDIA"), authorId: "account", recipientId: "peer", server: undefined }];
  m.media = [{ id: "photo", messageId: "message", direction: "OUT", state, width: 2, height: 1, mime: "image/jpeg" }];
  await open(); await settleGeometry(); expect(screen.queryByRole("button", { name: "Download again" })).toBeNull();
});
it("closes an open photo when an unsend arrives in the same thread", async () => {
  m.messages = [received("MEDIA")]; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  const rendered = await open(); fireEvent.click(await screen.findByRole("button", { name: "View photo" }));
   expect(await screen.findByRole("dialog", { name: "Photo viewer" })).toBeTruthy();
  m.messages = [{ ...received("MEDIA"), body: "", unsentAt: 1 }]; m.chat.revision++;
  rendered.rerender(thread());
   await waitFor(() => expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull());
});
it("can retry preparation after relationship loss aborted a draft", async () => {
  let resolve!: (value: unknown) => void; m.prepare.mockReturnValue(new Promise((done) => { resolve = done; }));
  const rendered = await open();
  const strip = () => screen.getByRole("group", { name: "1 photo to send" });
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg")] } });
  // The staged tray's own pending line is what the reader sees while the codec runs.
  expect(within(strip()).getByText("Preparing attachments…")).toBeTruthy();
  m.view.mode = "REQUEST"; rendered.rerender(thread());
  await act(async () => { resolve({ bytes: new ArrayBuffer(1), mime: "image/jpeg", width: 2, height: 1 }); });
  m.view.mode = "CONNECTED"; rendered.rerender(thread());
  expect(within(strip()).queryByText("Preparing attachments…")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
it("uses the canonical Android URI import before preparing a selected photo", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  const imported = { uri: "synthetic-import" }, source = new File(["x"], "photo.jpg");
  m.choose.mockResolvedValue(["content://synthetic-photo"]); m.import.mockResolvedValue(imported); m.file.mockReturnValue(source);
  m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await open(); chooseAttachment("Photos");
  await screen.findByRole("button", { name: /^Review photo 1 of 1$/ });
  expect(m.choose).toHaveBeenCalledWith({ source: "photos", limit: 10 });
  // No abort signal: a projection refresh on resume used to cancel the very
  // grant the picker had just returned, so the photo vanished silently.
  expect(m.import).toHaveBeenCalledWith("content://synthetic-photo");
  expect(m.file).toHaveBeenCalledWith(imported);
  expect(m.prepare).toHaveBeenCalledWith(source);
});
it("stages a bulk pick, reviews it in the shared viewer, and sends one message per photo", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  m.choose.mockResolvedValue(["content://p1", "content://p2", "content://p3"]);
  m.import.mockImplementation(async (uri: string) => ({ uri }));
  m.file.mockImplementation((item: { uri: string }) => new File(["x"], `${item.uri}.jpg`));
  m.prepare.mockImplementation(async (source: File) => ({
    bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1, name: source.name }));
  await open();
  chooseAttachment("Photos");
  await screen.findByRole("button", { name: "Review photo 3 of 3" });
  // The picker is asked for a real bulk selection, and the tray keeps order.
  expect(m.choose).toHaveBeenCalledWith({ source: "photos", limit: 10 });
  expect(screen.getByText("3 photos ready. Tap one to review.")).toBeTruthy();
  // Reviewing reuses the shared photo viewer over the staged items.
  fireEvent.click(screen.getByRole("button", { name: "Review photo 2 of 3" }));
  expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.send).toHaveBeenCalledTimes(3));
  expect(m.send.mock.calls.map((call) => (call[4] as { width: number }).width)).toEqual([2, 2, 2]);
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Review photo/ })).toBeNull());
});
it("stages a mixed photo and video pick and sends each through its own lane", async () => {
  m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  m.upload.mockResolvedValue({ key: "files/account/chat/clip.mp4", name: "clip.mp4", mime: "video/mp4", byteSize: 12, kind: "video" });
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [
    new File(["x"], "p.jpg", { type: "image/jpeg" }),
    new File(["video"], "clip.mp4", { type: "video/mp4" }),
  ] } });
  await screen.findByText("2 attachments ready. Tap a photo to review.");
  // Only the photo goes through the canonical image preparation lane.
  expect(m.prepare).toHaveBeenCalledTimes(1);
  // A video has no fabricated poster, so it offers no review frame.
  expect(screen.getByRole("button", { name: /^Review photo 1 of 1$/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Both" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.send).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  expect(m.upload).toHaveBeenCalledTimes(1);
  const body = String(m.text.mock.calls[0]?.[3]);
  expect(body.startsWith("norfold-file:v1:")).toBe(true);
  // The caption rides the first item that actually left. The photo leaves
  // first, so the photo carries it and the clip's own body stays bare.
  expect(String(m.send.mock.calls[0]?.[3])).toBe("Both");
  expect(body).not.toContain("Both");
  expect(m.send.mock.calls[0]?.[4]).toMatchObject({ width: 2 });
});
it("keeps a staged video's identity and composition instant across a retry", async () => {
  m.upload.mockResolvedValue({ key: "files/account/chat/clip.mp4", name: "clip.mp4", mime: "video/mp4", byteSize: 12, kind: "video" });
  m.text.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("saved");
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] } });
  await screen.findByText("1 attachment ready. Tap Send to share.");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "First caption" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  const identity = m.text.mock.calls[0]?.[6];
  const instant = m.text.mock.calls[0]?.[8];
  expect(typeof identity).toBe("string");
  expect(typeof instant).toBe("number");
  // A refused send removes the object it uploaded; the item stays for retry.
  expect(m.removeFile).toHaveBeenCalledTimes(1);
  await screen.findByText("1 attachment ready. Tap Send to share.");
  // Text typed after the failure is newer intent: the retry still sends the
  // caption its first attempt stored, and the newer words stay in the field.
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Edited after failure" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[6]).toBe(identity);
  expect(m.text.mock.calls[1]?.[8]).toBe(instant);
  expect(m.text.mock.calls[1]?.[3]).toBe(m.text.mock.calls[0]?.[3]);
  expect(screen.getByLabelText("Message")).toHaveProperty("value", "Edited after failure");
});
it("does not stage a non-photo, non-video file chosen through the attachment picker", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(screen.getByText("Only photos and videos can be added here.")).toBeTruthy());
  expect(m.prepare).not.toHaveBeenCalled();
  expect(screen.queryByRole("group", { name: /to send/ })).toBeNull();
});
it("refuses a video chosen in a message request without staging or uploading it", async () => {
  m.view.mode = "REQUEST";
  await open();
  // The file rows stay reachable in a request; the intake must refuse them
  // instead of filling a tray that Send can never accept.
  fireEvent.change(screen.getByLabelText("Choose video"), { target: { files: [new File(["v"], "clip.mp4", { type: "video/mp4" })] } });
  await waitFor(() => expect(screen.getByText("Photos and videos are available when you're friends.")).toBeTruthy());
  expect(screen.queryByRole("group", { name: /to send/ })).toBeNull();
  expect(m.upload).not.toHaveBeenCalled();
});
it("refuses a video that arrives while another file is still sending", async () => {
  // The document send owns the composer when the already-open video picker
  // resolves; its late result must not enter the tray or upload.
  m.upload.mockReturnValue(new Promise(() => {}));
  await open();
  fireEvent.change(screen.getByLabelText("Choose document"), { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(m.upload).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Choose video"), { target: { files: [new File(["v"], "clip.mp4", { type: "video/mp4" })] } });
  await waitFor(() => expect(screen.getByText("Wait for the current send to finish before adding an attachment.")).toBeTruthy());
  expect(screen.queryByRole("group", { name: /to send/ })).toBeNull();
  expect(m.upload).toHaveBeenCalledTimes(1);
});
it("survives a projection refresh while the native picker is open", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  const imported = { uri: "synthetic-import" }, source = new File(["x"], "photo.jpg");
  let grant!: (uris: string[]) => void;
  m.choose.mockReturnValue(new Promise((done) => { grant = done; }));
  m.import.mockResolvedValue(imported); m.file.mockReturnValue(source);
  m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await open(); chooseAttachment("Photos");
  // The app backgrounds while the picker is up, and the projection refresh
  // that runs on resume drops the cached view. The selection must survive it.
  await act(async () => { m.view = { ...m.view, mode: "REQUEST" }; });
  await act(async () => { m.view = { ...m.view, mode: "CONNECTED" }; });
  await act(async () => { grant(["content://synthetic-photo"]); });
  expect(await screen.findByRole("button", { name: /^Review photo 1 of 1$/ })).toBeTruthy();
});
it("ignores a late local read after leaving the thread without allocating a URL", async () => {
  let resolve!: (bytes: ArrayBuffer) => void; m.read.mockReturnValue(new Promise((done) => { resolve = done; }));
  m.messages = [received("MEDIA")];
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  const rendered = await open(); await waitFor(() => expect(m.read).toHaveBeenCalledTimes(1));
  rendered.unmount(); await act(async () => { resolve(new ArrayBuffer(1)); });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("retains an independent viewer copy when the local thumbnail is evicted and releases every URL on exit", async () => {
  let sequence = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:owned-${++sequence}`);
  m.messages = [received("MEDIA")]; m.read.mockResolvedValue(new ArrayBuffer(1));
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg", expiresAt: Date.now() + 100000 }];
  const rendered = await open(); fireEvent.click(await screen.findByRole("button", { name: "View photo" }));
  m.media = [{ ...(m.media[0] as object), state: "EVICTED" }]; m.chat.revision++; rendered.rerender(thread());
  // The engine correctly makes the background transcript inert while open.
  await screen.findByText("Download again");
  expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeTruthy();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-1");
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:owned-2");
  rendered.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-2");
});
it("makes permanent-unavailable downloads opaque while a transient failure stays retryable", async () => {
  m.messages = [received("MEDIA")];
  m.media = [{ id: "photo", messageId: "message", direction: "IN", state: "EVICTED", width: 2, height: 1, mime: "image/jpeg", expiresAt: Date.now() + 100000 }];
  m.download.mockRejectedValueOnce(new Error("synthetic network failure")).mockRejectedValueOnce(new PhotoUnavailableError());
  await open(); fireEvent.click(await screen.findByRole("button", { name: "Download again" }));
  await screen.findByText("Could not load photo.");
  fireEvent.click(screen.getByRole("button", { name: "Download again" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Download again" })).toBeNull());
  expect(screen.getByText("Photo unavailable")).toBeTruthy();
  expect(screen.queryByText(/synthetic network/)).toBeNull();
});

it("opens a single photo at its real place by reading photos the thread had not loaded", async () => {
  let sequence = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:single-${++sequence}`);
  m.messages = [
    { ...received("MEDIA"), id: "first" },
    { ...received("MEDIA"), id: "second" },
  ];
  m.media = ["first", "second"].map((messageId) => ({ id: `photo-${messageId}`, messageId, direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }));
  // The first photo has not been read yet (it sits outside the lazy margin),
  // so the screen only holds the second one when the viewer opens.
  let firstRead = false;
  m.read.mockImplementation(async (_account, id) => {
    if (id === "photo-first" && !firstRead) { firstRead = true; return null; }
    return new ArrayBuffer(1);
  });
  await open();
  fireEvent.click(await screen.findByRole("button", { name: "View photo" }));
  const viewer = await screen.findByRole("dialog", { name: "Photo viewer" });
  await waitFor(() => expect(within(viewer).getByText("Photo 2 of 2")).toBeTruthy());
});

it("opens the available conversation sequence and removes access immediately on relationship loss", async () => {
  let sequence = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:gallery-${++sequence}`);
  m.messages = [
    { ...received("MEDIA"), id: "first" },
    { ...received("MEDIA"), id: "unsent", unsentAt: 1 },
    { ...received("MEDIA"), id: "second" },
    { ...received("MEDIA"), id: "missing" },
  ];
  m.media = ["first", "unsent", "second", "missing"].map((messageId) => ({ id: `photo-${messageId}`, messageId, direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }));
  m.read.mockImplementation(async (_account, id) => id === "photo-missing" ? null : new ArrayBuffer(1));
  const rendered = await open();
  await waitFor(() => expect(screen.getAllByRole("button", { name: "View photo" })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button", { name: "View photo" })[1]!);
  expect(await screen.findByText("Photo 2 of 2")).toBeTruthy();
  expect(m.read).not.toHaveBeenCalledWith("account", "photo-unsent");
  fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
  await screen.findByText("Photo 1 of 2");
  m.view.mode = "REQUEST"; rendered.rerender(thread());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "View photo" })).toBeNull();
  expect(m.download).not.toHaveBeenCalled();
});

it("opens the available photo sequence from Media and removes the gallery on relationship loss", async () => {
  m.messages=[{...received("MEDIA"),id:"first"},{...received("MEDIA"),id:"removed",unsentAt:1},{...received("MEDIA"),id:"second"}];
  m.media=["first","removed","second"].map(messageId=>({id:`photo-${messageId}`,messageId,direction:"IN",state:"READY",width:2,height:1,mime:"image/jpeg"}));
  m.read.mockResolvedValue(new ArrayBuffer(1));const rendered=await open();
  await waitFor(()=>expect(screen.getAllByRole("button",{name:"View photo"})).toHaveLength(2));
  fireEvent.click(screen.getByRole("button",{name:"Conversation options"}));
  fireEvent.click(screen.getByRole("button",{name:"Media"}));
  const panel=screen.getByRole("dialog",{name:"Conversation media"});
  await waitFor(()=>expect(within(panel).getAllByRole("button",{name:"View photo"})).toHaveLength(2));
  fireEvent.click(within(panel).getAllByRole("button",{name:"View photo"})[1]!);
  await screen.findByText("Photo 2 of 2");
  fireEvent.click(screen.getByRole("button",{name:"Close photo viewer"}));
  await waitFor(()=>expect(screen.queryByText("Photo 2 of 2")).toBeNull());
  expect(screen.getByRole("dialog",{name:"Conversation media"})).toBeTruthy();
  m.view.mode="REQUEST";rendered.rerender(thread());
  expect(within(panel).queryByRole("button",{name:"View photo"})).toBeNull();
  expect(within(panel).getByText("Photos are available when you're friends.")).toBeTruthy();
  expect(m.read).not.toHaveBeenCalledWith("account","photo-removed");
});

it("removes an unsent noncurrent photo from the open gallery and revokes its independent URL", async () => {
  let sequence = 0; vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:unsend-${++sequence}`);
  m.messages = [{ ...received("MEDIA"), id: "first" }, { ...received("MEDIA"), id: "second" }];
  m.media = ["first", "second"].map((messageId) => ({ id: `photo-${messageId}`, messageId, direction: "IN", state: "READY", width: 2, height: 1, mime: "image/jpeg" }));
  m.read.mockResolvedValue(new ArrayBuffer(1));
  const rendered = await open();
  await waitFor(() => expect(screen.getAllByRole("button", { name: "View photo" })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button", { name: "View photo" })[1]!);
  await screen.findByText("Photo 2 of 2");
  m.messages = [{ ...received("MEDIA"), id: "first", unsentAt: 1 }, { ...received("MEDIA"), id: "second" }];
  m.chat.revision++; rendered.rerender(thread());
  await screen.findByText("Photo 1 of 1");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:unsend-3");
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:unsend-4");
  fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:unsend-4"));
});

/** One stored Klipy body row. The body carries the picker-kind fragment. */
function klipyRow(id: string, body: string, extras: Record<string, unknown> = {}) {
  return { id, conversationId: "chat", authorId: "peer", recipientId: "account", body,
    messageType: "TEXT" as const, server: { eventId: `event-${id}`, sequence: 1 }, ...extras };
}
function seedKlipyRecent(item: { kind: "gifs" | "stickers"; slug: string; title: string; mediaUrl: string; previewUrl: string }) {
  localStorage.setItem(EXPRESSION_RECENTS_KEY, JSON.stringify([{ type: "klipy", key: `klipy:${item.kind}:${item.slug}`, item }]));
}
async function pickRecent(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  fireEvent.click(screen.getByRole("button", { name: `Recent ${title}` }));
}

it("sends a sticker as its provider URL tagged with the picker kind", async () => {
  seedKlipyRecent({ kind: "stickers", slug: "sticker-a", title: "Sticker A",
    mediaUrl: "https://media.klipy.com/s.webp", previewUrl: "https://media.klipy.com/s.png" });
  await open();
  await pickRecent("Sticker A");
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  // The kind rides the fragment; the whole body is still the provider URL.
  expect(m.text.mock.calls[0]?.[3]).toBe("https://media.klipy.com/s.webp#norfold-media=sticker");
  const img = document.querySelector("img.fb-chat-klipy") as HTMLImageElement;
  expect(img.getAttribute("data-media-kind")).toBe("sticker");
  expect(img.getAttribute("alt")).toBe("Sticker");
  const label = screen.getByText("Sticker");
  expect(label.className).toBe("fb-chat-expressive-kind");
  expect(label.closest(".fb-chat-message-status")).toBeTruthy();
  // The marker is never rendered, and no media lane moved bytes for it.
  expect(screen.queryByText(/norfold-media/)).toBeNull();
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
  expect(m.download).not.toHaveBeenCalled();
});

it("sends a GIF tagged as a GIF and labels it beside the time", async () => {
  seedKlipyRecent({ kind: "gifs", slug: "gif-a", title: "Gif A",
    mediaUrl: "https://media.klipy.com/a.gif", previewUrl: "https://media.klipy.com/a.png" });
  await open();
  await pickRecent("Gif A");
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  expect(m.text.mock.calls[0]?.[3]).toBe("https://media.klipy.com/a.gif#norfold-media=gif");
  expect(document.querySelector("img.fb-chat-klipy")?.getAttribute("data-media-kind")).toBe("gif");
  expect(screen.getByText("GIF").className).toBe("fb-chat-expressive-kind");
});

it("labels a received Klipy row and still offers no Copy for it", async () => {
  m.messages = [klipyRow("gif", "https://media.klipy.com/a.gif#norfold-media=gif")];
  await open();
  const img = document.querySelector("img.fb-chat-klipy") as HTMLImageElement;
  expect(img.getAttribute("data-media-kind")).toBe("gif");
  expect(img.getAttribute("alt")).toBe("GIF");
  expect(screen.getByText("GIF").className).toBe("fb-chat-expressive-kind");
  expect(screen.queryByText(/norfold-media/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Options for received message" }));
  await screen.findByRole("menu", { name: "Message actions" });
  expect(screen.queryByRole("menuitem", { name: "Copy text" })).toBeNull();
});

it("shows an honest fallback for a Klipy body that predates the marker", async () => {
  m.messages = [klipyRow("legacy", "https://media.klipy.com/legacy.gif")];
  await open();
  const img = document.querySelector("img.fb-chat-klipy") as HTMLImageElement;
  expect(img.getAttribute("data-media-kind")).toBe("unknown");
  expect(img.getAttribute("alt")).toBe("Sticker or GIF");
  expect(screen.getByText("Sticker/GIF").className).toBe("fb-chat-expressive-kind");
});

it("clears the kind label when a Klipy row is unsent", async () => {
  m.messages = [klipyRow("gone", "https://media.klipy.com/s.webp#norfold-media=sticker", { unsentAt: 5 })];
  await open();
  expect(screen.getByText("Message unsent")).toBeTruthy();
  expect(document.querySelector(".fb-chat-expressive-kind")).toBeNull();
  expect(document.querySelector("img.fb-chat-klipy")).toBeNull();
});

it("keeps a quoted Klipy row and its summary free of the encoded kind", async () => {
  m.messages = [
    klipyRow("orig", "Original"),
    klipyRow("answer", "https://media.klipy.com/a.gif#norfold-media=gif",
      { replyToId: "orig", server: { eventId: "event-answer", sequence: 2 } }),
  ];
  await open();
  const row = document.querySelector('[data-chat-message="answer"]')!;
  // The quote names the quoted row exactly; the marker never reaches a reader.
  expect(row.querySelector(".fb-chat-quote-preview")?.textContent).toBe("Original");
  const img = row.querySelector("img.fb-chat-klipy") as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("https://media.klipy.com/a.gif");
  expect(img.getAttribute("data-media-kind")).toBe("gif");
  expect(row.textContent).not.toContain("norfold-media");
  expect(row.querySelector(".fb-chat-expressive-kind")?.textContent).toBe("GIF");
});

it("keeps a Klipy row out of a photo album and leaves photo timestamps alone", async () => {
  const run = photoRun(2);
  m.messages = [...run.messages, klipyRow("sticker", "https://media.klipy.com/s.webp#norfold-media=sticker",
    { authorId: "account", recipientId: "peer", createdAt: 9_000, server: { eventId: "event-sticker", sequence: 9 } })];
  m.media = run.media;
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const album = screen.getByRole("listitem", { name: "2 photos" });
  expect(album.textContent).not.toContain("norfold-media");
  expect(album.querySelector(".fb-chat-expressive-kind")).toBeNull();
  const row = document.querySelector('[data-chat-message="sticker"]')!;
  expect(row.closest("li.fb-chat-run")).toBeNull();
  expect(row.querySelector('img.fb-chat-klipy[data-media-kind="sticker"]')).toBeTruthy();
  expect(row.querySelector(".fb-chat-expressive-kind")?.textContent).toBe("Sticker");
});

it("summarizes a tagged Klipy row by kind and keeps the pre-marker fallback", () => {
  const base = { id: "q", conversationId: "chat", authorId: "peer", recipientId: "account",
    messageType: "TEXT" as const, server: { eventId: "e", sequence: 1 } };
  expect(replyPreview({ ...base, body: "https://media.klipy.com/s.webp#norfold-media=sticker" })).toBe("Sticker");
  expect(replyPreview({ ...base, body: "https://media.klipy.com/a.gif#norfold-media=gif" })).toBe("GIF");
  // History predates the marker, so the quoted summary says both instead of
  // guessing a kind from the URL's extension.
  expect(replyPreview({ ...base, body: "https://media.klipy.com/a.gif" })).toBe("Sticker/GIF");
});

function projection(over: Partial<ConversationProjection> = {}): ConversationProjection {
  return { conversationId: "chat", peerId: "peer", mode: "CONNECTED", request: "NONE",
    requestEpoch: null, ownHidden: false, ownDeclined: false, ownBlocked: false,
    ownMuted: false, pinnedMessageIds: [], revision: 1, ...over };
}
function optionsSheet() {
  fireEvent.click(screen.getByRole("button", { name: "Conversation options" }));
  return screen.getByRole("dialog", { name: "Conversation info" });
}
function chatHeader(): HTMLElement {
  return document.querySelector(".fb-chat-header") as HTMLElement;
}

it("separates an absent presentation field from an explicit authority clear", () => {
  const cached = projection({ ownMuted: undefined });
  const current = projection({ ownHidden: true });
  const display = projection();
  // A fixture or older snapshot without the field keeps the previous
  // current-then-cached behaviour instead of inventing a third rule.
  expect(presentationProjection({ accountId: "account", currentProjections: null }, "account", "chat", cached)).toBe(cached);
  expect(presentationProjection({ accountId: "account", currentProjections: { chat: current } }, "account", "chat", cached)).toBe(current);
  // A published set answers for its own signed-in account only.
  const displayProjections = { chat: display };
  expect(presentationProjection({ accountId: "account", currentProjections: null, displayProjections }, "account", "chat", cached)).toBe(display);
  expect(presentationProjection({ accountId: "other", currentProjections: null, displayProjections }, "account", "chat", cached)).toBeNull();
  // A live accepted set outranks the bridged view instead of showing the older
  // relationship for one more frame.
  expect(presentationProjection({ accountId: "account", currentProjections: { chat: current }, displayProjections }, "account", "chat", cached)).toBe(current);
  // An explicit clear is not a cache miss: a revoked authority never falls back
  // to a stale CONNECTED projection, and an accepted set only answers for the
  // conversations it actually carries.
  expect(presentationProjection({ accountId: "account", currentProjections: null, displayProjections: null }, "account", "chat", cached)).toBeNull();
  expect(presentationProjection({ accountId: "account", currentProjections: null, displayProjections: {} }, "account", "chat", cached)).toBeNull();
  // A conversation summary's cached projection is nullable, so the helper must
  // accept that shape: no cache and no accepted set still show nothing.
  expect(presentationProjection({ accountId: "account", currentProjections: null }, "account", "chat", null)).toBeNull();
  expect(presentationProjection({ accountId: "account", currentProjections: null, displayProjections: null }, "account", "chat", null)).toBeNull();
});

it("keeps the relationship visible but inert while a routine refresh is between sets", async () => {
  m.view.ownMuted = true;
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = { chat: m.view };
  await open();
  // The header keeps naming the last accepted relationship instead of flicking
  // to "Saved chat" for one pass.
  expect(within(chatHeader()).getByText("Friends")).toBeTruthy();
  const sheet = optionsSheet();
  // Presentation keeps the management rows in place; authority decides whether
  // any of them may act.
  const share = within(sheet).getByRole("button", { name: "Share location" });
  expect(share).toHaveProperty("disabled", true);
  expect(within(sheet).getByRole("button", { name: "Archive" })).toHaveProperty("disabled", true);
  expect(within(sheet).getByRole("button", { name: "Remove friend" })).toHaveProperty("disabled", true);
  const mute = within(sheet).getByRole("switch", { name: "Mute notifications" });
  expect(mute.getAttribute("aria-checked")).toBe("true");
  expect(mute).toHaveProperty("disabled", true);
  fireEvent.click(share);
  fireEvent.click(within(sheet).getByRole("button", { name: "Archive" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Remove friend" }));
  // No mutation, no location picker: a revoked authority is a truthful disabled
  // state, never a queued action.
  expect(m.location).not.toHaveBeenCalled();
  expect(m.relationship).not.toHaveBeenCalled();
  expect(m.mute).not.toHaveBeenCalled();
});

it("does not revive a cached CONNECTED row after an explicit clear and follows a fresh set", async () => {
  const rendered = await open();
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = null;
  rendered.rerender(thread());
  expect(within(chatHeader()).getByText("Saved chat")).toBeTruthy();
  optionsSheet();
  // Nothing is known about the relationship, so no relationship row claims one.
  expect(screen.queryByRole("button", { name: "Share location" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove friend" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Hide request" })).toBeNull();
  // A restored, genuinely non-connected set relabels the same rows.
  m.chat.displayProjections = { chat: projection({ mode: "REQUEST", request: "INCOMING", requestEpoch: "epoch" }) };
  rendered.rerender(thread());
  await waitFor(() => expect(within(chatHeader()).getByText("Message request")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Hide request" })).toBeTruthy();
});

it("keeps the request badge from the published presentation during a routine refresh", async () => {
  vi.stubGlobal("innerWidth", 400);
  const incoming = projection({ mode: "REQUEST", request: "INCOMING", requestEpoch: "epoch" });
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = { chat: incoming };
  m.chat.conversations = [{ conversationId: "chat", peerId: "peer", cachedProjection: incoming,
    lastMessage: null, lastSequence: 0, unreadCount: 0, pendingCount: 0, updatedAt: 0, projectionObservedAt: null }] as never;
  const list = () => <MemoryRouter initialEntries={["/connections"]}><Routes>
    <Route path="/connections" element={<Connections />} /></Routes></MemoryRouter>;
  const rendered = render(list());
  expect(await screen.findByRole("button", { name: "Requests, 1" })).toBeTruthy();
  // An explicit clear drops the badge to zero rather than reviving the cached
  // incoming request.
  m.chat.displayProjections = null;
  rendered.rerender(list());
  await waitFor(() => expect(screen.getByRole("button", { name: "Requests, 0" })).toBeTruthy());
});

/** One conversation-list row for the privacy-classification tests: the cached
 *  projection carries the durable local hide/dismiss flags, and an optional
 *  body stands in for the last message so the row can be found in the list. */
function listRow(conversationId: string, over: Partial<ConversationProjection> = {}, body?: string) {
  const cachedProjection = projection({ conversationId, peerId: `${conversationId}-peer`, ...over });
  return { conversationId, peerId: `${conversationId}-peer`, cachedProjection,
    lastMessage: body === undefined ? null : { body, conversationId, authorId: `${conversationId}-peer`, recipientId: "account" },
    lastSequence: 0, unreadCount: 0, pendingCount: 0, updatedAt: 0, projectionObservedAt: 0 };
}
function connectionsList() {
  return <MemoryRouter initialEntries={["/connections"]}><Routes>
    <Route path="/connections" element={<Connections />} /></Routes></MemoryRouter>;
}

it("keeps locally archived and dismissed chats out of All when presentation is cleared", async () => {
  vi.stubGlobal("innerWidth", 400);
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = null;
  m.chat.conversations = [
    listRow("hidden", { ownHidden: true }, "Hidden body"),
    listRow("declined", { ownDeclined: true }, "Declined body"),
    listRow("plain", {}, "Plain body"),
  ] as never;
  render(connectionsList());
  // All is the clean inbox even while no relationship is known: only the local
  // hide/dismiss flags classify the row, so nothing reappears.
  expect(await screen.findByText("Plain body")).toBeTruthy();
  expect(screen.queryByText("Hidden body")).toBeNull();
  expect(screen.queryByText("Declined body")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Archived" }));
  expect(await screen.findByText("Hidden body")).toBeTruthy();
  expect(screen.getByText("Declined body")).toBeTruthy();
  expect(screen.queryByText("Plain body")).toBeNull();
});

it("names an unknown locally hidden row instead of claiming a relationship", async () => {
  vi.stubGlobal("innerWidth", 400);
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = null;
  m.chat.conversations = [listRow("localized", { ownHidden: true })] as never;
  render(connectionsList());
  // All hides it; a name search is the way back, labelled for what is known.
  expect(screen.queryByText("Hidden conversation")).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search people or chats" }), { target: { value: "rowan" } });
  expect(await screen.findByRole("link", { name: "Open conversation with Rowan Lee" })).toBeTruthy();
  expect(screen.getByText("Hidden conversation")).toBeTruthy();
  // The cached relationship is never repainted as a label.
  expect(screen.queryByText("Archived")).toBeNull();
  expect(screen.queryByText("Friends")).toBeNull();
  expect(screen.queryByText("Message request")).toBeNull();
  expect(screen.queryByText("Request sent")).toBeNull();
});

it("does not derive the Requests tab from a cached relationship when presentation is cleared", async () => {
  vi.stubGlobal("innerWidth", 400);
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = null;
  m.chat.conversations = [listRow("cached-request", { mode: "REQUEST", request: "INCOMING", requestEpoch: "epoch" }, "Request body")] as never;
  render(connectionsList());
  // The row is a conversation with an unknown relationship, not a request.
  expect(await screen.findByText("Request body")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Requests, 0" }));
  expect(await screen.findByText("No requests conversations")).toBeTruthy();
  expect(screen.queryByText("Request body")).toBeNull();
});

it("lets a fresh accepted unhide override the durable hidden flag", async () => {
  vi.stubGlobal("innerWidth", 400);
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = { chat: projection({ ownHidden: false }) };
  m.chat.conversations = [listRow("chat", { ownHidden: true })] as never;
  render(connectionsList());
  // The fresh accepted view answers first: the row is a friend again, not a
  // hidden conversation, and it leaves the local archived bucket.
  expect(await screen.findByText("Friends")).toBeTruthy();
  expect(screen.queryByText("Hidden conversation")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Archived" }));
  expect(await screen.findByText("No archived conversations")).toBeTruthy();
});

it("does not paint another account's cached privacy flags", async () => {
  vi.stubGlobal("innerWidth", 400);
  m.chat.accountId = "other";
  m.chat.currentProjections = null as never;
  m.chat.displayProjections = null;
  m.chat.conversations = [listRow("foreign", { ownHidden: true, ownDeclined: true })] as never;
  render(connectionsList());
  // The cached flags belong to another viewer, so they cannot hide this row.
  expect(await screen.findByText("Conversation")).toBeTruthy();
  expect(screen.queryByText("Hidden conversation")).toBeNull();
  expect(screen.queryByText("Dismissed")).toBeNull();
});
