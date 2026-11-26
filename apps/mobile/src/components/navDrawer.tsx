import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { Menu } from "lucide-react";

/**
 * The shell publishes one drawer trigger so a route's own top bar can carry
 * the control beside its brand instead of the shell painting a floating circle
 * over the content. The default context is unavailable, which is why a header
 * rendered outside the shell (the dev fixture, a settings window, a test)
 * never grows a stray navigation control.
 */
export interface NavDrawerContextValue {
  available: boolean;
  expanded: boolean;
  open: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const NavDrawerContext = createContext<NavDrawerContextValue>({
  available: false,
  expanded: false,
  open: () => undefined,
  triggerRef: { current: null },
});

export function NavDrawerProvider({
  available,
  expanded,
  open,
  triggerRef,
  children,
}: NavDrawerContextValue & { children: ReactNode }) {
  return (
    <NavDrawerContext.Provider value={{ available, expanded, open, triggerRef }}>
      {children}
    </NavDrawerContext.Provider>
  );
}

/** The one inline navigation control, mounted by a route's top bar. */
export function NavDrawerButton() {
  const { available, expanded, open, triggerRef } = useContext(NavDrawerContext);
  if (!available) return null;
  return (
    <button
      ref={triggerRef}
      type="button"
      className="fb-nav-drawer-inline"
      aria-label="Open navigation"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={open}
    >
      <Menu size={22} aria-hidden="true" />
    </button>
  );
}
