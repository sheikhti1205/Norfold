import { createContext, useContext } from "react";

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
