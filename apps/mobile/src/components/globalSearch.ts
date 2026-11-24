import { useSyncExternalStore } from "react";

/**
 * One search surface for the whole app.
 *
 * The magnifier in every top bar and the Search row in
 * the navigation open the same floating overlay - the prototype's pill bar with
 * recent searches, live results and the advanced card. Search is not a
 * destination, so opening it never navigates; `/search` stays reachable as the
 * deep-linkable full results page.
 *
 * The trigger lives in route-owned app bars (TopUtilities) and in the shell's
 * rail, which do not share a React parent below Shell. A tiny external store
 * lets both open the same single overlay without drilling a callback through
 * every screen, and keeps exactly one overlay mounted.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let open = false;
let origin: HTMLElement | null = null;
let seed: string | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function focusInput() {
  document.querySelector<HTMLInputElement>("[data-global-search-input]")?.focus();
}

/** Open the overlay, remembering the control that owns focus return. */
export function openGlobalSearch(trigger?: Element | null, query?: string) {
  if (trigger instanceof HTMLElement) origin = trigger;
  if (typeof query === "string" && query !== "") seed = query;
  if (open) {
    focusInput();
    return;
  }
  open = true;
  emit();
}

/**
 * A character typed on a non-editable surface opens search with that character
 * already in the field, so the reader does not type twice. Reading is a
 * one-shot: a later open starts empty.
 */
export function takeGlobalSearchSeed() {
  const value = seed;
  seed = null;
  return value;
}

/** The magnifier and the Search nav row behave as one toggle. */
export function toggleGlobalSearch(trigger?: Element | null) {
  if (open) closeGlobalSearch();
  else openGlobalSearch(trigger);
}

/** Close it and put the reader back on the control that opened it. */
export function closeGlobalSearch() {
  if (!open) return;
  open = false;
  const target = origin;
  origin = null;
  emit();
  // `isConnected` covers a trigger whose route unmounted while search was up.
  if (target?.isConnected) target.focus();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGlobalSearchOpen() {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/** Test isolation only: no state may outlive a mounted app. */
export function resetGlobalSearch() {
  open = false;
  origin = null;
  seed = null;
  emit();
}
