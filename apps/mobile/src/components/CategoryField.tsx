import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Category } from "@norfold/shared";
import { CATEGORY_GROUPS, isReleasedCategory, RELEASED_CATEGORIES, searchCategoryCatalog } from "@norfold/shared";
import { Check, ChevronDown, Lock, Search, X } from "lucide-react";
import { Dialog, Popover } from "react-aria-components";
import { OverlayDepthProvider, OverlayStackBridge, useOverlayDepth, useOverlayPortalContainer } from "./overlayFoundation";
import { AnimatedNote } from "./Fields";
import { fadeUpVariants, listItemVariants, motionDurations, motionEasings, motionSprings } from "./uiMotion";
import "./CategoryField.css";

/** Released canonical options only — safe to submit to the deployed validator. */
export const CATEGORY_OPTIONS = RELEASED_CATEGORIES.map((canonical) => ({
  value: canonical as Category,
  label: canonical,
}));

const UNRELEASED_HINT = "Coming after database update";

interface CategoryFieldProps {
  value: Category | "";
  onChange: (value: Category | "") => void;
  error?: string;
  disabled?: boolean;
}

export function CategoryField({ value, onChange, error, disabled = false }: CategoryFieldProps) {
  const [open, setOpen] = useState(false);
  const depth = useOverlayDepth();
  // Inside another popover (the search filters), the panel must stay in that
  // popover's DOM tree or the parent closes as soon as this one takes focus.
  const portalContainer = useOverlayPortalContainer();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [activeOption, setActiveOption] = useState("");
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const errorId = error ? "category-error" : undefined;

  const results = useMemo(() => searchCategoryCatalog(query), [query]);
  const grouped = useMemo(
    () =>
      CATEGORY_GROUPS.map((group) => ({
        group,
        options: results.filter((option) => option.group === group),
      })).filter((entry) => entry.options.length > 0),
    [results],
  );

  function commit(canonical: string) {
    if (disabled || !isReleasedCategory(canonical)) return;
    onChange(canonical as Category);
    closePopover();
    setQuery("");
  }

  function closePopover() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const matchCount = results.filter((option) => isReleasedCategory(option.canonical)).length;

  // Flat row order for the entrance stagger — capped at index 8 so the last
  // row never waits longer than 8 * 20ms regardless of catalogue size.
  const rowOrder = useMemo(() => {
    const order = new Map<string, number>();
    let rowIndex = 0;
    for (const { options: groupOptions } of grouped) {
      for (const option of groupOptions) order.set(option.canonical, rowIndex++);
    }
    return order;
  }, [grouped]);

  const searchField = (
    <div className="relative">
      <Search
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
      />
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search categories"
        aria-label="Search categories"
        className="min-h-[48px] w-full rounded-m3-sm border border-outline-variant bg-surface pl-9 pr-10 text-base"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="Clear category search"
          className="absolute right-1 top-1/2 flex min-h-[48px] min-w-[48px] -translate-y-1/2 items-center justify-center"
        >
          <X aria-hidden="true" size={16} />
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-on-surface">Category</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-label="Category"
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        data-testid="category-trigger"
        disabled={disabled}
        className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-m3-sm border bg-surface px-3.5 py-3 text-left text-base ${
          error ? "border-error" : "border-outline-variant"
        }`}
      >
        <span className={value ? "text-on-surface" : "text-on-surface-variant"}>
          {value || "Choose a category"}
        </span>
        <ChevronDown aria-hidden="true" size={18} className="shrink-0 text-on-surface-variant" />
      </button>

      <Popover triggerRef={triggerRef} isOpen={open && !disabled} onOpenChange={(next) => next ? setOpen(true) : closePopover()} placement="bottom start" offset={8} UNSTABLE_portalContainer={portalContainer ?? undefined} className="fb-popover fb-category-popover" style={{ zIndex: 70 + depth * 10 }} data-testid="category-popover">
        <OverlayDepthProvider depth={depth}>
        <OverlayStackBridge onClose={closePopover} />
        <Dialog aria-label="Choose a category" className="fb-category-dialog">
        <div className="shrink-0 p-2" data-testid="category-search-header">{searchField}</div>
        {grouped.length === 0 ? (
          <motion.div
            variants={fadeUpVariants}
            initial="hidden"
            animate="visible"
            transition={{ duration: motionDurations.standard, ease: motionEasings.out }}
            className="flex flex-col items-center gap-2 py-6 text-center"
          >
            <p className="text-sm text-on-surface">No categories match “{query}”.</p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="min-h-[48px] rounded-m3-sm border border-outline-variant px-4 text-sm"
            >
              Show all categories
            </button>
          </motion.div>
        ) : (
          <motion.div
            data-testid="category-results"
            variants={fadeUpVariants}
            initial="hidden"
            animate="visible"
            transition={{ duration: motionDurations.standard, ease: motionEasings.out }}
            className="h-full min-h-0 overflow-y-auto overscroll-contain pb-2"
          >
            {query && (
              <p aria-live="polite" className="px-1 pb-1 text-xs text-on-surface-variant">
                {matchCount === 1 ? "1 category" : `${matchCount} categories`}
              </p>
            )}
            {grouped.map(({ group, options }, groupIndex) => (
              <section
                key={group}
                aria-label={group}
                className={`flex flex-col gap-1 ${
                  groupIndex > 0 ? "mt-2 border-t border-outline-variant/50 pt-2" : ""
                }`}
              >
                <h3 className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  {group}
                </h3>
                {options.map((option) => {
                  const released = isReleasedCategory(option.canonical);
                  const selected = value === option.canonical;
                  const delay = Math.min(rowOrder.get(option.canonical) ?? 0, 8) * 0.02;
                  return (
                    <motion.button
                      key={option.canonical}
                      type="button"
                      layout
                      disabled={!released}
                      tabIndex={released && (activeOption === option.canonical || (!results.some((item) => item.canonical === activeOption && isReleasedCategory(item.canonical)) && results.find((item) => isReleasedCategory(item.canonical))?.canonical === option.canonical)) ? 0 : -1}
                      onFocus={() => setActiveOption(option.canonical)}
                      onKeyDown={(event) => {
                        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const rows = Array.from(event.currentTarget.closest('[data-testid="category-results"]')?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
                        const index = rows.indexOf(event.currentTarget);
                        const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                        rows[next]?.focus();
                      }}
                      aria-pressed={selected}
                      aria-label={option.canonical}
                      title={released ? option.examples : UNRELEASED_HINT}
                      onClick={() => commit(option.canonical)}
                      variants={listItemVariants}
                      initial="hidden"
                      animate="visible"
                      transition={{
                        duration: motionDurations.standard,
                        ease: motionEasings.out,
                        delay,
                      }}
                      className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-m3-xs px-3 py-2 text-left text-base ${
                        selected ? "bg-surface-container" : ""
                      } ${released ? "hover:bg-surface-container" : "opacity-50"}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium text-on-surface">{option.canonical}</span>
                        <span className="truncate text-xs text-on-surface-variant">
                          {released ? option.examples : UNRELEASED_HINT}
                        </span>
                      </span>
                      {/* Acknowledgement always in the DOM — only opacity and
                          scale move, so switching rows never blinks. */}
                      <motion.span
                        aria-hidden="true"
                        className="flex shrink-0 items-center justify-center"
                        initial={false}
                        animate={{ opacity: selected ? 1 : 0, scale: selected ? 1 : 0.6 }}
                        transition={motionSprings.snappy}
                      >
                        <Check size={18} />
                      </motion.span>
                      {!released && <Lock aria-hidden="true" size={16} className="shrink-0 text-on-surface-variant" />}
                    </motion.button>
                  );
                })}
              </section>
            ))}
          </motion.div>
        )}
        </Dialog>
        </OverlayDepthProvider>
      </Popover>
      {error && (
        <AnimatedNote id={errorId} role="alert" className="text-sm text-error">
          {error}
        </AnimatedNote>
      )}
    </div>
  );
}
