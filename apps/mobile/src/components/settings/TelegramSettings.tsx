import { useCallback, useEffect, useRef, useState } from "react";
import { Browser } from "@capacitor/browser";
import { Button } from "../Button";
import { SettingsGroup } from "./SettingsPrimitives";
import { createTelegramLink, getTelegramAccount, getTelegramLinkState, unlinkTelegram, type TelegramAccount } from "../../services/telegram";

type View = { kind: "loading" | "error" | "unlinked" } | { kind: "linked"; account: TelegramAccount } | { kind: "waiting"; token: string; deadline: number };

export function TelegramSettings() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(() => { setView({ kind: "loading" }); setAttempt(value => value + 1); }, []);

  useEffect(() => {
    let alive = true;
    void getTelegramAccount().then(account => {
      if (alive) setView(account.linked ? { kind: "linked", account } : { kind: "unlinked" });
    }, () => { if (alive) setView({ kind: "error" }); });
    return () => { alive = false; };
  }, [attempt]);

  useEffect(() => {
    if (view.kind !== "waiting") return;
    const { token, deadline } = view;
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expire = () => {
      if (!alive) return;
      setMessage("This connection expired. Please try again.");
      setView({ kind: "unlinked" });
    };
    const tick = setInterval(() => { setNow(Date.now()); if (Date.now() >= deadline) expire(); }, 1000);
    const schedule = (delay: number) => {
      if (alive && Date.now() + delay < deadline) timer = setTimeout(() => { void check(); }, delay);
    };
    async function check() {
      if (!alive || Date.now() >= deadline) return;
      try {
        const result = await getTelegramLinkState(token);
        if (!alive || Date.now() >= deadline) return;
        if (result.state === "expired") { expire(); return; }
        if (result.state === "linked") {
          setMessage("");
          setView({ kind: "linked", account: { linked: true, phone: result.phone, username: null } });
          return;
        }
        failures = 0; setMessage(""); schedule(3000);
      } catch {
        if (!alive || Date.now() >= deadline) return;
        failures += 1; setMessage("Could not check the connection. Trying again.");
        schedule(Math.min(3000 * 2 ** Math.min(failures, 4), 48000));
      }
    }
    schedule(3000);
    return () => { alive = false; clearInterval(tick); if (timer) clearTimeout(timer); };
  }, [view]);

  const linkedWithoutUsername = view.kind === "linked" && view.account.username === null;
  useEffect(() => {
    if (!linkedWithoutUsername) return;
    let alive = true;
    void getTelegramAccount().then(account => {
      if (alive && account.linked && account.username) setView({ kind: "linked", account });
    }).catch(() => {});
    return () => { alive = false; };
  }, [linkedWithoutUsername]);

  async function connect() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const link = await createTelegramLink();
      if (!mounted.current) return;
      if (Date.parse(link.expiresAt) <= Date.now()) { setMessage("This connection expired. Please try again."); return; }
      await Browser.open({ url: link.deepLink });
      if (mounted.current) { setNow(Date.now()); setView({ kind: "waiting", token: link.token, deadline: Date.parse(link.expiresAt) }); }
    } catch { if (mounted.current) setMessage("Could not open Telegram. Please try again."); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function unlink() {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await unlinkTelegram(); if (mounted.current) { setConfirm(false); setView({ kind: "unlinked" }); } }
    catch { if (mounted.current) setMessage("Could not unlink Telegram. Please try again."); }
    finally { if (mounted.current) setBusy(false); }
  }

  const seconds = view.kind === "waiting" ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : 0;
  return <SettingsGroup title="Connect Telegram">
    <div className="fb-account-password">
      {view.kind === "loading" && <span aria-hidden="true">…</span>}
      {view.kind === "error" && <><p>Could not check your Telegram connection.</p><Button onClick={reload}>Retry Telegram</Button></>}
      {view.kind === "unlinked" && <><p>Connect Telegram for signing in, verifying a phone number, and unlinking without needing the device.</p><Button loading={busy} onClick={() => { void connect(); }}>Connect Telegram</Button></>}
      {view.kind === "waiting" && <><p>Open Telegram and press Start.</p><p>Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p><Button variant="text" onClick={() => { setMessage(""); setView({ kind: "unlinked" }); }}>Cancel</Button></>}
      {view.kind === "linked" && <>
        {view.account.username && <p>Connected as @{view.account.username}</p>}
        <p>{view.account.phone || "No number is shared yet."}</p>
        {!confirm ? <Button variant="outline" onClick={() => setConfirm(true)}>Unlink</Button> : <><p>Unlinking does not sign you out of the app.</p><div className="fb-account-confirm-row"><Button variant="outline" loading={busy} onClick={() => { void unlink(); }}>Confirm unlink</Button><Button variant="text" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button></div></>}
      </>}
      {message && <p role="status">{message}</p>}
    </div>
  </SettingsGroup>;
}
