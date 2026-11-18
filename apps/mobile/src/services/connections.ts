import { getSupabase } from "./supabaseClient";

/**
 * One public number: how many people this account is connected with.
 *
 * The count comes from `findback_public_connection_count_client`, which derives
 * it from the existing CONNECTED conversation rows and never exposes a peer, a
 * message or a direction. A failed read returns `null` — callers omit the line
 * instead of printing a zero they cannot prove.
 */
export async function fetchConnectionCount(userId?: string | null): Promise<number | null> {
  const target = (userId ?? "").trim();
  try {
    const { data, error } = await getSupabase().rpc("findback_public_connection_count_client", {
      p_user_id: target === "" ? null : target,
    });
    if (error) return null;
    const value = typeof data === "number" ? data : Number(data);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

/** "Connected with 8 people" / "Connected with 1 person"; null at zero. */
export function connectionCountLabel(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return `Connected with ${count} ${count === 1 ? "person" : "people"}`;
}
