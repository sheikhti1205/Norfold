import { ChevronRight, Plus } from "lucide-react";
import { useAppearance, ACCENT_OPTIONS, type AccentId, type NavLayout } from "../appearance";
import { useTheme, type Theme } from "../theme";
import { NavLayoutCard, ThemeCard } from "./settings";
import { UserAvatar } from "./UserAvatar";
import type { RememberedAccount } from "../services/rememberedAccounts";
import "./AccountMenu.css";

/**
 * The sub-panels that replace the account rows inside the same card.
 *
 * They are the real controls, not a picture of them: the accent and navigation
 * tiles write the appearance store the Personalization page writes, and the
 * account switcher uses the same remembered-account list the sign-in chooser
 * reads. Nothing here paints beside the popover - a panel owns the card while
 * it is open, and Back returns to the rows.
 */
export function PersonalizationPanel({ onOpenPage }: { onOpenPage: () => void }) {
  const { settings, update } = useAppearance();
  const { theme, setTheme } = useTheme();
  const chooseAccent = (accent: AccentId) => update({ accent, accentSource: "preset" });
  const chooseLayout = (navLayout: NavLayout) => update({ navLayout, navLayoutChosen: true });
  return <div className="fb-account-panel-body" role="group" aria-label="Personalization">
    <fieldset className="fb-choice-fieldset">
      <legend>Theme</legend>
      <div className="fb-preview-grid fb-preview-grid-theme">
        {(["system", "light", "dark"] as const satisfies readonly Theme[]).map((value) => (
          <ThemeCard key={value} name="account-theme" value={value}
            checked={theme === value} onChange={setTheme} />
        ))}
      </div>
    </fieldset>
    <fieldset className="fb-choice-fieldset">
      <legend>Accent</legend>
      <div className="fb-account-accents">
        {ACCENT_OPTIONS.map((option) => (
          <button key={option.id} type="button" aria-label={option.label} aria-pressed={settings.accent === option.id}
            className="fb-account-accent" data-selected={settings.accent === option.id}
            style={{ background: option.swatch }} onClick={() => chooseAccent(option.id)} />
        ))}
      </div>
    </fieldset>
    <fieldset className="fb-choice-fieldset fb-account-layout">
      <legend>Navigation</legend>
      <div className="fb-preview-grid fb-preview-grid-nav">
        {(["bottom", "rail"] as const).map((value) => (
          <NavLayoutCard key={value} name="fb-account-nav" value={value}
            checked={settings.navLayout === value} onChange={chooseLayout} />
        ))}
      </div>
    </fieldset>
    <button type="button" className="fb-account-panel-link" onClick={onOpenPage}>
      Open Personalization<ChevronRight size={16} aria-hidden="true" />
    </button>
  </div>;
}

export function SwitchAccountPanel({ current, accounts, switching, error, onSwitch, onAdd }: {
  current: { id: string; name: string; username: string };
  accounts: RememberedAccount[];
  switching: string | null;
  error: string | null;
  onSwitch: (account: RememberedAccount) => void;
  onAdd: () => void;
}) {
  return <div className="fb-account-panel-body" role="group" aria-label="Switch account">
    <div className="fb-account-current">
      <UserAvatar username={current.name} size={32} />
      <span className="fb-account-switch-copy">
        <span className="fb-account-switch-name">{current.name}</span>
        {current.username && <span className="fb-account-switch-handle">@{current.username}</span>}
      </span>
      <span className="fb-account-current-tag">Current</span>
    </div>
    <div className="fb-account-divider" />
    {accounts.length > 0 ? <ul className="fb-account-switch-list" aria-label="Other accounts on this device">
      {accounts.map((account) => <li key={account.id}>
        <button type="button" className="fb-account-switch-row" disabled={switching !== null}
          aria-label={`Switch to ${account.displayName}, @${account.username}`}
          onClick={() => onSwitch(account)}>
          <UserAvatar username={account.displayName} size={28} />
          <span className="fb-account-switch-copy">
            <span className="fb-account-switch-name">{account.displayName}</span>
            <span className="fb-account-switch-handle">@{account.username}</span>
          </span>
          {switching === account.id && <span className="fb-account-switch-busy">Switching</span>}
        </button>
      </li>)}
    </ul> : <p className="fb-account-switch-empty">No other accounts on this device.</p>}
    <button type="button" className="fb-account-add" aria-label="Add another account" onClick={onAdd}>
      <Plus size={18} aria-hidden="true" /><span>Add another account</span>
    </button>
    {error && <p role="alert" className="fb-account-panel-status">{error}</p>}
  </div>;
}
