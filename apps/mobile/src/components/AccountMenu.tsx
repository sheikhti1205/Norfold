import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button, Dialog, DialogTrigger } from "react-aria-components";
import { Bookmark, ChevronRight, CircleHelp, LogOut, MessageSquareWarning, Palette, Settings, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../auth";
import { ConfirmDialog } from "./AdaptiveTaskSurface";
import { LayeredPopover } from "./overlayFoundation";
import { UserAvatar } from "./UserAvatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { identityHref } from "./UserIdentityTrigger";
import { AppearancePreview, SettingsPreview } from "./AccountPreviews";
import "./AccountMenu.css";

type PreviewId = "appearance" | "settings" | null;

/**
 * The rail's single identity control.
 *
 * Owner order 2026-11-12 (R1): an avatar and a gear as two separate controls was
 * wrong. One control carries the avatar, the account name, the handle and the
 * earned badge, and it is the only thing in the footer. Settings is reached from
 * inside the popover, not from a sibling icon.
 *
 * Rows with something to show open a nested floating panel beside the popover
 * (R2) instead of navigating: hovering with a fine pointer, focusing the row, or
 * pressing it. The panel lives inside the same floating layer, positioned beside
 * the dialog, so it never becomes a second focus trap; Escape closes the panel
 * first and the popover second, and focus is handed back to the row.
 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewId>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const rowRefs = useRef(new Map<PreviewId, HTMLButtonElement>());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<PreviewId>(null);
  const closeTimer = useRef<number | null>(null);
  const name = user?.displayName?.trim() || user?.username || "Account";
  const destination = user?.username ? identityHref({ username: user.username }) : "/profile";
  const verification = user as { emailVerified?: boolean; phoneVerified?: boolean; telegramPhoneVerified?: boolean } | null;

  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  useEffect(() => { if (!open) setPreview(null); }, [open]);
  useEffect(() => { previewRef.current = preview; }, [preview]);
  useEffect(() => {
    // Registered once, at mount, so this capture listener is earlier in the
    // window's listener list than the overlay's own Escape handling. That is
    // what makes Escape close the panel first and the popover second; a React
    // handler cannot order itself against react-aria's document listener.
    const onKey = (event: KeyboardEvent) => {
      const id = previewRef.current;
      if (event.key !== "Escape" || !id) return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
      rowRefs.current.get(id)?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const openPreview = (which: Exclude<PreviewId, null>) => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setPreview(which);
  };
  const closePreview = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setPreview(null);
  };
  const signOut = () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    void logout().then(() => setConfirming(false), () => setError(true)).finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  const closeAll = () => { setPreview(null); setOpen(false); };
  const previewRow = (id: Exclude<PreviewId, null>, label: string, icon: React.ReactNode) => (
    <button type="button" className="fb-account-row" aria-haspopup="dialog" aria-expanded={preview === id}
      ref={(node) => { if (node) rowRefs.current.set(id, node); }}
      onMouseEnter={() => openPreview(id)}
      onMouseLeave={() => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(closePreview, 140); }}
      onFocus={() => openPreview(id)}
      onClick={() => openPreview(id)}>
      {icon}<span>{label}</span><ChevronRight size={20} aria-hidden="true" />
    </button>
  );

  return <div className="fb-account-rail">
    <DialogTrigger isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setPreview(null); }}>
      {/* A signed-out rail has no name to add; "Account, Account" is not a
          name, so the label is just "Account" rather than repeating the word. */}
      <Button aria-label={name === "Account" ? "Account" : `Account, ${name}`}
        aria-expanded={pathname === "/settings" || pathname.startsWith("/settings/")}
        className="fb-nav-link fb-account-trigger">
        <UserAvatar avatarUrl={user?.avatarUrl} username={name} size={32} />
        <span className="fb-account-trigger-text">
          <span className="fb-account-trigger-name">{name}</span>
          {user?.username && <span className="fb-account-trigger-handle">@{user.username}</span>}
        </span>
        <VerifiedBadge emailVerified={verification?.emailVerified} phoneVerified={verification?.phoneVerified}
          telegramPhoneVerified={verification?.telegramPhoneVerified} />
      </Button>
      <LayeredPopover placement="right bottom" shouldFlip={false} offset={8} className="fb-account-menu">
        <Dialog aria-label="Account" className="fb-account-dialog">
          {/* The panel's Escape handling is a native capture listener on this
              wrapper (see the effect above): it has to run before the popover's
              own document listener, which a React bubble handler cannot
              guarantee. */}
          <div className="fb-account-body" ref={bodyRef}>
          <div className="fb-account-list">
            <a href={destination} className="fb-account-row fb-account-identity" onClick={(event) => { event.preventDefault(); closeAll(); navigate(destination); }}>
              <UserAvatar avatarUrl={user?.avatarUrl} username={name} size={40} />
              <span className="fb-account-identity-text"><strong>{name}</strong>{user?.username && <span>@{user.username}</span>}</span>
              <ChevronRight size={20} aria-hidden="true" />
            </a>
            <div className="fb-account-divider" />
            {previewRow("settings", "Settings", <Settings size={24} aria-hidden="true" />)}
            {previewRow("appearance", "Appearance", <Palette size={24} aria-hidden="true" />)}
            <a href="/settings/notifications" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/settings/notifications"); }}>
              <SlidersHorizontal size={24} aria-hidden="true" /><span>Activity preferences</span><ChevronRight size={20} aria-hidden="true" />
            </a>
            <a href="/saved" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/saved"); }}>
              <Bookmark size={24} aria-hidden="true" /><span>Saved</span><ChevronRight size={20} aria-hidden="true" />
            </a>
            <a href="/settings/feedback" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/settings/feedback"); }}>
              <MessageSquareWarning size={24} aria-hidden="true" /><span>Report a problem</span><ChevronRight size={20} aria-hidden="true" />
            </a>
            <a href="/settings/help" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/settings/help"); }}>
              <CircleHelp size={24} aria-hidden="true" /><span>Help</span><ChevronRight size={20} aria-hidden="true" />
            </a>
            <Button className="fb-account-row" onPress={() => { closeAll(); setError(false); setConfirming(true); }}>
              <LogOut size={24} aria-hidden="true" /><span>Log out</span><ChevronRight size={20} aria-hidden="true" />
            </Button>
          </div>
          {preview && <div className="fb-account-preview" role="group" aria-label={preview === "appearance" ? "Appearance preview" : "Settings preview"}
            onMouseEnter={() => openPreview(preview)} onMouseLeave={() => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(closePreview, 140); }}>
            {preview === "appearance"
              ? <AppearancePreview onOpenPage={() => { closeAll(); navigate("/settings/appearance"); }} />
              : <SettingsPreview onOpenPage={(path) => { closeAll(); navigate(path); }} />}
          </div>}
          </div>
        </Dialog>
      </LayeredPopover>
    </DialogTrigger>
    <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Log out?"
      description="You can sign in again later." confirmLabel="Log out" onConfirm={signOut} busy={busy}>
      {error && <p role="alert">Could not log out. Please try again.</p>}
    </ConfirmDialog>
  </div>;
}
