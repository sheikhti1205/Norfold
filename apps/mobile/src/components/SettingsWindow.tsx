import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { X } from "lucide-react";
import { Settings } from "../screens/Settings";
import { settingsRouteElements } from "../screens/settingsRoutes";
import { OverlayStackBridge } from "./overlayFoundation";
import { RouterDepthProvider } from "./routerHistory";
import "./SettingsWindow.css";

/**
 * Settings as a floating window, not a page swap.
 *
 * Owner order 2026-11-13 (reference: the VS Code settings window): the Settings
 * row opens the settings surface over the app, and a press outside it closes
 * the window. The surface is the real settings tree - the same route elements
 * the `/settings` URL mounts - so a page cannot exist in one place and not the
 * other.
 *
 * The window keeps its own memory history. Opening it never changes the app's
 * URL, so closing puts the reader back exactly where they were without
 * replaying navigation, and a section visit inside the window leaves no
 * settings URL behind. A destination outside `/settings` is handed back to the
 * real router, which closes the window on the way.
 *
 * React Router 8 refuses a `<Router>` inside another `<Router>`, so this uses
 * the same history and context values a MemoryRouter would provide, minus the
 * nesting invariant. The route context is reset to the window's root so the
 * app's current matches do not become the window's parent path. This is the
 * router's own escape hatch (`UNSAFE_` contexts) and keeps every settings
 * page's `useNavigate`, `Link` and `useParams` pointed at the window instead of
 * the page behind it.
 */
export function SettingsWindow({ open, onClose, onExit }: {
  open: boolean;
  onClose: () => void;
  /** Navigate the real app after leaving the window for a non-settings route. */
  onExit: (path: string) => void;
}) {
  // Mounted only while open, so every open starts at the root and the memory
  // history (and its listener) belongs to exactly one showing of the window.
  if (!open) return null;
  return <SettingsWindowSurface onClose={onClose} onExit={onExit} />;
}

function SettingsWindowSurface({ onClose, onExit }: {
  onClose: () => void;
  onExit: (path: string) => void;
}) {
  const historyRef = useRef<ReturnType<typeof UNSAFE_createMemoryHistory> | null>(null);
  if (historyRef.current === null) {
    // `v5Compat` is what makes push/replace notify the listener. With it off,
    // the window painted once and never followed a settings link or redirect.
    historyRef.current = UNSAFE_createMemoryHistory({ initialEntries: ["/settings"], v5Compat: true });
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

  return <ModalOverlay isOpen onOpenChange={(next) => { if (!next) onClose(); }} isDismissable
    className="fb-modal-backdrop fb-settings-backdrop">
    <Modal className="fb-modal-panel fb-settings-window">
      <OverlayStackBridge onClose={onClose} onBack={goBack} />
      <Dialog aria-label="Settings" className="fb-settings-dialog">
        <header className="fb-settings-window-head">
          <Heading slot="title" className="fb-settings-window-title">Settings</Heading>
          <Button aria-label="Close settings" className="fb-icon-control" onPress={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </header>
        <div className="fb-settings-window-body">
          <UNSAFE_NavigationContext.Provider value={navigation}>
            <UNSAFE_LocationContext.Provider value={location}>
              <UNSAFE_RouteContext.Provider value={route}>
                <RouterDepthProvider depth={depth}>
                  <Routes>
                    <Route path="/settings" element={<Settings />}>{settingsRouteElements()}</Route>
                    <Route path="*" element={<ExitToApp onExit={onExit} />} />
                  </Routes>
                </RouterDepthProvider>
              </UNSAFE_RouteContext.Provider>
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_NavigationContext.Provider>
        </div>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

function ExitToApp({ onExit }: { onExit: (path: string) => void }) {
  const { pathname, search } = useLocation();
  useLayoutEffect(() => { onExit(`${pathname}${search}`); }, [onExit, pathname, search]);
  return null;
}
