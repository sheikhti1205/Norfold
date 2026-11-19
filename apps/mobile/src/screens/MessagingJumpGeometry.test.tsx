// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { Capacitor } from "@capacitor/core";
import { ThreadSession } from "./Messaging";
import { LiveRegion } from "../components/LiveRegion";
import { MessagingRestoration } from "../components/MessagingRestoration";
import type { MessagingThreadSync } from "../services/messaging/runtime";

/**
 * Jump-control ownership in the message viewport.
 *
 * jsdom has no layout engine, so these assertions are deliberately structural:
 * the floating latest control must be a sibling of the scroller inside the
 * viewport box, never a child of the scroller and never a direct child of the
 * page. The viewport box ends where the composer stack begins, so the control
 * cannot scroll away and does not need a guessed page-bottom offset. Composer
 * growth, reply/attachment context and a conversation or account change must
 * not change that ownership. Actual pixels remain a deployed-browser acceptance
 * item.
 */
const m = vi.hoisted(() => {
  const view = { mode: "CONNECTED", request: "OUTGOING", ownBlocked: false, ownMuted: false, epoch: "relationship-a", revision: 1, pinnedMessageIds: [] as string[] };
  return { view, watch: vi.fn(), chat: { accountId: "account", status: "ready", revision: 1,
    threadSync: { conversationId: "chat", mode: "ready", missing: 0 } as MessagingThreadSync | null,
    conversations: [{ conversationId: "chat", peerId: "peer", cachedProjection: view, lastMessage: null,
      lastSequence: 0, unreadCount: 0, pendingCount: 0, updatedAt: 0, projectionObservedAt: 0 },
      { conversationId: "chat-2", peerId: "peer", cachedProjection: view, lastMessage: null,
      lastSequence: 0, unreadCount: 0, pendingCount: 0, updatedAt: 0, projectionObservedAt: 0 }],
    currentProjections: { chat: view, "chat-2": view } as Record<string, typeof view> },
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
vi.mock("../services/messaging/preparePhoto", () => ({ prepareMessagingPhoto: m.prepare }));
vi.mock("../services/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/moderation")>()),
  submitReport: (input: unknown, signal?: AbortSignal) => m.report(input, signal),
}));
vi.mock("../services/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/posts")>()),
  fetchPost: (id: string) => m.fetchPost(id),
}));
vi.mock("../services/media/nativeMedia", () => ({ chooseNativeImages: m.choose, importNativeImageUri: m.import, importedImageToFile: m.file }));

function received(body = "Caption") {
  return { id: "message", conversationId: "chat", authorId: "peer", recipientId: "account", body,
    messageType: "TEXT", server: { eventId: "event", sequence: 1 } };
}

function Harness({ accountId = "account", conversationId = "chat" }: { accountId?: string; conversationId?: string }) {
  return <MemoryRouter><LiveRegion /><MessagingRestoration />
    <ThreadSession accountId={accountId} conversationId={conversationId} /></MemoryRouter>;
}

/**
 * Give the scroller a deterministic box and return a way to report a reader
 * who is 800px from the end. 800 > the 400px reveal threshold, so the floating
 * control renders exactly as it would in the browser.
 */
function scrollerGeometry() {
  const area = document.querySelector<HTMLElement>(".fb-chat-messages")!;
  let top = 0;
  Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => 1200 });
  Object.defineProperty(area, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(area, "scrollTop", { configurable: true, get: () => top, set: (value: number) => { top = value; } });
  return {
    reveal() { act(() => { top = 100; area.dispatchEvent(new Event("scroll")); }); },
  };
}

function expectViewportOwnership() {
  const page = document.querySelector<HTMLElement>(".fb-chat-page")!;
  // Direct children by identity rather than `:scope`, which older jsdom
  // selector engines do not implement.
  const children = Array.from(page.children);
  const viewport = children.find(child => child.classList.contains("fb-chat-viewport")) as HTMLElement | undefined;
  const scroller = page.querySelector<HTMLElement>(".fb-chat-messages")!;
  const jump = screen.getByRole("button", { name: "Jump to latest message" });
  const composer = page.querySelector<HTMLFormElement>("form.fb-peer-composer");
  expect(viewport).toBeTruthy();
  expect(scroller.parentElement).toBe(viewport);
  expect(jump.parentElement).toBe(viewport);
  expect(jump.closest(".fb-chat-messages")).toBeNull();
  expect(page.contains(jump)).toBe(true);
  expect(jump.parentElement).not.toBe(page);
  expect(composer).toBeTruthy();
  expect(composer!.parentElement).toBe(page);
  // The viewport precedes the composer stack, so its bottom edge is that stack's
  // top edge rather than the page's bottom.
  expect(viewport!.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  m.view.mode = "CONNECTED"; m.view.ownBlocked = false; m.view.pinnedMessageIds = []; m.chat.revision = 1;
  m.messages = [received()]; m.media = []; m.outbox = [];
  m.chat.accountId = "account"; m.chat.status = "ready";
  m.chat.currentProjections = { chat: m.view, "chat-2": m.view };
  m.chat.threadSync = { conversationId: "chat", mode: "ready", missing: 0 };
  m.watch.mockReset().mockReturnValue(() => {});
  m.threadRead.mockReset().mockImplementation(async () => ({ messages: m.messages, outbox: m.outbox, media: m.media }));
  m.fetchPost.mockReset().mockResolvedValue({ id: "report", type: "LOST", title: "Blue wallet", status: "OPEN", attachments: [] });
  m.receipt.mockReset().mockResolvedValue({ context: "authority", readIds: [] });
  m.observe.mockReset().mockResolvedValue(true);
  m.refresh.mockReset().mockResolvedValue(undefined);
  m.prepare.mockReset();
  m.choose.mockReset(); m.import.mockReset(); m.file.mockReset();
  m.holdIds.mockReset().mockImplementation(async () => []);
  m.hold.mockReset().mockImplementation(async () => null);
  m.report.mockReset().mockImplementation(async () => ({ reportId: "receipt" }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("jump-control viewport ownership", () => {
  it("keeps the control in the message viewport, never inside the scroller", async () => {
    render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    expectViewportOwnership();
    // The short composer still leaves the control outside the scroller.
    expect(document.querySelector("form.fb-peer-composer textarea")).toBeTruthy();
  });

  it("holds the same ownership while the composer grows and shrinks", async () => {
    render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    const field = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(field, { target: { value: "one\ntwo\nthree\nfour" } });
    expectViewportOwnership();
    fireEvent.change(field, { target: { value: "" } });
    expectViewportOwnership();
  });

  it("holds ownership when a reply chip grows the composer", async () => {
    render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    fireEvent.click(screen.getByRole("button", { name: "Options for received message" }));
    const menu = await screen.findByRole("menu", { name: "Message actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reply" }));
    expect(document.querySelector(".fb-chat-reply-chip")).toBeTruthy();
    expectViewportOwnership();
  });

  it("holds ownership while the attachment sheet is open", async () => {
    render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    const menu = await screen.findByRole("menu", { name: "Add attachment" });
    expect(menu.closest(".fb-chat-viewport")).toBeNull();
    expectViewportOwnership();
  });

  it("keeps the control clear of a staged photo strip that grows the composer stack", async () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    const imported = { uri: "synthetic-import" }, source = new File(["x"], "photo.jpg");
    m.choose.mockResolvedValue(["content://synthetic-photo"]);
    m.import.mockResolvedValue(imported);
    m.file.mockReturnValue(source);
    m.prepare.mockResolvedValue({ bytes: new ArrayBuffer(1), sha256: "a".repeat(64), mime: "image/jpeg", byteSize: 1, width: 2, height: 1 });
    render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    // The shipped native intake: picker → URI import → File → shared preparation,
    // so the strip below is the real draft row rather than appended DOM.
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Add attachment" })).getByRole("menuitem", { name: "Photos" }));
    const strip = await screen.findByRole("group", { name: "1 photo to send" });
    // Proof the strip came from the real intake, not from appended DOM.
    expect(m.prepare).toHaveBeenCalledTimes(1);
    const viewport = document.querySelector<HTMLElement>(".fb-chat-viewport")!;
    expect(strip.closest(".fb-chat-viewport")).toBeNull();
    expect(viewport.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectViewportOwnership();
    fireEvent.click(within(strip).getByRole("button", { name: "Remove photo 1" }));
    expect(screen.queryByRole("group", { name: "1 photo to send" })).toBeNull();
    expectViewportOwnership();
  });

  it("keeps the viewport owner when the same instance changes conversation", async () => {
    const view = render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    expectViewportOwnership();
    // The shipped shell keys a real switch; this rerender keeps the DOM instance
    // and changes the conversation the anchor owner fences, which is the path
    // that resets the follow latch without remounting the viewport.
    view.rerender(<Harness conversationId="chat-2" />);
    geometry.reveal();
    expectViewportOwnership();
  });

  it("keeps the viewport owner when the same instance changes account", async () => {
    const view = render(<Harness />);
    await screen.findByText("Caption");
    const geometry = scrollerGeometry();
    geometry.reveal();
    expectViewportOwnership();
    // The anchor fence key is `${accountId}:${conversationId}`, so the account
    // half resets the latch on the same DOM instance. The runtime follows the
    // new account, so the composer stays live instead of degrading to locked.
    m.chat.accountId = "second-account";
    view.rerender(<Harness accountId="second-account" />);
    geometry.reveal();
    expectViewportOwnership();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
  });
});
