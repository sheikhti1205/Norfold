import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Keyboard, Smile } from "lucide-react";
import { KEYBOARD_OPEN_THRESHOLD_PX, useKeyboardInset } from "../hooks/keyboardInset";
import { registerBackInterceptor } from "./backNavigation";
import { useHoverLabel } from "./HoverLabel";
import "./composerDock.css";

/**
 * The pane when nothing has measured an IME yet. The reference products dock a
 * ~300 dp band (Telegram's measured pane is 324 dp); this is the floor, never a
 * hard-coded replacement for a real measurement.
 */
export const DOCK_FALLBACK_HEIGHT_PX = 300;

/**
 * The band the on-screen keyboard occupies, remembered across its dismissal.
 *
 * `useKeyboardInset` is the app's existing IME reading (visual viewport, which
 * is how a resizing WebView and an overlaying IME both report). Opening the
 * pane deliberately blurs the field, so the live inset drops to 0 the moment
 * the pane appears; the last real reading is what keeps the pane in the band
 * the keyboard just left.
 */
export function useComposerDockBand(): number {
  const { insetPx } = useKeyboardInset();
  const [remembered, setRemembered] = useState(0);
  useEffect(() => {
    if (insetPx > KEYBOARD_OPEN_THRESHOLD_PX) setRemembered(insetPx);
  }, [insetPx]);
  return remembered > 0 ? remembered : DOCK_FALLBACK_HEIGHT_PX;
}

export interface ComposerDockState {
  open: boolean;
  heightPx: number;
  toggle: () => void;
  close: () => void;
}

/**
 * Open/closed state shared by the trigger in the row and the pane in the
 * shell's panel slot.
 *
 * The phone contract is that the pane replaces the keyboard instead of stacking
 * on it: opening blurs the field (the draft stays in the caller's state, never
 * in the DOM), and closing puts the caret back, which is what returns the IME.
 * Focus is never the reason the pane closes.
 */
export function useComposerDock(fieldRef: RefObject<HTMLTextAreaElement | null>): ComposerDockState {
  const [open, setOpen] = useState(false);
  const heightPx = useComposerDockBand();

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => fieldRef.current?.focus());
  }, [fieldRef]);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    // The only thing that dismisses the IME is the field losing focus; the
    // value lives with the caller, so nothing is lost.
    fieldRef.current?.blur();
    setOpen(true);
  }, [open, close, fieldRef]);

  return { open, heightPx, toggle, close };
}

export interface ComposerDockProps {
  /** Measured IME band, from `useComposerDock`. */
  heightPx: number;
  /** Accessible name of the pane. */
  label: string;
  onRequestClose: () => void;
  children: ReactNode;
  testId?: string;
}

/**
 * The docked pane itself: normal flow under the composer row, no portal, no
 * fixed positioning. It takes focus on mount so the keyboard belongs to the
 * pane, and while it is mounted it owns the two dismissal gestures the phone
 * has: Android Back (through the app's one interceptor registry, the same one
 * the attachment sheet used) and Escape from anywhere inside it. Both close the
 * pane and leave the caret with the field; the comments sheet and the
 * conversation underneath are never dismissed by the same press.
 */
export function ComposerDock({ heightPx, label, onRequestClose, children, testId = "composer-dock" }: ComposerDockProps) {
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pane.current?.focus({ preventScroll: true });
  }, []);

  // Back: registered for exactly the pane's lifetime, so a press with no dock
  // open is never consumed here.
  useEffect(() => registerBackInterceptor(() => {
    onRequestClose();
    return true;
  }), [onRequestClose]);

  // Escape: capture phase, because the pane's own focus can sit on a tab or a
  // grid item by then. Stopping the event keeps an outer layer from acting on
  // the same press.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onRequestClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onRequestClose]);

  return (
    <div
      ref={pane}
      className="fb-composer-pane"
      style={{ height: `${heightPx}px` }}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export interface ExpressionDockTriggerProps {
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** The composer's own control weight (`fb-icon-control` or `fb-peer-icon`). */
  className?: string;
  label?: string;
  testId?: string;
}

/**
 * The picker button that stays beside the field in every state. Its glyph
 * becomes a keyboard while the pane is open, which is the gesture that brings
 * the IME back.
 */
export function ExpressionDockTrigger({
  open, onToggle, disabled = false, className = "fb-icon-control",
  label = "Emoji, GIFs and stickers", testId,
}: ExpressionDockTriggerProps) {
  const { hoverLabel } = useHoverLabel();
  const Icon = open ? Keyboard : Smile;

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-expanded={open}
      data-testid={testId}
      disabled={disabled}
      onClick={onToggle}
      {...hoverLabel(label)}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
