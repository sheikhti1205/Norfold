/**
 * Primary-navigation layout (owner ruling 4(e)).
 *
 * The reader picks a bottom bar or a side rail in Appearance. That preference
 * is only honoured where a side column can exist: at the compact breakpoint and
 * up. Below it the bottom bar always wins, so a stored `"rail"` can never turn
 * a phone into a narrow column or a drawer.
 *
 * The width gate is `useWideViewport` (the single owner of the rail breakpoint,
 * derived from `COMPACT_MAX_PX` in `responsive.ts`); this module only decides
 * how the stored preference resolves against it. One resolver, no second media
 * query, no parallel nav system.
 */
import { useSyncExternalStore } from "react";
import { APPEARANCE_EVENT, APPEARANCE_STORAGE_KEY, loadAppearance, useAppearance, type NavLayout } from "../appearance";
import { useWideViewport } from "./responsive";

/** What the stored preference renders as at this viewport width. */
export function resolveNavLayout(
  preference: NavLayout,
  wideViewport: boolean,
): NavLayout {
  return preference === "rail" && wideViewport ? "rail" : "bottom";
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
