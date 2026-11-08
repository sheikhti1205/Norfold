import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { Button, Dialog, DialogTrigger } from "react-aria-components";
import { LayeredPopover } from "./overlayFoundation";
import "./longPress.css";

/** Owner-approved long-press window (repository mobile-interaction skill). */
const HOLD_MS = 400;
const MOVE_PX = 10;

export interface LongPressState {
  open: boolean;
  setOpen: (value: boolean) => void;
  surface: RefObject<HTMLDivElement | null>;
}

/**
 * Long-press surface for contextual actions that must not have a visible
 * ellipsis/chevron trigger.
 *
 * - touch/pen: 400 ms hold, cancelled by movement past the gesture threshold,
 *   pointercancel/loss, scroll or unmount;
 * - mouse: hold or right-click;
 * - keyboard/screen reader: the surface itself is focusable and exposes the
 *   standard ContextMenu / Shift+F10 shortcut plus `aria-haspopup`.
 *
 * After the hold fires, the synthetic click that would otherwise navigate or
 * open the image viewer is suppressed exactly once.
 */
export function LongPressArea({ label, disabled = false, className = "", popup = "menu", onOpen, children }: {
  label: string;
  disabled?: boolean;
  className?: string;
  popup?: "menu" | "dialog";
  /** Runs once when the hold, right-click or ContextMenu shortcut opens the surface. */
  onOpen?: () => void;
  children: (state: LongPressState) => ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const suppress = useRef(false);
  const [open, setOpenState] = useState(false);

  const clearTimer = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    origin.current = null;
    window.removeEventListener("scroll", cancel, true);
  };
  function cancel() {
    clearTimer();
  }
  function fire() {
    clearTimer();
    suppress.current = true;
    onOpen?.();
    setOpenState(true);
  }
  function setOpen(value: boolean) {
    setOpenState(value);
    if (!value) surface.current?.focus({ preventScroll: true });
  }
  useEffect(() => cancel, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (timer.current !== null) cancel();
    // Nested controls that own their own gesture/press (Undo chip) opt out.
    if ((event.target as Element | null)?.closest?.("[data-longpress-ignore]")) return;
    origin.current = { x: event.clientX, y: event.clientY };
    window.addEventListener("scroll", cancel, true);
    timer.current = window.setTimeout(fire, HOLD_MS);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const from = origin.current;
    if (!from) return;
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVE_PX) cancel();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || event.nativeEvent.isComposing) return;
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    event.preventDefault();
    suppress.current = true;
    setOpenState(true);
  }

  return (
    <div
      ref={surface}
      className={`fb-longpress ${className}`}
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-haspopup={popup}
      aria-expanded={open}
      aria-label={`${label} — press and hold, or press Shift+F10, for actions`}
      data-longpress-surface
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        if (disabled) return;
        event.preventDefault();
        fire();
      }}
      onClickCapture={(event) => {
        if (!suppress.current) return;
        suppress.current = false;
        // Only the tap-through on the surface itself is swallowed. A click in
        // the portalled menu/dialog still bubbles through this React tree, but
        // it is a real action and must reach its handler.
        if (!(event.target as Element | null)?.closest?.("[data-longpress-surface]")) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
    >
      {children({ open, setOpen, surface })}
    </div>
  );
}

/**
 * Anchor + dialog for a long-press surface that shows a scrollable panel rather
 * than a menu (Match activity). The dialog is collision-aware, scrolls
 * internally and never rises from the bottom of the screen.
 */
export function LongPressDialog({ label, open, setOpen, children }: {
  label: string;
  open: boolean;
  setOpen: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button aria-label={label} className="fb-longpress-anchor" excludeFromTabOrder aria-hidden />
      <LayeredPopover placement="bottom start" offset={6} className="fb-longpress-panel">
        <Dialog aria-label={label} className="fb-longpress-dialog">
          {children}
        </Dialog>
      </LayeredPopover>
    </DialogTrigger>
  );
}
