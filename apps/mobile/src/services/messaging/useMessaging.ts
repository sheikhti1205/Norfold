import { useSyncExternalStore } from "react";
import { useAuth } from "../../auth";
import { EMPTY_MESSAGING_SNAPSHOT, getMessagingRuntimeSnapshot, subscribeMessagingRuntime } from "./runtime";

/** Extra render-time scope fence: a newly rendered account must never observe
 * the previous account's snapshot while the auth effect is still pending.
 *
 * This requires a signed-in session, like every messaging surface. A person
 * card can be seen outside that shell (it guards itself with
 * `useOptionalAuth` before it mounts anything that reads messaging), so the
 * optional session never reaches this hook. */
export function useMessaging() {
  const user = useAuth().user;
  const snapshot = useSyncExternalStore(subscribeMessagingRuntime, getMessagingRuntimeSnapshot,
    () => EMPTY_MESSAGING_SNAPSHOT);
  return snapshot.accountId === user?.id ? snapshot : EMPTY_MESSAGING_SNAPSHOT;
}
