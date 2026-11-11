/**
 * Chat wake → paint latency, memory only.
 *
 * This is diagnostic instrumentation for the message fast path: a wake hint
 * arrives over Realtime, and the pass it triggers must publish the conversation
 * the reader is looking at soon after. Nothing here is telemetry — there is no
 * network call, no storage, no analytics and no production console output. The
 * samples live in one ring buffer for the lifetime of the process, so a
 * developer can ask `recentLatencySamples()` from a devtools console instead of
 * instrumenting the app again.
 *
 * A hint is only ever paired with a paint that names the same conversation:
 * a hint whose conversation is unknown (or that never gets a matching paint) is
 * dropped rather than reported as an unmeasurable sample.
 */
export interface ChatLatencySample {
  /** Conversation the hint named; absent signals are never sampled. */
  conversationId?: string;
  /** Milliseconds from the hint to the pass that published its data. */
  ms: number;
  /** Wall-clock time the sample was taken. */
  at: number;
}

/** Samples retained for inspection; older ones are overwritten. */
const SAMPLE_LIMIT = 50;
/** Hints allowed to wait for a paint before the oldest is dropped. */
const PENDING_LIMIT = 20;
/** A hint with no paint in this window is treated as unmeasurable. */
const PENDING_TTL_MS = 10_000;

const samples: ChatLatencySample[] = [];
const pending: Array<{ conversationId: string; at: number }> = [];

/**
 * Record that a wake hint for `conversationId` arrived. A hint without a
 * conversation id cannot be paired with a conversation paint, so it is ignored
 * instead of being reported as a sample that never completes.
 */
export function markHintReceived(conversationId?: string): void {
  if (typeof conversationId !== "string" || conversationId.length === 0) return;
  const at = Date.now();
  const cutoff = at - PENDING_TTL_MS;
  // Entries are appended in arrival order, so anything expired (or anything
  // beyond the cap) sits at the front.
  while (pending.length > 0 && ((pending[0]?.at ?? at) < cutoff || pending.length >= PENDING_LIMIT)) {
    pending.shift();
  }
  pending.push({ conversationId, at });
}

/**
 * Record that the pass carrying the pending hint published `conversationId`.
 * Oldest matching hint wins; a paint with no waiting hint records nothing.
 */
export function markConversationPainted(conversationId: string): void {
  const at = Date.now();
  const cutoff = at - PENDING_TTL_MS;
  const index = pending.findIndex(
    (entry) => entry.conversationId === conversationId && entry.at >= cutoff,
  );
  if (index < 0) return;
  const hint = pending[index]!;
  pending.splice(index, 1);
  const sample: ChatLatencySample = { conversationId, ms: Math.max(0, at - hint.at), at };
  samples.push(sample);
  while (samples.length > SAMPLE_LIMIT) samples.shift();
  // Development-only: a release build records the sample but never logs it.
  // eslint-disable-next-line no-console -- development-only; release builds drop this branch.
  if (import.meta.env.DEV) console.debug(`[chat] wake→paint ${sample.ms}ms`, conversationId);
}

/** Most recent samples, oldest first. A copy: callers cannot mutate the buffer. */
export function recentLatencySamples(): readonly ChatLatencySample[] {
  return samples.slice();
}
