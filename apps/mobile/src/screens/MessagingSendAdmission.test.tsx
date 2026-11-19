// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { MessagingThread, ThreadSession } from "./Messaging";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import type { MessagingThreadSync } from "../services/messaging/runtime";
import { EXPRESSION_RECENTS_KEY } from "../services/expressionRecents";

const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return {
    view,
    chat: {
      accountId: "account", status: "ready", revision: 1, error: null as string | null,
      threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
      conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }],
      currentProjections: { chat: view } as Record<string, typeof view> | null,
    },
    messages: [] as Record<string, unknown>[], media: [] as Record<string, unknown>[],
    outbox: [] as Record<string, unknown>[],
    cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] },
    watch: vi.fn(), threadRead: vi.fn(), text: vi.fn(), send: vi.fn(), voice: vi.fn(),
    location: vi.fn(), mute: vi.fn(), pin: vi.fn(), prepare: vi.fn(), relationship: vi.fn(),
    read: vi.fn(), download: vi.fn(), remove: vi.fn(), recover: vi.fn(), retry: vi.fn(),
    receipt: vi.fn(), observe: vi.fn(), refresh: vi.fn(), choose: vi.fn(), import: vi.fn(),
    file: vi.fn(), holdIds: vi.fn(), hold: vi.fn(), purgeHold: vi.fn(),
    upload: vi.fn(), removeFile: vi.fn(), fileBody: vi.fn(),
    report: vi.fn(async (_input: unknown, _signal?: AbortSignal) => ({ reportId: "receipt" })),
  };
});

vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: async () => new Map(), readCachedAccountIdentities: () => new Map() }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({
  getCachedMessagingThreadState: () => m.cached,
  watchMessagingThread: m.watch,
  sendMessagingVoice: m.voice,
  sendMessagingLocation: m.location,
  setMessagingMuted: m.mute,
  pinMessagingMessage: m.pin,
  readMessagingThreadState: () => m.threadRead(),
  fetchMessagingReceiptView: m.receipt,
  observeMessagingReceipt: m.observe,
  markMessagingConversationRead: async () => {},
  refreshMessaging: m.refresh,
  retryMessagingMedia: m.refresh,
  sendMessagingText: m.text,
  sendMessagingMedia: m.send,
  readMessagingMedia: m.read,
  downloadMessagingMedia: m.download,
  changeMessagingRelationship: m.relationship,
  clearMessagingConversation: async () => {},
  removeMessagingMessage: m.remove,
  recoverMessagingText: m.recover,
  retryMessagingMessage: m.retry,
  readMessagingUnsentHoldIds: m.holdIds,
  readMessagingUnsentHold: m.hold,
  purgeMessagingUnsentHold: m.purgeHold,
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  uploadChatFile: (...args: unknown[]) => m.upload(...args),
  removeChatFile: (...args: unknown[]) => m.removeFile(...args),
  chatFileBody: (...args: unknown[]) => m.fileBody(...args),
}));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: (input: unknown, signal?: AbortSignal) => m.report(input, signal),
}));
vi.mock("../services/media/nativeMedia", () => ({ chooseNativeImages: m.choose, importNativeImageUri: m.import, importedImageToFile: m.file }));

const STICKER = "MediaViews";

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.view.revision = 1;
  m.view.request = "OUTGOING";
  m.chat.accountId = "account"; m.chat.status = "ready"; m.chat.revision = 1; m.chat.error = null;
  m.chat.currentProjections = { chat: m.view };
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.messages = []; m.media = []; m.outbox = []; m.cached = null;
  m.watch.mockReset().mockReturnValue(() => undefined);
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
  m.text.mockReset().mockResolvedValue("saved");
  m.send.mockReset().mockResolvedValue("media-saved");
  m.read.mockReset().mockResolvedValue(null);
  m.download.mockReset().mockResolvedValue(undefined);
  m.remove.mockReset().mockResolvedValue(undefined);
  m.recover.mockReset().mockResolvedValue(undefined);
  m.retry.mockReset().mockResolvedValue(undefined);
  m.refresh.mockReset().mockResolvedValue(undefined);
  m.relationship.mockReset().mockResolvedValue(undefined);
  m.mute.mockReset().mockResolvedValue(undefined);
  m.pin.mockReset().mockResolvedValue(undefined);
  m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] });
  m.observe.mockReset().mockResolvedValue(true);
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.purgeHold.mockReset().mockImplementation(async () => undefined);
  m.report.mockReset().mockImplementation(async () => ({ reportId: "receipt" }));
  m.choose.mockReset(); m.import.mockReset(); m.file.mockReset(); m.prepare.mockReset();
  m.upload.mockReset().mockResolvedValue({ key: "chat/mock", name: "notes.txt", mime: "text/plain", size: 5 });
  m.removeFile.mockReset().mockResolvedValue(undefined);
  m.fileBody.mockReset().mockReturnValue("norfold-file:mock");
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

function thread() {
  return <MemoryRouter initialEntries={["/connections/chat"]}><LiveRegion /><MessagingRestoration />
    <Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes></MemoryRouter>;
}
async function open() {
  const rendered = render(thread());
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  return rendered;
}
function field() { return screen.getByRole("textbox", { name: "Message" }); }
function sendButton() { return screen.getByRole("button", { name: "Send message" }); }

/** A deferred admission that reports the durable boundary on demand, so the
 *  view refresh stays blocked exactly where a slow local read would. */
function deferAdmission() {
  let admitted!: () => void;
  let finish!: (value: string | { id: string; viewStale: true }) => void;
  m.text.mockImplementation((...args: unknown[]) => {
    admitted = args[7] as () => void;
    return new Promise((resolve) => { finish = resolve; });
  });
  return { admitted: () => admitted, finish: (value: string | { id: string; viewStale: true }) => finish(value) };
}

const REPORT_ID = "8f14e45f-ceea-467f-a1d2-3b5c4d6e7f80";

/** The thread body without the route wrapper, so a rerender can serve the same
 *  instance with another owner exactly as an in-place account change would. */
function ownedThread(accountId: string) {
  return <MemoryRouter initialEntries={[`/connections/chat?report=${REPORT_ID}`]}>
    <LiveRegion /><MessagingRestoration />
    <ThreadSession accountId={accountId} conversationId="chat" />
  </MemoryRouter>;
}

it("settles the submitted draft at the committed admission while the view refresh is still blocked", async () => {
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "Saved before the read" } });
  fireEvent.click(sendButton());
  expect(m.text).toHaveBeenCalledTimes(1);
  // Nothing is cleared before persistence: the draft still owns the words and
  // the optimistic bubble simply mirrors them.
  expect(field()).toHaveProperty("value", "Saved before the read");
  expect(screen.getByText("Sending…")).toBeTruthy();

  act(() => admission.admitted()());
  // Durable enqueue happened even though the reload never resolved.
  expect(field()).toHaveProperty("value", "");
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Saved before the read")).toHaveLength(1);
  expect(screen.queryByText("Not sent")).toBeNull();
  expect(screen.queryByText("Your message was not sent. Tap Retry on it.")).toBeNull();
  expect(screen.getByText("Sending…")).toBeTruthy();
});

it("keeps the rejected message on screen with its stable identity instead of clearing it as sent", async () => {
  m.text.mockRejectedValueOnce(new Error("admission failed")).mockResolvedValueOnce("saved");
  await open();
  fireEvent.change(field(), { target: { value: "Rejected" } });
  fireEvent.click(sendButton());
  await screen.findByText("Your message was not sent. Tap Retry on it.");
  expect(screen.getByText("Not sent")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("Rejected")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  // The retry is the same admitted identity, never a second message.
  expect(m.text.mock.calls[1]?.[6]).toBe(m.text.mock.calls[0]?.[6]);
});

it("never erases typing that arrived before the admission settled", async () => {
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "First" } });
  fireEvent.click(sendButton());
  fireEvent.change(field(), { target: { value: "Second" } });
  act(() => admission.admitted()());
  expect(field()).toHaveProperty("value", "Second");
  // The bubble carries the submitted revision, not the newer typing.
  expect(within(screen.getByRole("list", { name: "Messages" })).getAllByText("First")).toHaveLength(1);
  expect(within(screen.getByRole("list", { name: "Messages" })).queryByText("Second")).toBeNull();
});

it("submits the draft captured at activation across the incoming-request accept round trip", async () => {
  m.view.mode = "REQUEST"; m.view.request = "INCOMING";
  let accept!: () => void;
  m.relationship.mockImplementation(() => new Promise<undefined>((resolve) => { accept = () => resolve(undefined); }));
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "First" } });
  fireEvent.click(sendButton());
  await waitFor(() => expect(m.relationship).toHaveBeenCalledTimes(1));
  // The composer is read-only while the accept runs, but the submission must
  // bind to the words it was activated with: a draft write that lands during
  // the round trip may never retarget the message or be cleared as if sent.
  expect(field()).toHaveProperty("readOnly", true);
  fireEvent.change(field(), { target: { value: "Second" } });
  await act(async () => { accept(); });
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  expect(m.text.mock.calls[0]?.[3]).toBe("First");
  expect(field()).toHaveProperty("value", "Second");
  // The committed callback clears only the submitted revision; the newer words
  // stay exactly as typed.
  act(() => admission.admitted()());
  expect(field()).toHaveProperty("value", "Second");
  await act(async () => admission.finish("saved"));
  await waitFor(() => expect(field()).toHaveProperty("value", "Second"));
  expect(m.text).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Not sent")).toBeNull();
});

it("admits one text send per activation and lets the next deliberate send start before the refresh ends", async () => {
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "Once" } });
  const button = sendButton();
  act(() => { button.click(); button.click(); });
  expect(m.text).toHaveBeenCalledTimes(1);

  act(() => admission.admitted()());
  expect(field()).toHaveProperty("value", "");
  // The first send's view refresh is still pending; a person's next message is
  // new intent, not a duplicate of the activation that just committed.
  fireEvent.change(field(), { target: { value: "Next" } });
  fireEvent.click(sendButton());
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[3]).toBe("Next");
});

it("blocks a different draft revision until the first admission commits, then allows it", async () => {
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "First" } });
  fireEvent.click(sendButton());
  expect(m.text).toHaveBeenCalledTimes(1);
  fireEvent.change(field(), { target: { value: "Second" } });
  // The field is never disabled, so the person keeps typing, but only one
  // durable admission may be uncommitted at a time even for a new revision.
  expect(field()).toHaveProperty("disabled", false);
  fireEvent.click(sendButton());
  expect(m.text).toHaveBeenCalledTimes(1);
  expect(field()).toHaveProperty("value", "Second");
  const transcript = within(screen.getByRole("list", { name: "Messages" }));
  expect(transcript.getAllByText("First")).toHaveLength(1);
  expect(transcript.queryByText("Second")).toBeNull();
  // The first send's durable callback ends its admission before the view read
  // settles, so the newer draft can now leave on its own activation.
  act(() => admission.admitted()());
  expect(field()).toHaveProperty("value", "Second");
  fireEvent.click(sendButton());
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[3]).toBe("Second");
  expect(transcript.getAllByText("Second")).toHaveLength(1);
  expect(screen.queryByText("Not sent")).toBeNull();
});

it("releases the admission latch after a rejection so a later deliberate send works", async () => {
  m.text.mockRejectedValueOnce(new Error("admission failed")).mockResolvedValueOnce("saved");
  await open();
  fireEvent.change(field(), { target: { value: "Failed once" } });
  fireEvent.click(sendButton());
  await screen.findByText("Your message was not sent. Tap Retry on it.");
  fireEvent.change(field(), { target: { value: "A new message" } });
  fireEvent.click(sendButton());
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[3]).toBe("A new message");
});

it("ignores a doubled sticker pick while a text admission owns the composer", async () => {
  localStorage.setItem(EXPRESSION_RECENTS_KEY, JSON.stringify([{
    type: "klipy", key: "klipy:stickers:sticker-a",
    item: { kind: "stickers", slug: "sticker-a", title: STICKER,
      mediaUrl: "https://klipy.com/a.gif", previewUrl: "https://klipy.com/a.png" },
  }]));
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "In flight" } });
  fireEvent.click(sendButton());
  expect(m.text).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  const recent = screen.getByRole("button", { name: `Recent ${STICKER}` });
  act(() => { recent.click(); recent.click(); });
  expect(m.text).toHaveBeenCalledTimes(1);

  await act(async () => { admission.admitted()(); admission.finish("saved"); });
  // The later deliberate pick is a new message, not blocked by the old latch.
  fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
  fireEvent.click(screen.getByRole("button", { name: `Recent ${STICKER}` }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
});

it("ignores a document pick while a text admission still owns the composer", async () => {
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "In flight" } });
  fireEvent.click(sendButton());
  // A picker result that lands inside the same admission is not a second send.
  fireEvent.change(screen.getByLabelText("Choose document"), {
    target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
  });
  await act(async () => undefined);
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.text).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("That file was not sent. Try again.")).toBeNull();

  await act(async () => { admission.admitted()(); admission.finish("saved"); });
  // After the admission settles the same pick is a deliberate new message.
  fireEvent.change(screen.getByLabelText("Choose document"), {
    target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
  });
  await waitFor(() => expect(m.upload).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text.mock.calls[1]?.[3]).toBe("norfold-file:mock");
});

it("drops an admission callback that arrives after the thread has left", async () => {
  const admission = deferAdmission();
  const rendered = await open();
  fireEvent.change(field(), { target: { value: "Leaving" } });
  fireEvent.click(sendButton());
  expect(m.text).toHaveBeenCalledTimes(1);
  rendered.unmount();
  expect(() => act(() => admission.admitted()())).not.toThrow();
});

it("does not settle a previous account's send into a reused thread", async () => {
  const admission = deferAdmission();
  const rendered = render(ownedThread("account"));
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  expect(screen.getByText(/which report you’re asking about/)).toBeTruthy();
  fireEvent.change(field(), { target: { value: "First" } });
  fireEvent.click(sendButton());
  expect(m.text).toHaveBeenCalledTimes(1);
  expect(m.text.mock.calls[0]?.[4]).toBe(REPORT_ID);

  // The shell keys the session by account, so a real switch remounts; this
  // proves the fence that must hold if one instance ever serves the next
  // account. Either way the previous account's late result may not touch the
  // draft, notice, reply or report context now on screen.
  m.chat.accountId = "account-2";
  rendered.rerender(ownedThread("account-2"));

  act(() => admission.admitted()());
  await act(async () => admission.finish({ id: "saved", viewStale: true }));

  expect(m.text).toHaveBeenCalledTimes(1);
  expect(field()).toHaveProperty("value", "First");
  expect(screen.queryByText(/view may be out of date/i)).toBeNull();
  expect(screen.queryByText("Your message was not sent. Tap Retry on it.")).toBeNull();
  expect(screen.getByText(/which report you’re asking about/)).toBeTruthy();
});

it("reports a stale view after a deferred refresh without inviting a resend", async () => {
  const admission = deferAdmission();
  await open();
  fireEvent.change(field(), { target: { value: "Committed" } });
  fireEvent.click(sendButton());
  await act(async () => { admission.admitted()(); admission.finish({ id: "saved", viewStale: true }); });
  expect(field()).toHaveProperty("value", "");
  expect(screen.getByText(/view may be out of date/i)).toBeTruthy();
  expect(screen.queryByText("Not sent")).toBeNull();
  expect(m.text).toHaveBeenCalledTimes(1);
});

it("shows the runtime's fixed ready-state failure with recovery without failing a saved message", async () => {
  m.messages = [{ id: "sent", conversationId: "chat", authorId: "account", recipientId: "peer",
    body: "Already sent", messageType: "TEXT", server: { sequence: 1 } }];
  m.chat.error = "Some messages could not send. Try again.";
  const rendered = await open();
  expect(screen.getByText("Some messages could not send. Try again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  // A sync failure is a status line, never a relabel of the accepted bubble.
  expect(screen.getAllByLabelText("Sent").length).toBeGreaterThan(0);
  expect(screen.queryByText("Not sent")).toBeNull();
  expect(screen.queryByText(/admission failed/i)).toBeNull();

  m.chat.error = null;
  rendered.rerender(thread());
  expect(screen.queryByText("Some messages could not send. Try again.")).toBeNull();
});
