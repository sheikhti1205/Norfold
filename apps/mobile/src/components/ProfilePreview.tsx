import { useCallback, useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Popover } from "react-aria-components";
import { CalendarDays, MapPin, Users, X } from "lucide-react";
import type { PublicProfile } from "@norfold/shared";
import { fetchPublicProfile } from "../services/profile";
import { connectionCountLabel, fetchConnectionCount } from "../services/connections";
import { useFinePointer } from "./inputCapabilities";
import { UserAvatar } from "./UserAvatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { PeerChatButton } from "./PeerChatButton";
import { identityDisplayName, identityHref, type PublicIdentity } from "./identity";
import { formatJoinedMonth } from "../utils/dates";
import "./ProfilePreview.css";

/**
 * The person card: who this is, and the one thing to do about it.
 *
 * Owner direction 2026-11-18 (reference: the Facebook hover card). Every place
 * a person appears carries the same card, not only desktop:
 * - fine pointer: a short rest or a key focus opens it;
 * - touch: a tap opens it and hands it focus, and the card is the way to the
 *   profile, the friend action and the conversation. An activation with no
 *   pointer detail (`detail === 0`) follows the identity link directly, so a
 *   destination that already exists is never behind a card step.
 *
 * Inside the card the avatar and name are links, the friend/message action is
 * one button that also opens the chat, and "View full profile" is the explicit
 * second destination. The bio stays partial with See more, because a card that
 * grows to a full profile stops being a card.
 *
 * WHY NOT `LayeredPopover`: that wrapper registers a modal layer for Escape and
 * hardware Back. A profile card is not a modal step over the page, so it must
 * not take the top Escape slot from a dialog underneath. It still uses the one
 * shared surface (`fb-popover`) and React Aria's collision engine, so it flips,
 * clamps and stays inside the viewport.
 */

const PREVIEW_OPEN_MS = 200;
const PREVIEW_CLOSE_MS = 160;
const PROFILE_CACHE_TTL_MS = 300_000;
const BIO_CLAMP_CHARS = 150;

interface CacheEntry {
  at: number;
  profile: PublicProfile;
}

const profileCache = new Map<string, CacheEntry>();
const profileRequests = new Map<string, Promise<PublicProfile>>();

/** Test seam: the cache is process-wide, so a test can ask for a cold start. */
export function clearProfilePreviewCache(): void {
  profileCache.clear();
  profileRequests.clear();
}

function cachedProfile(person: PublicIdentity): PublicProfile | null {
  const entry = profileCache.get(person.id);
  if (!entry) return null;
  if (Date.now() - entry.at >= PROFILE_CACHE_TTL_MS) {
    profileCache.delete(person.id);
    return null;
  }
  return entry.profile;
}

function loadProfile(person: PublicIdentity): Promise<PublicProfile> {
  const cached = cachedProfile(person);
  if (cached) return Promise.resolve(cached);
  const pending = profileRequests.get(person.id);
  if (pending) return pending;
  const request = fetchPublicProfile(person.username)
    .then((profile) => {
      profileCache.set(person.id, { at: Date.now(), profile });
      return profile;
    })
    .finally(() => profileRequests.delete(person.id));
  profileRequests.set(person.id, request);
  return request;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; profile: PublicProfile }
  | { status: "error" };

export function ProfilePreview({ person, className = "", openOnFocus = true, children }: {
  person: PublicIdentity;
  className?: string;
  /**
   * Open when the wrapped control receives keyboard focus. True where the
   * wrapped control IS the identity link; false where the card wraps a row or
   * avatar inside a larger navigation target, whose focus must not be hijacked.
   */
  openOnFocus?: boolean;
  children: ReactNode;
}) {
  const finePointer = useFinePointer();
  return <PreviewCard person={person} className={className} finePointer={finePointer} openOnFocus={openOnFocus}>{children}</PreviewCard>;
}

function PreviewCard({ person, className, finePointer, openOnFocus, children }: {
  person: PublicIdentity;
  className?: string;
  finePointer: boolean;
  openOnFocus: boolean;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A card closed by Escape or by tabbing out puts focus back on the link.
  // Without this guard that focus would reopen the card it just left.
  const suppressFocusOpen = useRef(false);
  const keyboardOpened = useRef(false);
  // A tap or a key hands focus to the card once it opens; a rest does not.
  const focusIntoPanel = useRef(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<PreviewState>(() => {
    const cached = cachedProfile(person);
    return cached ? { status: "ready", profile: cached } : { status: "loading" };
  });
  const [connections, setConnections] = useState<number | null>(null);

  const name = identityDisplayName(person);
  const nameId = useId();
  const bioId = useId();
  const personId = person.id;
  const personUsername = person.username;
  const personRef = useRef(person);
  personRef.current = person;

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    cancelOpen();
    cancelClose();
    if (restoreFocus) {
      // Focus the identity before the panel unmounts. The overlay's teardown
      // otherwise parks focus on the body, and a later rAF races the browser's
      // own focus change. suppressFocusOpen stops this same focus reopening it.
      const link = triggerRef.current?.querySelector<HTMLElement>("a") ?? null;
      suppressFocusOpen.current = true;
      link?.focus();
      suppressFocusOpen.current = false;
    }
    setOpen(false);
    keyboardOpened.current = false;
    focusIntoPanel.current = false;
  }, [cancelClose, cancelOpen]);

  useEffect(() => () => { cancelOpen(); cancelClose(); }, [cancelOpen, cancelClose]);

  // A new person is a new card: a bio expanded for one author must not stay
  // expanded for the next.
  useEffect(() => { setExpanded(false); }, [personId]);

  // The card belongs to the row under the pointer, not to a scroll position.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => close(false);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, close]);

  // A touch card is dismissed by pressing anywhere outside it. The press that
  // opened it is already over, so this never fights the opening gesture.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  // Escape closes the card and gives the identity its focus back. Shift+Tab on
  // the card's first action does the same. Capture runs ahead of the page and
  // of the overlay's own key handling, so one key closes one layer.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        close(true);
        return;
      }
      if (event.key !== "Tab" || !event.shiftKey) return;
      const panel = panelRef.current;
      const target = event.target as Node | null;
      if (!panel || !target || !panel.contains(target)) return;
      const first = panel.querySelector<HTMLElement>("a[href], button:not([disabled])");
      if (!first || first !== target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      close(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Load on open; the cache serves the next five minutes. Keyed by account id,
  // so a renamed handle cannot split one person into two entries.
  useEffect(() => {
    if (!open || state.status !== "loading") return;
    const latest = personRef.current;
    const cached = cachedProfile(latest);
    if (cached) { setState({ status: "ready", profile: cached }); return; }
    let alive = true;
    loadProfile(latest)
      .then((profile) => { if (alive) setState({ status: "ready", profile }); })
      .catch(() => { if (alive) setState({ status: "error" }); });
    return () => { alive = false; };
  }, [open, state.status, personId, personUsername]);

  // A failed load is not cached, so reopening the card asks again.
  useEffect(() => {
    if (!open) return;
    setState((current) => current.status === "error" ? { status: "loading" } : current);
  }, [open]);

  // The friend count is a public number, read only while the card is open. A
  // failed read omits the line instead of printing a zero it cannot prove.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setConnections(null);
    void fetchConnectionCount(personId)
      .then((count) => { if (alive) setConnections(count); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [open, personId]);

  const onPointerEnter = (event: ReactPointerEvent) => {
    if (!finePointer || event.pointerType === "touch") return;
    keyboardOpened.current = false;
    focusIntoPanel.current = false;
    cancelClose();
    if (open) return;
    cancelOpen();
    openTimer.current = setTimeout(() => { openTimer.current = null; setOpen(true); }, PREVIEW_OPEN_MS);
  };

  const onPointerLeave = () => {
    if (!finePointer) return;
    cancelOpen();
    // A pointer that leaves a card the reader has focused (or is using) must
    // not pull it out from under them.
    if (panelRef.current?.contains(document.activeElement)) return;
    cancelClose();
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); keyboardOpened.current = false; }, PREVIEW_CLOSE_MS);
  };

  /**
   * Touch has no hover, so the tap opens the card and hands it focus. An
   * activation with no pointer detail (`detail === 0`) keeps the link's own
   * destination instead of adding a card step.
   */
  const onTriggerClick = (event: ReactMouseEvent) => {
    if (finePointer) return;
    if (event.detail === 0) return;
    // The panel portals to the body but stays inside this trigger's React tree,
    // so its own taps reach this capture first. A tap on the card's controls is
    // a destination or a close, never a request to reopen the card.
    const target = event.target as Node | null;
    if (target && panelRef.current?.contains(target)) return;
    event.preventDefault();
    cancelClose();
    if (!open) focusIntoPanel.current = true;
    setOpen(true);
  };

  // A tap or a key hands focus to the card once the portalled panel has
  // committed. A rest-opened card leaves focus where the reader had it, and
  // preventScroll keeps this focus change from scrolling the card and tripping
  // its own scroll dismissal.
  useEffect(() => {
    if (!open || !focusIntoPanel.current) return;
    focusIntoPanel.current = false;
    panelRef.current
      ?.querySelector<HTMLElement>("a[href], button:not([disabled])")
      ?.focus({ preventScroll: true });
  }, [open]);

  // Keyboard focus opens at once, as the metadata labels do. Touch focus is the
  // tap itself, which has its own path above.
  const onFocus = (event: ReactFocusEvent) => {
    if (!finePointer || !openOnFocus) return;
    if (panelRef.current?.contains(event.target as Node)) return;
    if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; }
    keyboardOpened.current = true;
    if (!open) focusIntoPanel.current = true;
    cancelOpen();
    cancelClose();
    setOpen(true);
  };

  const onBlur = (event: ReactFocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && (triggerRef.current?.contains(next) || panelRef.current?.contains(next))) return;
    if (keyboardOpened.current) close(false);
  };

  const profile = state.status === "ready" ? state.profile : null;
  const shownName = profile?.displayName?.trim() || name;
  const shownAvatar = profile?.avatarUrl ?? person.avatarUrl ?? null;
  const handle = profile?.username || person.username;
  const href = identityHref(person);
  const location = profile?.locationLabel?.trim() || "";
  const bio = profile?.bio?.trim() || "";
  const longBio = bio.length > BIO_CLAMP_CHARS;
  const connectionsLabel = connectionCountLabel(connections);

  return (
    <span
      ref={triggerRef}
      className={`fb-profile-preview-trigger ${className}`.trim()}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClickCapture={onTriggerClick}
    >
      {children}
      {open && (
        <Popover
          isOpen
          onOpenChange={(next) => { if (!next) close(false); }}
          triggerRef={triggerRef}
          isNonModal
          placement="bottom start"
          offset={10}
          className="fb-popover fb-profile-preview-panel"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-labelledby={nameId}
            data-testid="profile-preview"
            onPointerEnter={cancelClose}
            onPointerLeave={onPointerLeave}
            className="fb-profile-preview"
          >
            <button
              type="button"
              className="fb-profile-preview-close"
              aria-label="Close profile preview"
              onClick={() => close(true)}
            >
              <X size={16} aria-hidden="true" />
            </button>
            <div className="fb-profile-preview-top">
              <Link to={href} className="fb-profile-preview-avatar" aria-label={`Open ${shownName}'s profile`}>
                <UserAvatar username={shownName} avatarUrl={shownAvatar} size={64} />
              </Link>
              <div className="fb-profile-preview-identity">
                <Link id={nameId} to={href} className="fb-profile-preview-name">
                  <span className="fb-profile-preview-name-text">{shownName}</span>
                  {profile && <VerifiedBadge emailVerified={profile.emailVerified} phoneVerified={profile.phoneVerified} />}
                </Link>
                <p className="fb-profile-preview-handle" data-testid="profile-preview-handle">@{handle}</p>
              </div>
            </div>

            {state.status === "loading" && (
              <div className="fb-profile-preview-placeholder" aria-hidden="true">
                <span /><span />
              </div>
            )}
            {state.status === "error" && (
              <p className="fb-profile-preview-note" data-testid="profile-preview-error">
                Profile details could not load. The profile page still opens.
              </p>
            )}

            {location && (
              <p className="fb-profile-preview-fact">
                <MapPin size={15} aria-hidden="true" />
                <span>{location}</span>
              </p>
            )}
            {profile?.createdAt && (
              <p className="fb-profile-preview-fact">
                <CalendarDays size={15} aria-hidden="true" />
                <span>{formatJoinedMonth(profile.createdAt)}</span>
              </p>
            )}
            {connectionsLabel && (
              <p className="fb-profile-preview-fact" data-testid="profile-preview-connections">
                <Users size={15} aria-hidden="true" />
                <span>{connectionsLabel}</span>
              </p>
            )}

            {bio ? (
              <div className="fb-profile-preview-bio-wrap">
                <p id={bioId} className="fb-profile-preview-bio" data-expanded={expanded ? "true" : undefined}>{bio}</p>
                {longBio && (
                  <button
                    type="button"
                    className="fb-profile-preview-more"
                    aria-expanded={expanded}
                    aria-controls={bioId}
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? "Show less" : "See more"}
                  </button>
                )}
              </div>
            ) : state.status === "ready" ? (
              // Owner direction 2026-11-18: a missing bio is stated, not left
              // as a blank gap that reads like a failed load.
              <p className="fb-profile-preview-empty" data-testid="profile-preview-no-bio">No bio</p>
            ) : null}

            <div className="fb-profile-preview-actions">
              <PeerChatButton person={person} />
              <Link to={href} className="fb-profile-preview-action" aria-label="View full profile">
                View full profile
              </Link>
            </div>
          </div>
        </Popover>
      )}
    </span>
  );
}
