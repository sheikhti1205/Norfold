import { useInlineRail } from "./navLayout";
import "./navOutsideBrand.css";

/**
 * The app name painted outside a side rail while that column is an unnamed icon
 * strip (owner direction 2026-11-18).
 *
 * The rail's head always carries the mark. The wordmark reads just past it, in
 * the header of the content the rail borders, and moves back into the rail the
 * moment the panel names itself: pinned, hover- or focus-expanded.
 * `Shell.nav.css` owns that decision, so every header renders this one
 * component instead of repeating the rule. The copy is inert text, never a
 * second home control: the rail already owns navigation.
 *
 * The shell publishes whether an in-flow rail is on screen. A phone drawer, a
 * chrome-free route, the dev fixture, or any surface rendered outside the shell
 * reports `false`, so this renders nothing there.
 */
export function NavOutsideBrand() {
  const inlineRail = useInlineRail();
  if (!inlineRail) return null;
  return <span className="fb-nav-outside-label fb-nav-outside-brand">Norfold</span>;
}
