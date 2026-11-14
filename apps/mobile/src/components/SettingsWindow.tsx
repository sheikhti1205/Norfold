import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import {
  UNSAFE_createMemoryHistory,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { Search, ArrowLeft, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "../auth";
import { Settings } from "../screens/Settings";
import { Profile } from "../screens/Profile";
import { ProfileEdit } from "../screens/ProfileEdit";
import { settingsRouteElements } from "../screens/settingsRoutes";
import { SettingsRow } from "./settings";
import { SettingsWindowHost, SettingsWindowTitle } from "./settingsWindowHost";
import { OverlayStackBridge } from "./overlayFoundation";
import { RouterDepthProvider } from "./routerHistory";
import { searchSettings } from "../services/settingsIndex";
import "./SettingsWindow.css";

/**
 * Settings as a floating window, not a page swap.
 *
 * Owner order 2026-11-13 (references: the VS Code settings window and the
 * owner's top-attached search sketch): the Settings row opens the settings
 * surface over the app, and a press outside it closes the window. The surface
 * is the real settings tree - the same route elements the `/settings` URL
 * mounts - so a page cannot exist in one place and not the other.
 *
 * The window owns the ONE settings search: a single icon in its top bar that
 * expands into a field in the same row, beside the title, with results dropping
 * below it. The field never adds a second row or pushes the page down (owner
 * order 2026-11-14). The tree carries no second search field, and settings
 * carries no notification bell (owner order 2026-11-13).
 *
 * The window keeps its own memory history. Opening it never changes the app's
 * URL, so closing puts the reader back exactly where they were without
 * replaying navigation, and a section visit inside the window leaves no
 * settings URL behind. The owner's profile is part of this surface: the
 * settings identity header and any `/profile` link open it inside the window,
 * so nobody is thrown back to a separate page. Any other destination is handed
 * back to the real router, which closes the window on the way.
 *
 * React Router 8 refuses a `<Router>` inside another `<Router>`, so this uses
 * the same history and context values a MemoryRouter would provide, minus the
 * nesting invariant. The route context is reset to the window's root so the
 * app's current matches do not become the window's parent path. This is the
 * router's own escape hatch (`UNSAFE_` contexts) and keeps every settings
 * page's `useNavigate`, `Link` and `useParams` pointed at the window instead of
 * the page behind it.
 */
export function SettingsWindow({ open, initialPath = "/settings", onClose, onExit }: {
  open: boolean;
  /** Section to open at, e.g. `/settings/notifications` from the account menu. */
  initialPath?: string;
  onClose: () => void;
  /** Navigate the real app after leaving the window for a non-settings route. */
  onExit: (path: string) => void;
}) {
  // Mounted only while open, so every open starts at the requested section and
  // the memory history (and its listener) belongs to exactly one showing of the
  // window. Keyed by the entry path: opening another row while the window is
  // already open starts that section rather than inheriting the old stack.
  if (!open) return null;
  return <SettingsWindowSurface key={initialPath} initialPath={initialPath} onClose={onClose} onExit={onExit} />;
}

function SettingsWindowSurface({ initialPath, onClose, onExit }: {
  initialPath: string;
  onClose: () => void;
  onExit: (path: string) => void;
}) {
  const historyRef = useRef<ReturnType<typeof UNSAFE_createMemoryHistory> | null>(null);
  if (historyRef.current === null) {
    // `v5Compat` is what makes push/replace notify the listener. With it off,
    // the window painted once and never followed a settings link or redirect.
    historyRef.current = UNSAFE_createMemoryHistory({ initialEntries: [initialPath], v5Compat: true });
  }
  const history = historyRef.current;
  const [state, setState] = useState(() => ({ action: history.action, location: history.location }));
  useLayoutEffect(() => history.listen(setState), [history]);

  const goBack = useCallback(() => {
    // Android Back walks the window's own sections first; at its root there is
    // nothing left to walk, so the window closes.
    if (history.index > 0) history.go(-1);
    else onClose();
  }, [history, onClose]);

  const navigation = useMemo(() => ({
    basename: "/",
    navigator: history,
    static: false,
    useTransitions: undefined,
    future: {},
  }), [history]);
  const location = useMemo(
    () => ({ location: state.location, navigationType: state.action }),
    [state],
  );
  const route = useMemo(() => ({ outlet: null, matches: [], isDataRoute: false }), []);
  const depth = useCallback(() => history.index, [history]);

  const [searchOpen, setSearchOpen] = useState(false);
  // The window chrome carries the ONE visible page title. A hosted page reports
  // its own title here (the same string it would have shown as its H1), so the
  // window never says "Settings" while the reader is inside Notifications, and
  // the page never paints a second giant heading underneath it.
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const atSettingsRoot = state.location.pathname.replace(/\/+$/, "") === "/settings";
  const windowTitle = atSettingsRoot ? "Settings" : pageTitle ?? "Settings";
  const canGoBack = history.index > 0;
  const searchToggle = useRef<HTMLButtonElement>(null);
  // Closing the field returns focus to the icon that opened it. Picking a
  // result is different: the destination's heading takes focus, so the toggle
  // must not steal it back. The toggle is mounted only while the field is
  // closed, so focus is restored after that commit.
  const restoreSearchFocus = useRef(false);
  const closeSearch = useCallback(() => {
    restoreSearchFocus.current = true;
    setSearchOpen(false);
  }, []);
  useLayoutEffect(() => {
    if (searchOpen || !restoreSearchFocus.current) return;
    restoreSearchFocus.current = false;
    searchToggle.current?.focus();
  }, [searchOpen]);
  // Escape belongs to the field while it is open, not to the window: a reader
  // dismissing search stays where the tree is. The bridge asks this before it
  // closes the window, so one keypress consumes exactly one layer.
  const consumeEscape = useCallback(() => {
    if (!searchOpen) return false;
    closeSearch();
    return true;
  }, [searchOpen, closeSearch]);

  return <ModalOverlay isOpen onOpenChange={(next) => { if (!next) onClose(); }} isDismissable
    className="fb-modal-backdrop fb-settings-backdrop">
    <Modal className="fb-modal-panel fb-settings-window">
      <OverlayStackBridge onClose={onClose} onBack={goBack} onEscape={consumeEscape} />
      {/* The window's router wraps the chrome as well as the tree. Search
          results are links, so they must navigate the window's memory history;
          outside these providers they would silently drive the app behind. */}
      <UNSAFE_NavigationContext.Provider value={navigation}>
        <UNSAFE_LocationContext.Provider value={location}>
          <UNSAFE_RouteContext.Provider value={route}>
            <Dialog aria-label="Settings" className="fb-settings-dialog">
              <header className="fb-settings-window-head" data-searching={searchOpen || undefined}>
                {canGoBack && (
                  <Button aria-label="Back" className="fb-icon-control fb-settings-window-back" onPress={goBack}>
                    <ArrowLeft size={18} aria-hidden="true" />
                  </Button>
                )}
                <Heading slot="title" className="fb-settings-window-title">{windowTitle}</Heading>
                <div className="fb-settings-window-actions">
                  {searchOpen
                    ? <SettingsWindowSearch onDismiss={closeSearch} onPicked={() => setSearchOpen(false)} />
                    : <Button ref={searchToggle} aria-label="Search settings" className="fb-icon-control"
                        onPress={() => setSearchOpen(true)}>
                        <Search size={18} aria-hidden="true" />
                      </Button>}
                  <Button aria-label="Close settings" className="fb-icon-control" onPress={onClose}>
                    <X size={18} aria-hidden="true" />
                  </Button>
                </div>
              </header>
              <div className="fb-settings-window-body">
                <SettingsWindowHost.Provider value>
                  <SettingsWindowTitle.Provider value={setPageTitle}>
                    <RouterDepthProvider depth={depth}>
                      <Routes>
                        <Route path="/settings" element={<Settings />}>{settingsRouteElements()}</Route>
                        {/* Own profile lives in the window too: the settings
                            identity header links here, and Profile's own edit
                            link must not close the surface mid-flow. */}
                        <Route path="/profile" element={<Profile />} />
                        <Route path="/profile/edit" element={<ProfileEdit />} />
                        <Route path="*" element={<ExitToApp onExit={onExit} />} />
                      </Routes>
                    </RouterDepthProvider>
                  </SettingsWindowTitle.Provider>
                </SettingsWindowHost.Provider>
              </div>
            </Dialog>
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_NavigationContext.Provider>
    </Modal>
  </ModalOverlay>;
}

/**
 * The window's one search: the magnifier expands into a field in the header
 * row, beside the title, and results drop below the bar.
 *
 * Every entry comes from `searchSettings`, so the list is the same catalogue
 * the Settings tree is generated from - search cannot offer a destination the
 * tree does not have. Results are ordinary links in the window's own router,
 * so picking one changes the window and leaves the page behind untouched.
 */
function SettingsWindowSearch({ onDismiss, onPicked }: {
  onDismiss: () => void;
  onPicked: () => void;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!trimmed) return null;
    return searchSettings(trimmed, {
      platform: Capacitor.isNativePlatform() ? "android" : "web",
      signedIn: Boolean(user),
      capabilities: [],
    });
  }, [trimmed, user]);
  const count = results?.length ?? 0;

  // A press outside the field or its results dismisses search, the way a
  // normal search bar behaves. Result clicks stay inside the area and pick.
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (area.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [onDismiss]);

  return <div ref={area} className="fb-settings-window-search" role="search">
    <Search size={16} aria-hidden="true" className="fb-settings-window-searchicon" />
    <input
      ref={input}
      type="search"
      value={query}
      autoFocus
      aria-label="Search settings"
      placeholder="Search settings"
      aria-controls={results ? resultsId : undefined}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" && count > 0) {
          event.preventDefault();
          document.getElementById(resultsId)?.querySelector<HTMLElement>("a")?.focus();
        }
      }}
    />
    {query && <button type="button" aria-label="Clear search" className="fb-settings-searchclear"
      onClick={() => { setQuery(""); input.current?.focus(); }}>
      <X size={16} aria-hidden="true" />
    </button>}
    {results && <div className="fb-settings-window-searchpanel">
      <p role="status" className="fb-settings-window-searchstatus">
        {count
          ? `${count} ${count === 1 ? "setting" : "settings"} found`
          : "No settings found. Try a different word."}
      </p>
      {count > 0 && <ul id={resultsId} className="fb-settings-window-results" aria-label="Settings search results"
        onClick={(event) => {
          // The row's own link navigates the window's memory router on this
          // same click; this only puts the field away afterwards.
          if ((event.target as Element).closest("a[href]")) onPicked();
        }}>
        {results.map(({ id, ...row }) => <li key={id}><SettingsRow {...row} /></li>)}
      </ul>}
    </div>}
  </div>;
}

function ExitToApp({ onExit }: { onExit: (path: string) => void }) {
  const { pathname, search } = useLocation();
  useLayoutEffect(() => { onExit(`${pathname}${search}`); }, [onExit, pathname, search]);
  return null;
}
