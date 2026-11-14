/** Retained SDK credentials. This storage is accessible to scripts on this origin. */
export interface AccountSession {
  accountId: string;
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

const KEY = "findback.accountSessions";
const LIMIT = 6;

function valid(value: unknown): value is AccountSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AccountSession>;
  return typeof session.accountId === "string" && session.accountId.length > 0 && session.accountId.length <= 128
    && typeof session.access_token === "string" && session.access_token.length > 0 && session.access_token.length <= 32768
    && typeof session.refresh_token === "string" && session.refresh_token.length > 0 && session.refresh_token.length <= 32768
    && (session.expires_at === undefined || (Number.isSafeInteger(session.expires_at) && session.expires_at > 0));
}

function readAll(): AccountSession[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > LIMIT || !parsed.every(valid)) throw new Error("Saved sessions could not be read.");
  const ids = new Set(parsed.map(session => session.accountId));
  if (ids.size !== parsed.length) throw new Error("Saved sessions could not be read.");
  return parsed.map(({ accountId, access_token, refresh_token, expires_at }) =>
    ({ accountId, access_token, refresh_token, ...(expires_at === undefined ? {} : { expires_at }) }));
}

export function readAccountSession(accountId: string): AccountSession | null {
  return readAll().find(session => session.accountId === accountId) ?? null;
}

export function saveAccountSession(session: AccountSession): void {
  if (!valid(session)) throw new Error("Session could not be saved.");
  const { accountId, access_token, refresh_token, expires_at } = session;
  const sessions = readAll().filter(item => item.accountId !== accountId);
  if (sessions.length >= LIMIT) throw new Error("Too many saved accounts.");
  localStorage.setItem(KEY, JSON.stringify([{ accountId, access_token, refresh_token,
    ...(expires_at === undefined ? {} : { expires_at }) }, ...sessions]));
}

export function removeAccountSession(accountId: string): void {
  const sessions = readAll().filter(session => session.accountId !== accountId);
  if (sessions.length) localStorage.setItem(KEY, JSON.stringify(sessions));
  else localStorage.removeItem(KEY);
}

export function clearAccountSessions(): void {
  localStorage.removeItem(KEY);
}
