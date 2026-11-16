import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";
import { useHoverLabel } from "./HoverLabel";

export interface EmojiPickerButtonProps {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  /** Class for the trigger so each composer keeps its own control weight. */
  className?: string;
  align?: "start" | "end";
  label?: string;
}

/**
 * Trigger plus floating palette.
 *
 * The panel stays open after a pick so several emoji can be added in a row;
 * it closes on Escape or on a press outside itself, and focus goes back to the
 * trigger when Escape closes it. The caller handles inserting at the caret and
 * returning focus to its field, because only the caller owns the textarea.
 */
export function EmojiPickerButton({
  onPick, disabled = false, className = "fb-icon-control", align = "start", label = "Emoji",
}: EmojiPickerButtonProps) {
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
    // Deliberately not `position: relative`: the panel resolves against the
    // composer that owns the field, so a right-aligned palette on a 320dp
    // phone ends at the composer's edge instead of hanging off the trigger's
    // 44px box and being clipped.
    <div ref={root}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        {...hoverLabel(label)}
      >
        <Smile size={21} aria-hidden="true" />
      </button>
      {open && (
        <div className="fb-picker-layer" data-align={align} role="dialog" aria-label={`${label} picker`}>
          <EmojiPicker label={label} onPick={onPick} />
        </div>
      )}
    </div>
  );
}
