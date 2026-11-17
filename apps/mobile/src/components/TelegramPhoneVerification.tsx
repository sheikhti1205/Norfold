import { useCallback, useEffect, useRef, useState } from "react";
import { Browser } from "@capacitor/browser";
import { CheckCircle2 } from "lucide-react";
import { Button } from "./Button";
import { TelegramMark } from "./BrandMarks";
import { useOtpCountdown } from "./auth/useOtpCountdown";
import {
  createTelegramLink,
  getTelegramAccount,
  getTelegramLinkState,
  TELEGRAM_BOT_URL,
  type TelegramAccount,
} from "../services/telegram";

/**
 * Phone verification through Telegram.
 *
 * Norfold has no SMS provider. The number is verified only when Telegram
 * returns the reader's own shared contact to the server RPC; a typed number on
 * this device is never proof. Every state here mirrors `telegram_links`
 * (`findback_telegram_account_state`), so a failed or unavailable connection
 * leaves the number unverified instead of pretending otherwise.
 */

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "unlinked" }
  | { kind: "waiting"; token: string; deadline: number }
  | { kind: "connected"; username: string | null }
  | { kind: "verified"; phone: string; username: string | null };

const POLL_MS = 3_000;

export function telegramPhoneState(account: TelegramAccount): State {
  if (account.linked && account.phone) {
    return { kind: "verified", phone: account.phone, username: account.username };
  }
  if (account.linked) return { kind: "connected", username: account.username };
  return { kind: "unlinked" };
}

/** `expiresIn` is already rendered by the caller; keep it a plain number. */
function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TelegramPhoneVerification({
  className = "",
}: {
  className?: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const applyAccount = useCallback((account: TelegramAccount) => {
    if (!alive.current) return;
    setState(telegramPhoneState(account));
    setNotice(null);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError(null);
    try {
      const account = await getTelegramAccount();
      applyAccount(account);
    } catch {
      if (alive.current) setState({ kind: "unavailable" });
    }
  }, [applyAccount]);

  useEffect(() => {
    void load();
  }, [load]);

  const deadline = state.kind === "waiting" ? state.deadline : 0;
  const { seconds } = useOtpCountdown(0, deadline);

  // While the bot link is pending, poll the server's token state. A consumed
  // token proves the account is linked; only a returned phone proves the number
  // was verified through the reader's own contact.
  useEffect(() => {
    if (state.kind !== "waiting") return;
    const { token, deadline: expiresAt } = state;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const expire = () => {
      if (!active) return;
      setState({ kind: "unlinked" });
      setError("This connection expired. Try again.");
    };

    const schedule = (delay: number) => {
      if (!active) return;
      if (Date.now() + delay < expiresAt) {
        timer = setTimeout(() => void check(), delay);
        return;
      }
      // The next poll would land after expiry: stop at the deadline instead of
      // leaving a frozen 0:00 card.
      timer = setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    };

    async function check() {
      if (!active) return;
      if (Date.now() >= expiresAt) {
        expire();
        return;
      }
      try {
        const result = await getTelegramLinkState(token);
        if (!active) return;
        if (result.state === "expired") {
          expire();
          return;
        }
        if (result.state === "linked") {
          const account = await getTelegramAccount();
          if (!active) return;
          applyAccount(account);
          return;
        }
        failures = 0;
        schedule(POLL_MS);
      } catch {
        if (!active) return;
        failures += 1;
        schedule(Math.min(POLL_MS * 2 ** Math.min(failures, 4), 48_000));
      }
    }

    schedule(POLL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [state, applyAccount]);

  // Returning from Telegram is the common path on a phone. Re-read the server
  // state when the app becomes visible again instead of showing a stale card.
  const recheckOnReturn = state.kind === "connected" || state.kind === "waiting";
  useEffect(() => {
    if (!recheckOnReturn) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void getTelegramAccount().then(applyAccount).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recheckOnReturn, applyAccount]);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const link = await createTelegramLink();
      if (!alive.current) return;
      if (Date.parse(link.expiresAt) <= Date.now()) {
        setError("This connection expired. Try again.");
        return;
      }
      await Browser.open({ url: link.deepLink });
      if (!alive.current) return;
      setState({ kind: "waiting", token: link.token, deadline: Date.parse(link.expiresAt) });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof Error && err.message === "verify your email first") {
        setError("Verify your email first, then connect Telegram.");
      } else {
        setError("Telegram is unavailable right now. Your number stays unverified. Try again.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function recheck() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const account = await getTelegramAccount();
      applyAccount(account);
      if (telegramPhoneState(account).kind !== "verified") {
        setNotice("No number from Telegram yet. In the bot chat, send /start, then tap Share my number.");
      }
    } catch {
      if (alive.current) setNotice("Could not check Telegram yet. Your number stays unverified.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function openBot() {
    try {
      await Browser.open({ url: TELEGRAM_BOT_URL });
    } catch {
      if (alive.current) setError("Could not open Telegram. Open it yourself and send /start to @Norfold_auth_bot.");
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {state.kind === "loading" && (
        <p role="status" className="text-sm text-on-surface-variant">
          Checking Telegram…
        </p>
      )}

      {state.kind === "unavailable" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-on-surface-variant">
            We could not check Telegram. Your number stays unverified until the connection works.
          </p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {state.kind === "unlinked" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-on-surface-variant">
            We confirm your mobile number through Telegram, not text messages. Open the Norfold bot, press Start, then tap Share my number.
          </p>
          <Button onClick={() => void connect()} loading={busy}>
            <TelegramMark size={18} />
            Verify with Telegram
          </Button>
        </div>
      )}

      {state.kind === "waiting" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-on-surface-variant">Open Telegram and press Start.</p>
          <p className="text-sm text-on-surface-variant">
            Then tap Share my number in the bot chat. A typed number does not verify anything.
          </p>
          <p className="text-sm text-on-surface-variant" role="status">
            This connection expires in {countdown(seconds)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void openBot()}>
              <TelegramMark size={16} />
              Open Telegram
            </Button>
            <Button variant="text" onClick={() => { setState({ kind: "unlinked" }); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state.kind === "connected" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-on-surface-variant">
            Telegram is connected{state.username ? ` as @${state.username}` : ""}. In the bot chat, tap Share my number. If the button is missing, send /start.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={busy} onClick={() => void recheck()}>
              Check again
            </Button>
            <Button variant="text" onClick={() => void openBot()}>
              <TelegramMark size={16} />
              Open Telegram
            </Button>
          </div>
        </div>
      )}

      {state.kind === "verified" && (
        <div className="flex items-start gap-3 rounded-m3-md bg-surface-container-low p-4">
          <CheckCircle2 className="mt-0.5 shrink-0 text-on-surface" size={20} aria-hidden />
          <div>
            <p className="font-medium">Mobile number verified with Telegram</p>
            <p className="text-sm text-on-surface-variant">{state.phone}</p>
            {state.username && <p className="text-sm text-on-surface-variant">@{state.username}</p>}
          </div>
        </div>
      )}

      {notice && (
        <p className="text-sm text-on-surface-variant" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
