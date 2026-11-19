import { useSyncExternalStore } from "react";

/**
 * One chat window for the whole app.
 *
 * The launcher and the window are two views of one panel, so a tiny external
 * store owns the single open window and the control that keeps focus return.
 * It is modelled on `components/globalSearch.ts` for the same reason.
 *
 * Memory only, by contract: no persisted panel, no persisted draft, no device
 * storage. Every mutation names its account, so a late picker completion or a
 * stray callback can never act for a different viewer. The hook returns `null`
 * for any other account or a signed-out viewer, which unmounts the panel and
 * therefore drops the in-memory draft exactly as an account switch must.
 */

export interface ChatDockState {
  accountId: string;
  phase: "closed" | "open" | "minimized";
  /** `null` only while the new-message picker is showing. */
  conversationId: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: ChatDockState | null = null;
let returnFocus: HTMLElement | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** No panel is ever painted during a server render. */
function serverCurrent() {
  return null;
}

/**
 * Open the panel. `conversationId` is `null` for the new-message picker.
 *
 * An initial open creates the account's state. An open that names a different
 * account replaces the old state instead of mutating it: that is an account
 * switch, and the previous in-memory draft must not survive it. Within one
 * account a mounted thread is never replaced here; only its own canonical
 * unsent-work guard may unmount it.
 */
export function openChatDock(accountId: string, trigger: Element | null, conversationId: string | null): void {
  if (!accountId) return;
  if (state && state.accountId !== accountId) state = null;
  const mountedThread = state !== null
    && (state.phase === "minimized" || (state.phase === "open" && state.conversationId !== null));
  if (mountedThread && state?.conversationId !== conversationId) return;
  state = { accountId, phase: "open", conversationId };
  if (trigger instanceof HTMLElement) returnFocus = trigger;
  emit();
}

/**
 * Select an existing conversation without a request, a navigation or a send.
 *
 * Legal only when nothing is mounted: a closed panel, or the open picker. A
 * mounted thread owns a draft, so replacing it is refused here and must go
 * through the canonical guard first.
 */
export function openConversation(accountId: string, conversationId: string): void {
  if (!accountId || !conversationId) return;
  if (!state || state.accountId !== accountId) return;
  const picker = state.phase === "open" && state.conversationId === null;
  if (state.phase !== "closed" && !picker) return;
  state = { accountId, phase: "open", conversationId };
  emit();
}

/** Collapse to the thread header, or restore it. A minimized panel stays mounted. */
export function toggleChatDockCompact(accountId: string): void {
  if (!state || state.accountId !== accountId) return;
  if (state.phase === "open") state = { ...state, phase: "minimized" };
  else if (state.phase === "minimized") state = { ...state, phase: "open" };
  else return;
  emit();
}

/** Close the panel and put the reader back on the control that opened it. */
export function closeChatDock(accountId: string): void {
  if (!state || state.accountId !== accountId || state.phase === "closed") return;
  state = { accountId, phase: "closed", conversationId: null };
  const target = returnFocus;
  returnFocus = null;
  emit();
  // `isConnected` covers a launcher whose route unmounted while the panel was up.
  if (target?.isConnected) target.focus({ preventScroll: true });
}

/** Test isolation and account change: no state may outlive its viewer. */
export function resetChatDock(): void {
  if (state === null && returnFocus === null) return;
  state = null;
  returnFocus = null;
  emit();
}

/** This viewer's panel, or `null` for another account and while signed out. */
export function useChatDock(viewerId: string | null): ChatDockState | null {
  return useSyncExternalStore(subscribe, () => (
    state !== null && viewerId !== null && state.accountId === viewerId ? state : null
  ), serverCurrent);
}
