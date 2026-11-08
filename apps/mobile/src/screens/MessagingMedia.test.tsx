// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { MessagingThread } from "./Messaging";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import { Capacitor } from "@capacitor/core";
import { PhotoUnavailableError } from "../services/messaging/mediaTransport";
import type { MessagingThreadSync } from "../services/messaging/runtime";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { sha256Hex } from "../services/messaging/media";

const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return { view, watch: vi.fn(), chat: { accountId: "account", status: "ready", revision: 1,
    threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
    conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view }], currentProjections: { chat: view } },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[], cached: null as null | { messages: unknown[]; media: unknown[]; outbox: unknown[] }, threadRead: vi.fn(),
    voice: vi.fn(), location: vi.fn(), mute: vi.fn(), pin: vi.fn(), prepare: vi.fn(), relationship: vi.fn(), text: vi.fn(), send: vi.fn(), read: vi.fn(), download: vi.fn(), remove: vi.fn(), recover: vi.fn(), retry: vi.fn(), receipt: vi.fn(), observe: vi.fn(), refresh: vi.fn(), choose: vi.fn(), import: vi.fn(), file: vi.fn() };
});
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: async () => new Map(), readCachedAccountIdentities: () => new Map() }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({ getCachedMessagingThreadState: () => m.cached, watchMessagingThread: m.watch, sendMessagingVoice: m.voice, sendMessagingLocation: m.location, setMessagingMuted: m.mute, pinMessagingMessage: m.pin, readMessagingThreadState: () => m.threadRead(), fetchMessagingReceiptView: m.receipt, observeMessagingReceipt: m.observe, markMessagingConversationRead: async () => {}, refreshMessaging: m.refresh, sendMessagingText: m.text, sendMessagingMedia: m.send, readMessagingMedia: m.read, downloadMessagingMedia: m.download, changeMessagingRelationship: m.relationship, clearMessagingConversation: async () => {}, removeMessagingMessage: m.remove, recoverMessagingText: m.recover, retryMessagingMessage: m.retry }));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/media/nativeMedia", () => ({ chooseNativeImages: m.choose, importNativeImageUri: m.import, importedImageToFile: m.file }));
beforeEach(() => { vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() })); m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.chat.revision = 1; m.messages = []; m.media = []; m.outbox = []; m.prepare.mockReset(); m.send.mockReset(); m.read.mockReset().mockResolvedValue(null); m.download.mockReset().mockResolvedValue(undefined); m.remove.mockReset().mockResolvedValue(undefined); m.recover.mockReset().mockResolvedValue(undefined); m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] }); m.observe.mockReset().mockResolvedValue(true); m.refresh.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}) });
  m.choose.mockReset(); m.import.mockReset(); m.file.mockReset();
  m.retry.mockReset().mockResolvedValue(undefined);
  m.text.mockReset().mockResolvedValue("saved");
  m.location.mockReset().mockResolvedValue("shared"); m.chat.accountId = "account";
  m.relationship.mockReset().mockResolvedValue(undefined);
  m.mute.mockReset().mockResolvedValue(undefined); m.view.ownMuted = false; m.chat.status = "ready";
  m.pin.mockReset().mockResolvedValue(undefined); m.view.pinnedMessageIds = [];
  m.view.epoch = "relationship-a"; m.view.revision = 1; m.chat.currentProjections = { chat: m.view };
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.watch.mockReset().mockReturnValue(() => {});
  m.cached = null;
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  // Attachments are collapsed while typing: reveal them through the real composer.
  fireEvent.click(screen.getByRole("button", { name: "Show attachments" }));
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
  await waitFor(() => expect(m.text).toHaveBeenCalledWith("account", "chat", "peer", "Continue offline", undefined, undefined));
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
  const resolvers: Array<(value: string) => void> = [];
  m.text.mockReset().mockImplementation(() => new Promise<string>((resolve) => { resolvers.push(resolve); }));
  await open();
  const field = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "First" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(1));
  expect(field.disabled).toBe(false);
  fireEvent.change(field, { target: { value: "Second" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenCalledTimes(2));
  expect(m.text).toHaveBeenLastCalledWith("account", "chat", "peer", "Second", undefined, undefined);
  expect(field.value).toBe("Second");
  // The first admission settling must not wipe input the person typed after it.
  await act(async () => { resolvers[0]!("saved"); });
  await waitFor(() => expect(field.value).toBe("Second"));
  await act(async () => { resolvers[1]!("saved"); });
  await waitFor(() => expect(field.value).toBe(""));
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
  await waitFor(() => expect(m.text).toHaveBeenCalledExactlyOnceWith("account", "chat", "peer", "About this report", report, undefined));
  await waitFor(() => expect(field).toHaveProperty("value", ""));
  await waitFor(() => expect(screen.getByTestId("query").textContent).toBe(""));
  fireEvent.change(field, { target: { value: "Now ordinary text" } }); fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(m.text).toHaveBeenLastCalledWith("account", "chat", "peer", "Now ordinary text", undefined, undefined));
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
  expect(within(dialog).queryByText("Caption")).toBeNull();
});
it("sends desktop Enter once but preserves Shift+Enter and IME composition", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: fine"), addEventListener() {}, removeEventListener() {} }));
  await open();const field=screen.getByRole("textbox",{name:"Message"});
  fireEvent.change(field,{target:{value:"Hello"}});
  fireEvent.keyDown(field,{key:"Enter",shiftKey:true});expect(m.text).not.toHaveBeenCalled();
  fireEvent.compositionStart(field);fireEvent.keyDown(field,{key:"Enter"});expect(m.text).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);fireEvent.keyDown(field,{key:"Enter"});
  await waitFor(()=>expect(m.text).toHaveBeenCalledExactlyOnceWith("account","chat","peer","Hello",undefined,undefined));
  await waitFor(()=>expect(field).toHaveProperty("value",""));
});
it("offers an accessible photo picker in a connected conversation", async () => {
  await open();
  expect((screen.getByRole("button", { name: "Choose photo" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Take photo" }) as HTMLButtonElement).disabled).toBe(false);
});
it("does not offer an active photo picker in a request", async () => {
  m.view.mode = "REQUEST"; await open();
  expect((screen.getByRole("button", { name: "Choose photo" }) as HTMLButtonElement).disabled).toBe(true);
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
it("renders a photo run as one bubble with the first caption and the last receipt", async () => {
  const run = photoRun(3); run.messages[2]!.readByPeer = true;
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  expect(screen.getByRole("group", { name: "3 photos" })).toBeTruthy();
  const cells = await screen.findAllByRole("button", { name: /^View photo \d of 3$/ });
  expect(cells).toHaveLength(3);
  // The transcript has one row, one caption and the receipt of the last photo.
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(1);
  expect(screen.getAllByText("Two shots")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Read" })).toBeTruthy();
  fireEvent.click(cells[2]!);
  const viewer = await screen.findByRole("dialog", { name: "Photo viewer" });
  await waitFor(() => expect(within(viewer).getByText("Photo 3 of 3")).toBeTruthy());
});
it("starts a new bubble when the next photo carries its own caption", async () => {
  const run = photoRun(1);
  m.messages = [...run.messages,
    { id: "second", conversationId: "chat", authorId: "account", recipientId: "peer", body: "And this",
      messageType: "MEDIA", createdAt: 1_500, server: { eventId: "event-second", sequence: 2 } }];
  m.media = [...run.media, { id: "media-2", messageId: "second", direction: "OUT", state: "READY", width: 2, height: 1, mime: "image/jpeg" }];
  m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  // The second send is one second after the first, so it would have joined the
  // run; its caption must still be visible, so it keeps its own bubble.
  expect(screen.queryByRole("group", { name: "2 photos" })).toBeNull();
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
it("renders four or more photos as one 2x2 bubble and counts the overflow", async () => {
  const run = photoRun(5);
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  expect(screen.getByRole("group", { name: "5 photos" })).toBeTruthy();
  expect(document.querySelector(".fb-chat-photo-grid-4")).toBeTruthy();
  const cells = await screen.findAllByRole("button", { name: /^View photo \d of 5$/ });
  expect(cells).toHaveLength(4);
  expect(screen.getByText("+1")).toBeTruthy();
  expect(document.querySelectorAll("[data-chat-message]")).toHaveLength(1);
});
it("jumps a quote that names a hidden photo to the visible group and rings it", async () => {
  const run = photoRun(3);
  m.messages = [...run.messages, { id: "reply", conversationId: "chat", authorId: "peer", recipientId: "account",
    body: "Which one?", messageType: "TEXT", createdAt: 9_000, replyToId: "photo-2",
    server: { eventId: "reply", sequence: 9 } }];
  m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  const quote = screen.getByRole("button", { name: /Quoted message from you/ });
  await waitFor(() => expect(quote.querySelector("img.fb-chat-quote-thumb")).toBeTruthy());
  fireEvent.click(quote);
  const leader = document.querySelector<HTMLElement>('[data-chat-message="photo-1"]');
  await waitFor(() => expect(leader?.querySelector(".fb-chat-message")?.className).toMatch(/fb-chat-flash-[ab]/));
  expect(document.activeElement).toBe(leader);
});
it("removes a whole still-pending photo run together", async () => {
  const run = photoRun(2);
  for (const message of run.messages) delete message.server;
  for (const attachment of run.media) attachment.state = "QUEUED";
  m.messages = run.messages; m.media = run.media; m.read.mockResolvedValue(new Uint8Array([1]).buffer);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Remove pending photos" }));
  await waitFor(() => expect(m.remove.mock.calls).toEqual([
    ["account", "chat", "photo-1", false], ["account", "chat", "photo-2", false]]));
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
  expect((screen.getByRole("button", { name: "Choose photo" }) as HTMLButtonElement).disabled).toBe(true);
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
   expect(screen.getByRole("dialog", { name: "Photo viewer" })).toBeTruthy();
  m.messages = [{ ...received("MEDIA"), body: "", unsentAt: 1 }]; m.chat.revision++;
  rendered.rerender(thread());
   await waitFor(() => expect(screen.queryByRole("dialog", { name: "Photo viewer" })).toBeNull());
});
it("can retry preparation after relationship loss aborted a draft", async () => {
  let resolve!: (value: unknown) => void; m.prepare.mockReturnValue(new Promise((done) => { resolve = done; }));
  const rendered = await open();
  fireEvent.change(screen.getByLabelText("Photo file input"), { target: { files: [new File(["x"], "p.jpg")] } });
  expect(screen.getByText("Preparing photos…")).toBeTruthy();
  m.view.mode = "REQUEST"; rendered.rerender(thread());
  await act(async () => { resolve({ bytes: new ArrayBuffer(1), mime: "image/jpeg", width: 2, height: 1 }); });
  m.view.mode = "CONNECTED"; rendered.rerender(thread());
  expect(screen.queryByText("Preparing photos…")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
it("uses the canonical Android URI import before preparing a selected photo", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  const imported = { uri: "synthetic-import" }, source = new File(["x"], "photo.jpg");
  m.choose.mockResolvedValue(["content://synthetic-photo"]); m.import.mockResolvedValue(imported); m.file.mockReturnValue(source);
  m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await open(); fireEvent.click(screen.getByRole("button", { name: "Choose photo" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Choose photo" }));
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
it("survives a projection refresh while the native picker is open", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  const imported = { uri: "synthetic-import" }, source = new File(["x"], "photo.jpg");
  let grant!: (uris: string[]) => void;
  m.choose.mockReturnValue(new Promise((done) => { grant = done; }));
  m.import.mockResolvedValue(imported); m.file.mockReturnValue(source);
  m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
  await open(); fireEvent.click(screen.getByRole("button", { name: "Choose photo" }));
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
  expect(within(panel).getByText("Photos are available when connected.")).toBeTruthy();
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
