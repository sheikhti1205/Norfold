// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchedProfile } from "@norfold/shared";
import { chatFileBody, type ChatFileMeta } from "../services/messaging/files";
import { ChatDock } from "./ChatDock";
import {
  closeChatDock, closeChatDockEntry, focusChatDock, minimizeChatDock,
  openChatDock, openConversation, resetChatDock, restoreChatDock,
  useChatDock, type ChatDockEntry,
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
          <button type="button" aria-label="Collapse chat"
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

function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function openUnread() {
  named("p1", "Alice");
  chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1" })];
  const view = mount("/");
  fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
  return view;
}

beforeEach(() => {
  resetChatDock();
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
  it("keeps the launcher off every chat surface", () => {
    for (const path of ["/chats", "/chats/a", "/connections", "/connections/a"]) {
      mount(path);
      expect(screen.queryByRole("button", { name: "Open messages" })).toBeNull();
      cleanup();
    }
  });

  it("offers the launcher on ordinary pages", () => {
    for (const path of ["/", "/search", "/my/1/edit"]) {
      mount(path);
      expect(screen.getByRole("button", { name: "Open messages" })).toBeTruthy();
      cleanup();
    }
  });

  it("hides the shortcut while the shell reports an occluding surface", () => {
    host.occluded = true;
    mount("/");
    expect(screen.queryByRole("button", { name: "Open messages" })).toBeNull();
  });
});

describe("ChatDock launcher", () => {
  it("opens the newest unread conversation from the avatar beside the new-message action", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c0", "p0", { unread: 0, author: "p0" }),
      summary("c1", "p1", { unread: 2, author: "p1" })];
    mount("/");
    expect(screen.getByText("2 unread")).toBeTruthy();
    // Both actions sit on the one launcher: the avatar and the pencil.
    expect(screen.getByRole("button", { name: "New message" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    expect(screen.getAllByLabelText(/^Conversation /)).toHaveLength(1);
    expect(thread.props).toMatchObject({ accountId: "me", conversationId: "c1", surface: "dock", active: true });
  });

  it("opens the new-message picker from the launcher without touching the unread", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "New message" }));

    // The picker is the compose surface: no thread, no request, no send.
    expect(screen.getByRole("heading", { name: "New message" })).toBeTruthy();
    expect(screen.getByLabelText("Search people")).toBeTruthy();
    expect(screen.queryByLabelText(/^Conversation /)).toBeNull();
    expect(runtime.request).not.toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toBe("/");

    // Closing it restores the unread avatar exactly as it was: opening a new
    // message never reads, sends or dismisses the existing unread row.
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.getByRole("button", { name: "Open chat with Alice" })).toBeTruthy();
    expect(screen.getByText("2 unread")).toBeTruthy();
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
      expect(screen.queryByRole("button", { name: "Open chat with Alice" })).toBeNull();
      expect(screen.getByRole("button", { name: "Open messages" })).toBeTruthy();
      cleanup();
    }
  });

  it("dismisses this shortcut only, keeps new-message access and honours a newer message", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    const view = mount("/");
    expect(screen.getByRole("button", { name: "New message" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss unread shortcut" }));
    expect(screen.queryByRole("button", { name: "Open chat with Alice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss unread shortcut" })).toBeNull();
    // New-message access does not depend on the dismissed shortcut.
    expect(screen.getByRole("button", { name: "New message" })).toBeTruthy();
    // The pending unread is untouched: no send, request, refresh or navigation.
    expect(runtime.request).not.toHaveBeenCalled();
    expect(runtime.refresh).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^Conversation /)).toBeNull();
    expect(screen.getByTestId("path").textContent).toBe("/");

    // Still the same message: the shortcut stays dismissed.
    view.rerender(tree());
    expect(screen.queryByRole("button", { name: "Open chat with Alice" })).toBeNull();

    // The key is account-fenced: the same ids under another viewer reappear.
    auth.user = { id: "other" };
    chat.accountId = "other";
    view.rerender(tree());
    expect(screen.getByRole("button", { name: /^Open chat with/ })).toBeTruthy();

    // Back on the first account, a newer message is a fresh key and returns.
    auth.user = { id: "me" };
    chat.accountId = "me";
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m2" })];
    view.rerender(tree());
    expect(screen.getByRole("button", { name: /^Open chat with/ })).toBeTruthy();
    expect(screen.getByText("2 unread")).toBeTruthy();
  });

  it("never paints the previous account's label after a viewer switch", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1", body: "Hi" })];
    const view = mount("/");
    expect(screen.getByRole("button", { name: "Open chat with Alice" })).toBeTruthy();

    // The same peer id under a viewer with no cached label must not inherit the
    // previous account's identity for even one render.
    auth.user = { id: "other" };
    chat.accountId = "other";
    identities.map = new Map();
    chat.conversations = [summary("c2", "p1", { unread: 1, author: "p1", body: "Hi" })];
    view.rerender(tree());
    expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Open chat with Member" })).toBeTruthy();
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
    expect(railHeads()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Restore chat with Alice" })).toBeTruthy();
    const kept = screen.getByLabelText("Message draft c1");
    expect(kept).toBe(draft);
    expect((kept as HTMLInputElement).value).toBe("half a thought");

    fireEvent.click(screen.getByRole("button", { name: "Restore chat with Alice" }));
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    expect(dockWindow("c1")?.hidden).toBe(false);
    expect(thread.byId.c1?.active).toBe(true);
    expect(rail()).toBeNull();
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
  });

  it("stays mounted but inactive while the shell is occluded", () => {
    const view = openUnread();
    host.occluded = true;
    view.rerender(tree());
    expect(panel()?.hidden).toBe(true);
    expect(dockWindow("c1")?.hidden).toBe(true);
    expect(thread.byId.c1?.active).toBe(false);
    expect(screen.getByLabelText("Message draft c1")).toBeTruthy();
  });

  it("returns focus to the launcher on close", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    const launcher = screen.getByRole("button", { name: "Open chat with Alice" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("expands to the canonical route without leaving a second transcript", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Open full chat" }));
    expect(screen.getByTestId("path").textContent).toBe("/chats/c1");
    expect(screen.queryByLabelText("Conversation c1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open chat with Alice" })).toBeNull();
  });

  it("drops every window and its account when the viewer changes", () => {
    const view = openUnread();
    act(() => openChatDock("me", null, "c2", 2));
    auth.user = { id: "other" };
    view.rerender(tree());
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Open messages" })).toBeTruthy();
  });
});

describe("ChatDock windows", () => {
  it("keeps two conversations open and gives the active lease to the last focus", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));

    // The desktop launcher stays at the foot while a window is open, so the
    // second conversation opens from the picker beside the first.
    expect(screen.getByRole("button", { name: "New message" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    fireEvent.click(screen.getByRole("button", { name: "Open conversation with Bob" }));
    expect(dockWindow("picker")).toBeNull();
    expect(dockWindows()).toHaveLength(2);
    expect(conversation("c1").dataset.active).toBe("false");
    expect(conversation("c2").dataset.active).toBe("true");

    // Pressing inside a window takes focus, and only one window owns the lease.
    fireEvent.pointerDown(conversation("c1"));
    expect(conversation("c1").dataset.active).toBe("true");
    expect(conversation("c2").dataset.active).toBe("false");
  });

  it("restores a minimized head beside the open window", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));

    // The launcher stays at the foot while a head exists, so a second chat
    // can be chosen from the picker.
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    fireEvent.click(screen.getByRole("button", { name: "Open conversation with Bob" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    act(() => openChatDock("me", null, "c2", 2));
    act(() => openChatDock("me", null, "c3", 2));

    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");
    expect(dockWindow("c3")?.dataset.phase).toBe("open");
    expect(conversation("c3").dataset.active).toBe("true");
    expect(railHeads()).toHaveLength(1);
  });

  it("pages the rail with a +N chip at both ends", () => {
    mount("/");
    act(() => {
      for (let index = 1; index <= 8; index += 1) openChatDock("me", null, `c${index}`, 8);
    });
    act(() => {
      for (let index = 1; index <= 8; index += 1) minimizeChatDock("me", `c${index}`);
    });

    // Newest nearest the launcher: c4..c8 with the older three hidden above.
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

  it("never puts the new-message chooser on the rail", () => {
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(rail()).toBeNull();
    expect(dockWindow("picker")?.dataset.view).toBe("picker");

    act(() => minimizeChatDock("me", null));
    expect(rail()).toBeNull();
    expect(dockWindow("picker")?.hidden).toBe(false);
  });

  it("hides the rail on a phone while a window is open", () => {
    viewport(375, 700);
    mount("/");
    act(() => openChatDock("me", null, "c1", 1));
    act(() => openChatDock("me", null, "c2", 1));
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");
    expect(rail()).toBeNull();

    act(() => minimizeChatDock("me", "c2"));
    expect(rail()).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByRole("heading", { name: "New message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open conversation with Alice" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bob/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cleo/ })).toBeNull();
  });

  it("shows the canonical one-line preview in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "Hello there" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByText("Hello there")).toBeTruthy();
  });

  it("never shows a serialized file marker or storage path in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", {
      unread: 0, author: "p1", body: chatFileBody(meta, "Here is the report"),
    })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.queryByText(/norfold-file:/)).toBeNull();
    expect(screen.queryByText(/files\/u-1/)).toBeNull();
  });

  it("names a malformed or future file marker as File in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "norfold-file:v2:AAAA" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.queryByText(/norfold-file:/)).toBeNull();
  });

  it("keeps the existing typed and honest expressive preview copy in Recent", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "", type: "VOICE" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByText("Voice message")).toBeTruthy();

    cleanup();
    resetChatDock();
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1", body: "https://media.klipy.com/a.gif" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByText("Sticker/GIF")).toBeTruthy();

    cleanup();
    resetChatDock();
    chat.conversations = [summary("c1", "p1", {
      unread: 0, author: "p1", body: "https://media.klipy.com/a.gif#norfold-media=gif",
    })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(screen.getByText("GIF")).toBeTruthy();
  });

  it("selects an existing conversation without a request, navigation or send", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 0, author: "p1" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    fireEvent.click(screen.getByRole("button", { name: "Open conversation with Alice" }));
    expect(runtime.request).not.toHaveBeenCalled();
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(screen.getByLabelText("Conversation c1")).toBeTruthy();
    expect(thread.props).toMatchObject({ accountId: "me", conversationId: "c1", surface: "dock", active: true });
  });

  it("starts a new conversation through the canonical request and opens it", async () => {
    people.results = [{ id: "p9", username: "sam", displayName: "Sam", avatarUrl: null }];
    runtime.request.mockResolvedValue("c-new");
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "sam" } });
    fireEvent.click(await screen.findByRole("button", { name: "Message Sam" }));
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(panel()).toBeNull();
    await act(async () => { settle?.("c-late"); await Promise.resolve(); });
    expect(screen.queryByLabelText("Conversation c-late")).toBeNull();
    expect(screen.getByRole("button", { name: "Open messages" })).toBeTruthy();
  });
});

// Vitest runs with `apps/mobile` as its cwd; a jsdom module has no file: URL.
const dockCss = readFileSync("src/components/ChatDock.css", "utf8");

describe("ChatDock surface sizing", () => {
  it("marks the picker window as the picker until a conversation takes it over", () => {
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
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
    // Content height while a fifth 52px row is visible; the sixth scrolls.
    expect(picker).toMatch(/(?:^|[;\s])height\s*:\s*auto\s*;/);
    const cap = Number(/(?:^|[;\s])max-height\s*:\s*min\(\s*([\d.]+)rem\s*,/.exec(picker)?.[1] ?? NaN);
    expect(cap).toBeGreaterThanOrEqual(25);
    expect(cap).toBeLessThanOrEqual(30);
    // The viewport bound and the shared width are the ones the window already had.
    expect(picker).toContain("var(--fb-dock-bottom)");

    // A thread window keeps the fixed 544px card beside its neighbours.
    const windowRule = /(?:^|\})\s*\.fb-chat-dock-window\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(windowRule).toContain("height: min(34rem");
    expect(windowRule).toContain("width: min(24rem");

    // The host is a bottom-right row, not a panel.
    const hostRow = /\.fb-chat-dock-stack\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(hostRow).toContain("flex-direction: row");
    expect(hostRow).toContain("gap: 12px");
    expect(hostRow).toContain("align-items: flex-end");

    // The rail is a 48px column of circular heads with an 8px rhythm.
    const railRule = /(?:^|\})\s*\.fb-chat-dock-rail\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(railRule).toContain("flex-direction: column");
    expect(railRule).toContain("gap: 8px");
    expect(railRule).toContain("inset-block-end");
    const head = /\.fb-chat-dock-rail-head\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(head).toContain("width: 48px");
    expect(head).toContain("height: 48px");
    expect(head).toContain("border-radius: 999px");
    const heads = /\.fb-chat-dock-rail-heads\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(heads).toContain("gap: 8px");
    expect(heads).toContain("max-block-size: 50dvh");
    const more = /\.fb-chat-dock-rail-more\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(more).toContain("width: 44px");
    expect(more).toContain("height: 44px");

    // Only the picker body scrolls; the picker itself never clips a menu.
    const body = /\.fb-chat-dock-body\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(body).toContain("overflow-y: auto");
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
    return <output data-testid={`state-${viewer ?? "signed-out"}`}>
      {state
        ? `${state.accountId}|${state.entries.map((entry) => `${entry.conversationId ?? "-"}:${entry.phase}`).join(",")}|f:${focused?.conversationId ?? "-"}`
        : "null"}
    </output>;
  }

  function mountStore() {
    return render(<><StoreProbe viewer="a" /><StoreProbe viewer="b" /><StoreProbe viewer={null} /></>);
  }

  it("is account-fenced and memory only", () => {
    mountStore();
    act(() => openChatDock("a", null, null));
    expect(screen.getByTestId("state-a").textContent).toBe("a|-:open|f:-");
    expect(screen.getByTestId("state-b").textContent).toBe("null");
    expect(screen.getByTestId("state-signed-out").textContent).toBe("null");
  });

  it("appends window entries, focuses an existing one and never duplicates", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => openChatDock("a", null, "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:open,c2:open|f:c2");
    act(() => openChatDock("a", null, "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:open,c2:open|f:c1");
    act(() => focusChatDock("a", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:open,c2:open|f:c2");
  });

  it("minimizes, restores and closes a single window", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => minimizeChatDock("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:minimized|f:-");
    act(() => restoreChatDock("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:open|f:c1");
    act(() => minimizeChatDock("a", "c1"));
    act(() => closeChatDockEntry("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("null");
  });

  it("keeps the picker out of minimize and swaps it for the chosen conversation", () => {
    mountStore();
    act(() => openChatDock("a", null, null));
    act(() => minimizeChatDock("a", null));
    expect(screen.getByTestId("state-a").textContent).toBe("a|-:open|f:-");
    act(() => openConversation("a", "c1"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:open|f:c1");
  });

  it("enforces the host limit by minimizing the least recently focused other window", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1", 1));
    act(() => openChatDock("a", null, "c2", 1));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:minimized,c2:open|f:c2");
  });

  it("refuses cross-account mutation and clears on close and reset", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => minimizeChatDock("b", "c1"));
    act(() => closeChatDockEntry("b", "c1"));
    act(() => openConversation("b", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("a|c1:open|f:c1");
    act(() => closeChatDock("a"));
    expect(screen.getByTestId("state-a").textContent).toBe("null");
    act(() => openChatDock("a", null, "c3"));
    act(() => resetChatDock());
    expect(screen.getByTestId("state-a").textContent).toBe("null");
  });
});
