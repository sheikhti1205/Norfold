// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { Connections, MessagingThread, replyPreview } from "./Messaging";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import { chatFileBody, type ChatFileMeta } from "../services/messaging/files";
import type { MessagingThreadSync } from "../services/messaging/runtime";

/**
 * R19 copy / link / menu integration. These are behavioural checks against the
 * real screen, with the same canonical boundaries mocked as MessagingMedia:
 * the durable runtime, auth, labels and native media. Nothing here asserts a
 * CSS string; the source contract stays in chatMediaSizing.ownership.
 */
const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return { view, watch: vi.fn(), chat: { accountId: "account", status: "ready", revision: 1,
    threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
    conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view,
      lastMessage: null as { body: string; messageType?: "TEXT" | "MEDIA" | "LOCATION" | "VOICE"; unsentAt?: number; contextReportId?: string } | null,
      lastSequence: 0, unreadCount: 0, pendingCount: 0, updatedAt: 0, projectionObservedAt: 0 }],
    currentProjections: { chat: view } },
    messages: [] as unknown[], media: [] as unknown[], outbox: [] as unknown[],
    threadRead: vi.fn(), fetchPost: vi.fn(),
    voice: vi.fn(), location: vi.fn(), mute: vi.fn(), pin: vi.fn(), prepare: vi.fn(), relationship: vi.fn(),
    text: vi.fn(), send: vi.fn(), read: vi.fn(), download: vi.fn(), remove: vi.fn(), recover: vi.fn(),
    retry: vi.fn(), receipt: vi.fn(), observe: vi.fn(), refresh: vi.fn(), choose: vi.fn(), import: vi.fn(), file: vi.fn(),
    holdIds: vi.fn(async () => [] as string[]), hold: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
    purgeHold: vi.fn(async () => undefined),
    report: vi.fn(async (_input: unknown, _signal?: AbortSignal) => ({ reportId: "receipt" })) };
});
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "account" } }) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: async () => new Map(), readCachedAccountIdentities: () => new Map() }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => m.chat }));
vi.mock("../services/messaging/runtime", () => ({ getCachedMessagingThreadState: () => null, watchMessagingThread: m.watch, sendMessagingVoice: m.voice, sendMessagingLocation: m.location, setMessagingMuted: m.mute, pinMessagingMessage: m.pin, readMessagingThreadState: () => m.threadRead(), fetchMessagingReceiptView: m.receipt, observeMessagingReceipt: m.observe, markMessagingConversationRead: async () => {}, refreshMessaging: m.refresh, sendMessagingText: m.text, sendMessagingMedia: m.send, readMessagingMedia: m.read, downloadMessagingMedia: m.download, changeMessagingRelationship: m.relationship, clearMessagingConversation: async () => {}, removeMessagingMessage: m.remove, recoverMessagingText: m.recover, retryMessagingMessage: m.retry, readMessagingUnsentHoldIds: m.holdIds, readMessagingUnsentHold: m.hold, purgeMessagingUnsentHold: m.purgeHold }));
// The chat list mounts the optional BackupPrompt; this suite covers previews,
// so keep the real Drive/runtime backup wiring out of the render entirely.
vi.mock("../services/messaging/backupRuntime", () => ({
  driveBackup: () => ({ promptDecision: () => null }),
  startDriveBackup: () => () => undefined,
  clearDriveBackup: () => undefined,
}));
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: (input: unknown, signal?: AbortSignal) => m.report(input, signal),
}));
// Keep every other post export real; only the one chat card read is controlled.
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  fetchPost: (id: string) => m.fetchPost(id),
}));
vi.mock("../services/media/nativeMedia", () => ({ chooseNativeImages: m.choose, importNativeImageUri: m.import, importedImageToFile: m.file }));

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.view.pinnedMessageIds = []; m.chat.revision = 1;
  m.messages = []; m.media = []; m.outbox = [];
  m.chat.accountId = "account"; m.chat.status = "ready";
  m.chat.currentProjections = { chat: m.view };
  m.chat.conversations[0]!.lastMessage = null;
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.watch.mockReset().mockReturnValue(() => {});
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
  m.fetchPost.mockReset().mockResolvedValue({ id: "report", type: "LOST", title: "Blue wallet", status: "OPEN", attachments: [] });
  m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] });
  m.observe.mockReset().mockResolvedValue(true);
  m.refresh.mockReset().mockResolvedValue(undefined);
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.report.mockReset().mockImplementation(async () => ({ reportId: "receipt" }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 200, right: 200, width: 200, height: 200, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "clipboard");
});

const origin = "https://findbackapp.social";
const reportId = "5b6f7c8d-1234-4abc-8def-123456789012";
const reportUrl = `${origin}/r/${reportId}`;
const fileMeta: ChatFileMeta = {
  key: "files/account/chat/x.pdf", name: "report.pdf", mime: "application/pdf", byteSize: 4096, kind: "pdf",
};

/** One received TEXT row with a server position, the shape the menu requires. */
function received(body = "Caption", extras: Record<string, unknown> = {}) {
  return { id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body,
    messageType: "TEXT", server: { eventId: "event", sequence: 1 }, ...extras };
}

function thread() {
  return <MemoryRouter initialEntries={["/connections/chat"]}><LiveRegion /><MessagingRestoration />
    <Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes></MemoryRouter>;
}

function searchThread() {
  return <MemoryRouter initialEntries={["/connections/chat?search=1"]}><LiveRegion /><MessagingRestoration />
    <Routes><Route path="/connections/:conversationId" element={<MessagingThread />} /></Routes></MemoryRouter>;
}

function chats() {
  return <MemoryRouter initialEntries={["/chats"]}><LiveRegion /><MessagingRestoration />
    <Routes><Route path="/chats" element={<Connections />} /></Routes></MemoryRouter>;
}

async function openChats() {
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  render(chats());
  await screen.findByRole("link", { name: /Open conversation with/ });
}

async function open() {
  const rendered = render(thread());
  // The screen's own loading line; waiting on the real copy keeps every
  // synchronous getBy below honest instead of racing the first read.
  await waitFor(() => expect(screen.queryByText("Opening messages…")).toBeNull());
  return rendered;
}

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

async function openMessageMenu(label = "Options for received message") {
  fireEvent.click(screen.getByRole("button", { name: label }));
  return screen.findByRole("menu", { name: "Message actions" });
}

describe("R19 message copy", () => {
  it("copies the exact visible text of an ordinary message", async () => {
    const body = "  keep\nthis exactly 🎉  ";
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    m.messages = [received(body)];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(body));
  });

  it("has no Copy action for a bare GIF body and renders it as media, not a link", async () => {
    const gif = "https://media.klipy.com/a.gif";
    m.messages = [received(gif)];
    await open();
    expect(document.querySelector("img.fb-chat-klipy")).toBeTruthy();
    expect(document.querySelector('[data-chat-message="message"] a')).toBeNull();
    await openMessageMenu();
    expect(screen.queryByRole("menuitem", { name: "Copy text" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
  });

  it("copies only the visible caption of a file, never the serialized marker", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    m.messages = [received(chatFileBody(fileMeta, "Here is the report 🎉"))];
    await open();
    expect(screen.getByText("Here is the report 🎉")).toBeTruthy();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("Here is the report 🎉"));
    expect(writeText.mock.calls[0]?.[0]).not.toContain("norfold-file:");
  });

  it("has no Copy action for a captionless file or a malformed marker", async () => {
    m.messages = [received(chatFileBody(fileMeta))];
    const first = await open();
    await openMessageMenu();
    expect(screen.queryByRole("menuitem", { name: "Copy text" })).toBeNull();
    first.unmount();
    m.messages = [received("norfold-file:v1:!!!not-base64 https://evil.example/x")];
    await open();
    // A malformed marker stays opaque text: a URL trapped in its payload must
    // not become a chat link.
    expect(document.querySelector('[data-chat-message="message"] a')).toBeNull();
    await openMessageMenu();
    expect(screen.queryByRole("menuitem", { name: "Copy text" })).toBeNull();
  });

  it("never offers Copy for an unsent message and does not link its old body", async () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    m.messages = [received(reportUrl, { unsentAt: 5 })];
    await open();
    expect(screen.getByText("Message unsent")).toBeTruthy();
    expect(document.querySelector('[data-chat-message="message"] a')).toBeNull();
    expect(m.fetchPost).not.toHaveBeenCalled();
    await openMessageMenu();
    expect(screen.queryByRole("menuitem", { name: "Copy text" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
  });

  it("shows an honest error when the clipboard is unavailable", async () => {
    stubClipboard(undefined);
    m.messages = [received("Copy me")];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy this message.");
  });

  it("shows an honest error when the clipboard write is rejected", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    m.messages = [received("Copy me")];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy this message.");
  });

  it("shows an honest error when the clipboard write throws synchronously", async () => {
    stubClipboard({ writeText: vi.fn(() => { throw new Error("sync"); }) });
    m.messages = [received("Copy me")];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy this message.");
    expect(screen.getByTestId("live-region-announcement").textContent).not.toBe("Message copied.");
  });
});

describe("R19 copy actions", () => {
  it("offers Copy link, not Copy text, for one bare safe URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    m.messages = [received("https://example.com/a?x=1")];
    await open();
    await openMessageMenu();
    expect(screen.queryByRole("menuitem", { name: "Copy text" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("https://example.com/a?x=1"));
  });

  it("copies prose and the exact link as two separate actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const url = "https://example.com/a?x=1";
    m.messages = [received(`Read ${url} and reply`)];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Read and reply"));
    expect(writeText.mock.calls[0]?.[0]).not.toContain(url);

    await waitFor(() => expect(screen.queryByRole("menu", { name: "Message actions" })).toBeNull());
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(url));
  });

  it("chooses one exact link at a time from the canonical menu, never a URL blob", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const first = "https://a.example/one";
    const second = "https://b.example/two";
    m.messages = [received(`Compare ${first} with ${second} first`)];
    await open();
    await openMessageMenu();
    const chooser = screen.getByRole("menuitem", { name: "Copy link" });
    act(() => chooser.focus());
    fireEvent.click(chooser);
    const submenu = await screen.findByRole("menu", { name: "Copy link" });
    expect(within(submenu).getAllByRole("menuitem").map((node) => node.textContent))
      .toEqual([first, second]);
    fireEvent.click(within(submenu).getByRole("menuitem", { name: second }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(second));
  });

  it("dedupes a repeated link into one direct action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const url = "https://example.com/one";
    m.messages = [received(`${url} again ${url}`)];
    await open();
    await openMessageMenu();
    expect(screen.queryByRole("menu", { name: "Copy link" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(url));
  });

  it("copies the visible report share URL, never the internal report id", async () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    m.messages = [received(reportUrl, { contextReportId: reportId })];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(reportUrl));
    expect(writeText.mock.calls[0]?.[0]).not.toBe(reportId);
  });

  it("keeps an unsafe scheme as text and never offers it as a link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    m.messages = [received("javascript:alert(1)")];
    await open();
    await openMessageMenu();
    expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("javascript:alert(1)"));
  });

  it("reports an honest failure when a link cannot reach the clipboard", async () => {
    stubClipboard(undefined);
    m.messages = [received("https://example.com/a")];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy this link.");
  });

  it("never claims a link copy that the clipboard rejected", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    m.messages = [received("https://example.com/a")];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy this link.");
    expect(screen.getByTestId("live-region-announcement").textContent).not.toBe("Link copied.");
  });

  it("never claims a link copy when the clipboard write throws synchronously", async () => {
    stubClipboard({ writeText: vi.fn(() => { throw new Error("sync"); }) });
    m.messages = [received("https://example.com/a")];
    await open();
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy this link.");
    expect(screen.getByTestId("live-region-announcement").textContent).not.toBe("Link copied.");
  });
});

describe("R19 message menu", () => {
  it.each([
    { name: "the corner chevron", trigger: () => {
      fireEvent.click(screen.getByRole("button", { name: "Options for received message" }));
    } },
    { name: "a context-menu press", trigger: () => {
      fireEvent.contextMenu(document.querySelector("[data-longpress-surface]")!);
    } },
    { name: "Shift+F10", trigger: () => {
      fireEvent.keyDown(document.querySelector("[data-longpress-surface]")!, { key: "F10", shiftKey: true });
    } },
  ])("opens one identical menu from $name", async ({ trigger }) => {
    m.messages = [received("Caption")];
    await open();
    expect(document.querySelectorAll("[data-longpress-surface]")).toHaveLength(1);
    trigger();
    const menu = await screen.findByRole("menu", { name: "Message actions" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(within(menu).getAllByRole("menuitem").map((node) => node.textContent))
      .toEqual(["Reply", "Copy text", "Pin", "Delete for me", "Report message"]);
  });

  it("attaches the one menu chevron to the bubble rather than the line", async () => {
    m.messages = [received("Caption")];
    await open();
    const bubble = document.querySelector('[data-chat-message="message"] .fb-chat-message');
    expect(bubble?.querySelector(":scope > .fb-chat-message-options")).toBeTruthy();
    expect(document.querySelectorAll(".fb-chat-message-options")).toHaveLength(1);
  });
});

describe("R19 chat links and previews", () => {
  it("renders one live report preview for a repeated link and copies the exact pasted URL", async () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    m.messages = [received(`${reportUrl} and again ${reportUrl}`)];
    await open();
    // Wait for the resolved card, not the loading state: both carry the same
    // preview class, and only the ready card carries the report id.
    await waitFor(() => expect(document.querySelector(`[data-chat-report="${reportId}"]`)).toBeTruthy());
    expect(document.querySelectorAll(".fb-chat-report-preview")).toHaveLength(1);
    const card = document.querySelector(`[data-chat-report="${reportId}"]`)!;
    expect(card.getAttribute("href")).toBe(`/posts/${reportId}`);
    // The represented URL is not printed again; the exact pasted URL is still
    // what the menu copies.
    expect(screen.queryAllByText(reportUrl)).toHaveLength(0);
    expect(m.fetchPost).toHaveBeenCalledTimes(1);
    expect(m.fetchPost).toHaveBeenCalledWith(reportId);
    await openMessageMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(reportUrl));
  });

  it("suppresses the repeated preview when the same report is already the message context", async () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    m.messages = [received(reportUrl, { contextReportId: reportId })];
    await open();
    await waitFor(() => expect(document.querySelector(`[data-chat-report="${reportId}"]`)).toBeTruthy());
    expect(document.querySelectorAll(".fb-chat-report-preview")).toHaveLength(1);
    const card = document.querySelector(`[data-chat-report="${reportId}"]`)!;
    expect(card.getAttribute("href")).toBe(`/posts/${reportId}`);
    expect(screen.queryAllByText(reportUrl)).toHaveLength(0);
    expect(m.fetchPost).toHaveBeenCalledTimes(1);
  });

  it("re-reads the linked report when the current block authority changes", async () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    m.messages = [received(reportUrl, { contextReportId: reportId })];
    const rendered = await open();
    await waitFor(() => expect(m.fetchPost).toHaveBeenCalledTimes(1));
    m.view.ownBlocked = true;
    rendered.rerender(thread());
    await waitFor(() => expect(m.fetchPost).toHaveBeenCalledTimes(2));
  });

  it("mounts the canonical YouTube player only after a deliberate press", async () => {
    // The compact card asks the provider for the real title. CI has no network:
    // an explicit not-ok answer keeps the honest fallback and this playback
    // check independent of YouTube; afterEach restores the global.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    m.messages = [received("Watch https://youtu.be/dQw4w9WgXcQ now")];
    await open();
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const player = await screen.findByTitle("Embedded YouTube video");
    expect(player.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("leaves an unsafe scheme as plain text", async () => {
    m.messages = [received("javascript:alert(1)")];
    await open();
    const bubble = document.querySelector('[data-chat-message="message"]')!;
    expect(bubble.querySelector("a")).toBeNull();
    expect(bubble.querySelector(".fb-chat-message-text")?.textContent).toBe("javascript:alert(1)");
  });

  it("links a safe generic URL without contacting the pasted host directly", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    m.messages = [received("Read https://example.com/a?x=1 now")];
    await open();
    const anchor = document.querySelector('[data-chat-message="message"] a[href="https://example.com/a?x=1"]');
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    // The card may contact only the Norfold metadata service, with the pasted
    // address in its body; unrelated chrome (a badge read) is allowed to run,
    // but nothing may approach the pasted host directly.
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("example.com"))).toBe(false);
    expect(m.fetchPost).not.toHaveBeenCalled();
  });
});

describe("R19 canonical previews", () => {
  const previewBase = { id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body: "" };

  it("quotes a valid file by name, including after leading whitespace", () => {
    expect(replyPreview({ ...previewBase, body: chatFileBody(fileMeta, "caption") })).toBe("report.pdf");
    expect(replyPreview({ ...previewBase, body: `\n${chatFileBody(fileMeta)}` })).toBe("report.pdf");
  });

  it("quotes a malformed or future reserved marker as File, never its payload", () => {
    expect(replyPreview({ ...previewBase, body: "norfold-file:v1:!!!not-base64 https://evil.example/x" })).toBe("File");
    expect(replyPreview({ ...previewBase, body: "norfold-file:v2:abcd" })).toBe("File");
  });

  it("keeps the typed quote semantics for an empty body", () => {
    expect(replyPreview({ ...previewBase, messageType: "MEDIA" })).toBe("Photo");
    expect(replyPreview({ ...previewBase, messageType: "VOICE" })).toBe("Voice message");
    expect(replyPreview({ ...previewBase, messageType: "LOCATION" })).toBe("Location");
  });

  it("names a proven Klipy kind and keeps prose containing its URL exact", () => {
    expect(replyPreview({ ...previewBase, body: "https://media.klipy.com/a.gif#norfold-media=gif" })).toBe("GIF");
    expect(replyPreview({ ...previewBase, body: "https://media.klipy.com/s.webp#norfold-media=sticker" })).toBe("Sticker");
    // A pre-marker body proves no kind; it is named for both rather than guessed.
    expect(replyPreview({ ...previewBase, body: "https://media.klipy.com/a.gif" })).toBe("Sticker/GIF");
    expect(replyPreview({ ...previewBase, body: "See https://media.klipy.com/a.gif now" })).toBe("See https://media.klipy.com/a.gif now");
  });

  const previewCases: { name: string; body: string; unsentAt?: number; shown: string }[] = [
    { name: "a valid file", body: chatFileBody(fileMeta, "caption"), shown: "report.pdf" },
    { name: "a file after leading whitespace", body: `\n${chatFileBody(fileMeta)}`, shown: "report.pdf" },
    { name: "a malformed reserved body", body: "norfold-file:v1:!!!not-base64 https://evil.example/x", shown: "File" },
    { name: "a future reserved body", body: "norfold-file:v2:abcd", shown: "File" },
    { name: "a bare Klipy body before the kind marker", body: "https://media.klipy.com/a.gif", shown: "Sticker/GIF" },
    { name: "a tagged sticker", body: "https://media.klipy.com/s.webp#norfold-media=sticker", shown: "Sticker" },
    { name: "a tagged GIF", body: "https://media.klipy.com/a.gif#norfold-media=gif", shown: "GIF" },
    { name: "prose containing a provider URL", body: "See https://media.klipy.com/a.gif now", shown: "See https://media.klipy.com/a.gif now" },
    { name: "an unsent row", body: "Gone", unsentAt: 5, shown: "Message unsent" },
    { name: "ordinary text", body: "  keep\nthis  ", shown: "  keep\nthis  " },
  ];

  it.each(previewCases)("shows $name in the chat list without leaking the stored body", async ({ body, unsentAt, shown }) => {
    const message = { id: "m1", conversationId: "chat", authorId: "peer", recipientId: "account", body,
      messageType: "TEXT" as const, ...(unsentAt !== undefined ? { unsentAt } : {}) };
    m.chat.conversations[0]!.lastMessage = message;
    await openChats();
    expect(document.querySelector(".fb-chat-preview")?.textContent).toBe(shown);
  });

  it("shows the canonical preview in a chat search result while matching the stored body", async () => {
    m.messages = [
      received(chatFileBody(fileMeta, "caption"), { id: "file", server: { eventId: "event-1", sequence: 1 } }),
      received("Keep this exactly", { id: "text", server: { eventId: "event-2", sequence: 2 } }),
    ];
    render(searchThread());
    const input = await screen.findByRole("searchbox", { name: "Search saved messages" });
    fireEvent.change(input, { target: { value: "caption" } });
    await waitFor(() => expect(document.querySelector(".fb-chat-search-results")?.textContent).toContain("report.pdf"));
    expect(document.querySelector(".fb-chat-search-results")?.textContent).not.toContain("norfold-file:");
    fireEvent.change(input, { target: { value: "exactly" } });
    await waitFor(() => expect(document.querySelector(".fb-chat-search-results")?.textContent).toContain("Keep this exactly"));
  });
});
