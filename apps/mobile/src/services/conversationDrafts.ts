/**
 * Composer text for conversations that are open in this session.
 *
 * The draft lives here instead of inside `ThreadSession` so closing a chat
 * window (which unmounts it) or leaving a chat route does not throw away words
 * the reader typed. The next mount for the same account and conversation reads
 * this map, so a draft survives an unmount but is never sent by restoring it.
 *
 * Memory is the live copy; `sessionStorage` is only a reload bridge. One key per
 * account, `fb-chat-drafts:<accountId>`, holds a JSON object mapping each
 * `conversationId` to the exact text. `sessionStorage` is the deliberate
 * compromise: a reload keeps the words, while a closed tab or app instance and a
 * sign-out drop them, so a shared device never keeps private chat text beyond
 * the current browsing session. Nothing goes to localStorage, IndexedDB,
 * cookies or the network, and nothing here is ever durable. Every key names its
 * account, so one account cannot read another's words; sign-out clears the map
 * and every stored key through the canonical per-session teardown.
 *
 * Bounded: at most `MAX_CONVERSATION_DRAFTS` entries, evicting the least
 * recently written or read, so a reader who opens many conversations cannot
 * grow the map without limit. The stored record follows the same order and is
 * additionally capped at `MAX_STORAGE_BYTES` of JSON, dropping only the least
 * recently used entries it must. A draft's text is never truncated: a single
 * draft too large to store stays in memory only.
 *
 * Writes are debounced so a keystroke does not reserialise every draft;
 * `pagehide` and a hidden `visibilitychange` flush synchronously, while a send
 * clears immediately, so sent words can never come back on reload.
 */

const STORAGE_PREFIX = "fb-chat-drafts:";
const MAX_CONVERSATION_DRAFTS = 64;
const MAX_STORAGE_BYTES = 256 * 1024;
const PERSIST_DEBOUNCE_MS = 300;

const drafts = new Map<string, string>();
/** Accounts whose stored record has already been read into `drafts`. */
const hydratedAccounts = new Set<string>();
/** Accounts with changes waiting for the debounce or the next flush point. */
const dirtyAccounts = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let encoder: TextEncoder | null = null;

function keyFor(accountId: string, conversationId: string): string {
  return `${accountId}\u0000${conversationId}`;
}

function entryPrefix(accountId: string): string {
  return `${accountId}\u0000`;
}

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

/** The environment's `sessionStorage`, or `null` when it is absent or refuses access. */
function getStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** UTF-8 size of the serialised record; falls back to code units, never throws. */
function byteLength(text: string): number {
  try {
    encoder ??= new TextEncoder();
    return encoder.encode(text).length;
  } catch {
    return text.length;
  }
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

/**
 * Loads this account's stored object into memory. The stored record is the
 * source of truth for the account: nothing is merged into what memory already
 * holds for it. A missing, corrupt or wrong-shaped record hydrates nothing.
 */
function hydrateAccount(accountId: string): void {
  if (hydratedAccounts.has(accountId)) return;
  hydratedAccounts.add(accountId);
  const storage = getStorage();
  if (storage === null) return;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(accountId));
  } catch {
    return;
  }
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const prefix = entryPrefix(accountId);
  for (const key of [...drafts.keys()]) {
    if (key.startsWith(prefix)) drafts.delete(key);
  }
  for (const [conversationId, text] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof text !== "string" || text.trim() === "") continue;
    remember(`${prefix}${conversationId}`, text);
  }
}

/**
 * Writes this account's live entries to its record: recency order, the LRU cap
 * already applied in memory, and the 256 KB guard dropping the oldest entries
 * that do not fit. An entry that alone exceeds the guard is simply left out, so
 * the reader's words are never truncated.
 */
function persistAccount(accountId: string): void {
  const storage = getStorage();
  if (storage === null) return;
  const prefix = entryPrefix(accountId);
  // Map iteration order is recency order, oldest first.
  const entries: Array<[string, string]> = [];
  for (const [key, text] of drafts) {
    if (key.startsWith(prefix)) entries.push([key.slice(prefix.length), text]);
  }
  let kept = entries;
  let json = JSON.stringify(Object.fromEntries(kept));
  while (kept.length > 0 && byteLength(json) > MAX_STORAGE_BYTES) {
    kept = kept.slice(1);
    json = JSON.stringify(Object.fromEntries(kept));
  }
  try {
    if (kept.length === 0) {
      storage.removeItem(storageKey(accountId));
      return;
    }
    storage.setItem(storageKey(accountId), json);
  } catch {
    /* Full or refused storage: persistence goes volatile, the composer still works. */
  }
}

/** Clears a change out of the pending set and writes it now, no debounce. */
function persistNow(accountId: string): void {
  dirtyAccounts.delete(accountId);
  persistAccount(accountId);
}

function schedulePersist(accountId: string): void {
  dirtyAccounts.add(accountId);
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushDrafts();
  }, PERSIST_DEBOUNCE_MS);
}

/** Writes every pending account immediately. */
function flushDrafts(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (dirtyAccounts.size === 0) return;
  const accounts = [...dirtyAccounts];
  dirtyAccounts.clear();
  for (const accountId of accounts) persistAccount(accountId);
}

/** The reader's saved text, or `""` when there is none. */
export function readConversationDraft(accountId: string, conversationId: string): string {
  hydrateAccount(accountId);
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
  hydrateAccount(accountId);
  const key = keyFor(accountId, conversationId);
  if (text.trim() === "") {
    drafts.delete(key);
    persistNow(accountId);
    return;
  }
  remember(key, text);
  schedulePersist(accountId);
}

export function clearConversationDraft(accountId: string, conversationId: string): void {
  hydrateAccount(accountId);
  drafts.delete(keyFor(accountId, conversationId));
  // A send must not come back on reload, so this never waits for the debounce.
  persistNow(accountId);
}

/** Sign-out and account switch: no reader may inherit another's words. */
export function clearAllConversationDrafts(): void {
  drafts.clear();
  hydratedAccounts.clear();
  dirtyAccounts.clear();
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const storage = getStorage();
  if (storage === null) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* Refused storage: the memory map is already empty, nothing else to drop. */
  }
}

/**
 * Flush points exist in the browser so a reload or a tab/app close in the
 * middle of a debounce still keeps the last keystrokes. They are registered
 * once, at module scope, and skip a runtime with no window or document.
 */
function flushOnPageHide(): void {
  flushDrafts();
}

function flushWhenHidden(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") flushDrafts();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", flushOnPageHide);
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", flushWhenHidden);
}
