import { useSyncExternalStore } from "react";

/**
 * The chat windows the reader keeps open across the app.
 *
 * Every open or minimized conversation is one entry in this external store.
 * Windows stay mounted for their whole lifetime, so a draft, staged photo or
 * recorder never dies when another conversation takes focus. It is modelled on
 * `components/globalSearch.ts` for the same reason.
 *
 * Memory only, by contract: no persisted windows, no persisted draft, no device
 * storage. Every mutation names its account, so a late picker completion or a
 * stray callback can never act for a different viewer. The hook returns `null`
 * for any other account or a signed-out viewer, which unmounts every window
 * and therefore drops the in-memory drafts exactly as an account switch must.
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
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: ChatDockState | null = null;
/** The control that opened an entry, so closing it returns focus there. */
const triggers = new Map<string, HTMLElement>();

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
  state = { accountId, seq, entries: applyLimit(entries, seq, limit) };
  emit();
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
    state = null;
    triggers.clear();
  }
  const current: ChatDockState = state ?? { accountId, entries: [], seq: 0 };
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
  state = { accountId, seq, entries: applyLimit(entries, seq, limit) };
  rememberTrigger(accountId, conversationId, trigger);
  emit();
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
  state = { accountId, seq, entries: applyLimit(entries, seq, limit) };
  emit();
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
  focusEntry(accountId, conversationId, limit);
}

/** Collapse a thread into a rail head. The picker is never minimizable. */
export function minimizeChatDock(accountId: string, conversationId: string | null): void {
  if (!state || state.accountId !== accountId) return;
  const entry = state.entries.find((candidate) => candidate.conversationId === conversationId);
  if (!entry || entry.phase === "minimized" || entry.conversationId === null) return;
  state = {
    accountId,
    seq: state.seq,
    entries: state.entries.map((candidate) => (
      candidate === entry ? { ...candidate, phase: "minimized" } : candidate
    )),
  };
  emit();
}

/** Close one window and put the reader back on the control that opened it. */
export function closeChatDockEntry(accountId: string, conversationId: string | null): void {
  if (!state || state.accountId !== accountId) return;
  const entry = state.entries.find((candidate) => candidate.conversationId === conversationId);
  if (!entry) return;
  const key = triggerKey(accountId, conversationId);
  const target = triggers.get(key) ?? null;
  triggers.delete(key);
  const entries = state.entries.filter((candidate) => candidate !== entry);
  state = entries.length === 0 ? null : { accountId, seq: state.seq + 1, entries };
  emit();
  // `isConnected` covers a trigger whose route unmounted while a window was up.
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/** Close every window of this account and return focus to the latest trigger. */
export function closeChatDock(accountId: string): void {
  if (!state || state.accountId !== accountId || state.entries.length === 0) return;
  const latest = [...state.entries].sort((a, b) => b.seq - a.seq)[0];
  const target = latest ? triggers.get(triggerKey(accountId, latest.conversationId)) ?? null : null;
  for (const entry of state.entries) triggers.delete(triggerKey(accountId, entry.conversationId));
  state = null;
  emit();
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/** Test isolation and account change: no state may outlive its viewer. */
export function resetChatDock(): void {
  if (state === null && triggers.size === 0) return;
  state = null;
  triggers.clear();
  emit();
}

/** This viewer's windows, or `null` for another account and while signed out. */
export function useChatDock(viewerId: string | null): ChatDockState | null {
  return useSyncExternalStore(subscribe, () => (
    state !== null && viewerId !== null && state.accountId === viewerId ? state : null
  ), serverCurrent);
}
