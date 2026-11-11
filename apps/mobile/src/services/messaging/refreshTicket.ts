/**
 * Foreground message traffic and relationship/authority recovery are different
 * costs (owner handoff 2026-11-03):
 *
 *   fast — flush the pending outbox, drain the newest authorized mailbox page
 *          (persist + ACK), reload local summaries. No VIEWS scan, no full
 *          history drain, no media sweep: those are what made an ordinary
 *          message wait on unrelated reconciliation.
 *   full — startup, reconnect/focus, relationship or block changes, explicit
 *          Sync, media sends and error recovery. Everything the old path did.
 */
export type RefreshMode = "fast" | "full";

/** One coalesced refresh request. `conversationId` is only meaningful for a
 * fast pass and only when the hint named a conversation this account knows. */
export interface RefreshTicket {
  mode: RefreshMode;
  conversationId?: string;
}

/**
 * Combine a queued ticket with a newer request.
 *
 * Full always wins (it refetches receipt/relationship authority that a message
 * hint never carries). Two fast passes stay scoped only when both name the same
 * conversation; anything else widens to a plain fast pass, because a single
 * scoped pass cannot settle two different targets or an untargeted wake.
 */
export function mergeRefresh(pending: RefreshTicket | null, next: RefreshTicket): RefreshTicket {
  if (!pending) return next;
  if (pending.mode === "full" || next.mode === "full") return { mode: "full" };
  if (pending.conversationId !== undefined && pending.conversationId === next.conversationId) {
    return { mode: "fast", conversationId: pending.conversationId };
  }
  return { mode: "fast" };
}

export function ticketFor(mode: RefreshMode, conversationId?: string): RefreshTicket {
  return conversationId === undefined ? { mode } : { mode, conversationId };
}
