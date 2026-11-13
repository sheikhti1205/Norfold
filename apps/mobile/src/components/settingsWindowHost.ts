import { createContext, useContext, useLayoutEffect } from "react";

/**
 * True while the settings tree is mounted inside the floating settings window.
 *
 * The window owns the single settings search affordance: one icon in its top
 * bar, opening a top-attached field over the tree. The standalone `/settings`
 * page keeps its own in-page field, so a page must never paint that field while
 * it is hosted in the window - otherwise the surface shows two search entries
 * (owner order 2026-11-13).
 *
 * This is presentation context, not authorisation: it says where the tree is
 * drawn, never who may see it.
 */
export const SettingsWindowHost = createContext(false);

/** Whether the calling settings page is rendered inside the floating window. */
export function useSettingsWindowHosted(): boolean {
  return useContext(SettingsWindowHost);
}

/**
 * Publishes a hosted page's title into the window chrome.
 *
 * The window's top bar is the one visible title. A page rendered there keeps
 * its own heading element for focus and screen-reader announcement, but the
 * window must not say "Settings" while the reader is inside Notifications
 * (owner order 2026-11-13: one title, not a duplicate stacked under another).
 */
export const SettingsWindowTitle = createContext<((title: string | null) => void) | null>(null);

/** Reports this page's title to the hosting window; a no-op elsewhere. */
export function useReportSettingsWindowTitle(title: string): void {
  const report = useContext(SettingsWindowTitle);
  // Layout effect: the window has already painted its previous title, so the
  // new page's name must land before the next paint rather than a frame after.
  useLayoutEffect(() => {
    if (!report) return;
    report(title);
    return () => report(null);
  }, [report, title]);
}
