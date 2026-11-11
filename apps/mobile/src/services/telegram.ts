import { getSupabase } from "./supabaseClient";
import { ApiError } from "./session";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
const scalar = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.trim().length > 0);
const validToken = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
const unexpected = () => new ApiError("The server returned an unexpected response.", 500, "UNEXPECTED_SHAPE");

function rpcError(error: { message: string; code?: string }): ApiError {
  const status = error.code === "28000" ? 401 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "P0001" ? 429 : 500;
  return new ApiError(error.message, status, error.code);
}

export interface TelegramAccount { linked: boolean; phone: string | null; username: string | null }
export async function getTelegramAccount(): Promise<TelegramAccount> {
  const { data, error } = await getSupabase().rpc("findback_telegram_account_state");
  if (error) throw rpcError(error);
  const row = record(data);
  if (!row || typeof row.linked !== "boolean" || !scalar(row.phone) || !scalar(row.telegram_username)) throw unexpected();
  return { linked: row.linked, phone: row.phone, username: row.telegram_username };
}

export async function createTelegramLink(): Promise<{ token: string; deepLink: string; expiresAt: string }> {
  const { data, error } = await getSupabase().rpc("findback_telegram_create_link_token");
  if (error) throw rpcError(error);
  const row = record(data);
  if (!row || !validToken(row.token) || typeof row.expires_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(row.expires_at) || !Number.isFinite(Date.parse(row.expires_at))) throw unexpected();
  const url = new URL("https://t.me/Norfold_auth_bot");
  url.searchParams.set("start", row.token);
  if (row.deep_link !== url.toString()) throw unexpected();
  return { token: row.token, deepLink: url.toString(), expiresAt: row.expires_at };
}

export async function getTelegramLinkState(token: string): Promise<{ state: "pending" | "linked" | "expired"; phone: string | null }> {
  if (!validToken(token)) throw new ApiError("The connection is invalid.", 400, "INVALID_TOKEN");
  const { data, error } = await getSupabase().rpc("findback_telegram_link_state", { p_token: token });
  if (error) throw rpcError(error);
  const row = record(data);
  if (!row || (row.state !== "pending" && row.state !== "linked" && row.state !== "expired") || !scalar(row.phone)) throw unexpected();
  return { state: row.state, phone: row.phone };
}

export async function unlinkTelegram(): Promise<void> {
  const { data, error } = await getSupabase().rpc("findback_telegram_unlink");
  if (error) throw rpcError(error);
  if (record(data)?.unlinked !== true) throw unexpected();
}
