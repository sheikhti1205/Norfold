// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchedProfile } from "@norfold/shared";
import { chatFileBody, type ChatFileMeta } from "../services/messaging/files";
import { ChatDock, openWindowLimit } from "./ChatDock";
import {
  clampChatDockCapacity, closeChatDock, closeChatDockEntry, closeChatDockSurface, focusChatDock,
  isChatDockDismissed, minimizeChatDock, openChatDock, openConversation, resetChatDock,
  resetChatDockDismissedForTests, restoreChatDock, useChatDock, type ChatDockEntry,
} from "./chatDock";

/**
 * Host acceptance for the chat windows.
 *
 * The canonical thread owns the transcript, receipts and every send. This suite
 * therefore replaces it with a stub that keeps its own draft and echoes the
 * frozen dock props, so a test can prove the host never remounts or re-enables
 * a thread, without pulling the real messaging runtime into a navigation test.
 * `ChatDock.integration.test.tsx` mounts the real adapter on top of this.
 */

type Summary = {
  conversationId: string;
  peerId: string;
  unreadCount: number;
  lastMessage: {
    id: string;
    authorId: string;
    body: string;
    messageType?: "TEXT" | "MEDIA" | "LOCATION" | "VOICE";
    unsentAt?: number;
  } | null;
  cachedProjection: Record<string, unknown> | null;
};

const meta: ChatFileMeta = {
  key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-report.pdf",
  name: "report.pdf",
  mime: "application/pdf",
  byteSize: 4096,
  kind: "pdf",
};
const thread = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
  byId: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("../screens/Messaging", () => ({
  ThreadSession: (props: {
    accountId: string; conversationId: string; surface?: string; active?: boolean;
    onToggleCompact?: () => void; onClose?: () => void; onExpand?: () => void;
  }) => {
    const [draft, setDraft] = useState("");
    const record = props as unknown as Record<string, unknown>;
    thread.props = record;
    thread.byId[props.conversationId] = record;
    return (
      <section className="fb-chat-page" aria-label={`Conversation ${props.conversationId}`}
        data-surface={props.surface} data-active={String(props.active)}>
        <header className="fb-chat-header">
          <h1>Thread {props.conversationId}</h1>
          <button type="button" aria-label={props.active ? "Collapse chat" : "Expand chat"}
            onClick={props.onToggleCompact}>collapse</button>
          <button type="button" aria-label="Open full chat" onClick={props.onExpand}>open</button>
          <button type="button" aria-label="Close chat" onClick={props.onClose}>close</button>
        </header>
        <input aria-label={`Message draft ${props.conversationId}`} value={draft}
          onChange={(event) => setDraft(event.target.value)} />
      </section>
    );
  },
}));

const auth = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null, booting: false, needsProfile: false,
}));
vi.mock("../auth", () => ({ useAuth: () => auth }));

const chat = vi.hoisted(() => ({
  accountId: "me" as string | null,
  status: "ready" as "opening" | "ready" | "offline" | "error",
  conversations: [] as Summary[],
  currentProjections: null as Record<string, Record<string, unknown>> | null,
}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => chat }));

const runtime = vi.hoisted(() => ({
  request: vi.fn(async (_accountId: string, _peerId: string) => "c-new"),
  refresh: vi.fn(async (_accountId: string) => undefined),
}));
vi.mock("../services/messaging/runtime", () => ({
  requestMessagingConversation: runtime.request,
  refreshMessaging: runtime.refresh,
}));

const people = vi.hoisted(() => ({
  results: [] as SearchedProfile[],
  search: vi.fn(async (_query: string) => ({ items: [] as SearchedProfile[], nextCursor: null })),
}));
vi.mock("../services/people", () => ({ searchPeople: people.search }));

type Identity = { id: string; username: string; displayName: string | null; avatarUrl: string | null };
const identities = vi.hoisted(() => ({ map: new Map<string, Identity>() }));
vi.mock("../services/accountLabels", () => ({
  readCachedAccountIdentities: () => identities.map,
  fetchAccountIdentities: async () => identities.map,
}));

const host = vi.hoisted(() => ({ occluded: false, bottomNav: true }));

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <ChatDock hostOccluded={host.occluded} bottomNavVisible={host.bottomNav} />
      <p data-testid="path">{location.pathname}</p>
      <button type="button" onClick={() => navigate("/chats/a")}>Go chat</button>
    </>
  );
}

function tree(entry = "/") {
  return <MemoryRouter initialEntries={[entry]}><Probe /></MemoryRouter>;
}
function mount(entry = "/") {
  return render(tree(entry));
}

function summary(conversationId: string, peerId: string, options: {
  unread?: number;
  author?: string;
  messageId?: string;
  body?: string;
  type?: "TEXT" | "MEDIA" | "LOCATION" | "VOICE";
  unsent?: boolean;
  view?: Record<string, unknown> | null;
} = {}): Summary {
  return {
    conversationId,
    peerId,
    unreadCount: options.unread ?? 0,
    lastMessage: options.author === undefined ? null : {
      id: options.messageId ?? `${conversationId}-m1`,
      authorId: options.author,
      body: options.body ?? "",
      messageType: options.type,
      unsentAt: options.unsent ? 1 : undefined,
    },
    cachedProjection: options.view ?? null,
  };
}

function named(peerId: string, label: string, username = label.toLowerCase().replace(/\s+/g, "")) {
  identities.map.set(peerId, { id: peerId, username, displayName: label, avatarUrl: null });
}

function panel() {
  return document.getElementById("fb-chat-dock");
}

function dockWindow(entry: string) {
  return document.querySelector<HTMLElement>(`.fb-chat-dock-window[data-entry="${entry}"]`);
}

function dockWindows() {
  return Array.from(document.querySelectorAll<HTMLElement>(".fb-chat-dock-window"));
}

function conversation(conversationId: string) {
  return screen.getByLabelText(`Conversation ${conversationId}`) as HTMLElement;
}

function rail() {
  return document.querySelector<HTMLElement>(".fb-chat-dock-rail");
}

function railHeads() {
  return Array.from(document.querySelectorAll<HTMLElement>(".fb-chat-dock-rail-head"));
}

/** The visible heads' conversation ids, top to bottom. */
function railEntries() {
  return railHeads().map((head) => head.dataset.entry);
}

/** The actions capsule; every rail test asserts it exists before using it. */
function strip() {
  return document.querySelector<HTMLElement>(".fb-chat-dock-rail-strip");
}

/** The resting circle; absent while the rail is open. */
function anchor() {
  return document.querySelector<HTMLElement>(".fb-chat-dock-rail-anchor");
}

function badge() {
  return document.querySelector<HTMLElement>(".fb-chat-dock-rail-badge");
}

/** Compose is the open rail's only way into the picker. From rest the circle
 *  opens the rail first; with the rail already open it is one press. */
function compose() {
  const circle = anchor();
  if (circle) fireEvent.click(circle);
  fireEvent.click(screen.getByRole("button", { name: /^Compose/ }));
}

/** Pick a person out of the picker's Recent list. */
function selectRecent(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Open conversation with ${label}`) }));
}

/** Compose, then open one existing conversation: the ordinary path to a window. */
function dockChat(label: string) {
  compose();
  selectRecent(label);
}

/** True when `a` precedes `b` in document order. */
function precedes(a: Node, b: Node) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function openUnread() {
  named("p1", "Alice");
  chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1" })];
  const view = mount("/");
  dockChat("Alice");
  return view;
}

beforeEach(() => {
  resetChatDock();
  resetChatDockDismissedForTests();
  viewport(1024, 768);
  auth.user = { id: "me" };
  auth.booting = false;
  auth.needsProfile = false;
  chat.accountId = "me";
  chat.status = "ready";
  chat.conversations = [];
  chat.currentProjections = null;
  host.occluded = false;
  host.bottomNav = true;
  runtime.request.mockReset();
  runtime.request.mockImplementation(async () => "c-new");
  runtime.refresh.mockReset();
  runtime.refresh.mockImplementation(async () => undefined);
  people.results = [];
  people.search.mockReset();
  people.search.mockImplementation(async () => ({ items: people.results, nextCursor: null }));
  identities.map = new Map();
  thread.props = null;
  thread.byId = {};
});

afterEach(cleanup);

describe("ChatDock route eligibility", () => {
  it("keeps the dock off every chat surface", () => {
    for (const path of ["/chats", "/chats/a", "/connections", "/connections/a"]) {
      mount(path);
      expect(rail()).toBeNull();
      expect(anchor()).toBeNull();
      expect(screen.queryByRole("button", { name: "Compose" })).toBeNull();
      cleanup();
    }
  });

  it("offers the dock on ordinary pages", () => {
    for (const path of ["/", "/search", "/my/1/edit"]) {
      mount(path);
      expect(screen.getByRole("button", { name: "Open chats" })).toBeTruthy();
      cleanup();
    }
  });

  it("hides the dock while the shell reports an occluding surface", () => {
    host.occluded = true;
    mount("/");
    expect(rail()).toBeNull();
    expect(screen.queryByRole("button", { name: "Compose" })).toBeNull();
  });
});

describe("ChatDock rail", () => {
  it("opens a conversation from Compose without reading, sending or navigating", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c0", "p0", { unread: 0, author: "p0" }),
      summary("c1", "p1", { unread: 2, author: "p1" })];
    mount("/");
    // The aggregate is the only unread cue on an empty dock, and it rides the
    // resting circle.
    expect(anchor()?.querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("1");
    compose();
    expect(screen.getByRole("heading", { name: "New message" })).toBeTruthy();
    selectRecent("Alice");
    expect(screen.getAllByLabelText(/^Conversation /)).toHaveLength(1);
    expect(thread.props).toMatchObject({ accountId: "me", conversationId: "c1", surface: "dock", active: true });
    expect(runtime.request).not.toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toBe("/");
  });

  it("opens the new-message picker from Compose without touching the unread", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    mount("/");
    compose();

    // The picker is the compose surface: no thread, no request, no send.
    expect(screen.getByRole("heading", { name: "New message" })).toBeTruthy();
    expect(screen.getByLabelText("Search people")).toBeTruthy();
    expect(screen.queryByLabelText(/^Conversation /)).toBeNull();
    expect(runtime.request).not.toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toBe("/");

    // Closing it restores the badge exactly as it was: opening a new message
    // never reads, sends or dismisses the existing unread row.
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(panel()).toBeNull();
    expect(badge()?.textContent).toBe("1");
    expect(screen.getByRole("button", { name: "Open chats, 1 waiting" })).toBeTruthy();
  });

  it("ignores an own last message, an unsent one and privacy-muted rows", () => {
    const cases: Array<{ rows: Summary[]; views?: Record<string, Record<string, unknown>> | null }> = [
      { rows: [summary("c1", "p1", { unread: 3, author: "me" })] },
      { rows: [summary("c1", "p1", { unread: 3, author: "p1", unsent: true })] },
      { rows: [summary("c1", "p1", { unread: 3, author: "p1" })], views: { c1: { ownMuted: true } } },
      { rows: [summary("c1", "p1", { unread: 3, author: "p1" })], views: { c1: { ownHidden: true } } },
      { rows: [summary("c1", "p1", { unread: 3, author: "p1" })], views: { c1: { ownDeclined: true } } },
      { rows: [summary("c1", "p1", { unread: 3, author: "p1" })], views: { c1: { ownBlocked: true } } },
      { rows: [summary("c1", "p1", { unread: 0, author: "p1" })] },
    ];
    for (const item of cases) {
      named("p1", "Alice");
      chat.conversations = item.rows;
      chat.currentProjections = item.views ?? null;
      mount("/");
      expect(badge()).toBeNull();
      expect(screen.getByRole("button", { name: "Open chats" })).toBeTruthy();
      cleanup();
    }
  });

  it("keeps every action in one capsule inside the rail, in order", () => {
    mount("/");
    act(() => openChatDock("me", null, "c1", 2));
    const capsule = strip() as HTMLElement;
    expect(capsule).toBeTruthy();
    expect(rail()?.contains(capsule)).toBe(true);
    // Compose, Minimize, Close — destructive last, and no second circle.
    expect(within(capsule).getAllByRole("button").map((node) => node.getAttribute("aria-label")))
      .toEqual(["Compose", "Minimize", "Close"]);
    expect(capsule.querySelector(".fb-chat-dock-rail-anchor")).toBeNull();
    expect(document.querySelector(".fb-chat-dock-utility-row")).toBeNull();
    expect(document.querySelector(".fb-chat-dock-rail-launcher")).toBeNull();
  });

  it("rests at the circle, then offers Compose alone when it is pressed", () => {
    mount("/");
    // Rest is the 48px circle in every case, even with nothing docked.
    const circle = anchor() as HTMLElement;
    expect(circle).toBeTruthy();
    expect(circle.getAttribute("aria-label")).toBe("Open chats");
    expect(strip()).toBeNull();

    fireEvent.click(circle);
    const capsule = strip() as HTMLElement;
    expect(capsule).toBeTruthy();
    expect(anchor()).toBeNull();
    // Nothing to minimize or close, so Compose is the only action.
    expect(within(capsule).getAllByRole("button").map((node) => node.getAttribute("aria-label")))
      .toEqual(["Compose"]);
    expect(within(capsule).getByRole("button", { name: "Compose" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Minimize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("keeps the count on the circle and never turns the pen into a number", () => {
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" })];
    mount("/");
    const circle = anchor() as HTMLElement;
    expect(circle.getAttribute("aria-label")).toBe("Open chats, 1 waiting");
    expect(circle.querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("1");
    expect(document.querySelectorAll(".fb-chat-dock-rail-badge")).toHaveLength(1);

    fireEvent.click(circle);
    const capsule = strip() as HTMLElement;
    expect(within(capsule).getByRole("button", { name: "Compose" })).toBeTruthy();
    expect(capsule.querySelector(".fb-chat-dock-rail-badge")).toBeNull();
    expect(document.querySelectorAll(".fb-chat-dock-rail-badge")).toHaveLength(0);
  });

  it("minimizes a window to a bubble and tucks the rail to the circle", () => {
    openUnread();
    const draft = screen.getByLabelText("Message draft c1");
    fireEvent.change(draft, { target: { value: "half a thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(thread.byId.c1?.active).toBe(false);
    expect(strip()).toBeNull();
    const circle = anchor() as HTMLElement;
    expect(circle).toBeTruthy();
    expect(circle.getAttribute("aria-label")).toBe("Open chats, 1 waiting");
    expect(circle.querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("1");

    // Parking, not dismissal: the circle brings the same bubble back, with the
    // draft untouched, because the thread was never unmounted.
    fireEvent.click(circle);
    expect(strip()).toBeTruthy();
    expect(railEntries()).toEqual(["c1"]);
    fireEvent.click(screen.getByRole("button", { name: "Restore chat with Alice" }));
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    expect(dockWindow("c1")?.hidden).toBe(false);
    expect(thread.byId.c1?.active).toBe(true);
    expect((screen.getByLabelText("Message draft c1") as HTMLInputElement).value).toBe("half a thought");
  });

  it("ends every window on Close and leaves the resting circle in the corner", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // Close ends the rail and every window, but the corner never goes empty:
    // the circle with its count is the way back in.
    expect(rail()).toBeTruthy();
    expect(panel()).toBeNull();
    expect(strip()).toBeNull();
    expect(screen.getByRole("button", { name: /^Open chats/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Compose/ })).toBeNull();
    expect(screen.queryByLabelText("Conversation c1")).toBeNull();
    // Close is a dismissal, not a parking space: Alice is remembered as
    // dismissed, so she cannot come back on her own.
    expect(isChatDockDismissed("me", "c1")).toBe(true);

    // The dismissal survives a genuine remount, and the circle is still there.
    cleanup();
    mount("/");
    expect(screen.getByRole("button", { name: /^Open chats/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore chat with/ })).toBeNull();

    // The circle re-opens the rail, and Compose is a pen — never a number.
    fireEvent.click(screen.getByRole("button", { name: /^Open chats/ }));
    expect(screen.getByRole("button", { name: /^Compose/ })).toBeTruthy();

    // Interaction re-enables her: opening a conversation clears the dismissal,
    // and minimizing it puts her back on the rail with a readable name.
    act(() => openChatDock("me", null, "c1", 2));
    act(() => minimizeChatDock("me", "c1"));
    expect(screen.getByRole("button", { name: /Restore chat with Alice/ })).toBeTruthy();
    act(() => resetChatDock());
    expect(screen.getByRole("button", { name: "Open chats, 1 waiting" })).toBeTruthy();
  });

  it("clears a dismissal persisted by an earlier visit before the rail reads it", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1" })];
    // A fresh page: no render has read the dismissal set yet, so the cache is
    // empty while localStorage still carries last visit's dismissal.
    resetChatDock();
    resetChatDockDismissedForTests();
    localStorage.setItem("fb-chat-dock-dismissed:me", JSON.stringify(["c1"]));
    mount("/");
    // Opening is interaction and must clear the stored flag even though nothing
    // has loaded the dismissal cache on this page yet. Before the fix the clear
    // was a no-op, and the first Minimize of that chat hid it for good.
    act(() => openChatDock("me", null, "c1", 2));
    act(() => minimizeChatDock("me", "c1"));
    expect(screen.getByRole("button", { name: /Restore chat with Alice/ })).toBeTruthy();
    expect(isChatDockDismissed("me", "c1")).toBe(false);
  });

  it("keeps the aggregate on the resting circle and never on Compose", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));

    // Tucked: one badge, on the circle, and no capsule.
    const circle = anchor() as HTMLElement;
    expect(circle.querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("1");
    expect(document.querySelectorAll(".fb-chat-dock-rail-badge")).toHaveLength(1);
    expect(strip()).toBeNull();

    // Open with a docked bubble: the bubble carries its own count, so the
    // capsule draws no aggregate of its own and Compose stays a pen.
    fireEvent.click(circle);
    const capsule = strip() as HTMLElement;
    expect(capsule.querySelector(".fb-chat-dock-rail-badge")).toBeNull();
    expect(within(capsule).getByRole("button", { name: "Compose" })).toBeTruthy();
    expect((railHeads()[0] as HTMLElement).querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("2");
    expect(document.querySelectorAll(".fb-chat-dock-rail-badge")).toHaveLength(1);

    // Emptied: the same aggregate returns to the circle, still the only badge.
    act(() => closeChatDockEntry("me", "c1"));
    const emptied = anchor() as HTMLElement;
    expect(emptied).toBeTruthy();
    expect(strip()).toBeNull();
    expect(emptied.querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("1");
    expect(document.querySelectorAll(".fb-chat-dock-rail-badge")).toHaveLength(1);
  });

  it("folds an open window when the page is pressed and keeps the rail open", () => {
    openUnread();
    expect(dockWindow("c1")?.dataset.phase).toBe("open");

    fireEvent.pointerDown(document.body);
    // Folded, not dismissed, and the rail never leaves the corner.
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(strip()).toBeTruthy();
    expect(railEntries()).toEqual(["c1"]);
    expect(isChatDockDismissed("me", "c1")).toBe(false);

    // The pointerdown that restores a bubble is inside the dock and never folds
    // the window it is about to open.
    const head = screen.getByRole("button", { name: "Restore chat with Alice" });
    fireEvent.pointerDown(head);
    fireEvent.click(head);
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    expect(dockWindow("c1")?.hidden).toBe(false);
  });

  it("moves focus with the rail when a keyboard user opens and tucks it", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    // The pressed control unmounted: focus lands on the circle that replaced it.
    expect(anchor()).toBeTruthy();
    expect(document.activeElement).toBe(anchor());

    fireEvent.click(anchor() as HTMLElement);
    const capsule = strip() as HTMLElement;
    expect(capsule).toBeTruthy();
    expect(document.activeElement).toBe(within(capsule).getByRole("button", { name: /^Compose/ }));
  });

  it("docks one person once and keeps counting her unread", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    mount("/");
    dockChat("Alice");
    // An open window is not also painted as a bubble beside itself.
    expect(railHeads()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Restore chat with Alice/ })).toBeNull();
    // The badge still counts her: she messaged, and the count is not a choice.
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect((anchor() as HTMLElement).querySelector(".fb-chat-dock-rail-badge")?.textContent).toBe("1");
  });

  it("keeps every other conversation reachable from Compose while one is docked", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [
      summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" }),
      summary("c2", "p2", { unread: 1, author: "p2", messageId: "m2" }),
    ];
    mount("/");
    dockChat("Alice");
    expect(dockWindow("c1")?.dataset.phase).toBe("open");

    compose();
    expect(screen.getByRole("button", { name: /^Open conversation with Bob/ })).toBeTruthy();
    selectRecent("Bob");
    expect(dockWindow("picker")).toBeNull();
    expect(dockWindow("c2")?.dataset.phase).toBe("open");
    expect(conversation("c2").dataset.active).toBe("true");
  });

  it("counts distinct unread people, capped at 99+, and draws nothing at zero", () => {
    // Zero unread: no badge element at all.
    mount("/");
    expect(badge()).toBeNull();
    cleanup();

    // Two distinct unread conversations: badge shows "2".
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [
      summary("c1", "p1", { unread: 2, author: "p1" }),
      summary("c2", "p2", { unread: 5, author: "p2" }),
    ];
    mount("/");
    expect(badge()?.textContent).toBe("2");
    cleanup();

    // 100 distinct unread conversations: "99+".
    chat.conversations = Array.from({ length: 100 }, (_, i) =>
      summary(`c${i}`, `p${i}`, { unread: 1, author: `p${i}` }),
    );
    mount("/");
    expect(badge()?.textContent).toBe("99+");
  });

  it("never paints the previous account's label after a viewer switch", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1", body: "Hi" })];
    const view = mount("/");
    compose();
    expect(screen.getByRole("button", { name: /^Open conversation with Alice/ })).toBeTruthy();

    // The same peer id under a viewer with no cached label must not inherit the
    // previous account's identity for even one render.
    auth.user = { id: "other" };
    chat.accountId = "other";
    identities.map = new Map();
    chat.conversations = [summary("c2", "p1", { unread: 1, author: "p1", body: "Hi" })];
    view.rerender(tree());
    expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();

    compose();
    expect(screen.getByRole("button", { name: /^Open conversation with Member/ })).toBeTruthy();
  });
});

describe("ChatDock Compose toggle", () => {
  it("opens the picker on the first press and closes it on the second, never more than once", () => {
    mount("/");
    expect(dockWindow("picker")).toBeNull();
    expect(document.querySelectorAll(".fb-chat-dock-window[data-entry='picker']")).toHaveLength(0);

    compose();
    expect(screen.getByRole("heading", { name: "New message" })).toBeTruthy();
    expect(dockWindow("picker")?.dataset.view).toBe("picker");
    expect(dockWindow("picker")?.dataset.phase).toBe("open");
    expect(document.querySelectorAll(".fb-chat-dock-window[data-entry='picker']")).toHaveLength(1);

    // A second press on the same action closes the picker instead of opening
    // another one.
    compose();
    expect(dockWindow("picker")).toBeNull();
    expect(document.querySelectorAll(".fb-chat-dock-window[data-entry='picker']")).toHaveLength(0);
    // The emptied dock falls back to the circle that carries the count.
    expect(screen.getByRole("button", { name: /^Open chats/ })).toBeTruthy();

    // It opens again, still exactly one entry.
    compose();
    expect(dockWindow("picker")?.dataset.view).toBe("picker");
    expect(document.querySelectorAll(".fb-chat-dock-window[data-entry='picker']")).toHaveLength(1);
  });
});

describe("ChatDock panel", () => {
  it("is a non-modal complementary window with one thread", () => {
    openUnread();
    expect(screen.getByRole("complementary", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByLabelText(/^Conversation /)).toHaveLength(1);
    expect(dockWindow("c1")?.dataset.view).toBe("thread");
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
  });

  it("minimises to a rail head without unmounting the thread or losing the draft", () => {
    openUnread();
    const draft = screen.getByLabelText("Message draft c1");
    fireEvent.change(draft, { target: { value: "half a thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));

    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(thread.byId.c1?.active).toBe(false);
    expect(railEntries()).toEqual(["c1"]);
    expect(screen.getByRole("button", { name: "Restore chat with Alice" })).toBeTruthy();
    const kept = screen.getByLabelText("Message draft c1");
    expect(kept).toBe(draft);
    expect((kept as HTMLInputElement).value).toBe("half a thought");

    fireEvent.click(screen.getByRole("button", { name: "Restore chat with Alice" }));
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    expect(dockWindow("c1")?.hidden).toBe(false);
    expect(thread.byId.c1?.active).toBe(true);
    // The rail still renders (it holds the capsule) but carries no heads.
    expect(strip()).toBeTruthy();
    expect(railHeads()).toHaveLength(0);
    expect(screen.getByLabelText("Message draft c1")).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("half a thought");
  });

  it("stays mounted but inactive and hidden on a chat route", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Go chat" }));
    expect(screen.getByTestId("path").textContent).toBe("/chats/a");
    expect(panel()?.hidden).toBe(true);
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(thread.byId.c1?.active).toBe(false);
    expect(screen.getByLabelText("Message draft c1")).toBeTruthy();
    expect(rail()).toBeNull();
  });

  it("stays mounted but inactive while the shell is occluded", () => {
    const view = openUnread();
    host.occluded = true;
    view.rerender(tree());
    expect(panel()?.hidden).toBe(true);
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(thread.byId.c1?.active).toBe(false);
    expect(screen.getByLabelText("Message draft c1")).toBeTruthy();
    expect(rail()).toBeNull();
  });

  it("returns to the circle when the thread closes itself", () => {
    openUnread();
    fireEvent.click(within(conversation("c1")).getByRole("button", { name: "Close chat" }));
    expect(panel()).toBeNull();
    // The last thread's close leaves nothing docked, and the corner falls back
    // to the circle that carries the count.
    expect(strip()).toBeNull();
    expect(screen.getByRole("button", { name: "Open chats, 1 waiting" })).toBeTruthy();
  });

  it("expands to the canonical route without leaving a second transcript", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));
    expect(screen.getByTestId("path").textContent).toBe("/chats/c1");
    expect(screen.queryByLabelText("Conversation c1")).toBeNull();
    // The chat route owns the conversation; the dock stands down there.
    expect(rail()).toBeNull();
  });

  it("drops every window and its account when the viewer changes", () => {
    const view = openUnread();
    act(() => openChatDock("me", null, "c2", 2));
    auth.user = { id: "other" };
    view.rerender(tree());
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Open chats" })).toBeTruthy();
  });
});

describe("ChatDock windows", () => {
  it("keeps two conversations open and gives the active lease to the last focus", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    dockChat("Alice");

    // Compose stays in the capsule while a window is open: it is the only
    // surface that can open a second conversation.
    compose();
    selectRecent("Bob");
    expect(dockWindow("picker")).toBeNull();
    expect(dockWindows()).toHaveLength(2);
    expect(conversation("c1").dataset.active).toBe("false");
    expect(conversation("c2").dataset.active).toBe("true");

    // Pressing inside a window takes focus, and only one window owns the lease.
    fireEvent.pointerDown(conversation("c1"));
    expect(conversation("c1").dataset.active).toBe("true");
    expect(conversation("c2").dataset.active).toBe("false");
  });

  it("names the header toggle for what it does on an unfocused window", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    dockChat("Alice");
    act(() => openChatDock("me", null, "c2", 2));

    // Only the window holding the lease offers Collapse. The other is open but
    // unfocused, so its control says what pressing it does.
    expect(conversation("c2").dataset.active).toBe("true");
    fireEvent.click(within(conversation("c1")).getByRole("button", { name: "Expand chat" }));

    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    expect(dockWindow("c1")?.hidden).toBe(false);
    expect(conversation("c1").dataset.active).toBe("true");
    expect(conversation("c2").dataset.active).toBe("false");
  });

  it("restores a minimized head beside the open window", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    dockChat("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));

    compose();
    selectRecent("Bob");
    expect(dockWindow("picker")).toBeNull();
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Restore chat with Alice" }));
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");
    expect(conversation("c1").dataset.active).toBe("true");
    expect(conversation("c2").dataset.active).toBe("false");
  });

  it("closes only the window it belongs to", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    dockChat("Alice");
    act(() => openChatDock("me", null, "c2", 2));

    fireEvent.click(within(conversation("c1")).getByRole("button", { name: "Close chat" }));
    expect(dockWindow("c1")).toBeNull();
    expect(dockWindow("c2")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Chat" })).toBeTruthy();
  });

  it("minimizes the least recently focused window when capacity is exceeded", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    named("p3", "Cleo");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }),
      summary("c2", "p2"), summary("c3", "p3")];
    mount("/");
    dockChat("Alice");
    act(() => openChatDock("me", null, "c2", 2));
    act(() => openChatDock("me", null, "c3", 2));

    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");
    expect(dockWindow("c3")?.dataset.phase).toBe("open");
    expect(conversation("c3").dataset.active).toBe("true");
    expect(railHeads()).toHaveLength(1);
  });

  it("pages the rail with a +N counter at both ends", () => {
    mount("/");
    act(() => {
      for (let index = 1; index <= 8; index += 1) openChatDock("me", null, `c${index}`, 8);
    });
    act(() => {
      for (let index = 1; index <= 8; index += 1) minimizeChatDock("me", `c${index}`);
    });

    // Newest nearest the capsule: c4..c8 with the older three hidden above.
    expect(railEntries()).toEqual(["c4", "c5", "c6", "c7", "c8"]);
    expect(screen.queryByRole("button", { name: /newer minimized/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Show 3 older minimized chats" })).toBeTruthy();

    // Paging upward reveals the older batch; the newer three now hide below.
    fireEvent.click(screen.getByRole("button", { name: "Show 3 older minimized chats" }));
    expect(railEntries()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(screen.getByRole("button", { name: "Show 3 newer minimized chats" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /older minimized/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 3 newer minimized chats" }));
    expect(railEntries()).toEqual(["c4", "c5", "c6", "c7", "c8"]);
    expect(screen.getByRole("button", { name: "Show 3 older minimized chats" })).toBeTruthy();
  });

  it("stacks the counters and heads above one capsule in the corner", () => {
    viewport(1024, 768);
    mount("/");
    act(() => {
      for (let index = 1; index <= 8; index += 1) openChatDock("me", null, `c${index}`, 8);
    });
    act(() => {
      for (let index = 1; index <= 8; index += 1) minimizeChatDock("me", `c${index}`);
    });

    const stack = document.querySelector<HTMLElement>(".fb-chat-dock-rail-stack");
    const capsule = strip() as HTMLElement;
    const older = screen.getByRole("button", { name: "Show 3 older minimized chats" });
    const heads = railHeads();
    expect(stack).toBeTruthy();
    expect(heads).toHaveLength(5);
    expect(within(capsule).getAllByRole("button").map((node) => node.getAttribute("aria-label")))
      .toEqual(["Compose", "Minimize", "Close"]);

    // The older counter is the stack's top, then the heads, then the capsule.
    // There is no second circle beside the capsule.
    expect(precedes(older, heads[0] as Node)).toBe(true);
    expect(precedes(heads[heads.length - 1] as Node, capsule)).toBe(true);
    expect(anchor()).toBeNull();

    // Paging to the older batch puts the newer counter below the last head and
    // still above the capsule.
    fireEvent.click(older);
    const newer = screen.getByRole("button", { name: "Show 3 newer minimized chats" });
    const olderHeads = railHeads();
    expect(precedes(olderHeads[olderHeads.length - 1] as Node, newer)).toBe(true);
    expect(precedes(newer, capsule)).toBe(true);
  });

  it("never puts the new-message chooser on the rail", () => {
    mount("/");
    compose();
    // The rail renders (it holds the capsule) but the new-message chooser is
    // never a rail head.
    expect(railHeads()).toHaveLength(0);
    expect(dockWindow("picker")?.dataset.view).toBe("picker");

    act(() => minimizeChatDock("me", null));
    expect(railHeads()).toHaveLength(0);
    expect(dockWindow("picker")?.hidden).toBe(false);
  });

  it("paints nothing on a phone, open windows or not", () => {
    viewport(375, 700);
    mount("/");
    act(() => openChatDock("me", null, "c1", 1));
    act(() => openChatDock("me", null, "c2", 1));
    expect(rail()).toBeNull();
    expect(anchor()).toBeNull();
    expect(panel()).toBeNull();
    expect(dockWindow("c1")).toBeNull();
    expect(dockWindow("c2")).toBeNull();

    viewport(1024, 768);
    act(() => { fireEvent.resize(window); });
    // Back on the desktop the same mounts paint again, untouched.
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");
    expect(rail()).toBeTruthy();
  });

  it("keeps the visible batch identical when a newer head appears while paged older (batch stability)", () => {
    viewport(1024, 768); // batch = 5
    mount("/");
    act(() => {
      for (let index = 1; index <= 8; index += 1) openChatDock("me", null, `c${index}`, 8);
    });
    act(() => {
      for (let index = 1; index <= 8; index += 1) minimizeChatDock("me", `c${index}`);
    });

    // Newest nearest the capsule: c4..c8 visible, c1..c3 hidden above.
    expect(railEntries()).toEqual(["c4", "c5", "c6", "c7", "c8"]);
    expect(screen.getByRole("button", { name: "Show 3 older minimized chats" })).toBeTruthy();

    // Page to the older batch.
    fireEvent.click(screen.getByRole("button", { name: "Show 3 older minimized chats" }));
    expect(railEntries()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(screen.getByRole("button", { name: "Show 3 newer minimized chats" })).toBeTruthy();

    // A newly minimized chat joins the newest end; the visible batch must not slide.
    act(() => openChatDock("me", null, "c9", 8));
    act(() => minimizeChatDock("me", "c9"));
    expect(railEntries()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    // Only the hidden-count counters changed: c6..c9 are now below.
    expect(screen.getByRole("button", { name: "Show 4 newer minimized chats" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /older minimized/ })).toBeNull();

    // Paging back to the newest batch shows the new head.
    fireEvent.click(screen.getByRole("button", { name: "Show 4 newer minimized chats" }));
    expect(railEntries()).toEqual(["c5", "c6", "c7", "c8", "c9"]);
  });

  it("keeps the visible batch identical on the newest batch when a new head appears", () => {
    viewport(1024, 768); // batch = 5
    mount("/");
    act(() => {
      for (let index = 1; index <= 5; index += 1) openChatDock("me", null, `c${index}`, 5);
    });
    act(() => {
      for (let index = 1; index <= 5; index += 1) minimizeChatDock("me", `c${index}`);
    });

    // Sitting on the newest batch: c1..c5 visible.
    expect(railEntries()).toEqual(["c1", "c2", "c3", "c4", "c5"]);

    // A new head appears at the newest end and is visible.
    act(() => openChatDock("me", null, "c6", 5));
    act(() => minimizeChatDock("me", "c6"));
    expect(railEntries()).toEqual(["c2", "c3", "c4", "c5", "c6"]);
  });

  it("leaves the other docked chat alone when one window closes itself", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    dockChat("Alice");
    // Limit 1 forces c1 (the only other open window) to fold to a rail head,
    // leaving c2 as the open floating window.
    act(() => openChatDock("me", null, "c2", 1));
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");

    fireEvent.click(within(conversation("c2")).getByRole("button", { name: "Close chat" }));
    expect(dockWindow("c2")).toBeNull();
    expect(screen.getByRole("button", { name: /Restore chat with Alice/ })).toBeTruthy();
  });

  it("Close removes every head and every window", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    dockChat("Alice");
    // Limit 1 folds c1 to a rail head so c2 becomes the open floating window.
    act(() => openChatDock("me", null, "c2", 1));
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dockWindow("c1")).toBeNull();
    expect(dockWindow("c2")).toBeNull();
    expect(panel()).toBeNull();
    // Close ends the windows and their heads, not the way in: the resting
    // circle stays in the corner.
    expect(railHeads()).toHaveLength(0);
    expect(strip()).toBeNull();
    expect(screen.getByRole("button", { name: /^Open chats/ })).toBeTruthy();
  });
});

describe("ChatDock picker", () => {
  it("lists ordinary eligible conversations, not unread-only ones", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    named("p3", "Cleo");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1" }),
      summary("c2", "p2", { unread: 0, author: "p2" }), summary("c3", "p3", { unread: 0, author: "p3" })];
    chat.currentProjections = { c2: { ownMuted: true }, c3: { ownHidden: true } };
    mount("/");
    compose();
    expect(screen.getByRole("heading", { name: "New message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open conversation with Alice" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bob/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cleo/ })).toBeNull();
  });

  it("shows the canonical one-line preview in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "Hello there" })];
    mount("/");
    compose();
    expect(screen.getByText("Hello there")).toBeTruthy();
  });

  it("never shows a serialized file marker or storage path in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", {
      unread: 0, author: "p1", body: chatFileBody(meta, "Here is the report"),
    })];
    mount("/");
    compose();
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.queryByText(/norfold-file:/)).toBeNull();
    expect(screen.queryByText(/files\/u-1/)).toBeNull();
  });

  it("names a malformed or future file marker as File in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "norfold-file:v2:AAAA" })];
    mount("/");
    compose();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.queryByText(/norfold-file:/)).toBeNull();
  });

  it("keeps the existing typed and honest expressive preview copy in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "", type: "VOICE" })];
    mount("/");
    compose();
    expect(screen.getByText("Voice message")).toBeTruthy();

    cleanup();
    resetChatDock();
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "https://media.klipy.com/a.gif" })];
    mount("/");
    compose();
    expect(screen.getByText("Sticker/GIF")).toBeTruthy();

    cleanup();
    resetChatDock();
    chat.conversations = [summary("c1", "p1", {
      unread: 0, author: "p1", body: "https://media.klipy.com/a.gif#norfold-media=gif",
    })];
    mount("/");
    compose();
    expect(screen.getByText("GIF")).toBeTruthy();
  });

  it("selects an existing conversation without a request, navigation or send", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1" })];
    mount("/");
    compose();
    selectRecent("Alice");
    expect(runtime.request).not.toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(screen.getByLabelText("Conversation c1")).toBeTruthy();
    expect(thread.props).toMatchObject({ accountId: "me", conversationId: "c1", surface: "dock", active: true });
  });

  it("starts a new conversation through the canonical request and opens it", async () => {
    people.results = [{ id: "p9", username: "sam", displayName: "Sam", avatarUrl: null }];
    runtime.request.mockResolvedValue("c-new");
    mount("/");
    compose();
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "sam" } });
    fireEvent.click(await screen.findByRole("button", { name: "Message Sam" }));
    await waitFor(() => expect(screen.getByLabelText("Conversation c-new")).toBeTruthy());
    expect(runtime.request).toHaveBeenCalledTimes(1);
    expect(runtime.request).toHaveBeenCalledWith("me", "p9");
    expect(screen.getByTestId("path").textContent).toBe("/");
  });

  it("asks the runtime to open before offering a conversation, and sends nothing", async () => {
    chat.status = "offline";
    people.results = [{ id: "p9", username: "sam", displayName: "Sam", avatarUrl: null }];
    mount("/");
    compose();
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "sam" } });
    fireEvent.click(await screen.findByRole("button", { name: "Message Sam" }));
    expect(screen.getByText("You're offline. Check your connection, then tap again.")).toBeTruthy();
    expect(runtime.refresh).toHaveBeenCalledTimes(1);
    expect(runtime.request).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^Conversation /)).toBeNull();
  });

  it("never opens a window for a request that finishes after the picker closed", async () => {
    let settle: ((id: string) => void) | null = null;
    runtime.request.mockImplementation(() => new Promise<string>((resolve) => { settle = resolve; }));
    people.results = [{ id: "p9", username: "sam", displayName: "Sam", avatarUrl: null }];
    mount("/");
    compose();
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "sam" } });
    fireEvent.click(await screen.findByRole("button", { name: "Message Sam" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(panel()).toBeNull();
    await act(async () => { settle?.("c-late"); await Promise.resolve(); });
    expect(screen.queryByLabelText("Conversation c-late")).toBeNull();
    expect(screen.getByRole("button", { name: /^Open chats/ })).toBeTruthy();
  });
});

// Vitest runs with `apps/mobile` as its cwd; a jsdom module has no file: URL.
const dockCss = readFileSync("src/components/ChatDock.css", "utf8");

describe("ChatDock surface sizing", () => {
  it("marks the picker window as the picker until a conversation takes it over", () => {
    mount("/");
    compose();
    expect(dockWindow("picker")?.dataset.view).toBe("picker");
    expect(dockWindow("picker")?.dataset.phase).toBe("open");

    cleanup();
    resetChatDock();
    openUnread();
    expect(dockWindow("c1")?.dataset.view).toBe("thread");
  });

  it("sizes the windows, the rail and the picker from their declarations", () => {
    const clean = dockCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    const picker = /\.fb-chat-dock-window\[data-view="picker"\]\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(picker).not.toBe("");
    // A definite four-to-five-row frame; the sixth row scrolls in the body.
    expect(picker).toMatch(/height:\s*clamp\(\s*23rem\s*,\s*52dvh\s*,\s*28rem\s*\)/);
    const cap = Number(/(?:^|[;\s])max-height\s*:\s*min\(\s*([\d.]+)rem\s*,/.exec(picker)?.[1] ?? NaN);
    expect(cap).toBeGreaterThanOrEqual(25);
    expect(cap).toBeLessThanOrEqual(30);
    // The viewport bound and the shared width are the ones the window already had.
    expect(picker).toContain("var(--fb-dock-bottom)");

    // A transcript window keeps its 24rem card beside its neighbours; the
    // picker is the thinner 20rem chooser.
    const windowRule = /(?:^|\})\s*\.fb-chat-dock-window\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(windowRule).toContain("height: min(34rem");
    expect(windowRule).toContain("width: min(24rem");
    expect(picker).toContain("width: min(20rem");

    // The host is a bottom-right row, not a panel.
    const hostRow = /\.fb-chat-dock-stack\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(hostRow).toContain("flex-direction: row");
    expect(hostRow).toContain("gap: 12px");
    expect(hostRow).toContain("align-items: flex-end");

    // The rail is one vertical column at the corner: an 8px rhythm and the same
    // shared bottom inset the window row uses.
    const railRule = /(?:^|\})\s*\.fb-chat-dock-rail\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(railRule).toContain("flex-direction: column");
    expect(railRule).toContain("align-items: flex-end");
    expect(railRule).toContain("gap: 8px");
    expect(railRule).toContain("inset-block-end");
    const stack = /\.fb-chat-dock-rail-stack\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(stack).toContain("flex-direction: column");
    expect(stack).toContain("gap: 8px");

    // The rest state is the shipped 48px circle.
    const circle = /\.fb-chat-dock-rail-anchor\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(circle).toContain("width: 48px");
    expect(circle).toContain("height: 48px");
    expect(circle).toContain("border-radius: 999px");
    const head = /\.fb-chat-dock-rail-head\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(head).toContain("width: 48px");
    expect(head).toContain("height: 48px");
    expect(head).toContain("border-radius: 999px");
    // The page counter is a small counter at the stack's end, not a head.
    const more = /\.fb-chat-dock-rail-more\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(more).toContain("min-width: 34px");
    expect(more).toContain("height: 28px");

    // The capsule copies the notification rail: 34px actions, 2px gaps, 4px
    // padding, hairline border, the same two-layer shadow.
    const capsule = /\.fb-chat-dock-rail-strip\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(capsule).toContain("gap: 2px");
    expect(capsule).toContain("padding: 4px");
    expect(capsule).toContain("border-radius: 999px");
    expect(capsule).toContain("box-shadow: 0 10px 28px -10px #0000004d, 0 2px 8px #0000001f");
    expect(capsule).toContain("transform-origin: right center");
    const action = /\.fb-chat-dock-rail-action\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(action).toContain("width: 34px");
    expect(action).toContain("height: 34px");
    // One tooltip system for the whole rail: the capsule's names come from the
    // shared HoverLabel, exactly as the bubbles' do, so there is no bespoke
    // name pill rule to drift out of step with it.
    expect(clean).not.toContain(".fb-chat-dock-rail-name");

    // A coarse pointer widens the capsule to three 48px actions, so the window
    // row reserves the wider clearance on the same two elements.
    const coarseAt = clean.indexOf("@media (hover: none), (pointer: coarse)");
    expect(coarseAt).toBeGreaterThan(-1);
    const coarse = clean.slice(coarseAt, clean.indexOf("\n}", coarseAt));
    expect(coarse).toContain("--fb-dock-window-clearance: 196px");

    // The window row sits beside the rail and reserves the widest capsule.
    const panelRule = /(?:^|\})\s*\.fb-chat-dock\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(panelRule).toContain("inset-block-end: calc(var(--fb-dock-bottom) + var(--fb-dock-composer))");
    // The clearance already counts the standard 12px inset, so the row adds
    // only the safe-area excess: 12 + 122 + 8 in an ordinary window.
    expect(panelRule).toContain("inset-inline-end: calc(var(--fb-dock-edge) + var(--fb-dock-window-clearance) - 12px)");
    expect(clean).toContain("--fb-dock-window-clearance: 142px");
    expect(clean).toContain("--fb-dock-edge: max(12px");

    // Only the picker body scrolls; the picker itself never clips a menu.
    const body = /\.fb-chat-dock-body\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(body).toContain("overflow-y: auto");
  });

  it("paints the badge inside the circle's own rim, clear of the 22px glyph", () => {
    const clean = dockCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    // The only badge in the rail lives on the resting circle. -2px keeps it on
    // the rim; the 22px glyph is centred, so an 18px badge never covers it.
    const base = /\.fb-chat-dock-rail-badge\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(base).toContain("inset-block-start: -2px");
    expect(base).toContain("inset-inline-end: -2px");
    // No capsule-corner variant exists: a number never replaces the pen.
    expect(clean).not.toContain(".fb-chat-dock-rail-badge-corner");
  });

  it("caps the window and the chooser at a compact share of a short viewport", () => {
    const clean = dockCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    const windowRule = /(?:^|\})\s*\.fb-chat-dock-window\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    // 544px stays the ceiling, never the target: at 720px of viewport the card
    // is two thirds, not 76%, and 6rem of page plus both
    // insets always remain.
    expect(windowRule).toContain("height: min(34rem, 66dvh");
    expect(windowRule).toContain("calc(100dvh - 2 * var(--fb-dock-bottom) - 6rem)");
    expect(720 * 0.66).toBeLessThan(544);

    const picker = /\.fb-chat-dock-window\[data-view="picker"\]\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    const frame = /height:\s*clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)dvh\s*,\s*([\d.]+)rem\s*\)/.exec(picker);
    expect(frame).not.toBeNull();
    const [, low = "", share = "", high = ""] = frame ?? [];
    // Four to five 52px rows inside ~158px of chrome (52px header, 48px search
    // with its 8px gap, the Recent label and the body padding) at the heights
    // tested. Static arithmetic over the declarations, not layout.
    const chrome = 158;
    for (const height of [720, 800, 900]) {
      const box = Math.min(Math.max(Number(low) * 16, height * Number(share) / 100), Number(high) * 16);
      const rows = (box - chrome) / 52;
      expect(rows, `${height}px`).toBeGreaterThanOrEqual(4);
      expect(rows, `${height}px`).toBeLessThan(6);
    }
  });
});

type Box = { top: number; bottom: number; left: number; right: number };

function rectOf(box: Box): DOMRect {
  return {
    x: box.left, y: box.top, top: box.top, bottom: box.bottom,
    left: box.left, right: box.right,
    width: box.right - box.left, height: box.bottom - box.top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * jsdom has no layout, so the two boxes the clearance reads are supplied here.
 * The rail's box is the one the declarations produce: a test that moves it
 * after a lift models the real element, and that is what proves a repeated
 * measurement cannot compound into a climb.
 */
function stubDockBoxes(railBox: Box, composer: Box) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("fb-chat-dock-rail")) return rectOf(railBox);
    if (this.classList.contains("fb-comment-composer")) return rectOf(composer);
    return rectOf({ top: 0, bottom: 0, left: 0, right: 0 });
  });
}

/** The observer the dock creates, with a handle to fire its callback. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe = (target: Element) => { this.targets.add(target); };
  unobserve = (target: Element) => { this.targets.delete(target); };
  disconnect = () => { this.targets.clear(); };
}

function pageComposer() {
  const composer = document.createElement("div");
  composer.className = "fb-comment-composer";
  document.body.appendChild(composer);
  return composer;
}

function railNode() {
  return document.querySelector<HTMLElement>(".fb-chat-dock-rail");
}

function clearanceOf(node: HTMLElement | null) {
  return node?.style.getPropertyValue("--fb-composer-clearance") ?? "";
}

describe("ChatDock page composer clearance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.querySelectorAll(".fb-comment-composer").forEach((node) => node.remove());
  });

  it("paints no dock chrome at phone widths, so no composer-clearance surface exists", () => {
    for (const width of [320, 390]) {
      viewport(width, 844);
      pageComposer();
      stubDockBoxes(
        { top: 780, bottom: 832, left: width - 64, right: width - 12 },
        { top: 780, bottom: 844, left: 0, right: width },
      );
      mount("/");
      // Below the desktop threshold nothing of the dock renders: no rail, no
      // anchor, no capsule and no panel — so there is no lift surface at all,
      // nothing to clear and nothing to compound.
      expect(rail()).toBeNull();
      expect(anchor()).toBeNull();
      expect(strip()).toBeNull();
      expect(panel()).toBeNull();
      expect(clearanceOf(railNode())).toBe("");
      cleanup();
      vi.restoreAllMocks();
      document.querySelectorAll(".fb-comment-composer").forEach((node) => node.remove());
    }
  });

  it("leaves the rail alone when the composer is outside its column", () => {
    viewport(1024, 768);
    pageComposer();
    // A centred 44rem readable column: the rail is not over it.
    stubDockBoxes(
      { top: 704, bottom: 756, left: 960, right: 1012 },
      { top: 690, bottom: 768, left: 160, right: 864 },
    );
    mount("/");
    expect(clearanceOf(railNode())).toBe("");
  });

  it("observes the composer and turns a taller box into a taller lift, once", () => {
    viewport(1024, 768);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    FakeResizeObserver.instances = [];
    const composer = pageComposer();
    const railBox: Box = { top: 780, bottom: 832, left: 960, right: 1012 };
    const box: Box = { top: 780, bottom: 844, left: 0, right: 1024 };
    stubDockBoxes(railBox, box);
    mount("/");
    act(() => openChatDock("me", null, "c1", 2));
    act(() => minimizeChatDock("me", "c1"));
    expect(clearanceOf(railNode())).toBe("60px");

    const observer = FakeResizeObserver.instances.at(-1);
    expect(observer?.targets.has(composer)).toBe(true);

    // The composer grew and the rail sits where the first lift put it.
    box.top = 700;
    railBox.top = 720;
    railBox.bottom = 772;
    act(() => observer?.callback());
    expect(clearanceOf(railNode())).toBe("140px");

    // The measured box carries that lift, so it is taken back out: a second
    // observation of the same boxes keeps the same clearance.
    railBox.top = 640;
    railBox.bottom = 692;
    act(() => observer?.callback());
    expect(clearanceOf(railNode())).toBe("140px");
  });

  it("never counts the dock's own composer as the page composer", () => {
    viewport(1024, 768);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    FakeResizeObserver.instances = [];
    // This box would shift the rail 74px if it were counted.
    stubDockBoxes(
      { top: 704, bottom: 756, left: 960, right: 1012 },
      { top: 690, bottom: 768, left: 900, right: 1024 },
    );
    mount("/");
    act(() => openChatDock("me", null, "c1", 2));
    const dockComposer = document.createElement("div");
    dockComposer.className = "fb-comment-composer";
    panel()?.appendChild(dockComposer);
    const observer = FakeResizeObserver.instances.at(-1);
    act(() => observer?.callback());
    expect(observer?.targets.has(dockComposer)).toBe(false);
    expect(clearanceOf(railNode())).toBe("");
  });

  it("paints nothing at phone widths even with a mounted thread", () => {
    viewport(390, 844);
    pageComposer();
    stubDockBoxes(
      { top: 780, bottom: 832, left: 326, right: 378 },
      { top: 780, bottom: 844, left: 0, right: 390 },
    );
    mount("/");
    act(() => openChatDock("me", null, "c1", 1));
    // A mounted thread stays alive in the store but is not painted on a phone:
    // no rail, no anchor, no capsule and no panel, so no lift surface.
    expect(rail()).toBeNull();
    expect(anchor()).toBeNull();
    expect(strip()).toBeNull();
    expect(panel()).toBeNull();
    expect(clearanceOf(railNode())).toBe("");
  });
});

describe("chatDock store", () => {
  function StoreProbe({ viewer }: { viewer: string | null }) {
    const state = useChatDock(viewer);
    const focused = state?.entries
      .filter((entry) => entry.phase === "open")
      .reduce<ChatDockEntry | null>((best, entry) => (
        best === null || entry.seq > best.seq ? entry : best
      ), null) ?? null;
    const list = state
      ? state.entries.map((entry) => `${entry.conversationId ?? "-"}:${entry.phase}`).join(",") || "empty"
      : "null";
    return <output data-testid={`state-${viewer ?? "signed-out"}`}>
      {`${list}|f:${focused?.conversationId ?? "-"}`}
    </output>;
  }

  function mountStore() {
    return render(<><StoreProbe viewer="a" /><StoreProbe viewer="b" /><StoreProbe viewer={null} /></>);
  }

  /** The facts the entry list does not carry: the folded flag, the rank, the visit. */
  function RailProbe() {
    const state = useChatDock("a");
    return <output data-testid="rail">
      {state === null
        ? "null"
        : `${state.tucked ? "tucked" : "open"}|${state.seq}|${state.closed ? "closed" : "live"}`}
    </output>;
  }

  it("is account-fenced and starts at the resting circle", () => {
    mountStore();
    // A signed-in viewer with no dock yet gets one stable empty snapshot, so
    // the Compose affordance exists before the first mutation. Signed out is
    // still nothing at all.
    expect(screen.getByTestId("state-a").textContent).toBe("empty|f:-");
    expect(screen.getByTestId("state-b").textContent).toBe("empty|f:-");
    expect(screen.getByTestId("state-signed-out").textContent).toBe("null|f:-");

    act(() => openChatDock("a", null, null));
    expect(screen.getByTestId("state-a").textContent).toBe("-:open|f:-");
    // Another viewer never sees a's entries, and no empty stand-in is invented
    // for an account this dock does not belong to.
    expect(screen.getByTestId("state-b").textContent).toBe("null|f:-");
    expect(screen.getByTestId("state-signed-out").textContent).toBe("null|f:-");
  });

  it("appends window entries, focuses an existing one and never duplicates", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => openChatDock("a", null, "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open|f:c2");
    act(() => openChatDock("a", null, "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open|f:c1");
    act(() => focusChatDock("a", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open|f:c2");
  });

  it("minimizes, restores and closes a single window", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => minimizeChatDock("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:minimized|f:-");
    act(() => restoreChatDock("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open|f:c1");
    act(() => minimizeChatDock("a", "c1"));
    act(() => closeChatDockEntry("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("empty|f:-");
  });

  it("keeps the picker out of minimize and swaps it for the chosen conversation", () => {
    mountStore();
    act(() => openChatDock("a", null, null));
    act(() => minimizeChatDock("a", null));
    expect(screen.getByTestId("state-a").textContent).toBe("-:open|f:-");
    act(() => openConversation("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open|f:c1");
  });

  it("enforces the host limit by minimizing the least recently focused other window", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 1));
    act(() => openChatDock("a", null, "c2", 1));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:minimized,c2:open|f:c2");
  });

  it("folds the surplus open windows when the host capacity shrinks", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 3));
    act(() => openChatDock("a", null, "c2", 3));
    act(() => openChatDock("a", null, "c3", 3));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open,c3:open|f:c3");
    // The most recently focused window keeps its lease; the two older ones
    // fold in place as rail heads and stay mounted for their drafts.
    act(() => clampChatDockCapacity("a", 1));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:minimized,c2:minimized,c3:open|f:c3");
  });

  it("leaves a dock with room to spare untouched when capacity is clamped", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 3));
    act(() => openChatDock("a", null, "c2", 3));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open|f:c2");
    act(() => clampChatDockCapacity("a", 3));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open|f:c2");
  });

  it("ignores a capacity clamp for another account or a non-finite limit", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 2));
    act(() => openChatDock("a", null, "c2", 2));
    act(() => clampChatDockCapacity("b", 1));
    act(() => clampChatDockCapacity("a", Number.POSITIVE_INFINITY));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c2:open|f:c2");
  });

  it("refuses cross-account mutation and clears on close and reset", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => minimizeChatDock("b", "c1"));
    act(() => closeChatDockEntry("b", "c1"));
    act(() => openConversation("b", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open|f:c1");
    act(() => closeChatDock("a"));
    expect(screen.getByTestId("state-a").textContent).toBe("empty|f:-");
    act(() => openChatDock("a", null, "c3"));
    act(() => resetChatDock());
    expect(screen.getByTestId("state-a").textContent).toBe("empty|f:-");
  });

  it("remembers a closed surface as a state, while closeChatDock clears the store", () => {
    function ClosedProbe() {
      const state = useChatDock("a");
      return <output data-testid="closed">
        {state === null ? "null" : `${state.closed ? "closed" : "open"}|${state.entries.length}`}
      </output>;
    }
    render(<ClosedProbe />);
    act(() => openChatDock("a", null, "c1"));
    act(() => closeChatDockSurface("a"));
    // The visit's dismissal is a fact a null state cannot hold: no window
    // survives, and nothing paints until an opener clears it.
    expect(screen.getByTestId("closed").textContent).toBe("closed|0");

    // Any opener clears the dismissal and the state stays this account's.
    act(() => openChatDock("a", null, "c2"));
    expect(screen.getByTestId("closed").textContent).toBe("open|1");

    // The plain close still drops the state itself: with nothing left, another
    // account's dock owns the store and viewer a is fenced back to null.
    act(() => closeChatDock("a"));
    act(() => openChatDock("b", null, "c9"));
    expect(screen.getByTestId("closed").textContent).toBe("null");
  });

  it("keeps one snapshot identity across renders and stays null when signed out", () => {
    const reads: Array<ReturnType<typeof useChatDock>> = [];
    function IdentityProbe() {
      const state = useChatDock("a");
      reads.push(state);
      return <output data-testid="identity">{state === null ? "null" : "state"}</output>;
    }
    const view = render(<><IdentityProbe /><StoreProbe viewer={null} /></>);
    view.rerender(<><IdentityProbe /><StoreProbe viewer={null} /></>);
    // A fresh object on every read would make useSyncExternalStore render
    // forever, so the frozen empty snapshot keeps its identity.
    expect(reads.length).toBeGreaterThan(1);
    expect(reads[0]).not.toBeNull();
    for (const read of reads) expect(read).toBe(reads[0]);
    // Signed out is still nothing at all.
    expect(screen.getByTestId("state-signed-out").textContent).toBe("null|f:-");
  });

  it("stores the account's windows and focus order, and never the picker", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 3));
    act(() => openChatDock("a", null, "c2", 3));
    act(() => minimizeChatDock("a", "c1"));
    act(() => openChatDock("a", null, null, 3));

    // Every mutation rewrites the record, and the picker — which is not a
    // conversation — has no place in it.
    expect(JSON.parse(sessionStorage.getItem("fb-chat-dock-entries:a") ?? "null")).toEqual({
      seq: 3,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "minimized", seq: 1 },
        { conversationId: "c2", phase: "open", seq: 2 },
      ],
    });
    const raw = sessionStorage.getItem("fb-chat-dock-entries:a") ?? "";
    expect(raw).not.toContain("null");
    expect(raw).not.toContain("closed");
  });

  it("removes the stored rail when the dock empties or the reader closes it", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 3));
    expect(sessionStorage.getItem("fb-chat-dock-entries:a")).toBeTruthy();
    act(() => closeChatDockEntry("a", "c1"));
    expect(sessionStorage.getItem("fb-chat-dock-entries:a")).toBeNull();

    act(() => openChatDock("a", null, "c1", 3));
    act(() => closeChatDock("a"));
    expect(sessionStorage.getItem("fb-chat-dock-entries:a")).toBeNull();

    // Close ends the visit without keeping it dismissed: there is nothing to
    // restore, so a reload paints the resting circle.
    act(() => openChatDock("a", null, "c1", 3));
    act(() => closeChatDockSurface("a"));
    expect(sessionStorage.getItem("fb-chat-dock-entries:a")).toBeNull();
  });

  it("restores a stored rail for the same account and drops what cannot be restored", () => {
    sessionStorage.setItem("fb-chat-dock-entries:a", JSON.stringify({
      seq: 1,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "open", seq: 4 },
        { conversationId: "c1", phase: "minimized", seq: 1 },
        { conversationId: "", phase: "open", seq: 9 },
        { conversationId: "c2", phase: "expanded", seq: 9 },
        { conversationId: "c3", phase: "minimized", seq: 2 },
        "junk",
        null,
      ],
    }));
    render(<><StoreProbe viewer="a" /><StoreProbe viewer="b" /><RailProbe /></>);
    // The duplicate, the empty id and the unknown phase never reach the rail;
    // the rank is clamped to the highest restored entry.
    expect(screen.getByTestId("state-a").textContent).toBe("c1:open,c3:minimized|f:c1");
    expect(screen.getByTestId("state-b").textContent).toBe("null|f:-");
    expect(screen.getByTestId("rail").textContent).toBe("open|4|live");

    // The restored state is the one a mutation acts on, and it is rewritten.
    act(() => minimizeChatDock("a", "c1"));
    expect(JSON.parse(sessionStorage.getItem("fb-chat-dock-entries:a") ?? "null")).toEqual({
      seq: 4,
      tucked: false,
      entries: [
        { conversationId: "c1", phase: "minimized", seq: 4 },
        { conversationId: "c3", phase: "minimized", seq: 2 },
      ],
    });
  });
});

describe("ChatDock window capacity", () => {
  afterEach(() => document.documentElement.style.removeProperty("font-size"));

  it("fits three 384px windows in a 1440px viewport", () => {
    expect(openWindowLimit(1440)).toBe(3);
    expect(openWindowLimit(1440, 384)).toBe(3);
  });

  it("fits one 768px window when the 24rem card doubles with the root font", () => {
    expect(openWindowLimit(1440, 768)).toBe(1);
  });

  it("fits two 384px windows in a 1024px viewport", () => {
    expect(openWindowLimit(1024, 384)).toBe(2);
  });

  it("never promises fewer than one window, however narrow the remainder", () => {
    // The rail reserve can exceed the space left, and a phone shows one anyway.
    expect(openWindowLimit(768, 768)).toBe(1);
    expect(openWindowLimit(375, 384)).toBe(1);
  });

  it("keeps the 384px default when the caller passes no window width", () => {
    expect(openWindowLimit(1440, 384)).toBe(openWindowLimit(1440));
    expect(openWindowLimit(1024, 384)).toBe(openWindowLimit(1024));
  });

  it("folds the surplus into rail heads when the text scale lowers capacity", async () => {
    viewport(1440, 727);
    mount("/");
    // The 16px root makes 24rem 384px, so a 1440px row keeps three windows.
    act(() => {
      for (const id of ["c1", "c2", "c3"]) openChatDock("me", null, id, 3);
    });
    expect(dockWindows()).toHaveLength(3);
    expect(railHeads()).toHaveLength(0);

    // 200% text makes each window 768px, so only one fits beside the rail.
    document.documentElement.style.fontSize = "32px";
    await waitFor(() => expect(railHeads()).toHaveLength(2));

    // The most recently focused window stays open; the surplus became heads.
    expect(dockWindow("c3")?.dataset.phase).toBe("open");
    expect(dockWindow("c3")?.hidden).toBe(false);
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("minimized");
    expect(conversation("c3").dataset.active).toBe("true");
    // Folded, never unmounted: every window is still in the tree, hidden.
    expect(dockWindows()).toHaveLength(3);
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(dockWindow("c2")?.hidden).toBe(true);

    // Restore the design root inside the act boundary so the observer's update
    // belongs to this test, and the next one starts at 100%.
    await act(async () => { document.documentElement.style.removeProperty("font-size"); });
  });
});
