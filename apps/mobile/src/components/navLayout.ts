/**
 * Primary-navigation layout (owner ruling 4(e), three-way preference
 * 2026-11-18; phone-rail correction 2026-11-18).
 *
 * `auto` uses the rail where a side column fits and the bottom bar otherwise.
 * `rail` is the reader's choice on every width: it renders the in-flow column
 * where there is room and a temporary overlay drawer on a phone. It is no
 * longer silently exchanged for the bottom bar — the navigation style is the
 * reader's decision, not one this module makes for them. `bottom` always keeps
 * the bar, floating over a wide canvas instead of turning into a rail. The
 * stored preference is never rewritten by a resize; it only decides what
 * renders.
 *
 * The width gate is `useWideViewport` (the single owner of the rail breakpoint,
 * derived from `COMPACT_MAX_PX` in `responsive.ts`); this module only decides
 * how the stored preference resolves against it. One resolver, no second media
 * query, no parallel nav system. `Shell` turns a rail on a narrow viewport into
 * the drawer; the resolver itself only names the chosen style.
 */
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from "react";
import { APPEARANCE_EVENT, APPEARANCE_STORAGE_KEY, loadAppearance, useAppearance, type NavLayout } from "../appearance";
import { useWideViewport } from "./responsive";

/** What the stored preference renders as at this viewport width. */
export function resolveNavLayout(
  preference: NavLayout,
  wideViewport: boolean,
): NavLayout {
  if (preference === "auto") return wideViewport ? "rail" : "bottom";
  return preference;
}

/** The layout the shell should render right now. */
export function useNavLayout(): NavLayout {
  const { settings } = useAppearance();
  const wideViewport = useWideViewport();
  return resolveNavLayout(settings.navLayout, wideViewport);
}

/**
 * The stored layout without re-applying the appearance.
 *
 * Route chrome (TopUtilities) lives inside the fixture's review surface, where
 * one page-wide text hold must remain the only root-font-size writer. Reading
 * the same preference through a side-effect-free subscription keeps that owner
 * singular while still reacting to a layout change.
 */
function subscribeToStoredLayout(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APPEARANCE_STORAGE_KEY) onChange();
  };
  window.addEventListener(APPEARANCE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStoredNavLayout(): NavLayout {
  const preference = useSyncExternalStore(
    subscribeToStoredLayout,
    () => loadAppearance().navLayout,
    () => "bottom" as NavLayout,
  );
  const wideViewport = useWideViewport();
  return resolveNavLayout(preference, wideViewport);
}

/**
 * Whether the shell is currently painting an in-flow side rail.
 *
 * The rail's own chrome (Home's row, the shared app bar, and the headers that
 * render `NavOutsideBrand`) needs to know this without repeating the
 * breakpoint, and it must be false wherever a rail is not actually on screen:
 * a phone drawer, a chrome-free route, the dev fixture, or any surface rendered
 * outside the shell. `Shell` owns the answer, so it publishes one value from
 * the same expression that mounts the rail: the outside wordmark cannot outlive
 * the column it belongs to. The default is `false`, which is why a bar rendered
 * on its own never grows a stray brand.
 */
const InlineRailContext = createContext(false);

export function useInlineRail(): boolean {
  return useContext(InlineRailContext);
}

export function InlineRailProvider({ show, children }: { show: boolean; children: ReactNode }) {
  return createElement(InlineRailContext.Provider, { value: show }, children);
}
