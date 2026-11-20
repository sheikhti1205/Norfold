import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchedProfile } from "@norfold/shared";
import { MessageSquareText, Pencil, Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth";
import { ThreadSession } from "../screens/Messaging";
import { fetchAccountIdentities, readCachedAccountIdentities } from "../services/accountLabels";
import type { ConversationSummary } from "../services/messaging/conversationIndex";
import { refreshMessaging, requestMessagingConversation } from "../services/messaging/runtime";
import { useMessaging } from "../services/messaging/useMessaging";
import { searchPeople } from "../services/people";
import { messagePreview } from "../utils/messagePreview";
import { useSafetyLifetime } from "../utils/useSafetyLifetime";
import {
  closeChatDockEntry, focusChatDock, minimizeChatDock,
  openChatDock, openConversation, resetChatDock, restoreChatDock, useChatDock,
  type ChatDockEntry,
} from "./chatDock";
import { useHoverLabel } from "./HoverLabel";
import { UserAvatar } from "./UserAvatar";
import "./ChatDock.css";

/**
 * The chat windows that follow the reader across non-chat pages.
 *
 * This module owns presentation, focus and the minimized rail. The transcript,
 * composer, receipts, media and every send belong to the exported
 * `ThreadSession`, rendered unchanged with `surface="dock"`.
 *
 * Hiding is a `hidden` attribute, never an unmount: a minimized or occluded
 * window keeps the component (and its draft, staged photos and recorder) alive,
 * and releases the canonical thread lease through `active` instead.
 */

/** Chat routes own the conversation themselves; the dock stands down there. */
const CHAT_SURFACE = /^\/(?:chats|connections)(?:\/|$)/;
const DOCK_ID = "fb-chat-dock";
const SEARCH_DEBOUNCE_MS = 250;
const DESKTOP_MIN_WIDTH = 768;
/** 24rem at the 16px design root, plus the row's gap. */
const WINDOW_WIDTH = 384;
const WINDOW_GAP = 12;
const DESKTOP_MAX_WINDOWS = 3;
/** Rail head geometry; the batch math and the CSS rule share these numbers. */
const RAIL_HEAD_SIZE = 48;
const RAIL_GAP = 8;
const RAIL_MAX_HEADS = 5;
const NO_ENTRIES: readonly ChatDockEntry[] = [];

/** Desktop windows side by side, capped at three; a phone shows one at a time. */
function openWindowLimit(width: number): number {
  if (width < DESKTOP_MIN_WIDTH) return 1;
  return Math.min(DESKTOP_MAX_WINDOWS, Math.max(1, Math.floor((width - 24) / (WINDOW_WIDTH + WINDOW_GAP))));
}

/**
 * Heads per rail batch: the column, including the page chips at both ends, must
 * stay inside half the viewport height. Worst case is both chips visible, so
 * reserve 44 + 8 above the heads and 8 + 44 below before fitting them in.
 */
function railBatch(height: number): number {
  const reserved = 2 * (44 + RAIL_GAP);
  const fit = Math.floor((0.5 * height - reserved + RAIL_GAP) / (RAIL_HEAD_SIZE + RAIL_GAP));
  return Math.max(1, Math.min(RAIL_MAX_HEADS, fit));
}

function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: typeof window === "undefined" ? DESKTOP_MIN_WIDTH : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

/** The fields the picker reads from a conversation summary. */
type DockConversation = Pick<ConversationSummary,
  "conversationId" | "peerId" | "unreadCount" | "lastMessage">;

type DockIdentities = ReturnType<typeof readCachedAccountIdentities>;
const NO_IDENTITIES: DockIdentities = new Map();

function useDockIdentities(accountId: string, peerIds: readonly string[]) {
  const key = [...new Set(peerIds)].sort().join(",");
  // The cached map carries its account. Without that tag the render between a
  // viewer switch and the effect below would paint the previous account's
  // names and photos for one commit.
  const [cache, setCache] = useState<{ accountId: string; map: DockIdentities }>(() => ({
    accountId,
    map: accountId ? readCachedAccountIdentities(accountId, key ? key.split(",") : []) : new Map(),
  }));
  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    setCache({ accountId, map: accountId ? readCachedAccountIdentities(accountId, ids) : new Map() });
    if (accountId && ids.length > 0) {
      void fetchAccountIdentities(accountId, ids).then((next) => {
        if (!cancelled) setCache({ accountId, map: next });
      }).catch(() => undefined); // A missing public label never implies a deleted account.
    }
    return () => { cancelled = true; };
  }, [accountId, key]);
  return cache.accountId === accountId ? cache.map : NO_IDENTITIES;
}

export function ChatDock({ hostOccluded, bottomNavVisible }: {
  hostOccluded: boolean;
  bottomNavVisible: boolean;
}) {
  const { user, booting, needsProfile } = useAuth();
  const accountId = user?.id ?? "";
  const chat = useMessaging();
  const dock = useChatDock(user?.id ?? null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { hoverLabel } = useHoverLabel();
  const viewport = useViewportSize();
  const capacity = openWindowLimit(viewport.width);
  const phone = viewport.width < DESKTOP_MIN_WIDTH;

  const entries = dock?.entries ?? NO_ENTRIES;
  const openEntries = entries.filter((entry) => entry.phase === "open");
  const minimized = entries.filter((entry) => entry.phase === "minimized");
  const panelMounted = entries.length > 0;
  const visible = !CHAT_SURFACE.test(pathname) && !hostOccluded;
  const focusedSeq = openEntries.reduce((max, entry) => Math.max(max, entry.seq), -1);
  // The rail is a pointer surface; while a window is open on a phone there is
  // no room beside it, so the rail waits until the reader minimizes.
  const railVisible = visible && minimized.length > 0 && (!phone || openEntries.length === 0);
  // Desktop keeps the compose control at the foot while windows are open: that
  // is the only surface that can open a second conversation, and the row above
  // it already reserves the 60px. A phone still gives the one window the whole
  // screen and brings the launcher back as soon as nothing is open.
  const launcherVisible = visible && (!phone || openEntries.length === 0)
    && (minimized.length > 0 || !panelMounted || !phone);

  const windowNodes = useRef(new Map<string, HTMLDivElement>());
  const previousViewer = useRef<string | null>(null);
  // Session-local only, keyed by account + conversation + message, so a
  // dismissal never leaks across viewers and a newer message announces again.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [railOffset, setRailOffset] = useState(0);
  const [focusAfterRestore, setFocusAfterRestore] = useState<string | null>(null);

  // An account change discards every in-memory window and its draft. The hook
  // is already fenced by viewer, so this clears the store itself as well.
  useEffect(() => {
    const viewer = user?.id ?? null;
    if (previousViewer.current !== null && previousViewer.current !== viewer) resetChatDock();
    previousViewer.current = viewer;
  }, [user?.id]);

  const rows: ConversationSummary[] = chat.accountId === accountId ? chat.conversations : [];
  const peerOf = new Map(rows.map((row) => [row.conversationId, row.peerId] as const));
  // Real unread truth: the viewer's own message, unsent messages and private
  // states are excluded. The count itself stays the summary's authority. A
  // dismissal names this exact message, so the shortcut goes away while the
  // row stays unread, and a newer message carries a fresh key.
  const unreadEligible = (conversation: ConversationSummary) => {
    const message = conversation.lastMessage;
    const view = chat.currentProjections?.[conversation.conversationId] ?? conversation.cachedProjection;
    return conversation.unreadCount > 0 && message !== null && message.authorId !== accountId
      && message.unsentAt === undefined && !view?.ownHidden && !view?.ownDeclined && !view?.ownBlocked
      && !view?.ownMuted;
  };
  const unreadRow = rows.find((conversation) => unreadEligible(conversation)
    && !dismissed.has(`${accountId}:${conversation.conversationId}:${conversation.lastMessage?.id ?? ""}`));
  // The exact key the dismiss control writes, so the button and the predicate
  // cannot drift apart.
  const unreadKey = unreadRow
    ? `${accountId}:${unreadRow.conversationId}:${unreadRow.lastMessage?.id ?? ""}`
    : "";
  // The new-message action survives a dismissal: unread activity exists even
  // when every candidate has been dismissed from the shortcut.
  const hasUnread = rows.some(unreadEligible);
  // Recent is ordinary eligible chats, not unread-only ones. Only the privacy
  // exclusions apply; the unread and last-author predicates stay on the launcher.
  const recent: DockConversation[] = rows.filter((conversation) => {
    if (conversation.peerId === accountId) return false;
    const view = chat.currentProjections?.[conversation.conversationId] ?? conversation.cachedProjection;
    return !view?.ownHidden && !view?.ownDeclined && !view?.ownBlocked && !view?.ownMuted;
  });
  const pickerOpen = entries.some((entry) => entry.conversationId === null);
  const windowPeers = entries.flatMap((entry) => {
    if (entry.conversationId === null) return [];
    const peerId = peerOf.get(entry.conversationId);
    return peerId ? [peerId] : [];
  });
  const identities = useDockIdentities(accountId, [
    ...(unreadRow ? [unreadRow.peerId] : []),
    ...(pickerOpen ? recent.map((row) => row.peerId) : []),
    ...windowPeers,
  ]);

  // Oldest first, so the newest minimized head renders at the bottom of the
  // column, nearest the launcher. `railOffset` counts the hidden newer heads
  // the reader has paged away from; the visible slice is the batch immediately
  // above that gap, and never outlives a shorter rail.
  const railOrder = [...minimized].sort((a, b) => a.seq - b.seq);
  const batch = Math.max(1, Math.min(railBatch(viewport.height), railOrder.length));
  const maxFromNewest = Math.max(0, railOrder.length - batch);
  const fromNewest = Math.min(railOffset, maxFromNewest);
  const start = railOrder.length - batch - fromNewest;
  const heads = railOrder.slice(start, start + batch);
  const above = start;
  const below = Math.max(0, railOrder.length - start - batch);
  useEffect(() => {
    if (railOffset > maxFromNewest) setRailOffset(maxFromNewest);
  }, [railOffset, maxFromNewest]);

  // Restoring asks to type again: the field is the honest destination, after
  // the window is visible rather than while it is still `hidden`.
  useEffect(() => {
    if (focusAfterRestore === null) return;
    windowNodes.current.get(focusAfterRestore)
      ?.querySelector<HTMLTextAreaElement>(".fb-peer-field textarea")?.focus({ preventScroll: true });
    setFocusAfterRestore(null);
  }, [focusAfterRestore, entries]);

  const minimizeEntry = useCallback((conversationId: string) => {
    if (accountId) minimizeChatDock(accountId, conversationId);
  }, [accountId]);
  const restoreEntry = useCallback((conversationId: string) => {
    if (!accountId) return;
    restoreChatDock(accountId, conversationId, capacity);
    setFocusAfterRestore(conversationId);
  }, [accountId, capacity]);
  const closeEntry = useCallback((conversationId: string | null) => {
    if (accountId) closeChatDockEntry(accountId, conversationId);
  }, [accountId]);
  const focusEntry = useCallback((conversationId: string | null) => {
    if (accountId) focusChatDock(accountId, conversationId);
  }, [accountId]);
  const expandEntry = useCallback((conversationId: string) => {
    if (!accountId) return;
    closeChatDockEntry(accountId, conversationId);
    // A push, not a replace: Back returns the reader to the page the dock was
    // floating over, with this window already closed.
    void navigate(`/chats/${encodeURIComponent(conversationId)}`);
  }, [accountId, navigate]);
  // Selection never replaces a mounted thread: it opens or focuses one window.
  const select = useCallback((conversationId: string) => {
    if (accountId) openConversation(accountId, conversationId, capacity);
  }, [accountId, capacity]);

  if (!user || booting || needsProfile) return null;

  const nameOf = (peerId: string) => {
    const person = identities.get(peerId);
    return person?.displayName?.trim() || person?.username || "";
  };
  const nameFor = (conversationId: string | null) => {
    const peerId = conversationId ? peerOf.get(conversationId) : undefined;
    return (peerId ? nameOf(peerId) : "") || "Member";
  };
  const isFocused = (entry: ChatDockEntry) => entry.phase === "open"
    && entry.seq === focusedSeq && visible;

  const unreadName = unreadRow ? nameOf(unreadRow.peerId) || "Member" : "";
  const unreadCount = unreadRow?.unreadCount ?? 0;

  return (
    <>
      {/* The launcher stays mounted for the whole dock lifetime so the store's
          remembered trigger is still connected when a window closes. A phone
          hides it behind an open window; desktop keeps it at the foot as the
          way to start another conversation. When hidden it leaves the page,
          the accessibility tree and the tab order exactly as an unmounted
          control would. One compact cluster carries all three actions: dismiss
          this shortcut, open the new-message picker, and open the unread peer's
          conversation. The dismiss control is keyed to the message, so it
          removes only this notice; the pencil and the avatar never depend on
          it. */}
      <div className="fb-chat-launcher"
        data-nav={bottomNavVisible ? "visible" : "hidden"}
        hidden={!launcherVisible}>
        {unreadRow && (
          <button type="button" className="fb-chat-launcher-action"
            aria-label="Dismiss unread shortcut"
            onClick={() => {
              if (!unreadKey) return;
              setDismissed((previous) => {
                if (previous.has(unreadKey)) return previous;
                const next = new Set(previous);
                next.add(unreadKey);
                return next;
              });
            }}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
        {hasUnread && (
          <button type="button" className="fb-chat-launcher-action"
            aria-label="New message"
            onClick={(event) => {
              if (!accountId) return;
              openChatDock(accountId, event.currentTarget, null, capacity);
            }}>
            <Pencil size={19} aria-hidden="true" />
          </button>
        )}
        {unreadRow ? (
          <button type="button" className="fb-chat-launcher-button"
            aria-label={`Open chat with ${unreadName}`}
            aria-describedby="fb-chat-launcher-unread"
            onClick={(event) => {
              if (!accountId) return;
              openChatDock(accountId, event.currentTarget, unreadRow.conversationId, capacity);
            }}>
            <UserAvatar username={unreadName} avatarUrl={identities.get(unreadRow.peerId)?.avatarUrl} size={46} shape="circle" />
            <span className="fb-chat-launcher-badge" aria-hidden="true">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          </button>
        ) : hasUnread ? null : (
          <button type="button" className="fb-chat-launcher-button"
            aria-label="Open messages"
            onClick={(event) => {
              if (!accountId) return;
              openChatDock(accountId, event.currentTarget, null, capacity);
            }}>
            <MessageSquareText size={22} aria-hidden="true" />
          </button>
        )}
        {unreadRow && <span id="fb-chat-launcher-unread" className="sr-only">{`${unreadCount} unread`}</span>}
      </div>
      {railVisible && (
        <div className="fb-chat-dock-rail" data-nav={bottomNavVisible ? "visible" : "hidden"}
          role="group" aria-label="Minimized chats">
          {above > 0 && (
            <button type="button" className="fb-chat-dock-rail-more"
              aria-label={`Show ${above} older minimized ${above === 1 ? "chat" : "chats"}`}
              onClick={() => setRailOffset(Math.min(maxFromNewest, fromNewest + batch))}>
              {`+${above}`}
            </button>
          )}
          <div className="fb-chat-dock-rail-heads">
            {heads.map((entry) => {
              const conversationId = entry.conversationId as string;
              const name = nameFor(conversationId);
              const unread = rows.find((row) => row.conversationId === conversationId)?.unreadCount ?? 0;
              const peerId = peerOf.get(conversationId);
              return (
                <button key={conversationId} type="button" className="fb-chat-dock-rail-head"
                  data-entry={conversationId}
                  aria-label={`Restore chat with ${name}`}
                  onClick={() => restoreEntry(conversationId)}
                  {...hoverLabel(name, "right")}>
                  <UserAvatar username={name} avatarUrl={peerId ? identities.get(peerId)?.avatarUrl : null}
                    size={44} shape="circle" />
                  {unread > 0 && (
                    <span className="fb-chat-dock-rail-badge" aria-hidden="true">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {below > 0 && (
            <button type="button" className="fb-chat-dock-rail-more"
              aria-label={`Show ${below} newer minimized ${below === 1 ? "chat" : "chats"}`}
              onClick={() => setRailOffset(Math.max(0, fromNewest - batch))}>
              {`+${below}`}
            </button>
          )}
        </div>
      )}
      {panelMounted && dock && (
        <div id={DOCK_ID} className="fb-chat-dock fb-chat-dock-stack"
          data-nav={bottomNavVisible ? "visible" : "hidden"}
          data-rail={railVisible ? "true" : undefined}
          data-launcher={launcherVisible && panelMounted ? "above" : undefined}
          hidden={!visible}
          role="complementary" aria-label="Chat">
          {entries.map((entry) => {
            const conversationId = entry.conversationId;
            if (conversationId === null) {
              return (
                <div key="picker" className="fb-chat-dock-window"
                  data-entry="picker" data-phase="open" data-view="picker"
                  hidden={!visible}
                  onPointerDownCapture={() => focusEntry(null)}>
                  <ChatDockPicker accountId={accountId} active={isFocused(entry)}
                    recent={recent} identities={identities} onSelect={select} onClose={() => closeEntry(null)} />
                </div>
              );
            }
            return (
              <div key={`${dock.accountId}:${conversationId}`} className="fb-chat-dock-window"
                ref={(node) => {
                  if (node) windowNodes.current.set(conversationId, node);
                  else windowNodes.current.delete(conversationId);
                }}
                data-entry={conversationId} data-phase={entry.phase} data-view="thread"
                hidden={entry.phase === "minimized" || !visible}
                onPointerDownCapture={() => focusEntry(conversationId)}>
                <ThreadSession key={`${dock.accountId}:${conversationId}`} accountId={dock.accountId}
                  conversationId={conversationId} surface="dock"
                  active={isFocused(entry)}
                  onToggleCompact={() => minimizeEntry(conversationId)}
                  onClose={() => closeEntry(conversationId)}
                  onExpand={() => expandEntry(conversationId)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The new-message surface, reusing searchPeople and
 * requestMessagingConversation. It sends nothing, accepts nothing and creates
 * no HTTP surface of its own.
 */
function ChatDockPicker({ accountId, active, recent, identities, onSelect, onClose }: {
  accountId: string;
  active: boolean;
  recent: DockConversation[];
  identities: ReturnType<typeof readCachedAccountIdentities>;
  onSelect: (conversationId: string) => void;
  onClose: () => void;
}) {
  const chat = useMessaging();
  const alive = useSafetyLifetime();
  const live = useRef(active);
  live.current = active;
  const pending = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busyPerson, setBusyPerson] = useState<string | null>(null);
  const [results, setResults] = useState<SearchedProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const ready = chat.accountId === accountId && chat.status === "ready";
  const term = query.trim();
  const tooLong = term.length > 80;

  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!term || tooLong) {
      setResults([]);
      setLoaded(false);
      setSearching(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setSearching(true);
    setFailed(false);
    setLoaded(false);
    const timer = window.setTimeout(() => {
      void searchPeople(term, { signal: controller.signal }).then((page) => {
        if (cancelled) return;
        setResults(page.items);
        setLoaded(true);
        setSearching(false);
      }).catch(() => {
        if (cancelled) return;
        setFailed(true);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [term, tooLong, attempt]);

  async function start(person: SearchedProfile) {
    if (pending.current || !alive.current || !live.current) return;
    setNote(null);
    if (!ready) {
      // The runtime may still be opening, or offline. Ask it to open and say so
      // instead of leaving a control that silently does nothing.
      setNote(chat.status === "offline"
        ? "You're offline. Check your connection, then tap again."
        : "Opening your messages. Tap again in a moment.");
      void refreshMessaging(accountId).catch(() => undefined);
      return;
    }
    pending.current = true;
    setBusyPerson(person.id);
    try {
      const conversationId = await requestMessagingConversation(accountId, person.id);
      // A completion that arrives after the panel closed, the route hid it or
      // the account changed must never open a window or a thread on its own.
      if (alive.current && live.current) onSelect(conversationId);
    } catch {
      if (alive.current) setNote("Couldn't start this conversation. Check your connection and try again.");
    } finally {
      pending.current = false;
      if (alive.current) setBusyPerson(null);
    }
  }

  const nameOf = (peerId: string) => {
    const person = identities.get(peerId);
    return person?.displayName?.trim() || person?.username || "";
  };

  return (
    <div className="fb-chat-picker">
      <header className="fb-chat-dock-header">
        <h1 className="fb-chat-dock-title">New message</h1>
        <button type="button" className="fb-chat-icon" aria-label="Close chat" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="fb-chat-dock-search">
        <Search size={17} aria-hidden="true" />
        <input ref={field} type="search" aria-label="Search people" placeholder="Search people"
          value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="fb-chat-dock-body">
        {note && <p className="fb-chat-dock-note" role="status">{note}</p>}
        {tooLong ? (
          <p className="fb-chat-dock-note">Try a shorter name or username.</p>
        ) : term ? (
          <>
            {searching && <p className="fb-chat-dock-note" role="status">Searching people…</p>}
            {failed && (
              <div className="fb-chat-dock-notice">
                <p role="alert">Couldn't search people. Check your connection and try again.</p>
                <button type="button" className="fb-surface-button" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </button>
              </div>
            )}
            {loaded && !searching && !failed && results.length === 0 && (
              <p className="fb-chat-dock-note">No people found.</p>
            )}
            <ul className="fb-chat-dock-list" aria-label="People">
              {results.map((person) => {
                const label = person.displayName?.trim() || person.username;
                const existing = recent.find((row) => row.peerId === person.id);
                return (
                  <li key={person.id}>
                    <button type="button" className="fb-chat-dock-person"
                      disabled={busyPerson !== null}
                      aria-busy={busyPerson === person.id}
                      aria-label={`Message ${label}`}
                      onClick={() => {
                        if (existing) onSelect(existing.conversationId);
                        else void start(person);
                      }}>
                      <UserAvatar username={label} avatarUrl={person.avatarUrl} size={36} />
                      <span className="fb-chat-dock-person-copy">
                        <span className="fb-chat-dock-person-name">{label}</span>
                        <span className="fb-chat-dock-person-handle">@{person.username}</span>
                      </span>
                      {busyPerson === person.id && (
                        <span className="fb-chat-dock-person-handle">Opening…</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <section aria-label="Recent conversations">
            <h2 className="fb-chat-dock-section">Recent</h2>
            {recent.length === 0 ? (
              <p className="fb-chat-dock-note">No conversations yet. Search for someone to start one.</p>
            ) : (
              <ul className="fb-chat-dock-list">
                {recent.map((row) => {
                  const person = identities.get(row.peerId);
                  const label = nameOf(row.peerId) || "Member";
                  const preview = row.lastMessage ? messagePreview(row.lastMessage) : "";
                  return (
                    <li key={row.conversationId}>
                      <button type="button" className="fb-chat-dock-person"
                        aria-label={`Open conversation with ${label}${row.unreadCount > 0 ? `, ${row.unreadCount} unread` : ""}`}
                        onClick={() => onSelect(row.conversationId)}>
                        <UserAvatar username={label} avatarUrl={person?.avatarUrl} size={36} />
                        <span className="fb-chat-dock-person-copy">
                          <span className="fb-chat-dock-person-name">{label}</span>
                          {preview ? (
                            <span className="fb-chat-dock-person-preview">{preview}</span>
                          ) : person?.username ? (
                            <span className="fb-chat-dock-person-handle">@{person.username}</span>
                          ) : null}
                        </span>
                        {row.unreadCount > 0 && (
                          <span className="fb-chat-dock-unread" aria-hidden="true">
                            {row.unreadCount > 99 ? "99+" : row.unreadCount}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
