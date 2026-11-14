import type { ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Search } from "lucide-react";
import { SearchField } from "../components/SearchField";
import { motionDurations, motionEasings, pressFeedback, scaleInVariants } from "../components/uiMotion";

/** Shared swap timing for the one-row state change. */
const swap = { duration: motionDurations.fast, ease: motionEasings.out } as const;

/**
 * Home's app bar: ONE compact row with the essential actions trailing.
 *
 * The visible title unit is gone (owner feedback 2026-11-13): the brand mark
 * and wordmark already live in the sidebar, so repeating them here spent the
 * feed's first row on a second copy of the same identity. The screen keeps one
 * visually hidden `h1` so the document still has its heading, and the row's
 * height does not move when search opens.
 *
 * The search field is deliberately not resident. The row holds either the field
 * or nothing but its trailing actions, never both, so an idle Home spends its
 * vertical space on the feed; the field appears only on an explicit activation
 * and returns focus to its trigger on close. Account identity lives in the
 * profile surface, and a result count was duplicate chrome on every visit.
 *
 * Motion: a crossfade of the same slot at `motionDurations.fast` (150ms) — the
 * app's existing state-acknowledgement token, which matches Material's
 * fast-effects Web conversion. It is intentionally NOT a container transform:
 * Material's published 300/250ms pair belongs to a *linked* SearchBar→SearchView
 * expansion, which this is not. Reduced motion keeps the crossfade and drops
 * the x-offset — the app-root MotionConfig degrades transform travel while
 * keeping opacity, so nothing here needs a second reduced-motion branch. Focus
 * is moved on the state change, never after the animation.
 *
 * Geometry: the closed and open states are both exactly 48px tall, so the state
 * change swaps the row rather than resizing it and the chips row below never
 * moves. The pill's 1px border sits inside that 48px (border-box) and every
 * child stays under it. The focus ring is drawn on the pill, not on the input —
 * see `index.css` `.fb-home-search-field`.
 */
export function HomeTopBar({
  expanded,
  query,
  onQueryChange,
  onOpen,
  onClear,
  onClose,
  onFocus,
  onFieldBlur,
  onBlur,
  inputRef,
  utilities,
}: {
  expanded: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onOpen: (trigger: HTMLButtonElement) => void;
  onClear: () => void;
  onClose: () => void;
  onFocus: () => void;
  /**
   * The *text field* lost focus, which is not the same event as the row losing
   * focus: Close, Clear and Filters live inside the row, so tabbing to them
   * blurs the input while the row keeps focus. Home arms the Android-Back
   * interceptor on this signal, because a typed-but-unfocused query is a
   * browsing filter by then (review HOME-SCROLL-FIXFORWARD-R2 MINOR-1).
   */
  onFieldBlur: () => void;
  onBlur: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  utilities?: ReactNode;
}) {
  // Closing unmounts the control that held focus, so focus is handed back to the
  // affordance that opened it instead of being dropped on <body> (WCAG 2.4.3).
  // A query restored from the URL mounts already expanded and must not steal
  // focus, so the first paint is never a transition.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(expanded);
  useEffect(() => {
    if (wasExpanded.current && !expanded) triggerRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  return (
    <div
      data-testid="home-search-row"
      className="flex min-h-[48px] items-center gap-1"
      onBlur={(event) => {
        // Close/Clear/Filters are part of the same interaction. Collapsing an
        // empty field on the input's blur moves Filters between pointer-down
        // and pointer-up, and unmounts Close during keyboard navigation.
        // `relatedTarget` is an `EventTarget`, not necessarily a `Node`; a
        // non-Node value must fall through to the blur path rather than throw
        // (review HOME-SCROLL-FIXFORWARD-R2 NIT-3).
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) onBlur();
      }}
    >
      {/* The sidebar owns the visible brand. This keeps the one heading the
          screen needs without drawing a second wordmark. */}
      <h1 className="sr-only">Norfold</h1>
      <AnimatePresence initial={false} mode="popLayout">
        {expanded ? (
          <motion.div
            key="field"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={swap}
            // Height parity with the closed row is the point: the pill is 48px
            // (box-border) and every child stays at or below 44px, so opening
            // search never moves the feed. The focus ring belongs to the pill,
            // see `index.css` `.fb-search-field-pill`.
            className="flex min-h-[48px] min-w-0 flex-1"
            data-testid="home-search-field"
          >
            <SearchField
              value={query}
              onChange={onQueryChange}
              ariaLabel="Search posts"
              // Short enough to survive the field's 320dp + Extra-large-text
              // width. The prompt elides as a real element.
              placeholder="Search posts…"
              inputRef={inputRef}
              onClear={onClear}
              inputProps={{ onFocus, onBlur: onFieldBlur }}
              leading={
                <button
                  type="button"
                  data-testid="home-search-close"
                  aria-label="Close search"
                  onClick={onClose}
                  className="fb-search-field-action"
                >
                  {/* An arrow, not a second ✕: "leave the field" and "clear the
                      query" are separate semantics, so they must not look alike.
                      It also matches the Android Back behaviour wired in Home. */}
                  <ArrowLeft size={18} aria-hidden />
                </button>
              }
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {/* The 48px hit areas carry their own padding, so the cluster is pulled
          10px toward the edge to align the trailing icon's optical edge with the
          row instead of reading inset-left / padded-right. */}
      <div className="fb-home-search-actions -mr-2.5 ml-auto flex shrink-0 items-center">
        {utilities}
        {/* `popLayout` is load-bearing: the trigger and the field share one flex
            slot. Without it the outgoing trigger keeps its 48px in flow for the
            whole 150ms exit, so the entering pill renders ~48px narrower than it
            settles and snaps wider on the last frame. Popped out, the field owns
            the slot from its first frame. The popped ghost therefore neither
            paints nor accepts pointer events while it is out
            (`.fb-home-search-actions [data-motion-pop-id]` in index.css), so it
            hands the slot over at the first frame instead of crossfading on top
            of a live target. `Home.test` samples a tap through the whole
            transition. */}
        <AnimatePresence initial={false} mode="popLayout">
          {!expanded && (
            <motion.button
              key="home-search-open"
              type="button"
              ref={triggerRef}
              data-testid="home-search-open"
              aria-label="Open search"
              onClick={(event) => onOpen(event.currentTarget)}
              whileTap={pressFeedback.iconButton}
              variants={scaleInVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={swap}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full text-on-surface"
            >
              <Search size={20} aria-hidden />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
