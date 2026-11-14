import { getSupabase } from "./supabaseClient";

/**
 * Which sign-in providers Supabase Auth has linked to the signed-in account.
 *
 * Reads the account's OWN local session snapshot (`identities` and the
 * `app_metadata.providers` marker). It is presentation only: it never grants a
 * sign-in method, never reads a token, and never names a provider the account
 * does not hold. `null` means the snapshot could not be read, so the caller
 * must say "could not check" instead of claiming "not linked".
 */
export async function readLinkedProviders(): Promise<ReadonlySet<string> | null> {
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) return null;
    const user = data.session?.user;
    if (!user) return null;
    const providers = new Set<string>();
    for (const identity of user.identities ?? []) {
      if (typeof identity.provider === "string" && identity.provider !== "") providers.add(identity.provider);
    }
    const declared = user.app_metadata?.providers;
    if (Array.isArray(declared)) {
      for (const provider of declared) {
        if (typeof provider === "string" && provider !== "") providers.add(provider);
      }
    }
    return providers.size > 0 ? providers : null;
  } catch {
    return null;
  }
}
