import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { useHoverLabel } from "./HoverLabel";
import { ExpressionPicker } from "./ExpressionPicker";
import type { KlipyItem } from "../services/klipy";

export interface ExpressionPickerButtonProps {
  onPickEmoji: (emoji: string) => void;
  onPickKlipy: (item: KlipyItem) => void;
  userId?: string | null;
  disabled?: boolean;
  /** Runs when the panel opens, so sibling popovers can close first. */
  onOpen?: () => void;
  /** Class for the trigger so each composer keeps its own control weight. */
  className?: string;
  align?: "start" | "end";
  label?: string;
  /** Prefix for provider-panel test ids (kept per composer). */
  testIdPrefix?: string;
  /**
   * Presentation of the panel: a floating popover (default) or a docked pane
   * rendered in the composer's flow, in the on-screen keyboard's place.
   */
  dock?: "popover" | "ime";
}

/**
 * One trigger for emoji, GIFs and stickers.
 *
 * The panel stays open after an emoji so several can be added in a row; a GIF
 * or sticker is a whole message, so that pick closes it. Escape or a press
 * outside closes it and focus returns to the trigger.
 *
 * Docked (`dock="ime"`), the panel is part of the composer rather than an
 * overlay: it renders inline, and dismiss comes from its own close control or
 * from the caller that mounts `ExpressionPicker` directly. No outside-press
 * listener is installed in that mode, because a press on the composer is not a
 * dismissal there.
 */
export function ExpressionPickerButton({
  onPickEmoji, onPickKlipy, userId = null, disabled = false, onOpen, className = "fb-icon-control",
  align = "start", label = "Emoji, GIFs and stickers", testIdPrefix = "expression", dock = "popover",
}: ExpressionPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { hoverLabel } = useHoverLabel();

  useEffect(() => {
    if (!open || dock === "ime") return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, dock]);

  const picker = (
    <ExpressionPicker
      dock={dock}
      userId={userId}
      testIdPrefix={testIdPrefix}
      onPickEmoji={onPickEmoji}
      onPickKlipy={onPickKlipy}
      onClose={() => setOpen(false)}
      onDismiss={() => { setOpen(false); trigger.current?.focus(); }}
    />
  );

  return (
    // Not `position: relative`: the panel resolves against the composer that
    // owns the field, so a right-aligned picker ends at the composer's edge.
    <div ref={root}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup={dock === "ime" ? undefined : "dialog"}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => {
          if (!value) onOpen?.();
          return !value;
        })}
        {...hoverLabel(label)}
      >
        <Smile size={20} aria-hidden="true" />
      </button>
      {open && (dock === "ime" ? picker : (
        <div className="fb-picker-layer" data-align={align} role="dialog" aria-label={`${label} picker`}>
          {picker}
        </div>
      ))}
    </div>
  );
}
