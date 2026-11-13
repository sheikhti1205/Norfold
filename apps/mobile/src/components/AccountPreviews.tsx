import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppearance, ACCENT_OPTIONS, type AccentId, type NavLayout } from "../appearance";
import { useTheme, type Theme } from "../theme";
import { NavLayoutCard, ThemeCard } from "./settings";
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
 * store the Appearance page writes, and the contact rule writes the account row
 * `findback_set_contact_rules` stores. Every panel also carries one explicit way
 * to the full page for the reader who wants the roomier version.
 */
export function AppearancePreview({ onOpenPage }: { onOpenPage: () => void }) {
  const { settings, update } = useAppearance();
  const { theme, setTheme } = useTheme();
  const chooseAccent = (accent: AccentId) => update({ accent, accentSource: "preset" });
  const chooseLayout = (navLayout: NavLayout) => update({ navLayout, navLayoutChosen: true });
  return <div className="fb-account-panel">
    <h3>Appearance</h3>
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
      Open Appearance<ChevronRight size={16} aria-hidden="true" />
    </button>
  </div>;
}

/**
 * One question, because the product has one gate.
 *
 * A first message in this schema *is* the connection request: nothing else can
 * reach an account before a conversation connects. Two dropdowns over that one
 * event would let a reader set answers that contradict each other and promise a
 * distinction the admission path cannot honour, so the panel asks the question
 * that is actually enforced and writes both stored columns from that answer.
 * Contact details are not offered here because no surface shows them yet.
 */
const CONTACT_RULE_QUESTION = "Who can start a conversation with you";
const CONTACT_RULE_HINT =
  "Applies to new conversations. People you have connected with can always reach you.";

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

  const chooseContactRule = (value: ContactRule) => {
    const previous = rules;
    const next = { ...rules, messageFrom: value, connectFrom: value };
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
      <label className="fb-account-rule">
        <span className="fb-account-rule-label">{CONTACT_RULE_QUESTION}</span>
        <select value={rules.messageFrom} disabled={loading} aria-label={CONTACT_RULE_QUESTION}
          aria-describedby="contact-rule-hint"
          onChange={(event) => chooseContactRule(event.target.value as ContactRule)}>
          {CONTACT_RULE_VALUES.map((value) => <option key={value} value={value}>{CONTACT_RULE_LABELS[value]}</option>)}
        </select>
        <span id="contact-rule-hint" className="fb-account-rule-hint">{CONTACT_RULE_HINT}</span>
      </label>
    </fieldset>
    {status && <p role={failed ? "alert" : "status"} className="fb-account-panel-status">{status}</p>}
  </div>;
}
