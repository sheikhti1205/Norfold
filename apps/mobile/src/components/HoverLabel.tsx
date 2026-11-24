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
import { FINE_POINTER_QUERY, hasFinePointer } from "./inputCapabilities";
import "./HoverLabel.css";

/**
 * ONE pointer-only name for icon-only controls.
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

export type HoverLabelPlacement = "top" | "right" | "left";

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

/**
 * A layer that replaces the page owns the pointer: a name hovering a control
 * that is no longer the thing on screen is a lie. These are the app's overlay
 * roots — dialogs/task surfaces, the photo viewer, and the picker layer.
 */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  "dialog[open]",
  ".fb-media-viewer",
  ".yarl__root",
  ".fb-picker-layer",
].join(", ");

/** A layer that replaced the page is present right now, not just after a mutation. */
function overlayOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector(OVERLAY_SELECTOR) !== null;
}

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
    // Pointer capability is decided by the hover entry point, not here: focus
    // and touch tap (useInfoLabel) must still name a control on a touch device.
    const next: ActiveLabel = { label, placement, rect: anchor.getBoundingClientRect(), anchor, pinned: options?.pinned === true };
    const paint = () => {
      // Never paint over a layer that has replaced the page while the dwell
      // was running. The observer below handles overlays that open later.
      if (overlayOpen()) return;
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

  // A name belongs to the control under the pointer, never to a surface that
  // replaced the page. A press, a keystroke, or an overlay opening ends it —
  // before it can float over a photo viewer or a dialog on a touch screen.
  useEffect(() => {
    const onPress = () => api.dismiss();
    const onKey = () => api.dismiss();
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey, true);
    const observer = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            const element = node as Element;
            if (element.matches(OVERLAY_SELECTOR) || element.querySelector(OVERLAY_SELECTOR) !== null) {
              api.dismiss();
              return;
            }
          }
        }
      });
    observer?.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("keydown", onKey, true);
      observer?.disconnect();
    };
  }, [api]);

  // The input can change under a mounted pill (a detachable keyboard, a
  // tablet switching to touch). The name goes with it.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(FINE_POINTER_QUERY);
    const onChange = () => { if (!query.matches) api.dismiss(); };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [api]);

  // Position after the pill has a measured width, before the browser paints:
  // no flicker, and no guessing the width of a wrapped label.
  useLayoutEffect(() => {
    const el = pill.current;
    if (!el || !active) return;
    const pad = 8;
    const gap = 10;
    const { rect, placement } = active;
    // A pill wider than the viewport is clamped to the side instead of running
    // off it. The stylesheet already caps the width; this is the guarantee for
    // an environment with no stylesheet cap.
    const available = Math.max(0, window.innerWidth - pad * 2);
    el.style.maxWidth = "";
    let box = el.getBoundingClientRect();
    if (available > 0 && box.width > available) {
      el.style.maxWidth = `${available}px`;
      box = el.getBoundingClientRect();
    }
    const half = box.width / 2;
    let left: number;
    let top: number;
    let transform: string;
    if (placement === "right" || placement === "left") {
      transform = "translateY(-50%)";
      left = placement === "right" ? rect.right + gap : rect.left - gap - box.width;
      // Flip to the other side only when the requested edge has no room. A
      // "left" label is the one a rail asks for: it must never cover the
      // neighbours that share the row, so the pad check is the only reason to
      // move it back over them.
      if (left + box.width > window.innerWidth - pad) left = rect.left - gap - box.width;
      else if (left < pad) left = rect.right + gap;
      left = Math.min(Math.max(left, pad), Math.max(pad, window.innerWidth - pad - box.width));
      top = Math.min(
        Math.max(rect.top + rect.height / 2, pad + box.height / 2),
        Math.max(pad + box.height / 2, window.innerHeight - pad - box.height / 2),
      );
    } else {
      transform = "translate(-50%, -100%)";
      // The visual box is `left - width / 2`, because the transform centres it.
      // Clamping the untransformed left edge pushed half the pill off the
      // viewport at the left edge (a verified badge at x=0 rendered 120px
      // outside at 900px wide).
      left = rect.left + rect.width / 2;
      if (rect.top - gap - box.height < pad) {
        transform = "translate(-50%, 0)";
        top = rect.bottom + gap;
      } else {
        top = rect.top - gap;
      }
      left = Math.min(Math.max(left, pad + half), Math.max(pad + half, window.innerWidth - pad - half));
      if (transform === "translate(-50%, 0)") {
        top = Math.min(Math.max(top, pad), Math.max(pad, window.innerHeight - pad - box.height));
      } else {
        top = Math.min(Math.max(top, pad + box.height), Math.max(pad + box.height, window.innerHeight - pad));
      }
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
 *
 * `anchor` is for controls that share one row: the name of a capsule action
 * belongs to the capsule, not to the 34px button, so a pill anchored to the
 * button would cover its neighbours. Resolved at pointer time, because a ref
 * is still empty in the render that mounts it.
 */
export function useHoverLabel() {
  const api = useContext(HoverLabelContext);
  const hoverLabel = useCallback(
    (label: string, placement: HoverLabelPlacement = "top", anchor?: () => HTMLElement | null): HoverLabelHandlers => {
      if (!api) return {};
      return {
        onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
          if (event.pointerType === "touch") return;
          // A compatibility mouse event on a touch screen must not paint a
          // name. Hosts that cannot answer the capability query trust the
          // explicit pointer type instead of treating every dwell as touch.
          if (typeof window !== "undefined" && typeof window.matchMedia === "function" && !hasFinePointer()) return;
          // Only a row whose own label is already painted in place is a
          // duplicate. The collapsed rail's sr-only name is not: it still
          // needs the fixed pill so the column never widens on dwell.
          const rail = event.currentTarget.closest<HTMLElement>(".fb-nav-rail");
          const ownLabel = event.currentTarget.querySelector(".fb-nav-label");
          const namedInPlace = ownLabel !== null && !ownLabel.classList.contains("sr-only");
          if (event.currentTarget.matches(".fb-nav-link") && (namedInPlace
            || rail?.dataset.pinned === "true" || rail?.dataset.hoverExpanded === "true")) {
            api.dismiss();
            return;
          }
          api.show(anchor?.() ?? event.currentTarget, label, placement);
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
