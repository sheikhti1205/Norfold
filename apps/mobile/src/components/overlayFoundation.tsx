import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { OverlayTriggerStateContext, Popover, type PopoverProps } from "react-aria-components";
import { isTopModalLayer, useModalLayer } from "../hooks/modalLayers";
import { registerBackInterceptor } from "./backNavigation";
import "./adaptiveFoundation.css";

// Portals preserve React context. Children therefore get a layer above their
// parent even though both mount under body (including menu -> confirmation).
const OverlayDepth = createContext(0);

export function useOverlayDepth() { return useContext(OverlayDepth) + 1; }

export function OverlayDepthProvider({ depth, children }: { depth: number; children: ReactNode }) {
  return <OverlayDepth.Provider value={depth}>{children}</OverlayDepth.Provider>;
}

/**
 * Where a popover opened from inside another popover should portal its panel.
 *
 * React Aria closes a popover when focus leaves its DOM subtree. A nested
 * popover that portals to `document.body` therefore steals focus out of its
 * parent and the parent closes under it. Portaling into the parent's own
 * panel keeps focus inside, keeps the parent's aria-hiding from swallowing
 * the child, and lets outside-interaction checks see one overlay tree. This
 * is the same containment React Aria uses for submenus.
 */
const OverlayPortalContainer = createContext<HTMLElement | null>(null);

export function useOverlayPortalContainer(): HTMLElement | null {
  return useContext(OverlayPortalContainer);
}

/** Bridge React Aria surfaces into the existing legacy Escape/Android Back stack.
 * React Aria alone owns focus, outside interaction and scroll containment.
 * Mount INSIDE the portal so a closed/collection-only popover registers nothing.
 */
export function OverlayStackBridge({ onClose, onBack, onEscape, dismissible = true }: {
  onClose: () => void;
  /** A surface with its own history can walk back before it dismisses. */
  onBack?: () => void;
  /**
   * First refusal on Escape for a child layer that opens over this one (the
   * settings window's search field). Returning true consumes the key so the
   * parent stays open; the bridge owns the one document listener, because a
   * second capture listener would never run after `stopImmediatePropagation`.
   */
  onEscape?: () => boolean;
  dismissible?: boolean;
}) {
  const layer = useModalLayer(true);
  const latest = useRef({ onClose, onBack, onEscape, dismissible });
  latest.current = { onClose, onBack, onEscape, dismissible };
  useEffect(() => {
    const close = () => { if (latest.current.dismissible) latest.current.onClose(); };
    const back = () => {
      if (!latest.current.dismissible) return;
      if (latest.current.onBack) latest.current.onBack();
      else latest.current.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !isTopModalLayer(layer)) return;
      // Capture before old document-level focus traps. One key/Back consumes
      // exactly one layer, including a submenu, and cannot close its parent.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (latest.current.onEscape?.()) return;
      close();
    };
    document.addEventListener("keydown", escape, true);
    const offBack = registerBackInterceptor(() => {
      if (!isTopModalLayer(layer)) return false;
      back();
      return true;
    });
    return () => { document.removeEventListener("keydown", escape, true); offBack(); };
  }, [layer]);
  return null;
}

function PopoverStackBridge() {
  const state = useContext(OverlayTriggerStateContext);
  return <OverlayStackBridge onClose={() => state?.close()} />;
}

/** Collision-aware positioning and nested portal grouping remain React Aria's. */
export function LayeredPopover({ children, className = "", ...props }: PopoverProps) {
  const depth = useOverlayDepth();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  return <Popover {...props} className={`fb-popover ${className}`} style={{ zIndex: 70 + depth * 10 }}>
    {(values) => <OverlayDepthProvider depth={depth}>
      <PopoverStackBridge />
      <OverlayPortalContainer.Provider value={portalContainer}>
        <div ref={setPortalContainer} style={{ display: "contents" }}>
          {typeof children === "function" ? children(values) : children}
        </div>
      </OverlayPortalContainer.Provider>
    </OverlayDepthProvider>}
  </Popover>;
}
