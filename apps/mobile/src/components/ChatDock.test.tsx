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
  openChatDock, openConversation, resetChatDock, resetChatDockDismissedForTests,
  restoreChatDock, useChatDock, type ChatDockEntry,
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
    // Both actions sit on the one launcher: the avatar and the pencil. The
    // pencil carries the distinct-unread badge in its label.
    expect(screen.getByRole("button", { name: "1 unread conversations, new message" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    expect(screen.getAllByLabelText(/^Conversation /)).toHaveLength(1);
    expect(thread.props).toMatchObject({ accountId: "me", conversationId: "c1", surface: "dock", active: true });
  });

  it("opens the new-message picker from the launcher without touching the unread", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "1 unread conversations, new message" }));

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

  it("renders the launcher bubble inside the rail column, with the utility row holding only the two controls", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    mount("/");
    // The launcher bubble is inside the rail column, after any heads.
    expect(screen.getByRole("button", { name: "Open chat with Alice" })).toBeTruthy();
    // The utility row holds exactly the close-all menu and the pencil.
    expect(screen.getByRole("button", { name: "Close chats" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /unread conversations, new message|New message/ })).toBeTruthy();
    // The utility row is not the launcher: it is a separate element below the stack.
    const utilityRow = document.querySelector(".fb-chat-dock-utility-row");
    expect(utilityRow).toBeTruthy();
    expect(utilityRow?.querySelector(".fb-chat-dock-rail-launcher")).toBeNull();
  });

  it("dismisses a conversation through the close-all menu and keeps it gone on remount", () => {
    named("p1", "Alice");
    chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1", messageId: "m1" })];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    expect(dockWindow("c1")).toBeTruthy();

    // Close all chats through the store action: the ActionMenu popover is a
    // react-aria component, not jsdom-friendly, so the store is exercised directly.
    act(() => closeChatDock("me"));
    expect(dockWindow("c1")).toBeNull();
    expect(panel()).toBeNull();
    // The dismissal is persisted to localStorage under the account key.
    expect(localStorage.getItem("fb-chat-dock-dismissed:me")).toContain("c1");

    // Genuine remount: unmount and remount, forcing the dismissed set to be
    // re-read from storage through loadDismissed.
    cleanup();
    const remounted = mount("/");
    expect(screen.queryByRole("button", { name: "Open chat with Alice" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Restore chat with Alice/ })).toBeNull();

    // Interaction re-enables it: opening from the picker clears the dismissed flag.
    act(() => openChatDock("me", null, "c1", 2));
    expect(dockWindow("c1")?.dataset.phase).toBe("open");
    // After clearing, minimising again should show it as a head.
    act(() => minimizeChatDock("me", "c1"));
    expect(screen.getByRole("button", { name: /Restore chat with Alice/ })).toBeTruthy();
    remounted.unmount();
  });

  it("the pencil badge counts distinct unread people, capped at 99+, and draws nothing at zero", () => {
    // Zero unread: no badge element at all.
    mount("/");
    expect(document.querySelector(".fb-chat-dock-utility-badge")).toBeNull();
    cleanup();

    // Two distinct unread conversations: badge shows "2".
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [
      summary("c1", "p1", { unread: 2, author: "p1" }),
      summary("c2", "p2", { unread: 5, author: "p2" }),
    ];
    mount("/");
    expect(screen.getByRole("button", { name: "2 unread conversations, new message" })).toBeTruthy();
    expect(document.querySelector(".fb-chat-dock-utility-badge")?.textContent).toBe("2");
    cleanup();

    // 100 distinct unread conversations: "99+".
    chat.conversations = Array.from({ length: 100 }, (_, i) =>
      summary(`c${i}`, `p${i}`, { unread: 1, author: `p${i}` }),
    );
    mount("/");
    expect(screen.getByRole("button", { name: "99+ unread conversations, new message" })).toBeTruthy();
    expect(document.querySelector(".fb-chat-dock-utility-badge")?.textContent).toBe("99+");
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
    // The rail still renders (it holds the launcher) but carries no heads.
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
    expect(screen.getByRole("button", { name: "1 unread conversations, new message" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "1 unread conversations, new message" }));
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
    fireEvent.click(screen.getByRole("button", { name: "1 unread conversations, new message" }));
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
    // The rail renders (it holds the launcher) but the new-message chooser is
    // never a rail head.
    expect(railHeads()).toHaveLength(0);
    expect(dockWindow("picker")?.dataset.view).toBe("picker");

    act(() => minimizeChatDock("me", null));
    expect(railHeads()).toHaveLength(0);
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

  it("keeps the visible batch identical when a newer head appears while paged older (batch stability)", () => {
    viewport(1024, 768); // batch = 5
    mount("/");
    act(() => {
      for (let index = 1; index <= 8; index += 1) openChatDock("me", null, `c${index}`, 8);
    });
    act(() => {
      for (let index = 1; index <= 8; index += 1) minimizeChatDock("me", `c${index}`);
    });

    // Newest nearest the launcher: c4..c8 visible, c1..c3 hidden above.
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
    // Only the hidden-count chips changed: c6..c9 are now below.
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

  it("Close floating windows closes open windows and leaves heads", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    // Limit 1 forces c1 (the only other open window) to fold to a rail head,
    // leaving c2 as the open floating window.
    act(() => openChatDock("me", null, "c2", 1));
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");

    // Close floating windows: close every open entry, leaving heads in place.
    act(() => closeChatDockEntry("me", "c2"));
    expect(dockWindow("c2")).toBeNull();
    expect(screen.getByRole("button", { name: /Restore chat with Alice/ })).toBeTruthy();
  });

  it("Close all chats leaves no heads and no windows", () => {
    named("p1", "Alice");
    named("p2", "Bob");
    chat.conversations = [summary("c1", "p1", { unread: 1, author: "p1" }), summary("c2", "p2")];
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
    // Limit 1 folds c1 to a rail head so c2 becomes the open floating window.
    act(() => openChatDock("me", null, "c2", 1));
    expect(dockWindow("c1")?.dataset.phase).toBe("minimized");
    expect(dockWindow("c2")?.dataset.phase).toBe("open");

    act(() => closeChatDock("me"));
    expect(dockWindow("c1")).toBeNull();
    expect(dockWindow("c2")).toBeNull();
    expect(panel()).toBeNull();
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
    // A definite four-to-five-row frame; the sixth row scrolls in the body.
    expect(picker).toMatch(/height:\s*clamp\(\s*23rem\s*,\s*52dvh\s*,\s*28rem\s*\)/);
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

  it("caps the window and the chooser at a compact share of a short viewport", () => {
    const clean = dockCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    const windowRule = /(?:^|\})\s*\.fb-chat-dock-window\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    // 544px stays the ceiling, never the target: at 720px of viewport the card
    // is two thirds, not the 76% the owner measured, and 6rem of page plus both
    // insets always remain.
    expect(windowRule).toContain("height: min(34rem, 66dvh");
    expect(windowRule).toContain("calc(100dvh - 2 * var(--fb-dock-bottom) - 6rem)");
    expect(720 * 0.66).toBeLessThan(544);

    const picker = /\.fb-chat-dock-window\[data-view="picker"\]\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    const frame = /height:\s*clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)dvh\s*,\s*([\d.]+)rem\s*\)/.exec(picker);
    expect(frame).not.toBeNull();
    const [, low = "", share = "", high = ""] = frame ?? [];
    // Four to five 52px rows inside ~154px of chrome (52px header, 44px search
    // with its 8px gap, the Recent label and the body padding) at the heights
    // the owner measured. Static arithmetic over the declarations, not layout.
    const chrome = 154;
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
 * The launcher's box is the one the declarations produce: a test that moves it
 * after a lift models the real element, and that is what proves a repeated
 * measurement cannot compound into a climb.
 */
function stubDockBoxes(launcher: Box, composer: Box) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("fb-chat-dock-rail-launcher")) return rectOf(launcher);
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

function launcherNode() {
  return document.querySelector<HTMLElement>(".fb-chat-dock-rail-launcher");
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

  it("lifts the launcher clear of a page composer at both phone widths", () => {
    const cases = [
      // The deployed measurement: 390x844, composer top 780, launcher bottom 832.
      { width: 390, height: 844, composer: 780, launcher: 832, lift: 60 },
      // 320 wide: the lift is the composer's own overlap, so the launcher stays
      // inside the viewport instead of being pushed past the top edge.
      { width: 320, height: 640, composer: 560, launcher: 628, lift: 76 },
    ];
    for (const item of cases) {
      viewport(item.width, item.height);
      pageComposer();
      stubDockBoxes(
        { top: item.launcher - 52, bottom: item.launcher, left: item.width - 64, right: item.width - 12 },
        { top: item.composer, bottom: item.height, left: 0, right: item.width },
      );
      mount("/");
      // The composer's top edge plus the dock's own 8px gap. The lift is
      // published on the rail (the single owner of --fb-composer-clearance),
      // not on the launcher button's own inline style.
      expect(clearanceOf(railNode())).toBe(`${item.lift}px`);
      expect(item.launcher - item.lift - 52, `${item.width}px wide`).toBeGreaterThan(0);
      cleanup();
      vi.restoreAllMocks();
      document.querySelectorAll(".fb-comment-composer").forEach((node) => node.remove());
    }
  });

  it("leaves the launcher alone when the composer is outside its column", () => {
    viewport(1024, 768);
    pageComposer();
    // A centred 44rem readable column: the launcher is not over it.
    stubDockBoxes(
      { top: 704, bottom: 756, left: 960, right: 1012 },
      { top: 690, bottom: 768, left: 160, right: 864 },
    );
    mount("/");
    expect(clearanceOf(launcherNode())).toBe("");
  });

  it("observes the composer and turns a taller box into a taller lift, once", () => {
    viewport(390, 844);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    FakeResizeObserver.instances = [];
    const composer = pageComposer();
    const launcher: Box = { top: 780, bottom: 832, left: 326, right: 378 };
    const box: Box = { top: 780, bottom: 844, left: 0, right: 390 };
    stubDockBoxes(launcher, box);
    mount("/");
    expect(clearanceOf(railNode())).toBe("60px");

    const observer = FakeResizeObserver.instances.at(-1);
    expect(observer?.targets.has(composer)).toBe(true);

    // The composer grew and the launcher sits where the first lift put it.
    box.top = 700;
    launcher.top = 720;
    launcher.bottom = 772;
    act(() => observer?.callback());
    expect(clearanceOf(railNode())).toBe("140px");

    // The measured box carries that lift, so it is taken back out: a second
    // observation of the same boxes keeps the same clearance.
    launcher.top = 640;
    launcher.bottom = 692;
    act(() => observer?.callback());
    expect(clearanceOf(railNode())).toBe("140px");
  });

  it("never counts the dock's own composer as the page composer", () => {
    viewport(1024, 768);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    FakeResizeObserver.instances = [];
    // This box would shift the launcher 74px if it were counted.
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

  it("drops the lift on a phone while a window is open, as the launcher hides", () => {
    viewport(390, 844);
    pageComposer();
    stubDockBoxes(
      { top: 780, bottom: 832, left: 326, right: 378 },
      { top: 780, bottom: 844, left: 0, right: 390 },
    );
    mount("/");
    expect(clearanceOf(railNode())).toBe("60px");

    act(() => openChatDock("me", null, "c1", 1));
    // On a phone with a window open the launcher is unmounted (not hidden), so
    // it reads as null and no clearance surface remains.
    expect(launcherNode()).toBeNull();
    expect(rail()).toBeNull();
    expect(panel()?.getAttribute("data-launcher")).toBeNull();
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
