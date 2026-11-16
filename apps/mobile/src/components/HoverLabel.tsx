import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./HoverLabel.css";

/**
 * ONE pointer-only name for icon-only controls (owner request 2026-11-15/16).
 *
 * The rail proved the gesture: rest on an icon, it names itself after the
 * notification action-rail dwell, and the page never reflows because the name
 * is a fixed body-level pill rather than a wider row. This provider is that
 * gesture for the whole app, so the post action row, the composers, the chat
 * header and the settings window do not each grow their own copy.
 *
 * ACCESSIBILITY: every control that opts in already carries `aria-label`, so
 * the pill is a visual duplicate only. It is `aria-hidden` and never announced
 * twice. Keyboard users keep the focus ring and the accessible name; nothing
 * here waits on a hover to become operable.
 *
 * TOUCH: a touch pointer never schedules a label. On a phone the icons are
 * 44px targets and the pill would appear under the finger with no way to read
 * it.
 */

/** Rest time before a name appears; matches the notification action rail. */
export const HOVER_LABEL_MS = 180;
/**
 * Jumping between neighbouring controls repaints immediately instead of
 * re-dwelling: the reader has already asked the question the dwell answers.
 * Leaving the cluster still hides at once, so nothing lingers over content.
 */
const HOVER_LABEL_REENTER_MS = 400;

export type HoverLabelPlacement = "top" | "right";

interface ActiveLabel {
  label: string;
  placement: HoverLabelPlacement;
  rect: DOMRect;
}

interface HoverLabelApi {
  show(anchor: HTMLElement, label: string, placement: HoverLabelPlacement): void;
  hide(): void;
  dismiss(): void;
}

const HoverLabelContext = createContext<HoverLabelApi | null>(null);

export function HoverLabelProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveLabel | null>(null);
  const pill = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = useRef(false);
  const lastHiddenAt = useRef(Number.NEGATIVE_INFINITY);

  const clearShow = useCallback(() => {
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearShow();
    if (!visible.current) return;
    // Hiding is immediate: the name belongs to the control under the pointer,
    // not to the space it just left.
    visible.current = false;
    lastHiddenAt.current = Date.now();
    setActive(null);
  }, [clearShow]);

  const show = useCallback((anchor: HTMLElement, label: string, placement: HoverLabelPlacement) => {
    clearShow();
    const paint = () => {
      visible.current = true;
      setActive({ label, placement, rect: anchor.getBoundingClientRect() });
    };
    if (visible.current) { paint(); return; }
    if (Date.now() - lastHiddenAt.current < HOVER_LABEL_REENTER_MS) { paint(); return; }
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      paint();
    }, HOVER_LABEL_MS);
  }, [clearShow]);

  const api = useMemo<HoverLabelApi>(() => ({ show, hide, dismiss: hide }), [show, hide]);

  // A name that outlives its anchor is a lie: scrolling, resizing or leaving
  // the app hides it before it can point at the wrong row.
  useEffect(() => {
    if (!active) return;
    const hide = () => api.hide();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") api.hide(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, api]);

  useEffect(() => () => clearShow(), [clearShow]);

  // Position after the pill has a measured width, before the browser paints:
  // no flicker, and no guessing the width of a wrapped label.
  useLayoutEffect(() => {
    const el = pill.current;
    if (!el || !active) return;
    const box = el.getBoundingClientRect();
    const pad = 8;
    const gap = 10;
    const { rect, placement } = active;
    let left: number;
    let top: number;
    let transform: string;
    if (placement === "right") {
      transform = "translateY(-50%)";
      left = rect.right + gap;
      if (left + box.width > window.innerWidth - pad) left = rect.left - gap - box.width;
      left = Math.min(Math.max(left, pad), Math.max(pad, window.innerWidth - pad - box.width));
      top = Math.min(
        Math.max(rect.top + rect.height / 2, pad + box.height / 2),
        Math.max(pad + box.height / 2, window.innerHeight - pad - box.height / 2),
      );
    } else {
      transform = "translate(-50%, -100%)";
      left = rect.left + rect.width / 2 - box.width / 2;
      if (rect.top - gap - box.height < pad) {
        transform = "translate(-50%, 0)";
        top = rect.bottom + gap;
      } else {
        top = rect.top - gap;
      }
      left = Math.min(Math.max(left, pad), Math.max(pad, window.innerWidth - pad - box.width));
      top = Math.min(Math.max(top, pad), Math.max(pad, window.innerHeight - pad));
    }
    el.dataset.placement = placement;
    el.style.transform = transform;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = "visible";
  }, [active]);

  return (
    <HoverLabelContext.Provider value={api}>
      {children}
      {active !== null && createPortal(
        <div ref={pill} className="fb-hover-label" aria-hidden="true">{active.label}</div>,
        document.body,
      )}
    </HoverLabelContext.Provider>
  );
}

export interface HoverLabelHandlers {
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: () => void;
  onPointerDown?: () => void;
  onPointerCancel?: () => void;
}

/**
 * Spread the returned handlers onto an icon-only control. Without a provider
 * (a fixture or a test that mounts a control alone) this is a no-op rather
 * than a crash, so the control keeps working.
 */
export function useHoverLabel() {
  const api = useContext(HoverLabelContext);
  const hoverLabel = useCallback(
    (label: string, placement: HoverLabelPlacement = "top"): HoverLabelHandlers => {
      if (!api) return {};
      return {
        onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
          if (event.pointerType === "touch") return;
          api.show(event.currentTarget, label, placement);
        },
        onPointerLeave: () => api.hide(),
        onPointerDown: () => api.hide(),
        onPointerCancel: () => api.hide(),
      };
    },
    [api],
  );
  const dismissHoverLabel = useCallback(() => api?.hide(), [api]);
  return { hoverLabel, dismissHoverLabel };
}
