import { useEffect, useRef } from "react";
import { useAppearance, type NavLayout } from "../appearance";
import { MEDIUM_MAX_PX, useViewportWidth } from "./responsive";
import { NavLayoutCard } from "./settings";
import "./NavigationSetup.css";

/**
 * First authenticated wide use. Never a modal, never an account preference.
 *
 * Owner direction (docs/design/APPEARANCE-CHOOSERS.md §4 and §5) with one later
 * correction (2026-11-12): the panel floats over the surface instead of sitting
 * in the page as a band, and it carries the same two picture tiles Appearance
 * uses, so the layout the reader picks here is the layout they will recognise
 * later. The written decisions still hold:
 *
 * - The label is `Choose your navigation`, not marketing copy.
 * - The copy says what happens next and points at where to change it.
 * - There is no third control. `Use recommended` was removed on purpose: a
 *   button that silently picks for the reader is the part that read as a
 *   consent banner. The recommendation is a line of text, so the choice stays
 *   the reader's.
 * - Tile order is `Automatic`, `Bottom bar`, then `Side rail`. Automatic is
 *   the responsive default: the rail appears when the screen has room and the
 *   bottom bar stays on phones. The explicit tiles differ in shape, not only
 *   orientation (four rail dots against five bar dots).
 * - Choosing a tile writes `navLayout` and `navLayoutChosen` exactly as before,
 *   and focus moves to the current page link in the new navigation.
 */
export function NavigationSetup() {
  const { settings, update } = useAppearance();
  const width = useViewportWidth();
  const choseHere = useRef(false);
  useEffect(() => {
    if (!settings.navLayoutChosen || !choseHere.current) return;
    choseHere.current = false;
    // The chosen control disappeared. Continue in the new canonical navigation,
    // rather than dropping keyboard/switch users back onto the document body.
    const nav = document.querySelector('nav[aria-label="Primary"]');
    (nav?.querySelector<HTMLAnchorElement>('[aria-current="page"]') ?? nav?.querySelector<HTMLAnchorElement>("a"))?.focus();
  }, [settings.navLayoutChosen]);
  const choose = (navLayout: NavLayout) => {
    choseHere.current = true;
    update({ navLayout, navLayoutChosen: true });
  };
  if (width < MEDIUM_MAX_PX || settings.navLayoutChosen) return null;
  return <section
    className="fb-nav-setup-popover"
    role="dialog"
    aria-modal="false"
    aria-labelledby="fb-nav-setup-title"
    aria-describedby="fb-nav-setup-body"
  >
    <h2 id="fb-nav-setup-title">Choose your navigation</h2>
    <p id="fb-nav-setup-body">You can change this later in Settings, under Personalization.</p>
    <fieldset className="fb-choice-fieldset fb-nav-setup-choices" aria-label="Navigation layout">
      <div className="fb-preview-grid fb-preview-grid-nav">
        {(["auto", "bottom", "rail"] as const).map(value => (
          <NavLayoutCard key={value} name="fb-nav-setup" value={value} checked={false} onChange={choose} />
        ))}
      </div>
    </fieldset>
    <p className="fb-nav-setup-recommendation">
      Recommended: Automatic. The rail appears when the screen has room; the bottom bar stays on phones.
    </p>
  </section>;
}
