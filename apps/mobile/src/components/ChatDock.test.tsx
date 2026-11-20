// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchedProfile } from "@norfold/shared";
import { chatFileBody, type ChatFileMeta } from "../services/messaging/files";
import { ChatDock } from "./ChatDock";
import {
  closeChatDock, openChatDock, openConversation, resetChatDock,
  toggleChatDockCompact, useChatDock,
} from "./chatDock";

/**
 * Host acceptance for the chat window.
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
const thread = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("../screens/Messaging", () => ({
  ThreadSession: (props: {
    accountId: string; conversationId: string; surface?: string; active?: boolean;
    onToggleCompact?: () => void; onClose?: () => void; onExpand?: () => void;
  }) => {
    const [draft, setDraft] = useState("");
    thread.props = props as unknown as Record<string, unknown>;
    return (
      <section className="fb-chat-page" aria-label={`Conversation ${props.conversationId}`}
        data-surface={props.surface} data-active={String(props.active)}>
        <header className="fb-chat-header">
          <h1>Thread {props.conversationId}</h1>
          <button type="button" aria-label={props.active ? "Collapse chat" : "Expand chat"}
            onClick={props.onToggleCompact}>compact</button>
          <button type="button" aria-label="Open full chat" onClick={props.onExpand}>open</button>
          <button type="button" aria-label="Close chat" onClick={props.onClose}>close</button>
        </header>
        <input aria-label="Message draft" value={draft}
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

function openUnread() {
  named("p1", "Alice");
  chat.conversations = [summary("c1", "p1", { unread: 2, author: "p1" })];
  const view = mount("/");
  fireEvent.click(screen.getByRole("button", { name: "Open chat with Alice" }));
  return view;
}

beforeEach(() => {
  resetChatDock();
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
  });

  it("minimises without unmounting the thread or losing the draft", () => {
    openUnread();
    const draft = screen.getByLabelText("Message draft");
    fireEvent.change(draft, { target: { value: "half a thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Collapse chat" }));
    expect(panel()?.dataset.phase).toBe("minimized");
    expect(thread.props?.active).toBe(false);
    const kept = screen.getByLabelText("Message draft");
    expect(kept).toBe(draft);
    expect((kept as HTMLInputElement).value).toBe("half a thought");
    fireEvent.click(screen.getByRole("button", { name: "Expand chat" }));
    expect(panel()?.dataset.phase).toBe("open");
    expect(thread.props?.active).toBe(true);
    expect(screen.getByLabelText("Message draft")).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe("half a thought");
  });

  it("stays mounted but inactive and hidden on a chat route", () => {
    openUnread();
    fireEvent.click(screen.getByRole("button", { name: "Go chat" }));
    expect(screen.getByTestId("path").textContent).toBe("/chats/a");
    expect(panel()?.hidden).toBe(true);
    expect(thread.props?.active).toBe(false);
    expect(screen.getByLabelText("Message draft")).toBeTruthy();
  });

  it("stays mounted but inactive while the shell is occluded", () => {
    const view = openUnread();
    host.occluded = true;
    view.rerender(tree());
    expect(panel()?.hidden).toBe(true);
    expect(thread.props?.active).toBe(false);
    expect(screen.getByLabelText("Message draft")).toBeTruthy();
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

  it("drops the panel and its account when the viewer changes", () => {
    const view = openUnread();
    auth.user = { id: "other" };
    view.rerender(tree());
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Open messages" })).toBeTruthy();
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

  it("never opens a panel for a request that finishes after the picker closed", async () => {
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

const dockCss = readFileSync(new URL("./ChatDock.css", import.meta.url), "utf8");

describe("ChatDock surface sizing", () => {
  it("marks the open panel as the picker until a conversation takes it over", () => {
    mount("/");
    fireEvent.click(screen.getByRole("button", { name: "Open messages" }));
    expect(panel()?.dataset.view).toBe("picker");
    expect(panel()?.dataset.phase).toBe("open");

    cleanup();
    resetChatDock();
    openUnread();
    expect(panel()?.dataset.view).toBe("thread");
  });

  it("sizes the picker to its rows and leaves the thread height alone", () => {
    const clean = dockCss.replace(/\/\*[\s\S]*?\*\//g, " ");
    const picker = /\.fb-chat-dock\[data-view="picker"\]\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(picker).not.toBe("");
    // Content height while a fifth 52px row is visible; the sixth scrolls.
    expect(picker).toMatch(/(?:^|[;\s])height\s*:\s*auto\s*;/);
    const cap = Number(/(?:^|[;\s])max-height\s*:\s*min\(\s*([\d.]+)rem\s*,/.exec(picker)?.[1] ?? NaN);
    expect(cap).toBeGreaterThanOrEqual(25);
    expect(cap).toBeLessThanOrEqual(30);
    // The viewport bound and the shared width are the ones the dock already had.
    expect(picker).toContain("var(--fb-dock-bottom)");

    // An open conversation keeps its fixed 544px panel.
    const dockRule = /(?:^|\})\s*\.fb-chat-dock\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(dockRule).toContain("height: min(34rem");
    expect(dockRule).toContain("width: min(24rem");
    // Only the picker body scrolls; the picker itself never clips a menu.
    const body = /\.fb-chat-dock-body\s*\{([^}]*)\}/.exec(clean)?.[1] ?? "";
    expect(body).toContain("overflow-y: auto");
  });
});

describe("chatDock store", () => {
  function StoreProbe({ viewer }: { viewer: string | null }) {
    const state = useChatDock(viewer);
    return <output data-testid={`state-${viewer ?? "signed-out"}`}>
      {state ? `${state.accountId}:${state.phase}:${state.conversationId ?? "-"}` : "null"}
    </output>;
  }

  function mountStore() {
    return render(<><StoreProbe viewer="a" /><StoreProbe viewer="b" /><StoreProbe viewer={null} /></>);
  }

  it("is account-fenced and memory only", () => {
    mountStore();
    act(() => openChatDock("a", null, null));
    expect(screen.getByTestId("state-a").textContent).toBe("a:open:-");
    expect(screen.getByTestId("state-b").textContent).toBe("null");
    expect(screen.getByTestId("state-signed-out").textContent).toBe("null");
  });

  it("refuses cross-account mutation and a replacement of a mounted thread", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => toggleChatDockCompact("b"));
    act(() => closeChatDock("b"));
    act(() => openConversation("b", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("a:open:c1");
    act(() => toggleChatDockCompact("a"));
    expect(screen.getByTestId("state-a").textContent).toBe("a:minimized:c1");
    act(() => openConversation("a", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("a:minimized:c1");
    act(() => toggleChatDockCompact("a"));
    act(() => closeChatDock("a"));
    expect(screen.getByTestId("state-a").textContent).toBe("a:closed:-");
    act(() => resetChatDock());
    expect(screen.getByTestId("state-a").textContent).toBe("null");
  });

  it("allows selection from a closed dock or an open picker only", () => {
    mountStore();
    act(() => openChatDock("a", null, "c1"));
    act(() => closeChatDock("a"));
    act(() => openConversation("a", "c2"));
    expect(screen.getByTestId("state-a").textContent).toBe("a:open:c2");
    act(() => closeChatDock("a"));
    act(() => openChatDock("a", null, null));
    act(() => openConversation("a", "c3"));
    expect(screen.getByTestId("state-a").textContent).toBe("a:open:c3");
  });
});
