/**
 * Composer text for conversations that are open in this session.
 *
 * The draft lives here instead of inside `ThreadSession` so closing a chat
 * window (which unmounts it) or leaving a chat route does not throw away words
 * the reader typed. The next mount for the same account and conversation reads
 * this map, so a draft survives an unmount but is never sent by restoring it.
 *
 * Memory only, by contract: no localStorage, sessionStorage, IndexedDB,
 * cookies or network. Chat text is private, and a shared or personal device
 * must not keep it on disk where a reload, a crash dump or the next person at
 * the keyboard could read it. Losing every draft on reload is the intended
 * price. Every key names its account, so even this live map cannot answer for
 * another account; sign-out additionally clears it through the canonical
 * per-session teardown.
 *
 * Bounded: at most `MAX_CONVERSATION_DRAFTS` entries, evicting the least
 * recently written or read, so a reader who opens many conversations cannot
 * grow the map without limit.
 */

const MAX_CONVERSATION_DRAFTS = 64;

const drafts = new Map<string, string>();

function keyFor(accountId: string, conversationId: string): string {
  return `${accountId}\u0000${conversationId}`;
}

/** Re-inserting is the recency update: Map iteration order is insertion order. */
function remember(key: string, text: string): void {
  drafts.delete(key);
  drafts.set(key, text);
  while (drafts.size > MAX_CONVERSATION_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
}

/** The reader's saved text, or `""` when there is none. */
export function readConversationDraft(accountId: string, conversationId: string): string {
  const key = keyFor(accountId, conversationId);
  const text = drafts.get(key);
  if (text === undefined) return "";
  // A read is recent use: a conversation the reader is looking at should not be
  // the next one evicted.
  remember(key, text);
  return text;
}

/** Empty or whitespace-only text is never a draft; it removes the entry. */
export function writeConversationDraft(accountId: string, conversationId: string, text: string): void {
  const key = keyFor(accountId, conversationId);
  if (text.trim() === "") { drafts.delete(key); return; }
  remember(key, text);
}

export function clearConversationDraft(accountId: string, conversationId: string): void {
  drafts.delete(keyFor(accountId, conversationId));
}

/** Sign-out and account switch: no reader may inherit another's words. */
export function clearAllConversationDrafts(): void {
  drafts.clear();
}
