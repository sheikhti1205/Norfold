import { useEffect, useRef, useState } from "react";
import { CheckCheck, MessagesSquare } from "lucide-react";
import { useAuth } from "../auth";
import { SelectField } from "../components/Fields";
import { SettingsGroup, SettingsPage, PreferenceSwitchRow } from "../components/settings";
import {
  CONTACT_RULE_LABELS, CONTACT_RULE_VALUES, DEFAULT_CONTACT_RULES, fetchContactRules,
  saveContactRules, type AccountContactRules, type ContactRule,
} from "../services/accountRules";
import { fetchMessagingPreferences, setMessagingPreference } from "../services/messaging/runtime";
import { useMessaging } from "../services/messaging/useMessaging";
import type { MessagingPreferences } from "../services/messaging/session";
import { BackupSettings } from "./BackupSettings";
import { MediaSettings } from "./MediaSettings";
import "./MessagingPrivacy.css";

export function MessagingPrivacy() {
  const { user } = useAuth();
  return user ? <MessagingPrivacySession key={user.id} accountId={user.id} /> : null;
}

function MessagingPrivacySession({ accountId }: { accountId: string }) {
  const chat = useMessaging();
  const available = chat.status === "ready" || chat.status === "offline";
  const [preferences, setPreferences] = useState<MessagingPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    setError(null);
    void fetchMessagingPreferences(accountId).then((next) => {
      if (!cancelled) setPreferences(next);
    }).catch(() => {
      if (!cancelled) setError("Your message settings could not load. Check your connection and try again.");
    });
    return () => { cancelled = true; };
  }, [accountId, available, attempt]);

  async function change(key: keyof MessagingPreferences, enabled: boolean) {
    if (busy || !preferences) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const next = await setMessagingPreference(accountId, key, enabled);
      if (alive.current) { setPreferences(next); setSaved(true); }
    } catch {
      // A failed read-back can follow a successful write. Do not assert rollback.
      if (alive.current) setError("Could not confirm your saved setting. Try reloading before changing it again.");
    } finally { if (alive.current) setBusy(false); }
  }
  return <SettingsPage title="Chat" backTo="/settings">
    <SettingsGroup title="Who can message you" description="New people send a request first. Choose who may start one, and whether an allowed request connects right away.">
      <ContactRules />
      {preferences && <PreferenceSwitchRow title="Connect new people automatically" icon={MessagesSquare}
        description="When someone is allowed to message you, connect right away instead of waiting for you to accept. This won’t accept requests you already have."
        checked={preferences.openMessages} disabled={busy || !!error || chat.status !== "ready"}
        onChange={(enabled) => void change("openMessages", enabled)} />}
    </SettingsGroup>
    {/* The row is the section: a heading repeating "Read receipts" directly
        above the same label read as a duplicated control. */}
    {preferences && <SettingsGroup>
      <PreferenceSwitchRow title="Read receipts" icon={CheckCheck}
        description="In connected chats, both people must enable receipts to see when messages are read. Never shared for message requests."
        checked={preferences.readReceipts} disabled={busy || !!error || chat.status !== "ready"}
        onChange={(enabled) => void change("readReceipts", enabled)} />
    </SettingsGroup>}
    {!preferences && !error && <p role="status" className="text-sm text-on-surface-variant">{chat.status === "error"
      ? "Your chats could not open. Go to Connections to try syncing again." : "Loading message settings…"}</p>}
    {busy && <p role="status" className="text-sm text-on-surface-variant">Saving…</p>}
    {saved && <p role="status" className="text-sm text-on-surface-variant">Settings saved.</p>}
    {error && <div><p role="alert" className="text-sm text-error">{error}</p>
      <button type="button" className="min-h-[44px] px-2 underline" disabled={busy} onClick={() => { setSaved(false); setAttempt((value) => value + 1); }}>Reload settings</button></div>}
    <BackupSettings />
    <MediaSettings />
  </SettingsPage>;
}

const CONTACT_RULE_QUESTION = "Who can start a conversation with you";
const CONTACT_RULE_HINT =
  "Applies to new conversations. People you have connected with can always reach you.";

/**
 * The account's contact rules belong to Chat: they decide whether a stranger may
 * open a conversation, and the switch beside them decides whether an allowed
 * approach connects automatically. Profile keeps identity and sign-in only
 * (owner order 2026-11-14).
 */
function ContactRules() {
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

  const choose = (value: ContactRule) => {
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

  return <div className="fb-chat-contact-rule">
    <SelectField
      label={CONTACT_RULE_QUESTION}
      value={rules.messageFrom}
      disabled={loading}
      onChange={(value) => choose(value as ContactRule)}
      hint={CONTACT_RULE_HINT}
      triggerClassName="fb-chat-contact-trigger"
      options={CONTACT_RULE_VALUES.map((value) => ({ value, label: CONTACT_RULE_LABELS[value] }))}
    />
    {status && <span role={failed ? "alert" : "status"} className="fb-chat-contact-status">{status}</span>}
  </div>;
}
