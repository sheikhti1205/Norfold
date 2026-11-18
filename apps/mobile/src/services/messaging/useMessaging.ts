import { useSyncExternalStore } from "react";
import { useOptionalAuth } from "../../auth";
import { EMPTY_MESSAGING_SNAPSHOT, getMessagingRuntimeSnapshot, subscribeMessagingRuntime } from "./runtime";

/** Extra render-time scope fence: a newly rendered account must never observe
 * the previous account's snapshot while the auth effect is still pending.
 * Outside a provider there is no account, so the empty snapshot is the truth. */
export function useMessaging() {
  const user = useOptionalAuth()?.user ?? null;
  const snapshot = useSyncExternalStore(subscribeMessagingRuntime, getMessagingRuntimeSnapshot,
    () => EMPTY_MESSAGING_SNAPSHOT);
  return snapshot.accountId === user?.id ? snapshot : EMPTY_MESSAGING_SNAPSHOT;
}
