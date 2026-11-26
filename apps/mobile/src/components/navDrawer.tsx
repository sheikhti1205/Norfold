import { createContext, useContext, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
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
  /**
   * Whether a top bar has mounted the inline control. The shell's fixed
   * fallback stays in the tree for surfaces that have no bar, so this is the
   * one signal that tells "the route carries the control" apart from "the route
   * has none". CSS alone cannot answer that for React.
   */
  inlineMounted: boolean;
  onInlineMount: (mounted: boolean) => void;
}

const noop = () => undefined;

const NavDrawerContext = createContext<NavDrawerContextValue>({
  available: false,
  expanded: false,
  open: noop,
  triggerRef: { current: null },
  inlineMounted: false,
  onInlineMount: noop,
});

export interface NavDrawerProviderProps
  extends Omit<NavDrawerContextValue, "inlineMounted" | "onInlineMount"> {
  /** Optional: a header rendered outside the shell never reports a mount. */
  inlineMounted?: boolean;
  onInlineMount?: (mounted: boolean) => void;
  children: ReactNode;
}

export function NavDrawerProvider({
  available,
  expanded,
  open,
  triggerRef,
  inlineMounted = false,
  onInlineMount = noop,
  children,
}: NavDrawerProviderProps) {
  return (
    <NavDrawerContext.Provider
      value={{ available, expanded, open, triggerRef, inlineMounted, onInlineMount }}
    >
      {children}
    </NavDrawerContext.Provider>
  );
}

/** The one inline navigation control, mounted by a route's top bar. */
export function NavDrawerButton() {
  const { available, expanded, open, triggerRef, onInlineMount } = useContext(NavDrawerContext);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A layout effect, not a passive one: the shell's fixed fallback must be
  // hidden before the first paint of a route that carries this control, or the
  // rejected bottom-left circle would paint for a frame on every mount. The
  // shared shell ref is handed over here instead of through the `ref` prop:
  // AnimatePresence keeps the previous route's bar mounted through its exit
  // animation, and that later unmount would otherwise null the ref the entering
  // route had already claimed. Clearing is ownership-checked for the same
  // reason.
  useLayoutEffect(() => {
    if (!available) return;
    const node = buttonRef.current;
    if (node !== null) triggerRef.current = node;
    onInlineMount(true);
    return () => {
      onInlineMount(false);
      if (triggerRef.current === node) triggerRef.current = null;
    };
  }, [available, triggerRef, onInlineMount]);
  if (!available) return null;
  return (
    <button
      ref={buttonRef}
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
