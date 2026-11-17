import { useEffect, useState } from "react";
import { getTelegramAccount, type TelegramAccount } from "../services/telegram";

/**
 * The one account-state reader for Telegram verification.
 *
 * `telegram_links` is the only proof of a verified mobile number (Norfold has
 * no SMS lane), so every surface that asks "is this account's number verified"
 * reads this RPC instead of `users.phone_verified`, which tracks the retired
 * typed-number path. The read repeats when the app regains focus: the common
 * route is out to the bot, tap Share my number, then back to the page, and a
 * stale "Not verified" after a real verification is the defect this fixes.
 */
export type TelegramAccountState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; account: TelegramAccount };

export function useTelegramAccount(userId: string | undefined): TelegramAccountState {
  const [state, setState] = useState<TelegramAccountState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setState({ status: "loading" });
      return () => { alive = false; };
    }
    setState({ status: "loading" });
    const load = () => {
      void getTelegramAccount().then(
        (account) => { if (alive) setState({ status: "ready", account }); },
        () => { if (alive) setState({ status: "unavailable" }); },
      );
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId]);

  return state;
}
