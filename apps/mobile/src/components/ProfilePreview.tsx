import { useCallback, useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Popover } from "react-aria-components";
import { MapPin } from "lucide-react";
import type { PublicProfile } from "@norfold/shared";
import { fetchPublicProfile } from "../services/profile";
import { useFinePointer } from "./inputCapabilities";
import { UserAvatar } from "./UserAvatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { identityDisplayName, identityHref, type PublicIdentity } from "./UserIdentityTrigger";
import "./ProfilePreview.css";

/**
 * Contextual profile preview for a fine pointer (owner scope 2026-11-12,
 * refined 2026-11-18).
 *
 * A person stays a destination: clicking the identity still opens the full
 * profile on every input. On a fine pointer the identity also answers a rest or
 * a key focus with the public facts the profile already owns, so a reader can
 * recognise the author without leaving the feed. Touch is unchanged and gets no
 * card at all.
 *
 * WHY NOT `LayeredPopover`: that wrapper registers a modal layer for Escape and
 * hardware Back. A hover card is not a modal step over the page, so it must not
 * take the top Escape slot from a dialog underneath. It still uses the one
 * shared surface (`fb-popover`) and React Aria's collision engine, so it
 * flips, clamps and stays inside the viewport like every other floating
 * surface, and it portals to the body so a masonry tile's transform cannot
 * clip it.
 */

const PREVIEW_OPEN_MS = 200;
const PREVIEW_CLOSE_MS = 160;
const PROFILE_CACHE_TTL_MS = 300_000;

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

export function ProfilePreview({ person, className = "", children }: {
  person: PublicIdentity;
  className?: string;
  children: ReactNode;
}) {
  const finePointer = useFinePointer();
  // The coarse path is exactly the old link: no wrapper listeners, no panel,
  // no data request. This is what ships on every phone.
  if (!finePointer) return <>{children}</>;
  return <FinePointerPreview person={person} className={className}>{children}</FinePointerPreview>;
}

function FinePointerPreview({ person, className, children }: {
  person: PublicIdentity;
  className?: string;
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
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PreviewState>(() => {
    const cached = cachedProfile(person);
    return cached ? { status: "ready", profile: cached } : { status: "loading" };
  });

  const name = identityDisplayName(person);
  const nameId = `fb-profile-preview-name-${person.id}`;
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
      // own focus change (the Shift+Tab exit used to land on the page's last
      // control). suppressFocusOpen stops this same focus from reopening it.
      const link = triggerRef.current?.querySelector<HTMLElement>("a") ?? null;
      suppressFocusOpen.current = true;
      link?.focus();
      suppressFocusOpen.current = false;
    }
    setOpen(false);
    keyboardOpened.current = false;
  }, [cancelClose, cancelOpen]);

  useEffect(() => () => { cancelOpen(); cancelClose(); }, [cancelOpen, cancelClose]);

  // The preview belongs to the row under the pointer, not to a scroll position.
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

  // Escape closes the card and gives the identity its focus back. Shift+Tab on
  // the card's first action does the same. Capture runs ahead of the page and
  // of the overlay's own key handling, so one key closes one layer; the panel
  // is portalled to the end of the body, so a native backward Tab would
  // otherwise jump to the last control on the page.
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

  // Load on open; the cache serves the next four minutes. Keyed by account id,
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

  const onPointerEnter = (event: ReactPointerEvent) => {
    if (event.pointerType === "touch") return;
    keyboardOpened.current = false;
    cancelClose();
    if (open) return;
    cancelOpen();
    openTimer.current = setTimeout(() => { openTimer.current = null; setOpen(true); }, PREVIEW_OPEN_MS);
  };

  const onPointerLeave = () => {
    cancelOpen();
    // A pointer that leaves a card the reader has focused (or is using) must
    // not pull it out from under them.
    if (panelRef.current?.contains(document.activeElement)) return;
    cancelClose();
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); keyboardOpened.current = false; }, PREVIEW_CLOSE_MS);
  };

  // A key focus hands focus to the card's one action once the portalled panel
  // has committed. The old rAF here raced the portal: it often ran before the
  // panel existed, so focus stayed on the link and the card was unreachable by
  // Tab. An effect runs after commit, which is the first moment the ref is real.
  useEffect(() => {
    if (!open || !keyboardOpened.current) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [open]);

  // Keyboard focus opens at once, as the metadata labels do.
  const onFocus = (event: ReactFocusEvent) => {
    if (panelRef.current?.contains(event.target as Node)) return;
    if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; }
    keyboardOpened.current = true;
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
  const location = profile?.locationLabel?.trim() || "";
  const bio = profile?.bio?.trim() || "";

  return (
    <span
      ref={triggerRef}
      className={`fb-profile-preview-trigger ${className}`.trim()}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
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
            <div className="fb-profile-preview-top">
              <UserAvatar username={shownName} avatarUrl={shownAvatar} size={64} />
              <div className="fb-profile-preview-identity">
                <p id={nameId} className="fb-profile-preview-name">
                  {shownName}
                  {profile && <VerifiedBadge emailVerified={profile.emailVerified} phoneVerified={profile.phoneVerified} />}
                </p>
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
            {bio && <p className="fb-profile-preview-bio">{bio}</p>}
            {location && (
              <p className="fb-profile-preview-location">
                <MapPin size={14} aria-hidden />
                <span>{location}</span>
              </p>
            )}
            <Link to={identityHref(person)} className="fb-profile-preview-action">View profile</Link>
          </div>
        </Popover>
      )}
    </span>
  );
}
