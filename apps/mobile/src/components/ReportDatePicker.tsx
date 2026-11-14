import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref, type TouchEvent } from "react";
import {
  Calendar,
  CalendarGrid,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarCell,
  CalendarGridBody,
  CalendarHeading,
  Button as AriaButton,
} from "react-aria-components";
import { parseDate, CalendarDate, CalendarDateTime, ZonedDateTime, today, getLocalTimeZone } from "@internationalized/date";
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, X, Check } from "lucide-react";
import { motion, useAnimationControls } from "framer-motion";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { motionDurations, motionEasings, motionSprings, popoverVariants } from "./uiMotion";
import "./ReportDatePicker.css";

interface ReportDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  id?: string;
  expected?: "LOST" | "FOUND";
  disabled?: boolean;
  "aria-describedby"?: string;
  /**
   * Accessible name for a picker that is not the report's event date. The
   * sheet title/description stay report-shaped unless overridden, so a filter
   * field never announces "When was it lost/found?".
   */
  label?: string;
  title?: string;
  description?: string;
  /** Empty-value copy. "Any date" reads as an absent filter bound. */
  placeholder?: string;
  /** Inclusive ISO-day bounds. Bounds are clamped to the past-only ceiling. */
  minValue?: string;
  maxValue?: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** The visible month heading is also the jump control's accessible name. */
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

const MONTH_NAME_FORMAT = new Intl.DateTimeFormat(undefined, { month: "long" });
const MONTH_SHORT_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short" });

function formatDisplay(date: CalendarDate): string {
  return DATE_FORMAT.format(date.toDate(getLocalTimeZone()));
}

function parseISO(value: string): CalendarDate | null {
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

/**
 * Month labels for the jump grid. Day 15 (not the 1st) keeps the label on the
 * same month in every timezone once the date is formatted locally.
 */
const MONTHS = Array.from({ length: 12 }, (_, index) => {
  const label = new Date(2024, index, 15);
  return {
    month: index + 1,
    short: MONTH_SHORT_FORMAT.format(label),
    long: MONTH_NAME_FORMAT.format(label),
  };
});

/** Lowest year the jump panel offers, so the year stepper stays bounded. */
const MIN_JUMP_YEAR = 1900;

/** Years moved by Shift+Arrow inside the jump panel. */
const DECADE_STEP = 10;

/** Horizontal travel (px) that counts as a month swipe on the calendar grid. */
const SWIPE_THRESHOLD_PX = 40;
/** Horizontal travel must dominate vertical travel by this factor. */
const SWIPE_DOMINANCE = 1.3;
/** Day selections arriving within this window after a swipe are accidental. */
const SWIPE_SUPPRESS_MS = 400;

function asCalendarDate(date: CalendarDate | CalendarDateTime | ZonedDateTime): CalendarDate {
  return "day" in date && !("hour" in date) ? date : new CalendarDate(date.year, date.month, date.day);
}

function isFutureDate(date: CalendarDate | CalendarDateTime | ZonedDateTime): boolean {
  // The server rejects event_date > (now() at time zone 'utc')::date, so the
  // client must cap on the SAME UTC day or it can offer a doomed date.
  const now = today("UTC");
  return asCalendarDate(date).compare(now) > 0;
}

export function ReportDatePicker({
  disabled = false,
  value,
  onChange,
  error,
  id: providedId,
  expected,
  "aria-describedby": ariaDescribedBy,
  label,
  title,
  description = "Select the date from the calendar below.",
  placeholder = "Select date",
  minValue,
  maxValue,
}: ReportDatePickerProps) {
  const id = useId();
  const triggerId = providedId || `${id}-trigger`;
  const calendarId = `${id}-calendar`;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const jumpPanelId = `${id}-jump-panel`;

  const [isOpen, setIsOpen] = useState(false);
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  useEffect(() => { if (disabled) { setIsOpen(false); setIsJumpOpen(false); } }, [disabled]);
  const [displayedValue, setDisplayedValue] = useState<CalendarDate | null>(() =>
    value ? parseISO(value) : null
  );
  // The visible month follows focus, not selection: react-aria keeps its own
  // focused date, so shortcuts that set the selection (Today) must also move
  // focus or the calendar stays on the old month. Controlled from the first
  // render (value's month, else today) to match the mount behavior.
  const [focusedDate, setFocusedDate] = useState<CalendarDate>(() => {
    const parsed = value ? parseISO(value) : null;
    if (parsed) return parsed;
    const now = today("UTC");
    return new CalendarDate(now.year, now.month, now.day);
  });
  // Year shown by the jump panel. Kept apart from focusedDate so browsing
  // years never touches the selected day or the committed value.
  const [jumpYear, setJumpYear] = useState(() => focusedDate.year);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const prevMonthRef = useRef<HTMLButtonElement>(null);
  const nextMonthRef = useRef<HTMLButtonElement>(null);
  const monthYearRef = useRef<HTMLButtonElement>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressDaySelectUntilRef = useRef(0);

  // Drives the month-travel slide only; the entrance above stays declarative.
  const monthControls = useAnimationControls();
  const travelMonth = (direction: 1 | -1) => {
    monthControls.start({
      x: [direction * 16, 0],
      transition: { duration: motionDurations.fast, ease: motionEasings.out },
    });
  };

  const todayDate = today("UTC");
  const parsedMax = maxValue ? parseISO(maxValue) : null;
  const maxDate = parsedMax && parsedMax.compare(todayDate) < 0 ? parsedMax : todayDate;
  const minDate = minValue ? parseISO(minValue) : null;
  const isBeforeMin = (date: CalendarDate | CalendarDateTime | ZonedDateTime): boolean =>
    minDate !== null && asCalendarDate(date).compare(minDate) < 0;
  const isOutOfRange = (date: CalendarDate | CalendarDateTime | ZonedDateTime): boolean =>
    isFutureDate(date) || isBeforeMin(date);

  // What the header already shows (react-aria clamps its focused date to
  // maxValue, so the label must clamp the same way).
  const headingDate = focusedDate.compare(maxDate) > 0 ? maxDate : focusedDate;
  const monthYearText = MONTH_YEAR_FORMAT.format(headingDate.toDate(getLocalTimeZone()));

  /**
   * Horizontal month swipe on the calendar grid only. One confirmed gesture
   * fires a single prev/next transaction through the real header buttons, so
   * keyboard controls, focus, maxValue capping and onChange semantics are
   * preserved (a swipe toward a forbidden future month hits the disabled
   * button and is a no-op). Never calls preventDefault: vertical movement
   * still belongs to the sheet drag/scroll, and taps still select days.
   */
  const handleGridTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    swipeStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleGridTouchEnd = (event: TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) <= SWIPE_THRESHOLD_PX || Math.abs(dx) <= SWIPE_DOMINANCE * Math.abs(dy)) {
      return;
    }
    // Swiping left advances forward; flip for RTL layouts.
    const rtl = typeof document !== "undefined" && document.dir === "rtl";
    const forward = dx < 0 !== rtl;
    const target = forward ? nextMonthRef.current : prevMonthRef.current;
    if (!target || target.disabled) return;
    // The swipe's own touchend can synthesize a click on the cell under the
    // finger; ignore day selections that arrive in its immediate wake.
    suppressDaySelectUntilRef.current = Date.now() + SWIPE_SUPPRESS_MS;
    target.click();
  };

  const handleCalendarChange = (next: CalendarDate | null) => {
    if (Date.now() < suppressDaySelectUntilRef.current) return;
    setDisplayedValue(next);
    // Keep focus (hence the visible month) aligned with the selection, as
    // the uncontrolled calendar does internally.
    if (next) setFocusedDate(next);
  };

  /** Past-only field: a month after the current UTC month is a dead target. */
  const isMonthUnavailable = (year: number, month: number): boolean =>
    year > maxDate.year || (year === maxDate.year && month > maxDate.month) ||
    (minDate !== null && (year < minDate.year || (year === minDate.year && month < minDate.month)));

  const minYear = minDate?.year ?? MIN_JUMP_YEAR;
  const clampJumpYear = (year: number): number =>
    Math.min(Math.max(year, minYear), maxDate.year);

  const stepJumpYear = (delta: number): void => {
    setJumpYear((year) => clampJumpYear(year + delta));
  };

  const closeJumpPanel = (): void => {
    setIsJumpOpen(false);
  };

  const openJumpPanel = (): void => {
    setJumpYear(clampJumpYear(headingDate.year));
    setIsJumpOpen(true);
  };

  const toggleJumpPanel = (): void => {
    if (isJumpOpen) closeJumpPanel();
    else openJumpPanel();
  };

  /**
   * Moves the focused (visible) month only. displayedValue — and therefore the
   * committed date — stays untouched until a day is picked, so jumping around
   * and cancelling leaves value exactly as it was.
   */
  const chooseMonth = (month: number): void => {
    if (isMonthUnavailable(jumpYear, month)) return;
    setFocusedDate(new CalendarDate(jumpYear, month, 1));
    setIsJumpOpen(false);
    monthYearRef.current?.focus();
  };

  /**
   * Escape belongs to the panel while it is open: close the panel and hand
   * focus back to the month-year button instead of dismissing the sheet. The
   * stopPropagation keeps the sheet's document-level Escape handler out of it.
   */
  const handleJumpPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setIsJumpOpen(false);
      monthYearRef.current?.focus();
      return;
    }
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      stepJumpYear(event.key === "ArrowLeft" ? -DECADE_STEP : DECADE_STEP);
    }
  };

  /** Focus rests on the toggle right after opening, so Escape works there too. */
  const handleMonthYearKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Escape" || !isJumpOpen) return;
    event.preventDefault();
    event.stopPropagation();
    closeJumpPanel();
  };

  const openSheet = () => {
    if (disabled) return;
    const parsed = value ? parseISO(value) : null;
    setDisplayedValue(parsed);
    // Reopen centered on the value's month, not a stale focused month.
    if (parsed) setFocusedDate(parsed);
    setIsJumpOpen(false);
    setIsOpen(true);
  };

  const closeSheet = (commit = false) => {
    if (!disabled && commit && displayedValue && !isOutOfRange(displayedValue)) {
      onChange(displayedValue.toString());
    }
    setIsJumpOpen(false);
    setIsOpen(false);
  };

  const handleConfirm = () => {
    closeSheet(true);
  };

  const handleCancel = () => {
    closeSheet(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      handleCancel();
    } else if ((event.key === "Enter" || event.key === " ") && !isOpen) {
      // A real <button> would fire click on Enter/Space; preventDefault keeps
      // control here, so opening the sheet must be explicit.
      event.preventDefault();
      openSheet();
    }
  };

  const displayValue = value ? parseISO(value) : null;
  const displayText = displayValue ? formatDisplay(displayValue) : placeholder;
  const hasError = Boolean(error);
  const fieldLabel = label ?? `Date of event${expected ? ` (${expected.toLowerCase()})` : ""}`;

  const describedBy = [
    ariaDescribedBy,
    hasError ? errorId : undefined,
    descriptionId,
  ].filter(Boolean).join(" ") || undefined;

  return (
    <div className="w-full">
      <button
        disabled={disabled}
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen && !disabled}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        aria-label={`${fieldLabel}. ${displayText}`}
        className={`w-full min-h-[48px] flex items-center justify-between gap-3 rounded-m3-md border px-3.5 py-3 text-base text-on-surface bg-surface transition-colors ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${
          hasError ? "border-error" : "border-outline-variant"
        } hover:border-on-surface focus:outline-none focus:ring-2 focus:ring-on-surface`}
        onClick={openSheet}
        onKeyDown={handleKeyDown}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1 text-start">
          <CalendarIcon size={20} aria-hidden className="text-on-surface-variant shrink-0" />
          <span className="truncate">{displayText}</span>
        </span>
        <ChevronRight size={20} aria-hidden className="text-on-surface-variant shrink-0" />
      </button>

      {hasError && (
        <span id={errorId} className="mt-1 block text-xs text-error" role="alert">
          {error}
        </span>
      )}

      <BottomSheet
        open={isOpen && !disabled}
        onClose={handleCancel}
        title={title ?? `When was it ${expected?.toLowerCase() || "lost/found"}?`}
        description={description}
        height="large"
        dismissible={true}
        closeLabel="Close"
      >
        <div id={descriptionId} className="sr-only">
          Calendar for selecting the date. Use arrow keys to navigate days, Page Up/Down to change months, Enter to select, Escape to cancel. Activate the month and year heading to jump to another month.
        </div>

        <motion.div
          data-testid="calendar-surface"
          variants={popoverVariants}
          initial="hidden"
          animate="visible"
          transition={{ duration: motionDurations.standard, ease: motionEasings.out }}
          className="w-full"
        >
        <motion.div data-testid="calendar-month" animate={monthControls} className="w-full">
        <Calendar
          id={calendarId}
          value={displayedValue}
          onChange={handleCalendarChange}
          focusedValue={focusedDate}
          onFocusChange={setFocusedDate}
          maxValue={maxDate}
          minValue={minDate ?? undefined}
          isDateUnavailable={isOutOfRange}
          selectionMode="single"
          autoFocus
          className="w-full"
        >
          <header className="flex items-center justify-between gap-2 mb-2">
            <AriaButton
              ref={prevMonthRef as Ref<HTMLButtonElement>}
              slot="previous"
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm text-on-surface-variant hover:bg-surface-container transition-colors"
              aria-label="Previous month"
              onClick={() => travelMonth(-1)}
            >
              <ChevronLeft size={24} aria-hidden />
            </AriaButton>
            {/*
              The visible month/year label is a real disclosure button. Its
              accessible name is stated explicitly because react-aria hides the
              visible heading from assistive tech (it announces the same text
              through a visually hidden heading).
            */}
            <button
              ref={monthYearRef}
              type="button"
              aria-expanded={isJumpOpen}
              aria-controls={jumpPanelId}
              aria-label={`${monthYearText}, choose month and year`}
              onClick={toggleJumpPanel}
              onKeyDown={handleMonthYearKeyDown}
              className="flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-1 rounded-m3-sm px-1 text-on-surface transition-colors hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-on-surface"
            >
              <CalendarHeading className="min-w-0 truncate text-base font-semibold text-on-surface" />
              <ChevronDown
                size={16}
                aria-hidden
                className={`shrink-0 text-on-surface-variant transition-transform ${isJumpOpen ? "rotate-180" : ""}`}
              />
            </button>
            <AriaButton
              ref={nextMonthRef as Ref<HTMLButtonElement>}
              slot="next"
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm text-on-surface-variant hover:bg-surface-container transition-colors"
              aria-label="Next month"
              onClick={() => travelMonth(1)}
            >
              <ChevronRight size={24} aria-hidden />
            </AriaButton>
          </header>

          {/*
            Inline jump panel: not a dialog, no focus trap, rendered directly
            above the day grid so the calendar keeps its own focus state. Every
            control here is a plain button, in DOM order.
          */}
          {isJumpOpen && (
            <div
              id={jumpPanelId}
              data-testid="calendar-jump-panel"
              role="group"
              aria-label="Jump to month and year"
              onKeyDown={handleJumpPanelKeyDown}
              className="mb-3 rounded-m3-md border border-outline-variant bg-surface-container p-2"
            >
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Previous year"
                  disabled={jumpYear <= minYear}
                  onClick={() => stepJumpYear(-1)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-m3-sm text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-on-surface"
                >
                  <ChevronLeft size={20} aria-hidden />
                </button>
                <span data-testid="calendar-jump-year" className="text-sm font-semibold tabular-nums text-on-surface">
                  {jumpYear}
                </span>
                <button
                  type="button"
                  aria-label="Next year"
                  disabled={jumpYear >= maxDate.year}
                  onClick={() => stepJumpYear(1)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-m3-sm text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-on-surface"
                >
                  <ChevronRight size={20} aria-hidden />
                </button>
              </div>

              <div className="mt-1 grid grid-cols-3 gap-1">
                {MONTHS.map(({ month, short, long }) => {
                  const isVisibleMonth = jumpYear === headingDate.year && month === headingDate.month;
                  return (
                    <button
                      key={month}
                      type="button"
                      aria-label={`${long} ${jumpYear}`}
                      disabled={isMonthUnavailable(jumpYear, month)}
                      onClick={() => chooseMonth(month)}
                      className={`min-h-[44px] min-w-0 rounded-m3-sm text-sm text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-on-surface ${
                        isVisibleMonth ? "bg-surface-container-high font-medium" : ""
                      }`}
                    >
                      {short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            data-testid="calendar-swipe-zone"
            onTouchStart={handleGridTouchStart}
            onTouchEnd={handleGridTouchEnd}
          >
          <CalendarGrid className="w-full">
            <CalendarGridHeader className="mb-1">
              {(day) => (
                <CalendarHeaderCell className="text-xs font-medium text-on-surface-variant py-1">
                  {day}
                </CalendarHeaderCell>
              )}
            </CalendarGridHeader>

            <CalendarGridBody>
              {(date) => {
                const isSelectedDay = Boolean(displayedValue && date.compare(displayedValue) === 0);
                return (
                <CalendarCell
                  key={date.toString()}
                  date={date}
                  className={({ isSelected, isToday, isUnavailable, isOutsideVisibleRange, isDisabled }: {
                    isSelected: boolean;
                    isToday: boolean;
                    isUnavailable: boolean;
                    isOutsideVisibleRange: boolean;
                    isDisabled: boolean;
                  }) =>
                    [
                      "relative flex items-center justify-center h-10 w-full rounded-full transition-colors",
                      isOutsideVisibleRange && "text-on-surface-variant/30",
                      isUnavailable && "text-on-surface-variant/30 line-through",
                      isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                      isSelected && "text-surface font-medium",
                      isToday && !isSelected && "ring-2 ring-on-surface",
                      isToday && isSelected && "ring-2 ring-on-surface",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                >
                  {/* The disc is the selected state itself: springy across days,
                      identity at rest (initial={false} never blinks on mount). */}
                  <motion.span
                    aria-hidden="true"
                    data-day-disc
                    className="absolute inset-0 rounded-full bg-on-surface"
                    initial={false}
                    animate={{ scale: isSelectedDay ? 1 : 0, opacity: isSelectedDay ? 1 : 0 }}
                    transition={motionSprings.snappy}
                  />
                  <span className="relative">{date.day}</span>
                </CalendarCell>
                );
              }}
            </CalendarGridBody>
          </CalendarGrid>
          </div>

          <div className="fb-date-actions flex items-center justify-between mt-4 pt-4 border-t border-outline-variant">
            <Button
              type="button"
              variant="text"
              size="md"
              disabled={isOutOfRange(today("UTC"))}
              onClick={() => {
                // Server-aligned "today" (UTC) so the shortcut can never pick a
                // date the validator rejects at the local/UTC day boundary.
                // Focus moves too, so the visible month follows the selection.
                const todayDate = today("UTC");
                const next = new CalendarDate(todayDate.year, todayDate.month, todayDate.day);
                setDisplayedValue(next);
                setFocusedDate(next);
              }}
              className="text-on-surface-variant hover:text-on-surface"
            >
              Today
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="md" onClick={handleCancel}>
                <X size={16} aria-hidden className="mr-1" />
                Cancel
              </Button>
              <Button type="button" variant="primary" size="md" onClick={handleConfirm} disabled={!displayedValue || isOutOfRange(displayedValue)}>
                <Check size={16} aria-hidden className="mr-1" />
                Confirm
              </Button>
            </div>
          </div>
        </Calendar>
        </motion.div>
        </motion.div>
      </BottomSheet>
    </div>
  );
}
