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
}

/**
 * One trigger for emoji, GIFs and stickers (owner direction 2026-11-18).
 *
 * The panel stays open after an emoji so several can be added in a row; a GIF
 * or sticker is a whole message, so that pick closes it. Escape or a press
 * outside closes it and focus returns to the trigger.
 */
export function ExpressionPickerButton({
  onPickEmoji, onPickKlipy, userId = null, disabled = false, onOpen, className = "fb-icon-control",
  align = "start", label = "Emoji, GIFs and stickers", testIdPrefix = "expression",
}: ExpressionPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { hoverLabel } = useHoverLabel();

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    // Not `position: relative`: the panel resolves against the composer that
    // owns the field, so a right-aligned picker ends at the composer's edge.
    <div ref={root}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="dialog"
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
      {open && (
        <div className="fb-picker-layer" data-align={align} role="dialog" aria-label={`${label} picker`}>
          <ExpressionPicker
            userId={userId}
            testIdPrefix={testIdPrefix}
            onPickEmoji={onPickEmoji}
            onPickKlipy={onPickKlipy}
            onClose={() => setOpen(false)}
            onDismiss={() => { setOpen(false); trigger.current?.focus(); }}
          />
        </div>
      )}
    </div>
  );
}
