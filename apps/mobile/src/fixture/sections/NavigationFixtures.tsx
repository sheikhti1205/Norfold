import { useState } from "react";
import { useLocation } from "react-router";
import { PrimaryNav } from "../../components/Shell";
import { NavigationSetup } from "../../components/NavigationSetup";
import { resolveNavLayout } from "../../components/navLayout";
import { useWideViewport } from "../../components/responsive";
import { TabTapProvider } from "../../components/TabTap";
import { loadAppearance, type NavLayout } from "../../appearance";
import { FixtureFrame, FixtureSection, type FixtureVariant } from "../FixtureSection";

/**
 * Adaptive-navigation preflight.
 *
 * The production navigation is rendered through `PrimaryNav`: the same owner,
 * the same destination list, the same active treatment and create action the
 * app uses, so a screenshot of this section is evidence about the real
 * component rather than a re-implementation. Only the surrounding two-column
 * frame is fixture scaffolding, and the pane below is labelled as a placeholder.
 *
 * Width comes from the real viewport (`useWideViewport`, the single breakpoint
 * owner), so resizing the browser at 600px flips the untouched Automatic default
 * to the bottom bar exactly as the shell does. The `small-width` frame is a
 * 320px box inside whatever viewport the reviewer has, so it explicitly resolves
 * as compact: that frame is the phone case, not the reviewer's window. A chosen
 * rail stays a rail there; the frame previews the rail the temporary drawer
 * carries (the live drawer, its trigger and its dismissal belong to Shell).
 */
/** The only variants this section renders: the nav has no data to vary. */
export const NAV_VARIANTS: FixtureVariant[] = ["normal", "large-text", "dark", "amoled", "small-width"];

/**
 * The navigation has no data, so loading/empty/error/long-content frames were
 * nine copies of one component (review n2). Only the variants that can change
 * its paint are rendered. A rail frame selects Notifications rather than Home
 * so a non-first destination is reviewed; the bottom bar keeps Home selected,
 * because a multi-word label in the bar's selected slot is clipped at 320 px
 * (a pre-existing bar limit this wave does not change).
 */
const railActivePath = "/chats";

function LiveNavigationDemo({ variant }: { variant: FixtureVariant }) {
  const wideViewport = useWideViewport();
  // Real stored choice, read once: this is a static preflight surface and must
  // not rewrite the reader's preference while it renders.
  const [stored] = useState<NavLayout>(() => loadAppearance().navLayout);
  const layout = resolveNavLayout(
    stored,
    variant === "small-width" ? false : wideViewport,
  );
  const rail = layout === "rail";

  return (
    <div
      data-testid={`fixture-nav-demo-${variant}`}
      data-nav-layout={layout}
      data-nav-stored={stored}
    >
      <TabTapProvider>
        <div className={`flex min-h-[220px] w-full ${rail ? "flex-row" : "flex-col"}`}>
          {rail && <PrimaryNav layout="rail" activePath={rail ? railActivePath : "/"} layoutScope={variant} />}
          <p className="min-h-[96px] flex-1 p-4 text-sm text-on-surface-variant">
            Route content (placeholder)
          </p>
          {!rail && <PrimaryNav layout="bottom" activePath={rail ? railActivePath : "/"} layoutScope={variant} />}
        </div>
      </TabTapProvider>
    </div>
  );
}

/**
 * The first-use chooser, mounted as production renders it.
 *
 * The popover is `position: fixed` and `FixtureFrame` carries `contain: paint`,
 * so the frame is its containing block: the card centres inside the frame
 * instead of escaping to the page viewport. That needs a real height to centre
 * in, because an out-of-flow child collapses the content box to the caption bar
 * and `overflow-hidden` would clip the card away.
 *
 * Mounted only behind `?chooser=frames` (see the caller). `NavigationSetup` reads
 * `useAppearance`, and that hook re-applies the reader's stored appearance
 * whenever `APPEARANCE_EVENT` fires. Because the event reaches every listener,
 * a mounted chooser re-applies the saved text scale *after* this page's
 * page-wide large-text hold has run, so the hold silently loses. The flag keeps
 * that interaction out of the default preflight page, which the fixture tests
 * assert against, without weakening the hold or reordering global listeners.
 *
 * A stored `navLayoutChosen` hides the chooser, which is the component's own
 * contract; clear site data to review it again.
 */
function FirstUseChooserDemo() {
  return (
    <div data-testid="fixture-nav-first-use-demo" className="min-h-[520px] w-full">
      <NavigationSetup />
      <p className="p-4 text-sm text-on-surface-variant">
        Route content (placeholder). The chooser floats over this surface.
      </p>
    </div>
  );
}

/** Variants that can change the chooser's paint. */
const CHOOSER_VARIANTS: FixtureVariant[] = ["normal", "dark"];

/**
 * `?chooser=frames` renders the chooser inside frames (one per theme token set);
 * `?chooser=page` mounts it with no frame at all, which is the production
 * arrangement: `position: fixed` then resolves against the viewport, so the
 * capture proves the card centres on the screen rather than in a box.
 */
export function NavigationFixtures() {
  const chooser = new URLSearchParams(useLocation().search).get("chooser");
  const frames = chooser === "frames";
  const pageMount = chooser === "page";
  return (
    <FixtureSection
      id="navigation"
      title="Navigation"
      description="The production primary navigation as a bottom bar or a side rail. Stored choice comes from Appearance; the rail sits in flow where it fits and opens as a temporary drawer on a phone, so the compact frame previews the rail that drawer carries. Resize the viewport to review the breakpoint. Add ?chooser=frames or ?chooser=page to this route to mount the first-use chooser."
    >
      <div className="flex flex-col gap-4">
        {NAV_VARIANTS.map((variant) => (
          <div key={variant} className="-mx-4">
            <FixtureFrame section="navigation" variant={variant} geometry>
              <LiveNavigationDemo variant={variant} />
            </FixtureFrame>
          </div>
        ))}
        {frames
          ? CHOOSER_VARIANTS.map((variant) => (
              <div key={`chooser-${variant}`} className="-mx-4">
                <FixtureFrame section="navigation" variant={variant} geometry>
                  <FirstUseChooserDemo />
                </FixtureFrame>
              </div>
            ))
          : null}
      </div>
      {pageMount ? <NavigationSetup /> : null}
    </FixtureSection>
  );
}
