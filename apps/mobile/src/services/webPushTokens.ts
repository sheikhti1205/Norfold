import { ApiError } from "./session";
import { getSupabase } from "./supabaseClient";

/**
 * The browser's own push endpoint, stored with the signed-in account so the
 * server can reach the closed tab. Only the endpoint plus its two encryption
 * keys leave the browser; no message content is ever part of this exchange.
 */
export interface WebPushSubscriptionJSON {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

function tokenErrorStatus(code: string | undefined): number {
  if (code === "42501") return 403;
  if (code === "28000") return 401;
  if (code === "22023") return 422;
  return 400;
}

/** Register (or refresh) this browser's push subscription for the caller. */
export async function registerWebPushSubscription(subscription: WebPushSubscriptionJSON): Promise<void> {
  const p256dh = subscription.keys?.p256dh?.trim();
  const auth = subscription.keys?.auth?.trim();
  if (!subscription.endpoint || !p256dh || !auth) {
    throw new ApiError("This browser did not provide a usable push subscription.", 422);
  }
  const { error } = await getSupabase().rpc("findback_register_web_push_subscription_client", {
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  });
  if (error) throw new ApiError(error.message, tokenErrorStatus(error.code));
}

/** Release one endpoint for the caller. Returns rows removed. */
export async function unregisterWebPushSubscription(endpoint: string): Promise<number> {
  const { data, error } = await getSupabase().rpc("findback_unregister_web_push_subscription_client", {
    p_endpoint: endpoint,
  });
  if (error) throw new ApiError(error.message, tokenErrorStatus(error.code));
  return Number(data ?? 0);
}
