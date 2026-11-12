import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Dialog, DialogTrigger } from "react-aria-components";
import { Bookmark, ChevronRight, CircleHelp, LogOut, MessageSquareWarning, Palette, Settings } from "lucide-react";
import { useAuth } from "../auth";
import { ConfirmDialog } from "./AdaptiveTaskSurface";
import { LayeredPopover } from "./overlayFoundation";
import { UserAvatar } from "./UserAvatar";
import { identityHref } from "./UserIdentityTrigger";
import "./AccountMenu.css";

export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const name = user?.displayName?.trim() || user?.username || "Account";
  const destination = user?.username ? identityHref({ username: user.username }) : "/profile";

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

  return <div className="fb-account-rail">
    <Button aria-label="Settings" aria-expanded={pathname === "/settings" || pathname.startsWith("/settings/")}
      className="fb-nav-link text-on-surface-variant" onPress={() => { setOpen(false); navigate("/settings"); }}>
      <Settings size={22} aria-hidden="true" />
      <span className="sr-only">Settings</span>
    </Button>
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button aria-label="Account" className="fb-nav-link fb-account-trigger">
        <UserAvatar avatarUrl={user?.avatarUrl} username={name} size={40} />
      </Button>
      <LayeredPopover placement="right bottom" shouldFlip={false} offset={8} className="fb-account-menu">
        <Dialog aria-label="Account" className="fb-account-dialog">
          <Link to={destination} className="fb-account-row fb-account-identity" onClick={() => setOpen(false)}>
            <UserAvatar avatarUrl={user?.avatarUrl} username={name} size={40} />
            <span className="fb-account-identity-text"><strong>{name}</strong>{user?.username && <span>@{user.username}</span>}</span>
            <ChevronRight size={20} aria-hidden="true" />
          </Link>
          <div className="fb-account-divider" />
          <Link to="/settings/appearance" className="fb-account-row" onClick={() => setOpen(false)}><Palette size={24} aria-hidden="true" />Appearance</Link>
          <Link to="/saved" className="fb-account-row" onClick={() => setOpen(false)}><Bookmark size={24} aria-hidden="true" />Saved</Link>
          <Link to="/settings/feedback" className="fb-account-row" onClick={() => setOpen(false)}><MessageSquareWarning size={24} aria-hidden="true" />Report a problem</Link>
          <div className="fb-account-divider" />
          <Link to="/settings" className="fb-account-row" onClick={() => setOpen(false)}><Settings size={24} aria-hidden="true" />Settings</Link>
          <div className="fb-account-divider" />
          <Link to="/settings/help" className="fb-account-row" onClick={() => setOpen(false)}><CircleHelp size={24} aria-hidden="true" /><span>Help</span><ChevronRight size={20} aria-hidden="true" /></Link>
          <Button className="fb-account-row" onPress={() => { setOpen(false); setError(false); setConfirming(true); }}><LogOut size={24} aria-hidden="true" /><span>Log out</span><ChevronRight size={20} aria-hidden="true" /></Button>
        </Dialog>
      </LayeredPopover>
    </DialogTrigger>
    <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Log out?"
      description="You can sign in again later." confirmLabel="Log out" onConfirm={signOut} busy={busy}>
      {error && <p role="alert">Could not log out. Please try again.</p>}
    </ConfirmDialog>
  </div>;
}
