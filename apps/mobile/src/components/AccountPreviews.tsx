import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppearance, ACCENT_OPTIONS, type AccentId, type NavLayout } from "../appearance";
import { NavLayoutCard } from "./settings";
import {
  CONTACT_RULE_LABELS, CONTACT_RULE_VALUES, DEFAULT_CONTACT_RULES, fetchContactRules,
  saveContactRules, type AccountContactRules, type ContactRule,
} from "../services/accountRules";
import "./AccountMenu.css";

/**
 * The nested floating panels opened from the account popover.
 *
 * Owner order 2026-11-12 (R2): a row does not walk the reader to a page, it
 * shows what is inside the row. So these panels are the real controls, not a
 * screenshot of them: the accent and navigation tiles write the same appearance
 * store the Appearance page writes, and the contact rules write the account row
 * `findback_set_contact_rules` stores. Every panel also carries one explicit way
 * to the full page for the reader who wants the roomier version.
 */
export function AppearancePreview({ onOpenPage }: { onOpenPage: () => void }) {
  const { settings, update } = useAppearance();
  const chooseAccent = (accent: AccentId) => update({ accent, accentSource: "preset" });
  const chooseLayout = (navLayout: NavLayout) => update({ navLayout, navLayoutChosen: true });
  return <div className="fb-account-panel">
    <h3>Appearance</h3>
    <div role="group" aria-label="Accent" className="fb-account-accents">
      {ACCENT_OPTIONS.map((option) => (
        <button key={option.id} type="button" aria-label={option.label} aria-pressed={settings.accent === option.id}
          className="fb-account-accent" data-selected={settings.accent === option.id}
          style={{ background: option.swatch }} onClick={() => chooseAccent(option.id)} />
      ))}
    </div>
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
      Open Appearance<ChevronRight size={16} aria-hidden="true" />
    </button>
  </div>;
}

const RULES: readonly { key: keyof AccountContactRules; label: string; hint: string }[] = [
  { key: "messageFrom", label: "Who can message you", hint: "Applies when someone starts a new conversation." },
  { key: "connectFrom", label: "Who can connect with you", hint: "Connection requests from people you have not met." },
  { key: "showContact", label: "Who can see your contact details", hint: "Your phone and email on your profile." },
];

export function SettingsPreview({ onOpenPage }: { onOpenPage: (path: string) => void }) {
  const [rules, setRules] = useState<AccountContactRules>(DEFAULT_CONTACT_RULES);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchContactRules().then((next) => { if (alive) setRules(next); },
      () => { if (alive) { setFailed(true); setStatus("Could not load your contact rules. Pull them up again in a moment."); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const change = (key: keyof AccountContactRules) => (value: ContactRule) => {
    const previous = rules;
    const next = { ...rules, [key]: value };
    setRules(next);
    setFailed(false);
    setStatus(null);
    void saveContactRules(next).then((saved) => setRules(saved), () => {
      setRules(previous);
      setFailed(true);
      setStatus("That rule was not saved. Try again.");
    });
  };

  return <div className="fb-account-panel">
    <h3>Your account</h3>
    <div className="fb-account-panel-links">
      {[
        { label: "Edit profile", path: "/profile/edit" },
        { label: "Account settings", path: "/settings/account" },
        { label: "Devices", path: "/settings/devices" },
        { label: "Backup", path: "/settings/backup" },
      ].map((row) => (
        <button key={row.path} type="button" className="fb-account-panel-link" onClick={() => onOpenPage(row.path)}>
          {row.label}<ChevronRight size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
    <fieldset className="fb-choice-fieldset fb-account-rules" disabled={loading}>
      <legend>Contact rules</legend>
      {RULES.map((rule) => (
        <label key={rule.key} className="fb-account-rule">
          <span className="fb-account-rule-label">{rule.label}</span>
          <select value={rules[rule.key]} disabled={loading} aria-label={rule.label} aria-describedby={`${rule.key}-hint`}
            onChange={(event) => change(rule.key)(event.target.value as ContactRule)}>
            {CONTACT_RULE_VALUES.map((value) => <option key={value} value={value}>{CONTACT_RULE_LABELS[value]}</option>)}
          </select>
          <span id={`${rule.key}-hint`} className="fb-account-rule-hint">{rule.hint}</span>
        </label>
      ))}
    </fieldset>
    {status && <p role={failed ? "alert" : "status"} className="fb-account-panel-status">{status}</p>}
  </div>;
}
