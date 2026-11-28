import { useEffect, useId, useRef, useState } from "react";
import { Smile, X } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";
import { useHoverLabel } from "./HoverLabel";

export interface EmojiPickerButtonProps {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  /** Class for the trigger so each composer keeps its own control weight. */
  className?: string;
  align?: "start" | "end";
  label?: string;
  /**
   * Presentation of the panel: a floating popover (default) or a docked pane
   * rendered in the composer's flow, in the on-screen keyboard's place.
   */
  dock?: "popover" | "ime";
}

/**
 * Trigger plus palette.
 *
 * The panel stays open after a pick so several emoji can be added in a row;
 * it closes on Escape or on a press outside itself, and focus goes back to the
 * trigger when Escape closes it. The caller handles inserting at the caret and
 * returning focus to its field, because only the caller owns the textarea.
 *
 * Docked (`dock="ime"`), the palette is part of the composer rather than an
 * overlay: it renders inline with its own drag handle and close control, and
 * no outside-press listener is installed. This is the emoji-only entry point;
 * the three-tab emoji/GIF/sticker pane is `ExpressionPicker`.
 */
export function EmojiPickerButton({
  onPick, disabled = false, className = "fb-icon-control", align = "start", label = "Emoji",
  dock = "popover",
}: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { hoverLabel } = useHoverLabel();
  const docked = dock === "ime";
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const panelId = `${baseId}-panel`;
  const labelId = `${baseId}-label`;

  useEffect(() => {
    if (!open || docked) return;
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
  }, [open, docked]);

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
        aria-haspopup={docked ? undefined : "dialog"}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        {...hoverLabel(label)}
      >
        <Smile size={21} aria-hidden="true" />
      </button>
      {open && (docked ? (
        <div className="fb-expression-picker fb-expression-dock" data-dock="ime">
          <div className="fb-expression-drag" aria-hidden="true">
            <span className="fb-expression-drag-bar" />
          </div>
          <div className="fb-expression-head">
            {/* Emoji is the only content here, so it is a label, not a
                one-item tablist with a control that has nothing to switch. */}
            <p id={labelId} className="fb-expression-label" style={{ marginInlineEnd: "auto" }}>{label}</p>
            <button
              type="button"
              className="fb-expression-close"
              aria-label="Close picker"
              onClick={() => { setOpen(false); trigger.current?.focus(); }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="fb-expression-tabpanel" role="tabpanel" id={panelId} aria-labelledby={labelId}>
            <EmojiPicker label={label} onPick={onPick} />
          </div>
        </div>
      ) : (
        <div className="fb-picker-layer" data-align={align} role="dialog" aria-label={`${label} picker`}>
          <EmojiPicker label={label} onPick={onPick} />
        </div>
      ))}
    </div>
  );
}
