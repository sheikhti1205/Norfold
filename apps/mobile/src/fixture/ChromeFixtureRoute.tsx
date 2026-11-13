import { useEffect, useState } from "react";
import { Search, Settings as SettingsIcon } from "lucide-react";
import { AppBar } from "../components/AppBar";
import { GlobalSearchOverlay } from "../components/GlobalSearchOverlay";
import { resetGlobalSearch, toggleGlobalSearch, useGlobalSearchOpen } from "../components/globalSearch";
import { SettingsWindow } from "../components/SettingsWindow";

/**
 * Dev-only stage for the two surfaces that sit outside a screen: the app-wide
 * search overlay and the floating settings window.
 *
 * Both are `position: fixed`, so a frame inside `/__fixture` cannot show their
 * real geometry. This route is the production shell's layout in miniature: the
 * real `AppBar` outside a scrolling content pane, the one search trigger, and
 * the experiences opened from it. No auth, no network, no fixture data. It is
 * compiled out of production with `import.meta.env.DEV`, exactly like
 * `/__fixture`.
 */
export function ChromeFixtureRoute() {
  const searchOpen = useGlobalSearchOpen();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The store is module-level: leaving the stage must not leave search open for
  // the next route.
  useEffect(() => () => resetGlobalSearch(), []);

  return <div data-testid="chrome-fixture" className="flex h-[100dvh] flex-col bg-surface text-on-surface">
    <div data-global-search={searchOpen ? "true" : undefined}>
      <AppBar
        title="Home"
        utilities={false}
        actions={<button
          type="button"
          aria-label="Search"
          aria-expanded={searchOpen}
          className="fb-icon-control"
          onClick={(event) => toggleGlobalSearch(event.currentTarget)}
        >
          <Search size={20} aria-hidden="true" />
        </button>}
      />
    </div>

    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
        <p className="text-sm font-medium text-on-surface-variant">Fixture stage</p>
        <h2 className="text-xl font-semibold">Route content behind the chrome</h2>
        <p className="text-sm text-on-surface-variant">
          The page stays readable while search or settings is up. Both surfaces
          own their own layer, so this text only loses focus and sharpness, not
          its place.
        </p>
        <p className="text-sm text-on-surface-variant">
          Resize the window to review the phone offset and the desktop centre.
          Turn on extra large text to review the measured app-bar height.
        </p>
        <button
          type="button"
          className="fb-surface-button mt-2 w-fit gap-2 border border-outline-variant px-4"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={18} aria-hidden="true" />
          Open settings window
        </button>
      </div>
    </main>

    <GlobalSearchOverlay />
    <SettingsWindow
      open={settingsOpen}
      initialPath="/settings/appearance"
      onClose={() => setSettingsOpen(false)}
      onExit={() => setSettingsOpen(false)}
    />
  </div>;
}
