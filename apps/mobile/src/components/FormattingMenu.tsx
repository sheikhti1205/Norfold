import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from "@floating-ui/react";
import { motion } from "framer-motion";
import { FORMATTING_GROUPS, type FormattingCommand, type FormattingGroupId } from "./formattingCommands";
import { motionDurations, popoverVariants } from "./uiMotion";

export interface FormattingMenuProps {
  /** Rendered only when true. */
  open: boolean;
  /** Already ranked and capped by the caller. */
  items: ReadonlyArray<FormattingCommand>;
  /** Index into `items` that is visually selected, or -1 for none. */
  activeIndex: number;
  /**
   * Returns the caret rect in viewport coordinates, or null when unavailable.
   * Called on every reposition, so it must read live layout, never a cached value.
   */
  getAnchorRect: () => DOMRect | null;
  /** Pointer entered a row. */
  onHover: (index: number) => void;
  /** Row activated by pointer. */
  onPick: (index: number) => void;
  /** Accessible name, e.g. "Formatting commands". */
  label: string;
}

const GROUP_LABELS = new Map<FormattingGroupId, string>(
  FORMATTING_GROUPS.map((group) => [group.id, group.label] as const),
);

// The report form owns the modal ladder's first slot (70 + depth × 10 = 80)
// and a dialog opened from it takes 90; media viewer layers start at 100.
const MENU_Z_INDEX = 92;

export function FormattingMenu({
  open,
  items,
  activeIndex,
  getAnchorRect,
  onHover,
  onPick,
  label,
}: FormattingMenuProps) {
  const baseId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    middleware: [
      offset(6),
      flip({ padding: 8, fallbackAxisSideDirection: "start" }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight }: { availableHeight: number }) {
          const panel = panelRef.current;
          if (!panel) return;
          panel.style.maxHeight = `${Math.max(0, availableHeight - 16)}px`;
          panel.style.overflowY = "auto";
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  // A virtual element re-reads the caret on every measurement, so the menu
  // follows the line the user is typing on instead of a stale rect.
  useEffect(() => {
    if (!open) return;
    refs.setPositionReference({
      getBoundingClientRect: () => getAnchorRect() ?? new DOMRect(0, 0, 0, 0),
    });
  }, [open, getAnchorRect, refs]);

  if (!open || items.length === 0) return null;

  const rows: ReactNode[] = [];
  let previousGroup: FormattingGroupId | null = null;

  // Headings are labels, not rows: `index` stays the index into `items` so the
  // caller's keyboard navigation and this listbox always agree.
  items.forEach((item, index) => {
    if (item.group !== previousGroup) {
      previousGroup = item.group;
      rows.push(
        <div
          key={`group-${item.group}-${index}`}
          role="presentation"
          className="px-3 pb-1 pt-2 text-xs font-medium text-on-surface-variant"
        >
          {GROUP_LABELS.get(item.group) ?? item.group}
        </div>,
      );
    }
    rows.push(
      <div
        key={item.id}
        id={`${baseId}-opt-${index}`}
        role="option"
        aria-selected={index === activeIndex}
        onPointerEnter={() => onHover(index)}
        onClick={() => onPick(index)}
        className={`flex min-h-[44px] cursor-pointer items-center rounded-m3-xs px-3 py-2 text-sm text-on-surface ${
          index === activeIndex ? "bg-surface-container-high" : ""
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </div>,
    );
  });

  return (
    <FloatingPortal>
      {/* Positioning shell only: floating-ui owns this element's transform. */}
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: MENU_Z_INDEX }}
        className="w-64 max-w-[calc(100vw-2rem)]"
      >
        {/* A press here must not blur the contenteditable: the caret, the
          selection and every key handler stay in the editor while the menu is
          open. That is also why this element is never focused. */}
        <motion.div
          ref={panelRef}
          id={baseId}
          role="listbox"
          aria-label={label}
          className="overflow-y-auto overscroll-contain rounded-m3-sm border border-outline-variant bg-surface-container p-1 shadow-lg"
          initial="hidden"
          animate="visible"
          variants={popoverVariants}
          transition={{ duration: motionDurations.fast }}
          style={{ transformOrigin: "top left" }}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => event.preventDefault()}
        >
          {rows}
        </motion.div>
      </div>
    </FloatingPortal>
  );
}
