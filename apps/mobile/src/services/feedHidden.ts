import { useSyncExternalStore } from "react";

/**
 * Reports the reader has put away for this visit.
 *
 * A feed cross is a reading decision, not a moderation write: the report stays
 * on the server and can come back with Undo or on the next launch. One small
 * external store keeps every mounted list in agreement without threading
 * state through the feed screens.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
const EMPTY: ReadonlySet<string> = new Set();
let hidden: ReadonlySet<string> = EMPTY;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function hideFeedPost(postId: string) {
  if (hidden.has(postId)) return;
  const next = new Set(hidden);
  next.add(postId);
  hidden = next;
  emit();
}

export function unhideFeedPost(postId: string) {
  if (!hidden.has(postId)) return;
  const next = new Set(hidden);
  next.delete(postId);
  hidden = next;
  emit();
}

/** Test isolation only: a new test starts with no put-away reports. */
export function resetHiddenFeedPosts() {
  if (hidden === EMPTY) return;
  hidden = EMPTY;
  emit();
}

export function isFeedPostHidden(postId: string) {
  return hidden.has(postId);
}

export function useHiddenFeedPosts(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => hidden, () => EMPTY);
}
