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
  anchor: HTMLElement;
  pinned: boolean;
}

interface HoverLabelApi {
  show(anchor: HTMLElement, label: string, placement: HoverLabelPlacement, options?: { pinned?: boolean; immediate?: boolean }): void;
  /** Pointer-left: a tapped label stays until the reader dismisses it. */
  hide(): void;
  /** Force it away (scroll, resize, blur, Escape, outside press). */
  dismiss(): void;
  isPinned(anchor: HTMLElement): boolean;
}

const HoverLabelContext = createContext<HoverLabelApi | null>(null);

export function HoverLabelProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveLabel | null>(null);
  const activeRef = useRef<ActiveLabel | null>(null);
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
    // A label the reader tapped open belongs to them until they dismiss it.
    if (activeRef.current?.pinned) return;
    // Hiding is immediate: the name belongs to the control under the pointer,
    // not to the space it just left.
    visible.current = false;
    activeRef.current = null;
    lastHiddenAt.current = Date.now();
    setActive(null);
  }, [clearShow]);

  const dismiss = useCallback(() => {
    clearShow();
    if (!visible.current) return;
    visible.current = false;
    activeRef.current = null;
    lastHiddenAt.current = Date.now();
    setActive(null);
  }, [clearShow]);

  const show = useCallback((anchor: HTMLElement, label: string, placement: HoverLabelPlacement, options?: { pinned?: boolean; immediate?: boolean }) => {
    clearShow();
    const next: ActiveLabel = { label, placement, rect: anchor.getBoundingClientRect(), anchor, pinned: options?.pinned === true };
    const paint = () => {
      visible.current = true;
      activeRef.current = next;
      setActive(next);
    };
    // A deliberate tap or keyboard focus shows at once; a resting pointer keeps
    // the dwell that stops labels flashing as the pointer crosses a cluster.
    if (next.pinned || options?.immediate) { paint(); return; }
    if (visible.current) { paint(); return; }
    if (Date.now() - lastHiddenAt.current < HOVER_LABEL_REENTER_MS) { paint(); return; }
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      paint();
    }, HOVER_LABEL_MS);
  }, [clearShow]);

  const isPinned = useCallback((anchor: HTMLElement) => {
    const current = activeRef.current;
    return current?.pinned === true && current.anchor === anchor;
  }, []);

  const api = useMemo<HoverLabelApi>(() => ({ show, hide, dismiss, isPinned }), [show, hide, dismiss, isPinned]);

  // A name that outlives its anchor is a lie: scrolling, resizing or leaving
  // the app hides it before it can point at the wrong row. A pinned label is
  // dismissed too: it must not float free of the control it describes.
  useEffect(() => {
    if (!active) return;
    const hide = () => api.dismiss();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") api.dismiss(); };
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

  // Tapping anywhere but the control closes a pinned label. The press that
  // pinned it is already over, so this never fights the opening gesture.
  useEffect(() => {
    if (!active?.pinned) return;
    const onDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && active.anchor.contains(target)) return;
      api.dismiss();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
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

export interface InfoLabelHandlers {
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur?: () => void;
}

/**
 * The same one pill, but answering every way a reader can ask: rest, focus,
 * or tap. Used by the small metadata controls whose whole content is a word
 * that has no room in the row. On touch the tap pins the pill until the
 * reader presses elsewhere; nothing opens a sheet.
 */
export function useInfoLabel() {
  const api = useContext(HoverLabelContext);
  const infoLabel = useCallback(
    (label: string, placement: HoverLabelPlacement = "top"): InfoLabelHandlers => {
      if (!api) return {};
      return {
        onPointerEnter: (event) => {
          if (event.pointerType === "touch") return;
          if (api.isPinned(event.currentTarget)) return;
          api.show(event.currentTarget, label, placement);
        },
        onPointerLeave: (event) => {
          if (api.isPinned(event.currentTarget)) return;
          api.hide();
        },
        onPointerUp: (event) => {
          if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
          if (api.isPinned(event.currentTarget)) api.dismiss();
          else api.show(event.currentTarget, label, placement, { pinned: true });
        },
        onFocus: (event) => {
          if (api.isPinned(event.currentTarget)) return;
          api.show(event.currentTarget, label, placement, { immediate: true });
        },
        onBlur: () => api.dismiss(),
      };
    },
    [api],
  );
  return { infoLabel };
}
