import { useSyncExternalStore } from "react";

/**
 * The chat windows the reader keeps open across the app.
 *
 * Every open or minimized conversation is one entry in this external store.
 * Windows stay mounted for their whole lifetime, so a draft, staged photo or
 * recorder never dies when another conversation takes focus. It is modelled on
 * `components/globalSearch.ts` for the same reason.
 *
 * The list itself survives a reload: which conversations are docked, their focus
 * order and whether the rail was tucked are remembered per account in
 * `sessionStorage`, because a refresh that emptied the rail reads as a
 * dismissal the reader never made. The record dies with the tab or app
 * instance, so a shared machine never resurrects a previous session's windows
 * and there is no durable copy to expire. A closed dock is never stored: ending
 * the visit is an action, not a preference, and the resting circle is always
 * the way back in. Drafts, staged photos and the recorder stay in memory.
 *
 * Every mutation names its account, so a late picker completion or a stray
 * callback can never act for a different viewer, and each account has its own
 * key, so one viewer's rail can never paint for another. The hook returns `null`
 * for any other account or a signed-out viewer, which unmounts every window
 * and therefore drops the in-memory drafts exactly as an account switch must;
 * a signed-in viewer who has not touched the dock yet gets one frozen empty
 * state instead, so the resting circle exists before the first mutation.
 */

export interface ChatDockEntry {
  /** `null` only while the new-message picker is showing. */
  conversationId: string | null;
  phase: "open" | "minimized";
  /** Focus rank: the highest open sequence owns the thread lease. */
  seq: number;
}

export interface ChatDockState {
  accountId: string;
  entries: readonly ChatDockEntry[];
  seq: number;
  /** Rail folded to the resting circle. Every window stays mounted. */
  tucked: boolean;
  /** Dock dismissed for this visit; nothing paints until an opener clears it. */
  closed: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: ChatDockState | null = null;
/** The control that opened an entry, so closing it returns focus there. */
const triggers = new Map<string, HTMLElement>();

/**
 * One frozen empty state per signed-in account that has not mutated the dock.
 * The hook must hand React a snapshot whose identity never changes between
 * renders, and the resting circle needs a state to read before the first open.
 */
const syntheticByAccount = new Map<string, ChatDockState>();
const NO_ENTRIES: readonly ChatDockEntry[] = Object.freeze([]);

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** No window is ever painted during a server render. */
function serverCurrent() {
  return null;
}

/**
 * Window persistence: which conversations are docked, their focus order and the
 * tucked flag.
 *
 * `sessionStorage`, not `localStorage`: the rail has to outlive the page, not
 * the tab or the app instance. Restoring the list the reader left open is worth
 * a page reload; a copy that outlives the session is not — a shared machine days
 * later must start at the circle, and there is nothing durable to expire. One
 * key per account, so a record can never paint for another viewer.
 */
const ENTRIES_PREFIX = "fb-chat-dock-entries:";
const entriesKey = (accountId: string): string => `${ENTRIES_PREFIX}${accountId}`;
/** Mirrors `RAIL_MAX_HEADS` in ChatDock.tsx: the rail is a column of five. */
const PERSIST_MAX_HEADS = 5;

interface StoredEntry {
  conversationId: string;
  phase: "open" | "minimized";
  seq: number;
}

/** `closed` is deliberately absent: a visit's dismissal is never restored. */
interface StoredDock {
  seq: number;
  tucked: boolean;
  entries: StoredEntry[];
}

/** A finite, non-negative integer sequence, or 0 for anything else. */
function storedSeq(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Write the record after a mutation, or drop it when there is nothing to
 * restore. A closed dock counts as nothing: a reload must return the resting
 * circle, never a remembered dismissal.
 */
function persistEntries(accountId: string, next: ChatDockState | null): void {
  try {
    if (next === null || next.closed) {
      sessionStorage.removeItem(entriesKey(accountId));
      return;
    }
    const record: StoredDock = {
      seq: next.seq,
      tucked: next.tucked,
      // The picker is not a conversation: it is never restored, so it is never
      // stored, not even as a placeholder.
      entries: next.entries.flatMap((entry) => (entry.conversationId === null
        ? []
        : [{ conversationId: entry.conversationId, phase: entry.phase, seq: entry.seq }])),
    };
    sessionStorage.setItem(entriesKey(accountId), JSON.stringify(record));
  } catch {
    // sessionStorage unavailable or quota-exceeded: the list is volatile again.
  }
}

/**
 * One account's stored rail, validated, or `null` for a first visit and for any
 * record this store did not write itself. Corrupt storage must behave exactly
 * like an empty dock — the resting circle — never like a half-restored rail.
 */
function readEntries(accountId: string): ChatDockState | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(entriesKey(accountId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<StoredDock>;
  // `tucked` decides whether the rail paints expanded, so an unknown value is a
  // corrupt record rather than a guess: either default would be wrong half the
  // time, and the circle is the one honest fallback.
  const tucked = record.tucked;
  const rawEntries = record.entries;
  if (typeof tucked !== "boolean" || !Array.isArray(rawEntries)) return null;
  const seen = new Set<string>();
  const candidates: StoredEntry[] = [];
  const storedEntries: unknown[] = rawEntries;
  for (const value of storedEntries) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Partial<StoredEntry>;
    const conversationId = entry.conversationId;
    if (typeof conversationId !== "string" || conversationId === "") continue;
    if (entry.phase !== "open" && entry.phase !== "minimized") continue;
    if (seen.has(conversationId)) continue;
    seen.add(conversationId);
    candidates.push({ conversationId, phase: entry.phase, seq: storedSeq(entry.seq) });
  }
  // The rail only ever heads five conversations, so a surplus is something this
  // store never wrote: keep the most recently focused five, the same five the
  // rail would have been showing.
  const keep = new Set([...candidates]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, PERSIST_MAX_HEADS)
    .map((entry) => entry.conversationId));
  const entries = candidates.filter((entry) => keep.has(entry.conversationId));
  const highest = entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
  const restored: ChatDockState = {
    accountId,
    entries: Object.freeze(entries),
    // A restored entry may carry the highest sequence, and two windows can never
    // share the thread lease.
    seq: Math.max(storedSeq(record.seq), highest),
    tucked,
    closed: false,
  };
  return Object.freeze(restored);
}

/**
 * The hydrated record per account, cached like `syntheticByAccount`: the hook
 * must hand React a snapshot whose identity never changes between renders, and
 * storage is read at most once per account in this instance. `null` marks a
 * lookup that found nothing, so a render never re-reads a record that is gone
 * and a dropped list can never be resurrected mid-session.
 */
const hydratedByAccount = new Map<string, ChatDockState | null>();

function hydrate(accountId: string): ChatDockState | null {
  const known = hydratedByAccount.get(accountId);
  if (known !== undefined) return known;
  const restored = readEntries(accountId);
  hydratedByAccount.set(accountId, restored);
  return restored;
}

/**
 * The one way the store changes: assign, persist, then tell React. Routing every
 * mutator through here is what stops a stored record drifting behind the painted
 * rail, and each mutation consumes the record for its account, so a window the
 * reader has since closed can never come back from storage in this instance.
 */
function commit(accountId: string, next: ChatDockState | null): void {
  state = next;
  hydratedByAccount.set(accountId, null);
  persistEntries(accountId, next);
  emit();
}

/**
 * Sticky dismissal: conversations closed through the dock are remembered per
 * account and must not reappear as rail heads on reload or on new messages.
 * Interaction (opening from the picker, chat list or a notification) clears
 * the flag. Persisted in localStorage under `fb-chat-dock-dismissed:<accountId>`,
 * capped at 100 entries so the store cannot grow without bound.
 */
const DISMISSED_PREFIX = "fb-chat-dock-dismissed:";
const dismissedKey = (accountId: string): string => `${DISMISSED_PREFIX}${accountId}`;
const DISMISSED_CAP = 100;

function loadDismissed(accountId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedKey(accountId));
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set<string>(parsed.slice(-DISMISSED_CAP));
  } catch {
    return new Set<string>();
  }
}

function saveDismissed(accountId: string, dismissed: Set<string>): void {
  try {
    const capped = [...dismissed].slice(-DISMISSED_CAP);
    localStorage.setItem(dismissedKey(accountId), JSON.stringify(capped));
  } catch {
    // localStorage unavailable or quota-exceeded: dismissal is volatile.
  }
}

/** Dismissed conversations, keyed by account, loaded lazily from localStorage. */
const dismissedByAccount = new Map<string, Set<string>>();

function getDismissed(accountId: string): Set<string> {
  let set = dismissedByAccount.get(accountId);
  if (!set) {
    set = loadDismissed(accountId);
    dismissedByAccount.set(accountId, set);
  }
  return set;
}

/** Remember a conversation as dismissed so it never comes back as a head. */
export function dismissChatDockEntry(accountId: string, conversationId: string | null): void {
  if (!accountId || !conversationId) return;
  const set = getDismissed(accountId);
  if (set.has(conversationId)) return;
  set.add(conversationId);
  saveDismissed(accountId, set);
}

/** Clear the dismissed flag: interaction re-enables the conversation. */
export function clearChatDockDismissed(accountId: string, conversationId: string | null): void {
  if (!accountId || !conversationId) return;
  // `getDismissed`, never the raw map: on a fresh page the cache is still empty
  // while localStorage carries last visit's dismissals, and a bare `get` would
  // return early and leave this conversation hidden from the rail for good.
  const set = getDismissed(accountId);
  if (!set.has(conversationId)) return;
  set.delete(conversationId);
  saveDismissed(accountId, set);
}

/** Check whether a conversation is dismissed from the dock. */
export function isChatDockDismissed(accountId: string, conversationId: string): boolean {
  if (!accountId) return false;
  return getDismissed(accountId).has(conversationId);
}

function triggerKey(accountId: string, conversationId: string | null): string {
  return `${accountId}:${conversationId ?? ""}`;
}

function rememberTrigger(accountId: string, conversationId: string | null, trigger: Element | null): void {
  if (trigger instanceof HTMLElement) triggers.set(triggerKey(accountId, conversationId), trigger);
}

/** A specific conversation supersedes the new-message chooser. */
function withoutPicker(entries: readonly ChatDockEntry[]): ChatDockEntry[] {
  return entries.filter((entry) => entry.conversationId !== null);
}

/**
 * Keep at most `limit` windows open. The window that just took focus is never
 * folded away; the least recently focused other conversations are minimized in
 * place, never unmounted, and become rail heads.
 */
function applyLimit(entries: readonly ChatDockEntry[], focusedSeq: number, limit: number): ChatDockEntry[] {
  if (!Number.isFinite(limit) || limit < 1) return [...entries];
  let excess = entries.filter((entry) => entry.phase === "open").length - limit;
  if (excess <= 0) return [...entries];
  const folded = new Set<string | null>();
  const candidates = entries
    .filter((entry) => entry.phase === "open" && entry.seq !== focusedSeq && entry.conversationId !== null)
    .sort((a, b) => a.seq - b.seq);
  for (const entry of candidates) {
    if (excess <= 0) break;
    folded.add(entry.conversationId);
    excess -= 1;
  }
  if (folded.size === 0) return [...entries];
  return entries.map((entry) => (
    entry.conversationId !== null && folded.has(entry.conversationId)
      ? { ...entry, phase: "minimized" }
      : entry
  ));
}

function focusEntry(accountId: string, conversationId: string | null, limit: number): void {
  if (!state || state.accountId !== accountId) return;
  const entry = state.entries.find((candidate) => candidate.conversationId === conversationId);
  if (!entry) return;
  const seq = state.seq + 1;
  const entries: ChatDockEntry[] = state.entries.map((candidate) => (
    candidate === entry ? { ...candidate, phase: "open", seq } : candidate
  ));
  commit(accountId, { accountId, seq, entries: applyLimit(entries, seq, limit), tucked: false, closed: false });
}

/**
 * Open a conversation, or focus its existing window. `conversationId` is
 * `null` for the new-message picker. `limit` is the host's viewport capacity:
 * opening past it minimizes the least recently focused other windows instead
 * of unmounting them.
 *
 * An initial open creates the account's state. An open that names a different
 * account replaces the old state instead of mutating it: that is an account
 * switch, and the previous in-memory drafts must not survive it.
 */
export function openChatDock(
  accountId: string,
  trigger: Element | null,
  conversationId: string | null,
  limit = Number.POSITIVE_INFINITY,
): void {
  if (!accountId) return;
  if (state && state.accountId !== accountId) {
    // Account switch: the previous viewer's dock is gone for this instance. Its
    // stored record stays for a reload, but it must not paint for this viewer.
    hydratedByAccount.set(state.accountId, null);
    state = null;
    triggers.clear();
  }
  const current: ChatDockState = state ?? hydrate(accountId)
    ?? { accountId, entries: [], seq: 0, tucked: true, closed: false };
  const existing = current.entries.find((entry) => entry.conversationId === conversationId);
  const seq = current.seq + 1;
  let entries: ChatDockEntry[];
  if (existing) {
    entries = current.entries.map((entry) => (
      entry === existing ? { ...entry, phase: "open", seq } : entry
    ));
  } else {
    const base = conversationId === null ? [...current.entries] : withoutPicker(current.entries);
    entries = [...base, { conversationId, phase: "open", seq }];
  }
  rememberTrigger(accountId, conversationId, trigger);
  // Opening a conversation clears its dismissed flag: interaction re-enables it.
  // Cleared before the commit so the render that paints this window already knows
  // it is not dismissed.
  if (conversationId !== null) clearChatDockDismissed(accountId, conversationId);
  commit(accountId, { accountId, seq, entries: applyLimit(entries, seq, limit), tucked: false, closed: false });
}

/**
 * Select an existing conversation from the picker without a request, a
 * navigation or a send. The chooser entry is replaced; every mounted thread
 * keeps its own draft.
 */
export function openConversation(
  accountId: string,
  conversationId: string,
  limit = Number.POSITIVE_INFINITY,
): void {
  if (!accountId || !conversationId) return;
  if (!state || state.accountId !== accountId) return;
  const existing = state.entries.find((entry) => entry.conversationId === conversationId);
  const seq = state.seq + 1;
  const entries: ChatDockEntry[] = withoutPicker(state.entries).map((entry) => (
    entry === existing ? { ...entry, phase: "open", seq } : entry
  ));
  if (!existing) entries.push({ conversationId, phase: "open", seq });
  // Opening a conversation clears its dismissed flag: interaction re-enables it.
  clearChatDockDismissed(accountId, conversationId);
  commit(accountId, { accountId, seq, entries: applyLimit(entries, seq, limit), tucked: false, closed: false });
}

/** Make one window the most recently focused, restoring it if minimized. */
export function focusChatDock(
  accountId: string,
  conversationId: string | null,
  limit = Number.POSITIVE_INFINITY,
): void {
  focusEntry(accountId, conversationId, limit);
}

/** Bring a rail head back as a focused window. It was never unmounted. */
export function restoreChatDock(
  accountId: string,
  conversationId: string | null,
  limit = Number.POSITIVE_INFINITY,
): void {
  // Restoring from the rail clears the dismissed flag: interaction re-enables it.
  // Cleared first, so the render that focuses the window cannot filter it out.
  if (conversationId !== null) clearChatDockDismissed(accountId, conversationId);
  focusEntry(accountId, conversationId, limit);
}

/**
 * Fold the surplus open windows after the host's capacity shrinks.
 *
 * The window's CSS width is 24rem, so its real pixel width grows with the
 * reader's text scale: a scale change (or a narrower viewport) can lower the
 * capacity while more windows are already open. This is the same rule as
 * opening past capacity — the most recently focused window stays open and the
 * least recently focused others become rail heads — but it runs when the limit
 * itself moves. `applyLimit` only flips `phase`, so every window stays mounted
 * (and keeps its draft); `tucked` and `closed` are untouched, and a row with
 * nothing over the limit neither re-orders nor emits.
 */
export function clampChatDockCapacity(accountId: string, limit: number): void {
  const current = state;
  if (!current || current.accountId !== accountId) return;
  if (!Number.isFinite(limit)) return;
  const focusedSeq = current.entries.reduce(
    (max, entry) => (entry.phase === "open" && entry.seq > max ? entry.seq : max),
    -1,
  );
  const entries = applyLimit(current.entries, focusedSeq, limit);
  // `applyLimit` always returns a fresh array: compare entries by identity so a
  // capacity change with nothing over the limit is a true no-op.
  const changed = entries.length !== current.entries.length
    || entries.some((entry, index) => entry !== current.entries[index]);
  if (!changed) return;
  commit(current.accountId, { ...current, entries });
}

/** Collapse a thread into a rail head. The picker is never minimizable. */
export function minimizeChatDock(accountId: string, conversationId: string | null): void {
  if (!state || state.accountId !== accountId) return;
  const entry = state.entries.find((candidate) => candidate.conversationId === conversationId);
  if (!entry || entry.phase === "minimized" || entry.conversationId === null) return;
  const { seq, tucked, closed } = state;
  commit(accountId, {
    accountId,
    seq,
    entries: state.entries.map((candidate) => (
      candidate === entry ? { ...candidate, phase: "minimized" } : candidate
    )),
    tucked,
    closed,
  });
}

/** Close one window and put the reader back on the control that opened it. */
export function closeChatDockEntry(accountId: string, conversationId: string | null, dismiss = true): void {
  if (!state || state.accountId !== accountId) return;
  const entry = state.entries.find((candidate) => candidate.conversationId === conversationId);
  if (!entry) return;
  const key = triggerKey(accountId, conversationId);
  const target = triggers.get(key) ?? null;
  triggers.delete(key);
  const { seq, tucked, closed } = state;
  const entries = state.entries.filter((candidate) => candidate !== entry);
  commit(accountId, entries.length === 0 ? null : { accountId, seq: seq + 1, entries, tucked, closed });
  // Closing through the dock remembers the conversation as dismissed. Expanding
  // into the full page is interaction, not closure, so callers pass false.
  if (dismiss && conversationId !== null) dismissChatDockEntry(accountId, conversationId);
  // `isConnected` covers a trigger whose route unmounted while a window was up.
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/** Close every window of this account and return focus to the latest trigger. */
export function closeChatDock(accountId: string): void {
  if (!state || state.accountId !== accountId || state.entries.length === 0) return;
  const latest = [...state.entries].sort((a, b) => b.seq - a.seq)[0];
  const target = latest ? triggers.get(triggerKey(accountId, latest.conversationId)) ?? null : null;
  for (const entry of state.entries) {
    triggers.delete(triggerKey(accountId, entry.conversationId));
    if (entry.conversationId !== null) dismissChatDockEntry(accountId, entry.conversationId);
  }
  commit(accountId, null);
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/**
 * The capsule's Minimize: park the rail in its resting circle without losing
 * anyone. Open threads fold to bubbles in place, and `seq` is untouched so the
 * stack order survives the fold. A live picker entry is dropped outright — the
 * picker is not a conversation, so it has no bubble to come back as, and it is
 * not remembered as dismissed either: tucking must not hide a person. No focus
 * move: the reader pressed a dock control, not a chat.
 */
export function tuckChatDock(accountId: string): void {
  if (!accountId || !state || state.accountId !== accountId) return;
  const entries: ChatDockEntry[] = state.entries
    .filter((entry) => entry.conversationId !== null)
    .map((entry) => (entry.phase === "open" ? { ...entry, phase: "minimized" } : entry));
  commit(accountId, { accountId, entries, seq: state.seq, tucked: true, closed: false });
}

/**
 * The resting circle: unfold the rail exactly as Minimize parked it. Nothing
 * is recreated because tucking never unmounted anything, so drafts and staged
 * media are still there. An account that has never had a dock gets its first
 * state here, since the circle is the first thing a fresh session shows.
 */
export function untuckChatDock(accountId: string): void {
  if (!accountId) return;
  // A stale call for a previous viewer must not replace the current one's dock.
  if (state !== null && state.accountId !== accountId) return;
  const current = state ?? hydrate(accountId);
  commit(accountId, current === null
    ? { accountId, entries: [], seq: 0, tucked: false, closed: false }
    : { ...current, tucked: false, closed: false });
}

/**
 * The capsule's Close: end the dock for this visit without stranding the
 * reader.
 *
 * Every conversation is closed and remembered as dismissed, its trigger
 * forgotten, and focus returns to the control that opened the most recent one.
 * What survives is the rail's resting circle: `closed` keeps the windows ended
 * (no bubble, no window) while the circle still shows the count and opens the
 * dock again. That is the owner's rule — the corner never goes empty, and the
 * pen never disappears.
 */
export function closeChatDockSurface(accountId: string): void {
  if (!accountId) return;
  // A stale call for a previous viewer must not dismiss the current one's dock.
  if (state !== null && state.accountId !== accountId) return;
  const current = state;
  const latest = current ? [...current.entries].sort((a, b) => b.seq - a.seq)[0] : undefined;
  const target = latest ? triggers.get(triggerKey(accountId, latest.conversationId)) ?? null : null;
  if (current) {
    for (const entry of current.entries) {
      triggers.delete(triggerKey(accountId, entry.conversationId));
      if (entry.conversationId !== null) dismissChatDockEntry(accountId, entry.conversationId);
    }
  }
  commit(accountId, { accountId, entries: [], seq: (current?.seq ?? 0) + 1, tucked: true, closed: true });
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/** Test isolation and account change: no state may outlive its viewer. */
export function resetChatDock(): void {
  // The stored record stays for the account being dropped — a reload and another
  // tab are still entitled to it — but this instance has consumed it: nothing may
  // resurrect the list before the next load.
  if (state !== null) hydratedByAccount.set(state.accountId, null);
  state = null;
  syntheticByAccount.clear();
  triggers.clear();
  dismissedByAccount.clear();
  emit();
}

/** Remove every key carrying `prefix` from one storage area. */
function clearStoredKeys(storage: Storage, prefix: string): void {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) {
        storage.removeItem(key);
        index -= 1;
      }
    }
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/** Test isolation only: clear every persisted sticky-dismissal and window key,
 * and the in-memory caches. Never called from production — `resetChatDock`
 * deliberately leaves storage intact so a reload and another tab still see it. */
export function resetChatDockDismissedForTests(): void {
  try {
    clearStoredKeys(localStorage, DISMISSED_PREFIX);
    clearStoredKeys(sessionStorage, ENTRIES_PREFIX);
  } catch {
    // Storage unavailable: nothing to clear.
  }
  dismissedByAccount.clear();
  hydratedByAccount.clear();
}

/** The one frozen empty state for a viewer who has not touched the dock yet. */
function syntheticState(accountId: string): ChatDockState {
  const cached = syntheticByAccount.get(accountId);
  if (cached) return cached;
  const empty: ChatDockState = Object.freeze({
    accountId,
    entries: NO_ENTRIES,
    seq: 0,
    tucked: true,
    closed: false,
  });
  syntheticByAccount.set(accountId, empty);
  return empty;
}

/**
 * This viewer's windows, or `null` for another account and while signed out.
 *
 * A signed-in viewer with no dock yet gets one stable, frozen empty state rather
 * than `null`: the resting circle is painted whenever the rail is not expanded,
 * which includes a closed or tucked dock with nothing in it, so a `null`
 * snapshot would leave the rail with no state to read before the first open and
 * the circle could not appear. The cached snapshot keeps its identity across
 * renders.
 *
 * A stored rail is adopted here, lazily and synchronously, before the first
 * mutation: `state` becomes the hydrated record, so the capacity clamp and an
 * opener see the restored windows instead of an empty dock. Nothing emits during
 * render — the reader is already painting — and the record is cached per account,
 * so every render of the same viewer gets the same object.
 */
export function useChatDock(viewerId: string | null): ChatDockState | null {
  return useSyncExternalStore(subscribe, () => {
    if (viewerId === null) return null;
    if (state === null) state = hydrate(viewerId);
    if (state === null) return syntheticState(viewerId);
    return state.accountId === viewerId ? state : null;
  }, serverCurrent);
}
