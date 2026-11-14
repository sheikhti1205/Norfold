/**
 * The "add another account" intent, kept across the browser Google redirect.
 *
 * A signed-in reader adds a second account without signing the first one out:
 * the account menu saves the current sign-in and opens `/auth?addAccount=1`.
 * The web Google flow leaves the page entirely, so the query string is gone
 * when the provider returns; this session flag restores the intent for the
 * callback bridge, a failed provider return, or the browser Back path.
 *
 * It is deliberately narrow: no credentials, only the account that must stay
 * signed in, and it expires like the other one-shot auth handoffs. A different
 * account finishing sign-in clears it (see `setUserState` in `auth.tsx`), so a
 * finished or abandoned attempt cannot turn a later `/auth` visit into an
 * unexpected add-account screen.
 */
const KEY = "findback.addAccountIntent";
const TTL_MS = 10 * 60 * 1000;

interface AddAccountIntent {
  accountId: string;
  expiresAt: number;
}

function readIntent(): AddAccountIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AddAccountIntent> | null;
    if (!value || typeof value.accountId !== "string" || value.accountId.length === 0
      || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()
      || value.expiresAt > Date.now() + TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return { accountId: value.accountId, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/** Start an add-account attempt that must keep `accountId` signed in. */
export function beginAddAccountIntent(accountId: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ accountId, expiresAt: Date.now() + TTL_MS }));
  } catch {
    /* navigation still works without storage */
  }
}

/** The account that must stay signed in, or null when no attempt is open. */
export function addAccountIntentAccount(): string | null {
  return readIntent()?.accountId ?? null;
}

export function clearAddAccountIntent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* unavailable storage */
  }
}
