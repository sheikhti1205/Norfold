import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, Dialog, DialogTrigger } from "react-aria-components";
import { ChevronLeft, ChevronRight, CircleHelp, LogOut, MessageSquareWarning, Palette, Settings, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../auth";
import { useWideViewport } from "./responsive";
import { ConfirmDialog } from "./AdaptiveTaskSurface";
import { LayeredPopover } from "./overlayFoundation";
import { UserAvatar } from "./UserAvatar";
import { VerifiedBadge } from "./VerifiedBadge";
import {
  readRememberedAccounts, subscribeRememberedAccounts, type RememberedAccount,
} from "../services/rememberedAccounts";
import { PersonalizationPanel, SwitchAccountPanel } from "./AccountPreviews";
import "./AccountMenu.css";

type PanelId = "switch" | "personalization" | null;

/**
 * The rail's single identity control.
 *
 * Owner order 2026-11-13 (reference: the ChatGPT account popover): the menu is
 * the width of the rail, opens above the trigger, and leads with the account
 * line - avatar, name, earned badge, arrow - which opens the account switcher.
 * Then Personalization, Activity preferences, Settings, Report a problem, Help,
 * Log out. Settings opens the floating settings window instead of a nested
 * option list; Personalization is the Appearance controls under the name the
 * owner uses for them.
 *
 * Rows are click-driven. The hover previews of R2 put a panel next to the card
 * and made the pointer own the layout; a click cannot be surprised by the
 * surface moving under it. A sub-panel replaces the row list inside the same
 * card, so nothing is ever painted beside it.
 */
export function AccountMenu({ onOpenSettings = () => {} }: { onOpenSettings?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const wide = useWideViewport();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PanelId>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [accounts, setAccounts] = useState<RememberedAccount[]>(readRememberedAccounts);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const name = user?.displayName?.trim() || user?.username || "Account";
  const verification = user as { emailVerified?: boolean; phoneVerified?: boolean; telegramPhoneVerified?: boolean } | null;
  const others = accounts.filter((account) => account.id !== user?.id);

  useEffect(() => subscribeRememberedAccounts(() => setAccounts(readRememberedAccounts())), []);
  useEffect(() => { if (!open) setPanel(null); }, [open]);
  useEffect(() => {
    // Registered once, at mount, so this capture listener runs before the
    // popover's own Escape handling: Escape closes the open sub-panel first and
    // the popover second, never both at once.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !panel) return;
      event.preventDefault();
      event.stopPropagation();
      setPanel(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panel]);

  const closeAll = () => { setPanel(null); setOpen(false); };
  const openSettings = () => { closeAll(); onOpenSettings(); };
  const signOut = () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    void logout().then(() => setConfirming(false), () => setError(true)).finally(() => setBusy(false));
  };
  const switchTo = (account: RememberedAccount) => {
    if (switching) return;
    setSwitching(account.id);
    setSwitchError(null);
    // Keep the account being left: signing out of one account must not erase
    // the other identity from this device's chooser.
    void logout({ keepAccount: true }).then(() => {
      closeAll();
      navigate("/signin", { state: { rememberedAccountId: account.id }, replace: true });
    }, () => setSwitchError("Could not switch accounts. Try again.")).finally(() => setSwitching(null));
  };

  return <div className="fb-account-rail">
    <DialogTrigger isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setPanel(null); }}>
      {/* A signed-out rail has no name to add; "Account, Account" is not a
          name, so the label is just "Account" rather than repeating the word. */}
      <Button aria-label={name === "Account" ? "Account" : `Account, ${name}`}
        aria-expanded={open}
        className="fb-nav-link fb-account-trigger">
        <UserAvatar avatarUrl={user?.avatarUrl} username={name} size={32} />
        <span className="fb-account-trigger-text">
          <span className="fb-account-trigger-name">{name}</span>
          {user?.username && <span className="fb-account-trigger-handle">@{user.username}</span>}
        </span>
        <VerifiedBadge emailVerified={verification?.emailVerified} phoneVerified={verification?.phoneVerified}
          telegramPhoneVerified={verification?.telegramPhoneVerified} />
      </Button>
      {/* Wide: above the trigger and flush with the rail's outer edges - the
          menu is the rail's width and rises over the destinations, like the
          reference. Compact: above and end-aligned; a right-side placement put
          a 287px popover at x=347 on a 390px phone, entirely off-screen. */}
      <LayeredPopover placement={wide ? "top" : "top end"} offset={8} className="fb-account-menu">
        <Dialog aria-label="Account" className="fb-account-dialog">
          {panel === "switch" ? <PanelShell title="Switch account" onBack={() => setPanel(null)}>
            <SwitchAccountPanel current={{ id: user?.id ?? "", name, username: user?.username ?? "" }} accounts={others}
              switching={switching} error={switchError} onSwitch={switchTo}
              onAdd={() => { closeAll(); navigate("/auth"); }} />
          </PanelShell> : panel === "personalization" ? <PanelShell title="Personalization" onBack={() => setPanel(null)}>
            <PersonalizationPanel onOpenPage={() => { closeAll(); navigate("/settings/appearance"); }} />
          </PanelShell> : <div className="fb-account-list">
            <button type="button" className="fb-account-row fb-account-identity" aria-haspopup="dialog"
              aria-expanded={false} onClick={() => setPanel("switch")}>
              <UserAvatar avatarUrl={user?.avatarUrl} username={name} size={36} />
              <span className="fb-account-identity-text">
                <span className="fb-account-identity-name">
                  <strong>{name}</strong>
                  <VerifiedBadge emailVerified={verification?.emailVerified} phoneVerified={verification?.phoneVerified}
                    telegramPhoneVerified={verification?.telegramPhoneVerified} />
                </span>
                {user?.username && <span>@{user.username}</span>}
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <div className="fb-account-divider" />
            <button type="button" className="fb-account-row" aria-haspopup="dialog"
              onClick={() => setPanel("personalization")}>
              <Palette size={20} aria-hidden="true" /><span className="fb-account-row-label">Personalization</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <a href="/settings/notifications" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/settings/notifications"); }}>
              <SlidersHorizontal size={20} aria-hidden="true" /><span className="fb-account-row-label">Activity preferences</span><ChevronRight size={18} aria-hidden="true" />
            </a>
            <button type="button" className="fb-account-row" aria-haspopup="dialog" onClick={openSettings}>
              <Settings size={20} aria-hidden="true" /><span className="fb-account-row-label">Settings</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <a href="/settings/feedback" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/settings/feedback"); }}>
              <MessageSquareWarning size={20} aria-hidden="true" /><span className="fb-account-row-label">Report a problem</span><ChevronRight size={18} aria-hidden="true" />
            </a>
            <a href="/settings/help" className="fb-account-row" onClick={(event) => { event.preventDefault(); closeAll(); navigate("/settings/help"); }}>
              <CircleHelp size={20} aria-hidden="true" /><span className="fb-account-row-label">Help</span><ChevronRight size={18} aria-hidden="true" />
            </a>
            <Button className="fb-account-row" onPress={() => { closeAll(); setError(false); setConfirming(true); }}>
              <LogOut size={20} aria-hidden="true" /><span className="fb-account-row-label">Log out</span><ChevronRight size={18} aria-hidden="true" />
            </Button>
          </div>}
        </Dialog>
      </LayeredPopover>
    </DialogTrigger>
    <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Log out?"
      description="You can sign in again later." confirmLabel="Log out" onConfirm={signOut} busy={busy}>
      {error && <p role="alert">Could not log out. Please try again.</p>}
    </ConfirmDialog>
  </div>;
}

function PanelShell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return <div className="fb-account-panel">
    <div className="fb-account-panel-head">
      <button type="button" className="fb-account-back" aria-label="Back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <h2 className="fb-account-panel-title">{title}</h2>
    </div>
    {children}
  </div>;
}
