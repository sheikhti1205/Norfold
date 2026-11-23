import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { SearchedProfile } from "@norfold/shared";
import { MessageSquareText, Minus, Pencil, Search, X } from "lucide-react";
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
  closeChatDockEntry, closeChatDockSurface, focusChatDock, minimizeChatDock,
  openChatDock, openConversation, resetChatDock, restoreChatDock, tuckChatDock,
  untuckChatDock, useChatDock, isChatDockDismissed, type ChatDockEntry,
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
/**
 * Heads in the rail before it pages. The rail is a column, so the fit is a
 * height question the drawing already answered: five 48px heads, the two +N
 * counters and the capsule. Independent of viewport width.
 */
const RAIL_MAX_HEADS = 5;
/** Air kept between the rail and a page composer pinned at the foot. */
const COMPOSER_CLEARANCE_GAP = 8;
const NO_ENTRIES: readonly ChatDockEntry[] = [];

/** Desktop windows side by side, capped at three; a phone shows one at a time. */
function openWindowLimit(width: number): number {
  if (width < DESKTOP_MIN_WIDTH) return 1;
  return Math.min(DESKTOP_MAX_WINDOWS, Math.max(1, Math.floor((width - 24) / (WINDOW_WIDTH + WINDOW_GAP))));
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
  // Dismissed conversations never reappear as heads. They stay out of the
  // rail order entirely so the batch math never counts them.
  const minimized = entries.filter((entry) => entry.phase === "minimized"
    && entry.conversationId !== null
    && !isChatDockDismissed(accountId, entry.conversationId));
  const panelMounted = entries.length > 0;
  const visible = !CHAT_SURFACE.test(pathname) && !hostOccluded;
  const focusedSeq = openEntries.reduce((max, entry) => Math.max(max, entry.seq), -1);
  // Three states and nothing else: `closed` paints no dock at all, `tucked`
  // paints the 48px circle, anything else paints the rail. A tuck alone never
  // hides the rail when it holds nothing: an empty dock is a Compose
  // affordance, never a dead circle. The store guarantees a state for a
  // signed-in viewer; the optional reads only keep the signed-out render (which
  // returns null below) type-safe.
  const dockClosed = dock?.closed === true;
  const expanded = !dockClosed && (!(dock?.tucked === true) || entries.length === 0);
  const railPainted = visible && !dockClosed;

  const windowNodes = useRef(new Map<string, HTMLDivElement>());
  const previousViewer = useRef<string | null>(null);
  // The anchor id of the first visible head: `null` means the newest batch.
  // An anchor id survives a new head appearing at the newest end, so the
  // reader's visible batch never slides. Repaired only when the anchor
  // conversation closes or is dismissed.
  const [railAnchor, setRailAnchor] = useState<string | null>(null);
  const [focusAfterRestore, setFocusAfterRestore] = useState<string | null>(null);
  // The rail unmounts one of its two halves whenever it opens or tucks, so a
  // keyboard activation that removes the pressed control moves focus to the
  // other half instead of dropping it on the document.
  const [pendingFocus, setPendingFocus] = useState<"strip" | "anchor" | null>(null);
  // A page composer pinned at the foot — the report page's comment bar — would
  // otherwise sit underneath the rail, and a tap on its Send button would
  // land on the rail instead. Its height is measured, never assumed: the lift
  // is published on the dock's own surfaces so the rail and an open window
  // keep one bottom anchor and move together.
  const railNode = useRef<HTMLDivElement | null>(null);
  const stripNode = useRef<HTMLDivElement | null>(null);
  const anchorNode = useRef<HTMLButtonElement | null>(null);
  const clearanceRef = useRef(0);
  const [composerClearance, setComposerClearance] = useState(0);

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
  // Distinct people with unread messages, capped at 99+. The same aggregate is
  // painted on the resting circle and on Compose: with the rail open a person
  // who has no dock entry would otherwise have no cue at all.
  const unreadPeopleCount = rows.filter(unreadEligible).length;
  const unreadBadge = unreadPeopleCount > 0
    ? (unreadPeopleCount > 99 ? "99+" : String(unreadPeopleCount))
    : null;
  // Recent is ordinary eligible chats, not unread-only ones. Only the privacy
  // exclusions apply; the unread and last-author predicates stay on the badge.
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
    ...(pickerOpen ? recent.map((row) => row.peerId) : []),
    ...windowPeers,
  ]);

  // Oldest first, so the newest minimized head renders at the bottom of the
  // stack, nearest the actions capsule.
  const railOrder = [...minimized].sort((a, b) => a.seq - b.seq);
  const batch = Math.max(1, Math.min(RAIL_MAX_HEADS, railOrder.length));

  // Anchor-id batch position stability (Section B): `railAnchor` names the
  // first visible head; `null` means the newest batch. A head appearing at the
  // newest end leaves the anchor's index unchanged, so `start` never slides.
  // No render-phase state updates or ref mutations.
  const anchorIndex = railAnchor ? railOrder.findIndex((entry) => entry.conversationId === railAnchor) : -1;
  const start = Math.max(0, anchorIndex >= 0 ? Math.min(anchorIndex, railOrder.length - batch) : railOrder.length - batch);
  const heads = railOrder.slice(start, start + batch);
  const above = start;
  const below = Math.max(0, railOrder.length - start - batch);

  // Repair when the anchor conversation closes or is dismissed: fall back to
  // the nearest surviving head, or the newest batch if none survives there.
  useEffect(() => {
    if (railAnchor === null) return;
    if (anchorIndex >= 0) return;
    const fallback = railOrder.at(Math.min(start, railOrder.length - 1));
    setRailAnchor(fallback ? fallback.conversationId : null);
  }, [railAnchor, railOrder, start]);

  // Restoring asks to type again: the field is the honest destination, after
  // the window is visible rather than while it is still `hidden`.
  useEffect(() => {
    if (focusAfterRestore === null) return;
    windowNodes.current.get(focusAfterRestore)
      ?.querySelector<HTMLTextAreaElement>(".fb-peer-field textarea")?.focus({ preventScroll: true });
    setFocusAfterRestore(null);
  }, [focusAfterRestore, entries]);

  // A keyboard activation that unmounts its own control hands focus to the half
  // of the rail that replaced it. Never traps: the rail is an ordinary group of
  // buttons, and Tab leaves it as it leaves any other group.
  useEffect(() => {
    if (pendingFocus === null) return;
    if (pendingFocus === "strip" && !expanded) return;
    if (pendingFocus === "anchor" && expanded) return;
    const target = pendingFocus === "strip"
      ? stripNode.current?.querySelector<HTMLButtonElement>("button") ?? null
      : anchorNode.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    setPendingFocus(null);
  }, [expanded, pendingFocus]);

  // Pressing the page folds the open window back to its bubble and leaves the
  // rail open. The listener exists only while a thread is open, so the
  // pointerdown that opened it (already dispatched) can never fold it. The dock
  // and its own rail are not "the page", and a page composer is a text surface
  // rather than a dismissal.
  const focusedOpenId = openEntries.find((entry) => entry.seq === focusedSeq)?.conversationId ?? null;
  useEffect(() => {
    if (!visible || !expanded || focusedOpenId === null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`#${DOCK_ID}`) || target.closest(".fb-chat-dock-rail")) return;
      if (target.closest(".fb-comment-composer")) return;
      minimizeChatDock(accountId, focusedOpenId);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [accountId, expanded, focusedOpenId, visible]);

  // Clearing a page composer is a geometry question, so it is measured. The
  // dock's own thread owns its composer (`#fb-chat-dock` is excluded below), so
  // a window can never lift the rail that opened it.
  useEffect(() => {
    const rail = railNode.current;
    // An unpainted rail has no box to measure and nothing to clear; dropping
    // the lift here is what keeps a covered page from staying shifted.
    if (!rail || !railPainted) {
      if (clearanceRef.current !== 0) {
        clearanceRef.current = 0;
        setComposerClearance(0);
      }
      return;
    }
    const pageComposers = () => Array.from(
      document.querySelectorAll<HTMLElement>(".fb-comment-composer"),
    ).filter((node) => node.closest(`#${DOCK_ID}`) === null);
    let applied = clearanceRef.current;
    let frame = 0;
    // The composer can arrive after this effect (a report's data loads) or
    // change height on its own (attachments, reply context, the keyboard), so
    // its own box is observed rather than one window resize.
    const Observer = typeof ResizeObserver === "function" ? ResizeObserver : null;
    const observed = new Set<Element>();
    let sizes: ResizeObserver | null = null;
    const rescan = () => {
      for (const composer of pageComposers()) {
        if (observed.has(composer)) continue;
        observed.add(composer);
        sizes?.observe(composer);
      }
      for (const composer of observed) {
        if (composer.isConnected) continue;
        observed.delete(composer);
        sizes?.unobserve(composer);
      }
    };
    const measure = () => {
      frame = 0;
      rescan();
      const box = rail.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      // The measured box already carries the lift from the previous pass; take
      // it back out so repeated measurements cannot compound into a climb.
      const top = box.top + applied;
      const bottom = box.bottom + applied;
      let next = 0;
      for (const composer of pageComposers()) {
        const rect = composer.getBoundingClientRect();
        // Only a composer in the rail's own columns can be covered by it;
        // a narrow centred column on a wide canvas is already clear.
        if (rect.right <= box.left || rect.left >= box.right) continue;
        if (rect.bottom <= top || rect.top >= bottom) continue;
        next = Math.max(next, Math.round(bottom - rect.top + COMPOSER_CLEARANCE_GAP));
      }
      if (next === applied) return;
      applied = next;
      clearanceRef.current = next;
      setComposerClearance(next);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    sizes = Observer ? new Observer(measure) : null;
    // A report's composer arrives with its data, long after this effect. Only a
    // record that adds or drops a composer may cost a scan: the app mutates a
    // live transcript continuously and none of it can move the rail.
    const holdsComposer = (node: Node) => node.nodeType === 1
      && ((node as Element).matches(".fb-comment-composer")
        || (node as Element).querySelector(".fb-comment-composer") !== null);
    const mutations = typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
        if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(holdsComposer))) {
          schedule();
        }
      })
      : null;
    mutations?.observe(document.body, { childList: true, subtree: true });
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      sizes?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [railPainted, pathname]);

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
    // Expanding is interaction, not closure: it must not write a dismissal.
    closeChatDockEntry(accountId, conversationId, false);
    // A push, not a replace: Back returns the reader to the page the dock was
    // floating over, with this window already closed.
    void navigate(`/chats/${encodeURIComponent(conversationId)}`);
  }, [accountId, navigate]);
  // Selection never replaces a mounted thread: it opens or focuses one window.
  const select = useCallback((conversationId: string) => {
    if (accountId) openConversation(accountId, conversationId, capacity);
  }, [accountId, capacity]);

  if (!user || booting || needsProfile) return null;
  // The dock is a wide-screen surface: below the desktop threshold it paints
  // nothing at all — no rail, no anchor, no capsule, no floating window.
  // A mounted thread stays alive in the store but is not rendered until the
  // viewport widens past the threshold again.
  if (phone) return null;

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

  // One measured lift, published on every fixed dock surface. Absent when no
  // page composer reaches the rail, so each inset keeps its own fallback.
  const clearance = railPainted ? composerClearance : 0;
  const composerStyle = clearance > 0
    ? ({ "--fb-composer-clearance": `${clearance}px` } as CSSProperties)
    : undefined;
  const stackIndex = (index: number) => ({ "--fb-dock-index": index } as CSSProperties);

  /**
   * Minimize is a parking space, not a dismissal: the store folds every open
   * window into its bubble and drops a live picker, then the rail tucks into
   * the circle. Nothing is discarded, so the circle restores the same stack.
   */
  const tuckRail = (keyboard: boolean) => {
    if (!accountId) return;
    // A picker is not a thread: tucking drops it, and a dock left holding
    // nothing stays open as the Compose affordance, so there is no circle to
    // hand focus to. The first action is where the pressed control used to be.
    const holdsThreads = entries.some((entry) => entry.conversationId !== null);
    tuckChatDock(accountId);
    if (keyboard) setPendingFocus(holdsThreads ? "anchor" : "strip");
  };

  return (
    <>
      {/* One vertical rail at the bottom-right. At rest it is the 48px anchor
          alone; open it is the stack of minimized people (older +N counter,
          oldest-to-newest heads, newer +N counter) above the actions capsule in
          the corner the anchor just left. `closed` paints nothing: it is
          absence, not an empty rail. */}
      {railPainted && (
        <div ref={railNode} className="fb-chat-dock-rail" data-nav={bottomNavVisible ? "visible" : "hidden"}
          style={composerStyle}
          role="group" aria-label="Chat dock">
          {expanded ? (
            <>
              {(above > 0 || heads.length > 0 || below > 0) && (
                <div className="fb-chat-dock-rail-stack">
                  {above > 0 && (
                    <button type="button" className="fb-chat-dock-rail-more" style={stackIndex(0)}
                      aria-label={`Show ${above} older minimized ${above === 1 ? "chat" : "chats"}`}
                      onClick={() => {
                        const nextStart = Math.max(0, start - batch);
                        setRailAnchor(nextStart === railOrder.length - batch
                          ? null : railOrder[nextStart]?.conversationId ?? null);
                      }}>
                      {`+${above}`}
                    </button>
                  )}
                  {heads.map((entry, index) => {
                    const conversationId = entry.conversationId as string;
                    const name = nameFor(conversationId);
                    const unread = rows.find((row) => row.conversationId === conversationId)?.unreadCount ?? 0;
                    const peerId = peerOf.get(conversationId);
                    return (
                      <button key={conversationId} type="button" className="fb-chat-dock-rail-head"
                        data-entry={conversationId}
                        style={stackIndex(index + (above > 0 ? 1 : 0))}
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
                  {below > 0 && (
                    <button type="button" className="fb-chat-dock-rail-more"
                      style={stackIndex(heads.length + (above > 0 ? 1 : 0))}
                      aria-label={`Show ${below} newer minimized ${below === 1 ? "chat" : "chats"}`}
                      onClick={() => {
                        const nextStart = Math.min(start + batch, railOrder.length - batch);
                        setRailAnchor(nextStart === railOrder.length - batch
                          ? null : railOrder[nextStart]?.conversationId ?? null);
                      }}>
                      {`+${below}`}
                    </button>
                  )}
                </div>
              )}
              {/* The capsule is the notification action rail laid horizontal:
                  Compose always, and Minimize/Close only when they would do
                  something. Close is destructive and last. */}
              <div ref={stripNode} className="fb-chat-dock-rail-strip">
                <button type="button" className="fb-chat-dock-rail-action"
                  aria-label={unreadPeopleCount > 0 ? `Compose, ${unreadPeopleCount} waiting` : "Compose"}
                  onClick={(event) => {
                    if (!accountId) return;
                    // The picker is its own dock entry: pressing Compose while it is
                    // open closes it instead of opening a second one. `pickerOpen` is
                    // derived from the store, so there is no second source of truth.
                    if (pickerOpen) {
                      closeChatDockEntry(accountId, null);
                    } else {
                      openChatDock(accountId, event.currentTarget, null, capacity);
                    }
                  }}>
                  <span className="fb-chat-dock-rail-glyph">
                    <Pencil size={16} aria-hidden="true" />
                    {unreadBadge && (
                      <span className="fb-chat-dock-rail-badge" aria-hidden="true">{unreadBadge}</span>
                    )}
                  </span>
                  <span className="fb-chat-dock-rail-name" aria-hidden="true">Compose</span>
                </button>
                {entries.length > 0 && (
                  <>
                    <span className="fb-chat-dock-rail-divider" aria-hidden="true" />
                    <button type="button" className="fb-chat-dock-rail-action" aria-label="Minimize"
                      onClick={(event) => tuckRail(event.detail === 0)}>
                      <Minus size={16} aria-hidden="true" />
                      <span className="fb-chat-dock-rail-name" aria-hidden="true">Minimize</span>
                    </button>
                    <span className="fb-chat-dock-rail-divider" aria-hidden="true" />
                    <button type="button" className="fb-chat-dock-rail-action fb-chat-dock-rail-danger"
                      aria-label="Close"
                      onClick={() => {
                        if (accountId) closeChatDockSurface(accountId);
                      }}>
                      <X size={16} aria-hidden="true" />
                      <span className="fb-chat-dock-rail-name" aria-hidden="true">Close</span>
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <button ref={anchorNode} type="button" className="fb-chat-dock-rail-anchor"
              aria-label={unreadPeopleCount > 0 ? `Open chats, ${unreadPeopleCount} waiting` : "Open chats"}
              onClick={(event) => {
                if (!accountId) return;
                untuckChatDock(accountId);
                if (event.detail === 0) setPendingFocus("strip");
              }}>
              <MessageSquareText size={22} aria-hidden="true" />
              {unreadBadge && (
                <span className="fb-chat-dock-rail-badge" aria-hidden="true">{unreadBadge}</span>
              )}
              <span className="fb-chat-dock-rail-name" aria-hidden="true">Open chats</span>
            </button>
          )}
        </div>
      )}
      {panelMounted && dock && !dockClosed && (
        <div id={DOCK_ID} className="fb-chat-dock fb-chat-dock-stack"
          data-nav={bottomNavVisible ? "visible" : "hidden"}
          style={composerStyle}
          hidden={!visible || !expanded}
          role="complementary" aria-label="Chat">
          {entries.map((entry) => {
            const conversationId = entry.conversationId;
            if (conversationId === null) {
              return (
                <div key="picker" className="fb-chat-dock-window"
                  data-entry="picker" data-phase="open" data-view="picker"
                  hidden={!visible || !expanded}
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
                hidden={entry.phase === "minimized" || !visible || !expanded}
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
