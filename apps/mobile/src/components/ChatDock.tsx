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
  closeChatDock, openChatDock, openConversation, resetChatDock,
  toggleChatDockCompact, useChatDock,
} from "./chatDock";
import { UserAvatar } from "./UserAvatar";
import "./ChatDock.css";

/**
 * The one chat window that follows the reader across non-chat pages.
 *
 * This module owns presentation and route eligibility only. The transcript,
 * composer, receipts, media and every send belong to the exported
 * `ThreadSession`, which is rendered unchanged with `surface="dock"`.
 *
 * Hiding is a `hidden` attribute, never an unmount: a minimized or occluded
 * window keeps the component (and its draft, staged photos and recorder) alive,
 * and releases the canonical thread lease through `active` instead.
 */

/** Chat routes own the conversation themselves; the dock stands down there. */
const CHAT_SURFACE = /^\/(?:chats|connections)(?:\/|$)/;
const DOCK_ID = "fb-chat-dock";
const SEARCH_DEBOUNCE_MS = 250;

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
  const launcher = useRef<HTMLButtonElement>(null);
  const compose = useRef<HTMLButtonElement>(null);
  /** The control that opened the panel, so close returns focus to it. */
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const unsentWork = useRef(false);
  const previousPhase = useRef<"closed" | "open" | "minimized">("closed");
  const previousViewer = useRef<string | null>(null);
  // Session-local only, keyed by account + conversation + message, so a
  // dismissal never leaks across viewers and a newer message announces again.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set<string>());

  const phase = dock?.phase ?? "closed";
  const panelMounted = dock !== null && (phase === "open" || phase === "minimized");
  const visible = !CHAT_SURFACE.test(pathname) && !hostOccluded;
  const pickerOpen = phase === "open" && dock?.conversationId === null;
  const threadId = dock?.conversationId ?? null;

  // An account change discards the in-memory panel and its draft. The hook is
  // already fenced by viewer, so this clears the store itself as well.
  useEffect(() => {
    const viewer = user?.id ?? null;
    if (previousViewer.current !== null && previousViewer.current !== viewer) resetChatDock();
    previousViewer.current = viewer;
  }, [user?.id]);

  // Focus return is a host concern: the launcher node stays mounted (hidden)
  // while the window is up, so it can take focus back after the commit.
  useEffect(() => {
    if (previousPhase.current !== "closed" && phase === "closed") {
      // The launcher and the new-message action are two triggers for one
      // window; focus goes back to whichever one the reader used.
      (opener.current ?? launcher.current)?.focus({ preventScroll: true });
    }
    if (previousPhase.current === "minimized" && phase === "open") {
      // The reader asked to type again; the field is the honest destination.
      panel.current?.querySelector<HTMLTextAreaElement>(".fb-peer-field textarea")?.focus({ preventScroll: true });
    }
    previousPhase.current = phase;
  }, [phase]);

  const rows: ConversationSummary[] = chat.accountId === accountId ? chat.conversations : [];
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
  const identities = useDockIdentities(accountId, [
    ...(unreadRow ? [unreadRow.peerId] : []),
    ...(pickerOpen ? recent.map((row) => row.peerId) : []),
  ]);

  // The flag describes the mounted thread only. A new thread starts clear, so a
  // closed conversation can never leave a stale veto behind in the picker.
  useEffect(() => { unsentWork.current = false; }, [threadId]);

  const onUnsentWorkChange = useCallback((value: boolean) => { unsentWork.current = value; }, []);
  const close = useCallback(() => { if (accountId) closeChatDock(accountId); }, [accountId]);
  const toggleCompact = useCallback(() => { if (accountId) toggleChatDockCompact(accountId); }, [accountId]);
  const expand = useCallback(() => {
    if (!accountId || !threadId) return;
    closeChatDock(accountId);
    // A push, not a replace: Back returns the reader to the page the dock was
    // floating over, with the dock already closed.
    void navigate(`/chats/${encodeURIComponent(threadId)}`);
  }, [accountId, threadId, navigate]);
  // Selection is legal only with no mounted thread. The canonical guard is the
  // only thing that may unmount one, so a stale unsent flag refuses here too.
  const select = useCallback((conversationId: string) => {
    if (!accountId || unsentWork.current) return;
    openConversation(accountId, conversationId);
  }, [accountId]);

  if (!user || booting || needsProfile) return null;

  const nameOf = (peerId: string) => {
    const person = identities.get(peerId);
    return person?.displayName?.trim() || person?.username || "";
  };
  const unreadName = unreadRow ? nameOf(unreadRow.peerId) || "Member" : "";
  const unreadCount = unreadRow?.unreadCount ?? 0;

  return (
    <>
      {/* The launcher stays mounted while the window is open so the store's
          remembered trigger is still connected when the window closes; it is
          hidden, so it leaves the page, the accessibility tree and the tab
          order exactly as an unmounted control would. One compact cluster
          carries all three actions: dismiss this shortcut, open the
          new-message picker, and open the unread peer's conversation. The
          dismiss control is keyed to the message, so it removes only this
          notice; the pencil and the avatar never depend on it. */}
      <div className="fb-chat-launcher"
        data-nav={bottomNavVisible ? "visible" : "hidden"}
        hidden={!visible || panelMounted}>
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
          <button ref={compose} type="button" className="fb-chat-launcher-action"
            aria-label="New message"
            onClick={() => {
              if (!accountId) return;
              opener.current = compose.current;
              openChatDock(accountId, compose.current, null);
            }}>
            <Pencil size={19} aria-hidden="true" />
          </button>
        )}
        {unreadRow ? (
          <button ref={launcher} type="button" className="fb-chat-launcher-button"
            aria-label={`Open chat with ${unreadName}`}
            aria-describedby="fb-chat-launcher-unread"
            onClick={() => {
              if (!accountId) return;
              opener.current = launcher.current;
              openChatDock(accountId, launcher.current, unreadRow.conversationId);
            }}>
            <UserAvatar username={unreadName} avatarUrl={identities.get(unreadRow.peerId)?.avatarUrl} size={46} shape="circle" />
            <span className="fb-chat-launcher-badge" aria-hidden="true">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          </button>
        ) : hasUnread ? null : (
          <button ref={launcher} type="button" className="fb-chat-launcher-button"
            aria-label="Open messages"
            onClick={() => {
              if (!accountId) return;
              opener.current = launcher.current;
              openChatDock(accountId, launcher.current, null);
            }}>
            <MessageSquareText size={22} aria-hidden="true" />
          </button>
        )}
        {unreadRow && <span id="fb-chat-launcher-unread" className="sr-only">{`${unreadCount} unread`}</span>}
      </div>
      {panelMounted && dock && (
        <div ref={panel} id={DOCK_ID} className="fb-chat-dock" data-phase={phase}
          data-nav={bottomNavVisible ? "visible" : "hidden"} hidden={!visible}
          role="complementary" aria-label="Chat">
          {pickerOpen
            ? <ChatDockPicker accountId={accountId} active={visible} recent={recent} identities={identities}
              onSelect={select} onClose={close} />
            : dock.conversationId !== null && (
              <ThreadSession key={`${dock.accountId}:${dock.conversationId}`} accountId={dock.accountId}
                conversationId={dock.conversationId} surface="dock"
                active={phase === "open" && visible}
                onToggleCompact={toggleCompact} onClose={close} onExpand={expand}
                onUnsentWorkChange={onUnsentWorkChange} />
            )}
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
      if (alive.current && live.current) openConversation(accountId, conversationId);
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
