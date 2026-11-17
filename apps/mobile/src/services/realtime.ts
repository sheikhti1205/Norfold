import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";
import { invalidateFeedCaches } from "../hooks/feedCache";

export type RealtimeEvent =
  | "feed:changed"
  | "post:updated"
  | "post:deleted"
  | "comment:invalidate"
  | "reaction:invalidate"
  | "reaction:changed"
  | "rating:changed"
  | "app-rating:changed"
  | "chat:invalidate"
  | "notification:added";

/** App-wide rating aggregate. Never a score, user id or per-user row. */
export interface AppRatingAggregate {
  average: number | null;
  count: number;
}

/**
 * `chat:invalidate` payload. `accountId` is added by this module from the
 * private topic's owner; the server may also name the conversation (and, for a
 * message wake, the message) the hint is about. Those ids are only a routing
 * hint: consumers must still read everything through an authorized call, and a
 * subscriber that ignores them keeps the previous account-wide behaviour.
 */
export type ChatInvalidatePayload = {
  /** Signed-in account whose private notification topic produced this hint. */
  accountId: string;
  invalidate?: true;
  conversationId?: string;
  messageId?: string;
};

type Handler = (payload: Record<string, unknown>) => void;

const listeners = new Map<RealtimeEvent, Set<Handler>>();
const postChannels = new Map<string, RealtimeChannel>();
const desiredPosts = new Set<string>();
let client: SupabaseClient | null = null;
let feedChannel: RealtimeChannel | null = null;
let inboxChannel: RealtimeChannel | null = null;
let boundInboxUser: string | null = null;
let desiredInboxUser: string | null = null;
let appRatingChannel: RealtimeChannel | null = null;
let appRatingSubscribers = 0;
let appRatingOpening: Promise<RealtimeChannel | null> | null = null;
let ready: Promise<void> = Promise.resolve();
let authUnsubscribe: (() => void) | null = null;

// Reconnect policy: bounded exponential backoff, capped, deduped per channel
// key, and always cancelled by disconnectRealtime(). The first retry waits 1s,
// doubling to a 30s ceiling so a flapping socket never hot-loops.
const RETRY_MAX_DELAY_MS = 30_000;
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();

/** Status values are a string enum the app treats as plain strings. */
function isSubscribedStatus(status: unknown): boolean {
  return status === "SUBSCRIBED";
}

function isFailedStatus(status: unknown): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

function backoffDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, RETRY_MAX_DELAY_MS);
}

/** Forget a channel's retry state (successful subscribe or explicit leave). */
function clearRetry(key: string): void {
  const timer = retryTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    retryTimers.delete(key);
  }
  retryCounts.delete(key);
}

function clearAllRetries(): void {
  for (const key of Array.from(retryTimers.keys())) clearRetry(key);
}

/** One in-flight reconnect per key; attempts reset on the next SUBSCRIBED. */
function scheduleRetry(key: string, retry: () => void): void {
  if (retryTimers.has(key)) return;
  const attempt = retryCounts.get(key) ?? 0;
  retryCounts.set(key, attempt + 1);
  retryTimers.set(
    key,
    setTimeout(() => {
      retryTimers.delete(key);
      retry();
    }, backoffDelayMs(attempt)),
  );
}

/**
 * Attach wire-event handlers to a private channel. The caller stores the
 * channel in its slot BEFORE subscribing: a subscribe() status callback can
 * fire synchronously, and a failure must be able to clear the slot it just
 * filled.
 */
function bindHandlers(channel: RealtimeChannel, bindings: Array<[string, RealtimeEvent]>, current: () => boolean): RealtimeChannel {
  for (const [wireEvent, appEvent] of bindings) {
    channel.on("broadcast", { event: wireEvent }, (message) => {
      if (!current()) return;
      dispatch(appEvent, (message?.payload ?? {}) as Record<string, unknown>);
    });
  }
  return channel;
}

function dispatch(event: RealtimeEvent, payload: Record<string, unknown>): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) handler(payload);
}

/**
 * Lazily create the client and keep the Realtime socket's auth in step with the
 * session. Private-channel RLS is checked against that token, so channels must
 * only be opened after this resolves (the `ready` gate below). The token owner
 * stays the auth module: this listener only mirrors its changes into Realtime
 * and tears down user-scoped sockets when the session goes away.
 */
function ensureClient(): SupabaseClient | null {
  // The cached client is only reusable while its auth mirror is still
  // attached. Sign-out tears the mirror down, and a first attach can fail
  // after the client is cached; either way an early-return here would leave
  // a long-lived socket on the access token it was opened with — a stale
  // token for the rest of the process (SIGNED_OUT → sign-in never rebinds).
  if (client && authUnsubscribe) return client;
  if (!client) {
    try {
      client = getSupabase();
    } catch {
      return null;
    }
  }
  const c = client;
  // Mirror every auth change (TOKEN_REFRESHED included) into Realtime so a
  // long-lived socket never keeps using the access token it was opened with.
  authUnsubscribe = c.auth.onAuthStateChange((_event, session) => {
    if (client !== c) return;
    if (session) {
      c.realtime.setAuth(session.access_token);
      return;
    }
    // SIGNED_OUT: the remaining channels are scoped to the dead user's RLS.
    disconnectRealtime();
  }).data.subscription.unsubscribe;
  ready = c.auth
    .getSession()
    .then(({ data }) => {
      if (data.session) c.realtime.setAuth(data.session.access_token);
    })
    .catch(() => undefined);
  return c;
}

/** Open the authenticated Realtime connection. Idempotent and safe on every auth change. */
export function connectRealtime(): void {
  const c = ensureClient();
  if (!c || feedChannel) return;
void ready.then(() => {
      if (client !== c || feedChannel) return;
      // The feed channel carries every post/comment/reaction change. A real
      // INSERT is a new post (increments the pill). UPDATE/DELETE mark feeds
      // dirty so back-nav from Detail never restores stale/deleted cards.
      // COMMENT_CHANGE/REACTION_CHANGE/RATING_CHANGE are generic updates only.
      const channel = c.channel("feed", { config: { private: true } });
      channel.on("broadcast", { event: "post:changed" }, (message) => {
        const payload = (message?.payload ?? {}) as Record<string, unknown>;
        const change = String(payload.change ?? payload.op ?? "").toUpperCase();
        if (payload.invalidate === true || change === "INSERT" || change === "UPDATE" || change === "DELETE") {
          invalidateFeedCaches();
        }
        dispatch("feed:changed", payload);
      });
      // A dropped feed subscription used to stay dead for the rest of the
      // session. The slot is filled BEFORE subscribing so a synchronous
      // CHANNEL_ERROR can clear it; the retry reconnects with backoff.
      feedChannel = channel;
      channel.subscribe((status: unknown) => {
        if (isSubscribedStatus(status)) {
          clearRetry("feed");
          return;
        }
        if (!isFailedStatus(status)) return;
        if (feedChannel === channel) {
          feedChannel = null;
          void c.removeChannel(channel);
        }
        if (client === c) scheduleRetry("feed", () => connectRealtime());
      });
    });
}

/** Tear down every channel (logout/unmount). The listener registry is kept. */
export function disconnectRealtime(): void {
  desiredPosts.clear();
  desiredInboxUser = null;
  boundInboxUser = null;
  appRatingSubscribers = 0;
  appRatingOpening = null;
  clearAllRetries();
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  if (!client) return;
  if (feedChannel) {
    void client.removeChannel(feedChannel);
    feedChannel = null;
  }
  if (inboxChannel) {
    void client.removeChannel(inboxChannel);
    inboxChannel = null;
  }
  if (appRatingChannel) {
    void client.removeChannel(appRatingChannel);
    appRatingChannel = null;
  }
  for (const [postId, channel] of postChannels) {
    void client.removeChannel(channel);
    postChannels.delete(postId);
  }
  client = null;
  ready = Promise.resolve();
}

/** Subscribe to an app-level realtime event; returns an unsubscribe function. */
export function onRealtime(event: RealtimeEvent, handler: Handler): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => {
    listeners.get(event)?.delete(handler);
  };
}

/** Subscribe to a post's private topic so its live events arrive. */
export function joinPostRoom(postId: string): void {
  desiredPosts.add(postId);
  const c = ensureClient();
  if (!c) return;
  void ready.then(() => {
    if (client !== c || !desiredPosts.has(postId) || postChannels.has(postId)) return;
    const key = `post:${postId}`;
    const channel = c.channel(key, { config: { private: true } });
    bindHandlers(channel, [
      ["post:updated", "post:updated"],
      ["post:deleted", "post:deleted"],
      ["comment:invalidate", "comment:invalidate"],
      ["reaction:invalidate", "reaction:invalidate"],
      ["reaction:changed", "reaction:changed"],
      ["rating:changed", "rating:changed"],
    ], () => client === c && postChannels.get(postId) === channel && desiredPosts.has(postId));
    // Slot first (a synchronous subscribe failure must be able to clear it).
    postChannels.set(postId, channel);
    channel.subscribe((status: unknown) => {
      if (isSubscribedStatus(status)) {
        if (postChannels.get(postId) !== channel || client !== c) return;
        clearRetry(key);
        dispatch("comment:invalidate", { postId, invalidate: true });
        dispatch("post:updated", { postId });
        return;
      }
      if (!isFailedStatus(status)) return;
      if (postChannels.get(postId) === channel) {
        postChannels.delete(postId);
        void c.removeChannel(channel);
      }
      if (client === c && desiredPosts.has(postId)) scheduleRetry(key, () => joinPostRoom(postId));
    });
  });
}

export function leavePostRoom(postId: string): void {
  desiredPosts.delete(postId);
  clearRetry(`post:${postId}`);
  const channel = postChannels.get(postId);
  if (!channel || !client) return;
  void client.removeChannel(channel);
  postChannels.delete(postId);
}

/**
 * Subscribe to the signed-in user's private inbox topic. The server broadcasts
 * a data-free signal on new notifications; consumers refetch their own inbox.
 * A channel bound to another account is dropped first so an account switch can
 * never keep listening on the previous user's topic.
 */
export function joinInboxRoom(userId: string): void {
  const c = ensureClient();
  if (!c) return;
  desiredInboxUser = userId;
  void ready.then(async () => {
    if (client !== c || desiredInboxUser !== userId) return;
    // Tear down any stale channel bound to a different React user FIRST, so
    // an account switch never leaves the previous user's topic listening even
    // if the SDK-identity guard below throws or skips.
    if (inboxChannel && boundInboxUser !== userId) {
      clearRetry("inbox");
      void c.removeChannel(inboxChannel);
      inboxChannel = null;
      boundInboxUser = null;
    }
    // SDK-before-React identity fencing: resolve the SDK session so teardown
    // and subscription decisions are based on the actual token owner.
    let sessionUserId: string | undefined;
    try {
      const { data } = await c.auth.getSession();
      if (client !== c || desiredInboxUser !== userId) return;
      sessionUserId = data.session?.user?.id;
    } catch {
      return;
    }
    const skip = !!sessionUserId && sessionUserId !== userId;
    // Also tear down a channel bound to the same React user whose SDK identity
    // diverged, even when the guard skips, to close the stale leak.
    if (skip && inboxChannel && sessionUserId !== boundInboxUser) {
      clearRetry("inbox");
      void c.removeChannel(inboxChannel);
      inboxChannel = null;
      boundInboxUser = null;
    }
    if (skip) return;
    if (inboxChannel) return;
    const channel = c.channel(`notification:${userId}`, { config: { private: true } });
    bindHandlers(channel, [
      ["notification:added", "notification:added"],
      ["comment:invalidate", "comment:invalidate"],
    ], () => client === c && inboxChannel === channel && boundInboxUser === userId && desiredInboxUser === userId);
    channel.on("broadcast", { event: "chat:invalidate" }, (message) => {
      if (client !== c || inboxChannel !== channel || boundInboxUser !== userId || desiredInboxUser !== userId) return;
      // The private room is the authority for WHICH account this hint belongs
      // to; the server may additionally name the conversation it concerns.
      // Forward those ids verbatim (never interpreted here) so a consumer can
      // scope its own authorized read, and keep the payload id-free when the
      // server sends none — every existing subscriber keeps working.
      const wire = (message?.payload ?? {}) as Record<string, unknown>;
      const payload: ChatInvalidatePayload = { accountId: userId };
      for (const key of ["conversationId", "messageId"] as const) {
        const value = wire[key];
        if (typeof value === "string" && value.length > 0) payload[key] = value;
      }
      dispatch("chat:invalidate", payload);
    });
    // Slot first (a synchronous subscribe failure must be able to clear it).
    inboxChannel = channel;
    boundInboxUser = userId;
    channel.subscribe((status: unknown) => {
      if (isSubscribedStatus(status)) {
        if (inboxChannel !== channel || client !== c) return;
        clearRetry("inbox");
        dispatch("comment:invalidate", { userId, invalidate: true });
        dispatch("chat:invalidate", { accountId: userId });
        return;
      }
      if (!isFailedStatus(status)) return;
      if (inboxChannel === channel) {
        inboxChannel = null;
        boundInboxUser = null;
        void c.removeChannel(channel);
      }
      if (client === c && desiredInboxUser === userId) {
        scheduleRetry("inbox", () => joinInboxRoom(userId));
      }
    });
  });
}

export function leaveInboxRoom(): void {
  desiredInboxUser = null;
  boundInboxUser = null;
  clearRetry("inbox");
  if (!client || !inboxChannel) return;
  void client.removeChannel(inboxChannel);
  inboxChannel = null;
}

/**
 * The app-rating topic is public. The private receive policy grants only
 * `feed`, `post:%` and `notification:<uid>`, and this topic carries a global
 * aggregate that every reader can already see on the feedback screen — never
 * who rated or what any individual scored.
 */
const APP_RATING_TOPIC = "app-rating";

/**
 * Accept only an aggregate and nothing else: exactly a whole `count`, and
 * (while someone has rated) a finite `average` between 1 and 5. Any extra key —
 * a score, a user id, a per-user row — rejects the whole payload instead of
 * being quietly forwarded alongside the aggregate.
 */
function appRatingAggregateFrom(payload: Record<string, unknown>): AppRatingAggregate | null {
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== "average" || keys[1] !== "count") return null;
  const average = payload.average;
  const count = payload.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
  if (count === 0) {
    if (average !== null) return null;
    return { average: null, count };
  }
  if (typeof average !== "number" || !Number.isFinite(average) || average < 1 || average > 5) return null;
  return { average, count };
}

/**
 * Open (or reuse) the shared app-rating channel. Concurrent callers share one
 * in-flight open, so two mounts never race two channels onto the same topic.
 * The topic is private: the server emits the aggregate after the rating row is
 * written, and the receive policy admits authenticated readers only. Resolves
 * null when the client is unavailable or the subscribe failed; callers treat
 * that as "no live aggregate" rather than an error.
 */
function openAppRatingChannel(): Promise<RealtimeChannel | null> {
  if (appRatingChannel) return Promise.resolve(appRatingChannel);
  if (appRatingOpening) return appRatingOpening;
  const c = ensureClient();
  if (!c) return Promise.resolve(null);
  const opening = ready
    .then(() => new Promise<RealtimeChannel | null>((resolve) => {
      if (client !== c || appRatingChannel) {
        resolve(appRatingChannel);
        return;
      }
      const channel = c.channel(APP_RATING_TOPIC, { config: { private: true } });
      channel.on("broadcast", { event: "rating:changed" }, (message) => {
        if (client !== c || appRatingChannel !== channel) return;
        const aggregate = appRatingAggregateFrom((message?.payload ?? {}) as Record<string, unknown>);
        if (!aggregate) return;
        // Rebuild the object here: an interface has no index signature, and the
        // listener registry carries plain records. Only these two fields travel.
        dispatch("app-rating:changed", { average: aggregate.average, count: aggregate.count });
      });
      // Slot first (a synchronous subscribe failure must be able to clear it).
      appRatingChannel = channel;
      channel.subscribe((status: unknown) => {
        if (isSubscribedStatus(status)) {
          clearRetry(APP_RATING_TOPIC);
          resolve(channel);
          return;
        }
        if (!isFailedStatus(status)) return;
        if (appRatingChannel === channel) {
          appRatingChannel = null;
          void c.removeChannel(channel);
        }
        // Only a mounted screen pays for reconnects.
        if (client === c && appRatingSubscribers > 0) {
          scheduleRetry(APP_RATING_TOPIC, () => { void openAppRatingChannel(); });
        }
        resolve(null);
      });
    }))
    .catch(() => null);
  appRatingOpening = opening.finally(() => {
    // Only one open can be in flight (guarded above), so clearing is safe.
    appRatingOpening = null;
  });
  return appRatingOpening;
}

/** Drop the app-rating channel without touching the listener registry. */
function closeAppRatingChannel(): void {
  clearRetry(APP_RATING_TOPIC);
  const channel = appRatingChannel;
  appRatingChannel = null;
  if (channel && client) void client.removeChannel(channel);
}

/**
 * Subscribe to the aggregate-only app-rating topic while the feedback screen is
 * mounted. Refcounted: the channel is removed at zero so a background tab does
 * not keep listening. Returns the matching unsubscribe.
 */
export function joinAppRatingRoom(): () => void {
  appRatingSubscribers += 1;
  void openAppRatingChannel();
  let joined = true;
  return () => {
    if (!joined) return;
    joined = false;
    appRatingSubscribers = Math.max(0, appRatingSubscribers - 1);
    if (appRatingSubscribers === 0) closeAppRatingChannel();
  };
}
