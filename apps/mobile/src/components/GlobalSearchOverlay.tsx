import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Check,
  ChevronDown,
  Clock,
  ImageOff,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  type Category,
  type PostItem,
  type PostStatus,
  type PostType,
  type SearchedProfile,
} from "@norfold/shared";
import { useAuth } from "../auth";
import { fetchFeed } from "../services/posts";
import { searchPeople } from "../services/people";
import { useMediaUrl } from "../services/media/privateMedia";
import { friendlyError } from "../utils/friendlyErrors";
import { asNlExtractOutcome, nlExtractLive } from "../services/liveNarrowTasks";
import { modalLayerCount } from "../hooks/modalLayers";
import { CATEGORY_OPTIONS } from "./CategoryField";
import { POST_TYPE_OPTIONS, STATUS_OPTIONS, statusLabel } from "./Segmented";
import { UserAvatar } from "./UserAvatar";
import { PostLink } from "./PostNavigation";
import { identityHref } from "./identity";
import { ProfilePreview } from "./ProfilePreview";
import { ReportDatePicker } from "./ReportDatePicker";
import { ReportPhotoPreview } from "./ReportPhotoPreview";
import { SearchField } from "./SearchField";
import { closeGlobalSearch, takeGlobalSearchSeed, useGlobalSearchOpen } from "./globalSearch";
import { motionDurations, motionEasings } from "./uiMotion";
import "./GlobalSearchOverlay.css";

/**
 * The app's one search surface, reproduced from
 * `docs/design/nav/prototype.html` (owner order 2026-11-13): a magnifier in a
 * top bar opens a floating pill bar - search icon, `Search reports, messages
 * and people…`, filter, close - over a blurred page. An empty field shows
 * recent searches; typing replaces that card with live report and people
 * results; no match says so and offers to clear the filters.
 *
 * The overlay never navigates on open. Picking a result goes to the result;
 * Enter goes to the full `/search` page with the same query and filters, so the
 * deep-linkable destination still exists without being a second search entry.
 * Messages are not searchable yet, so the field never fabricates one.
 *
 * Filters are one compact pill row, not a form. Each pill opens an app-styled
 * panel and writes its value straight into the pill, so the reader can see the
 * live query without a separate chip summary. Report dates use the item's
 * lost/found date (`event_date`), which is the bound the feed has always
 * supported, through the shared date sheet (`ReportDatePicker`).
 */

interface SearchFilters {
  type: PostType | "";
  category: Category | "";
  status: PostStatus | "";
  sort: "newest" | "oldest";
  dateFrom: string;
  dateTo: string;
}

type FilterMenuKey = "type" | "category" | "status" | "date" | "sort";
type DatePreset = "any" | "week" | "month" | "year";
type DateBound = "from" | "to";

const EMPTY_FILTERS: SearchFilters = {
  type: "",
  category: "",
  status: "",
  sort: "newest",
  dateFrom: "",
  dateTo: "",
};
const RECENT_KEY = "norfold-search-recent";
const RECENT_LIMIT = 5;

const MENU_TITLES: Record<FilterMenuKey, string> = {
  type: "Type",
  category: "Category",
  status: "Status",
  date: "Date lost or found",
  sort: "Sort",
};

const DATE_PRESETS: readonly { key: DatePreset; label: string }[] = [
  { key: "any", label: "Any date" },
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "Last 30 days" },
  { key: "year", label: "This year" },
];

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function recentStorageKey(accountId: string | undefined) {
  return `${RECENT_KEY}:${accountId ?? "guest"}`;
}

function readRecent(accountId: string | undefined): string[] {
  try {
    const raw = localStorage.getItem(recentStorageKey(accountId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim() !== "").slice(0, RECENT_LIMIT);
  } catch {
    // Storage is an enhancement; a blocked or corrupt store starts empty.
    return [];
  }
}

function writeRecent(accountId: string | undefined, values: string[]) {
  try {
    localStorage.setItem(recentStorageKey(accountId), JSON.stringify(values.slice(0, RECENT_LIMIT)));
  } catch {
    // Private mode or a full quota must not break search.
  }
}

function mergeRecent(values: string[], next: string) {
  const trimmed = next.trim();
  if (!trimmed) return values;
  const key = trimmed.toLowerCase();
  return [trimmed, ...values.filter((value) => value.toLowerCase() !== key)].slice(0, RECENT_LIMIT);
}

/** One debounce, owned here: no search library and no second request policy. */
function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** A parsed calendar day, or null when the string is not a real date. */
function parseDay(value: string): { year: number; month: number; day: number } | null {
  const match = DAY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return { year, month, day };
}

/** A date-only bound, judged as a real calendar day rather than any digits. */
function validDay(value: string): boolean {
  return parseDay(value) !== null;
}

/**
 * The bounds the feed may actually use. Each bound is judged on its own, so one
 * impossible day cannot throw away the other valid one; only a reversed range
 * invalidates both. The full `/search` page applies the same validity and range
 * rules; only availability differs on purpose, because this overlay's pickers
 * opt in to future days while `/search` keeps its past-only fields.
 */
function appliedRange(filters: SearchFilters) {
  const fromUsable = !filters.dateFrom || validDay(filters.dateFrom);
  const toUsable = !filters.dateTo || validDay(filters.dateTo);
  const reversed = Boolean(
    fromUsable && toUsable && filters.dateFrom && filters.dateTo &&
    filters.dateFrom > filters.dateTo,
  );
  return {
    from: fromUsable && !reversed ? filters.dateFrom : "",
    to: toUsable && !reversed ? filters.dateTo : "",
    invalid: !fromUsable || !toUsable,
    reversed,
  };
}

function activeFilterCount(filters: SearchFilters) {
  const range = appliedRange(filters);
  return (
    (filters.type ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.sort !== "newest" ? 1 : 0) +
    (range.from || range.to ? 1 : 0)
  );
}

function searchParamsFor(query: string, filters: SearchFilters) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  const range = appliedRange(filters);
  if (range.from) params.set("dateFrom", range.from);
  if (range.to) params.set("dateTo", range.to);
  return params;
}

/** Local calendar day, so a date is never shifted by a UTC conversion. */
function isoDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  if (preset === "any") return { from: "", to: "" };
  if (preset === "year") {
    return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  }
  const start = new Date(today);
  start.setDate(start.getDate() - (preset === "week" ? 6 : 29));
  return { from: isoDay(start), to: isoDay(today) };
}

function presetFor(filters: SearchFilters): DatePreset | "custom" {
  const { from, to } = appliedRange(filters);
  if (!from && !to) return "any";
  for (const key of ["week", "month", "year"] as const) {
    const preset = presetRange(key);
    if (from === preset.from && to === preset.to) return key;
  }
  return "custom";
}

function shortDay(value: string) {
  const match = DAY_PATTERN.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, month, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function datePillLabel(filters: SearchFilters) {
  const preset = presetFor(filters);
  if (preset === "any") return "Date";
  if (preset !== "custom") {
    return DATE_PRESETS.find((option) => option.key === preset)?.label ?? "Date";
  }
  const range = appliedRange(filters);
  if (!range.from && !range.to) return "Date";
  if (range.from && range.to) return `${shortDay(range.from)} – ${shortDay(range.to)}`;
  if (range.from) return `From ${shortDay(range.from)}`;
  return `Until ${shortDay(range.to)}`;
}

function filterPillName(title: string, value: string, placeholder: string) {
  return value === placeholder ? title : `${title}: ${value}`;
}

export function GlobalSearchOverlay() {
  const open = useGlobalSearchOpen();
  return <AnimatePresence>{open && <SearchSurface />}</AnimatePresence>;
}

function SearchSurface() {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from My reports, the one search surface searches that owner's
  // reports: same pill filters, no people, and `/search` keeps the scope.
  const myReports = location.pathname === "/my";
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const filterRevision = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<FilterMenuKey | null>(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readRecent(user?.id));
  const [reports, setReports] = useState<PostItem[]>([]);
  const [people, setPeople] = useState<SearchedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phoneTop, setPhoneTop] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const filterToggle = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Record<FilterMenuKey, HTMLButtonElement | null>>({
    type: null,
    category: null,
    status: null,
    date: null,
    sort: null,
  });
  const resultsId = useId();
  const filtersId = useId();
  const dateFromId = `${filtersId}-date-from`;
  const dateToId = `${filtersId}-date-to`;

  // A printable keystroke elsewhere in the app opens search with that
  // character already in the field, so the reader never types it twice.
  useEffect(() => {
    const seeded = takeGlobalSearchSeed();
    if (seeded) setQuery(seeded);
  }, []);

  // A card opened from a result portals out of this surface, so its own
  // destinations (the avatar, the name, View full profile) never pass through
  // the result row's click. Taking one still leaves search, and the card's
  // Close stays a card-only dismissal, so the navigation is the signal. The
  // location key changes even when the destination is the page already open.
  const entryLocationKey = useRef(location.key);
  useEffect(() => {
    if (location.key !== entryLocationKey.current) closeGlobalSearch();
  }, [location.key]);

  const trimmed = query.trim();
  const deferred = useDebounced(trimmed, 220);
  const settled = useDebounced(trimmed, 400);
  const range = appliedRange(filters);
  const activeCount = activeFilterCount(filters);
  const shouldSearch = deferred.length > 0 || activeCount > 0;

  useEffect(() => {
    if (!accountId || !settled || settled !== trimmed) return;
    let cancelled = false;
    const revision = filterRevision.current;
    void nlExtractLive(settled).then((result) => {
      if (cancelled || revision !== filterRevision.current) return;
      const outcome = asNlExtractOutcome(result);
      if (outcome.kind === "failed") return;
      const patch = outcome.patch;
      setFilters((current) => {
        const validFrom = patch.dateFrom === undefined || validDay(patch.dateFrom);
        const validTo = patch.dateTo === undefined || validDay(patch.dateTo);
        const validRange = validFrom && validTo &&
          !(patch.dateFrom && patch.dateTo && patch.dateFrom > patch.dateTo);
        return {
          ...current,
          type: current.type || patch.postType || "",
          category: current.category || patch.category || "",
          status: current.status || patch.status || "",
          dateFrom: !current.dateFrom && !current.dateTo && validRange ? patch.dateFrom || "" : current.dateFrom,
          dateTo: !current.dateFrom && !current.dateTo && validRange ? patch.dateTo || "" : current.dateTo,
        };
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [accountId, settled, trimmed]);

  // The phone overlay sits 8px under the measured app bar, not under a guessed
  // height: 200% text makes the bar taller and must move the overlay with it.
  useLayoutEffect(() => {
    const measure = () => {
      if (window.innerWidth >= 600) { setPhoneTop(null); return; }
      // A route transition can keep the outgoing bar mounted; an off-screen bar
      // must not decide the offset. Take the lowest bar the reader can see, so
      // the overlay always clears the one on screen.
      let bottom = 52;
      for (const bar of document.querySelectorAll<HTMLElement>(".fb-app-bar, [data-testid='home-search-row']")) {
        const rect = bar.getBoundingClientRect();
        if (rect.height === 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
        bottom = Math.max(bottom, rect.bottom);
      }
      setPhoneTop(Math.max(52, Math.round(bottom + 8)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Escape closes one layer at a time: the shared date sheet first, then the
  // date panel, the filter row, and finally the search. The sheet registers as
  // a modal layer above this surface, so its own topmost handler gets the key;
  // this handler must not close the panel behind it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modalLayerCount() > 0) return;
      event.preventDefault();
      if (openMenu) {
        const key = openMenu;
        setOpenMenu(null);
        pillRefs.current[key]?.focus();
        return;
      }
      if (filtersOpen) {
        setFiltersOpen(false);
        filterToggle.current?.focus();
        return;
      }
      closeGlobalSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filtersOpen, openMenu]);

  // An open filter panel puts focus on its selected option (or the category
  // search field), so a keyboard reader enters the panel instead of tabbing
  // through the remaining pills first.
  useEffect(() => {
    if (!openMenu) return;
    const panel = menuPanel.current;
    if (!panel) return;
    const target = openMenu === "category"
      ? panel.querySelector<HTMLInputElement>("input[type='search']")
      : panel.querySelector<HTMLElement>('[aria-pressed="true"]') ?? panel.querySelector<HTMLElement>("button");
    target?.focus();
  }, [openMenu]);

  // A press anywhere outside the filter tray dismisses the panel without
  // dismissing the search surface. The tray stays mounted for the pointerdown
  // that lands on another pill.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (event: PointerEvent) => {
      if (tray.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== "category") setCategoryQuery("");
  }, [openMenu]);

  useEffect(() => {
    if (!shouldSearch) {
      setReports([]);
      setPeople([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const reportRequest: Promise<PostItem[]> = accountId
      ? fetchFeed({
        ...(myReports ? { userId: accountId } : {}),
        q: deferred,
        type: filters.type,
        category: filters.category,
        status: filters.status,
        sort: filters.sort,
        dateFrom: range.from || undefined,
        dateTo: range.to || undefined,
      }).then((page) => page.items.slice(0, 5))
      : Promise.resolve([]);
    const peopleRequest: Promise<SearchedProfile[]> = accountId && !myReports && deferred.length > 0
      ? searchPeople(deferred, { limit: 5 }).then((page) => page.items)
      : Promise.resolve([]);
    Promise.allSettled([reportRequest, peopleRequest]).then(([reportResult, peopleResult]) => {
      if (cancelled) return;
      if (reportResult.status === "fulfilled") setReports(reportResult.value);
      else setReports([]);
      if (peopleResult.status === "fulfilled") setPeople(peopleResult.value);
      else setPeople([]);
      const failure = [reportResult, peopleResult].find((result) => result.status === "rejected");
      setError(failure && failure.status === "rejected" ? friendlyError(failure.reason).message : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [
    accountId,
    attempt,
    deferred,
    filters.type,
    filters.category,
    filters.status,
    filters.sort,
    range.from,
    range.to,
    shouldSearch,
    myReports,
  ]);

  function remember(value: string) {
    setRecent((current) => {
      const next = mergeRecent(current, value);
      writeRecent(accountId ?? undefined, next);
      return next;
    });
  }

  function pickRecent(value: string) {
    setQuery(value);
    remember(value);
    input.current?.focus();
  }

  function clearAll() {
    filterRevision.current += 1;
    setQuery("");
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    setOpenMenu(null);
    input.current?.focus();
  }

  function clearFilters() {
    filterRevision.current += 1;
    setFilters(EMPTY_FILTERS);
    setOpenMenu(null);
    filterToggle.current?.focus();
  }

  function toggleMenu(key: FilterMenuKey) {
    setOpenMenu((current) => (current === key ? null : key));
  }

  function patchFilters(key: FilterMenuKey, patch: Partial<SearchFilters>, close = true) {
    filterRevision.current += 1;
    setFilters((current) => ({ ...current, ...patch }));
    if (!close) return;
    setOpenMenu(null);
    pillRefs.current[key]?.focus();
  }

  function choosePreset(preset: DatePreset) {
    filterRevision.current += 1;
    const next = presetRange(preset);
    setFilters((current) => ({ ...current, dateFrom: next.from, dateTo: next.to }));
    setOpenMenu(null);
    pillRefs.current.date?.focus();
  }

  /** The shared picker commits only on Confirm; its onChange is the one place
   *  a bound reaches the filters, so Cancel leaves the query untouched. */
  function applyDateBound(bound: DateBound, value: string) {
    filterRevision.current += 1;
    setFilters((current) => (
      bound === "from" ? { ...current, dateFrom: value } : { ...current, dateTo: value }
    ));
  }

  /** The picker has no Clear control, so each bound keeps its own: clearing
   *  means "any date" and keeps the reader on the field it emptied. */
  function clearDateBound(bound: DateBound) {
    applyDateBound(bound, "");
    document.getElementById(bound === "from" ? dateFromId : dateToId)?.focus();
  }

  function seeAll() {
    if (trimmed) remember(trimmed);
    const params = searchParamsFor(trimmed, filters);
    if (myReports) params.set("scope", "mine");
    closeGlobalSearch();
    navigate(`/search${params.size ? `?${params}` : ""}`);
  }

  function pickResult() {
    if (trimmed) remember(trimmed);
    closeGlobalSearch();
  }

  const searchLabel = myReports ? "Search your reports" : "Search reports, messages and people";
  const resultCount = reports.length + people.length;
  const showRecent = !shouldSearch;
  const showEmpty = Boolean(accountId) && shouldSearch && !loading && !error && resultCount === 0;
  const typeValue = filters.type === "LOST" ? "Lost" : filters.type === "FOUND" ? "Found" : "Type";
  const categoryValue = filters.category || "Category";
  const statusValue = filters.status ? statusLabel(filters.status) : "Status";
  const dateValue = datePillLabel(filters);
  const sortValue = filters.sort === "oldest" ? "Oldest" : "Newest";
  const filterToggleName = activeCount > 0 ? `Advanced search, ${activeCount} active` : "Advanced search";

  // A phone cannot fit every pill. The open pill must stay fully visible even
  // when choosing a value widens it — "From Nov 20" is wider than "Date" — so
  // this follows the label, not just the open state.
  const openPillText = openMenu === "type" ? typeValue
    : openMenu === "category" ? categoryValue
      : openMenu === "status" ? statusValue
        : openMenu === "date" ? dateValue
          : openMenu === "sort" ? sortValue
            : null;
  useEffect(() => {
    if (!openMenu) return;
    pillRefs.current[openMenu]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [openMenu, openPillText]);

  return <>
    <motion.div
      className="fb-search-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
      onPointerDown={(event) => { event.preventDefault(); closeGlobalSearch(); }}
    />
    <motion.div
      className="fb-search-overlay"
      role="search"
      aria-label={searchLabel}
      style={phoneTop === null ? undefined : {
        top: phoneTop,
        /* The phone keeps the app-bar offset and safe-area math, but the cap is
           still the smaller of the comfortable viewport share and the space left
           below the bar, so a tall phone window cannot become a full-screen sheet. */
        maxHeight: `min(60vh, calc(100dvh - ${phoneTop}px - 12px))`,
      }}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
    >
      <div className="fb-search-bar">
        <SearchField
          value={query}
          onChange={setQuery}
          ariaLabel={searchLabel}
          placeholder={myReports ? "Search your reports…" : "Search reports, messages and people…"}
          inputRef={input}
          onClear={() => setQuery("")}
          className="fb-search-overlay-field"
          inputProps={{
            "data-global-search-input": "",
            autoFocus: true,
            autoComplete: "off",
            "aria-controls": shouldSearch ? resultsId : undefined,
            onKeyDown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                seeAll();
              } else if (event.key === "ArrowDown" && resultCount > 0) {
                event.preventDefault();
                document.getElementById(resultsId)?.querySelector<HTMLElement>("a")?.focus();
              }
            },
          }}
        />
        {/* Clearing filters is a real control next to the filter button, not
            an underlined link hiding at the end of the pill row. */}
          <button
            type="button"
            className="fb-search-clear-filters"
            aria-label="Clear filters"
            onClick={clearFilters}
            disabled={activeCount === 0}
          >
            Clear filters
          </button>
        <button
          ref={filterToggle}
          type="button"
          className="fb-search-iconbtn fb-search-filter-toggle"
          aria-label={filterToggleName}
          aria-expanded={filtersOpen}
          aria-controls={filtersOpen ? filtersId : undefined}
          data-active={filtersOpen || activeCount > 0 || undefined}
          onClick={() => {
            setOpenMenu(null);
            setFiltersOpen(!filtersOpen);
          }}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          {activeCount > 0 && (
            <span className="fb-search-filter-count" aria-hidden="true">{activeCount}</span>
          )}
        </button>
        <button
          type="button"
          className="fb-search-iconbtn"
          aria-label="Close search"
          onClick={() => closeGlobalSearch()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {filtersOpen && <div
        className="fb-search-filterbar"
        id={filtersId}
        role="group"
        aria-label="Advanced search"
        ref={tray}
      >
        <div className="fb-search-pills">
          <FilterPill
            text={typeValue}
            accessibleName={filterPillName("Type", typeValue, "Type")}
            active={Boolean(filters.type)}
            open={openMenu === "type"}
            controls={`${filtersId}-type`}
            buttonRef={(node) => { pillRefs.current.type = node; }}
            onClick={() => toggleMenu("type")}
          />
          <FilterPill
            text={categoryValue}
            accessibleName={filterPillName("Category", categoryValue, "Category")}
            active={Boolean(filters.category)}
            open={openMenu === "category"}
            controls={`${filtersId}-category`}
            buttonRef={(node) => { pillRefs.current.category = node; }}
            onClick={() => toggleMenu("category")}
          />
          <FilterPill
            text={statusValue}
            accessibleName={filterPillName("Status", statusValue, "Status")}
            active={Boolean(filters.status)}
            open={openMenu === "status"}
            controls={`${filtersId}-status`}
            buttonRef={(node) => { pillRefs.current.status = node; }}
            onClick={() => toggleMenu("status")}
          />
          <FilterPill
            text={dateValue}
            accessibleName={filterPillName("Date", dateValue, "Date")}
            active={Boolean(range.from || range.to)}
            open={openMenu === "date"}
            controls={`${filtersId}-date`}
            buttonRef={(node) => { pillRefs.current.date = node; }}
            onClick={() => toggleMenu("date")}
          />
          <FilterPill
            text={sortValue}
            accessibleName={`Sort: ${sortValue}`}
            active={filters.sort === "oldest"}
            open={openMenu === "sort"}
            controls={`${filtersId}-sort`}
            buttonRef={(node) => { pillRefs.current.sort = node; }}
            onClick={() => toggleMenu("sort")}
          />
        </div>
        {openMenu && <FilterMenu
          menu={openMenu}
          filters={filters}
          filtersId={filtersId}
          menuRef={menuPanel}
          categoryQuery={categoryQuery}
          onCategoryQuery={setCategoryQuery}
          onPatch={patchFilters}
          onPreset={choosePreset}
          dateFromId={dateFromId}
          dateToId={dateToId}
          onApplyBound={applyDateBound}
          onClearBound={clearDateBound}
        />}
      </div>}

      <div className="fb-search-card" aria-live="polite">
        {showRecent && <>
          <p className="fb-search-card-title">Recent searches</p>
          {recent.length === 0
            ? <p className="fb-search-note">No recent searches</p>
            : <ul className="fb-search-list">
              {recent.map((value) => <li key={value}>
                <button type="button" className="fb-gsearch-row" onClick={() => pickRecent(value)}>
                  <Clock size={18} aria-hidden="true" className="fb-gsearch-row-icon" />
                  <span className="fb-gsearch-row-copy"><span className="fb-gsearch-row-title">{value}</span></span>
                </button>
              </li>)}
            </ul>}
        </>}

        {shouldSearch && <>
          {loading && <p className="fb-search-note" role="status">Searching…</p>}
          {error && <div className="fb-search-note" role="alert">
            <p>{error}</p>
            <button type="button" className="fb-search-reset" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
          </div>}
          {resultCount > 0 && <ul className="fb-search-list" id={resultsId} aria-label="Search results">
            {reports.map((report) => <li key={`report-${report.id}`}>
              <SearchReportRow report={report} onPick={pickResult} />
            </li>)}
            {people.map((person) => <li key={`person-${person.id}`}>
              {/* The same person card the people directory carries: a rest or a
                  tap answers "who is this?" in place, and the row itself is the
                  destination only when the card did not take the gesture. */}
              <ProfilePreview person={person} className="w-full" openOnFocus={false}>
                <Link
                  to={identityHref(person)}
                  className="fb-gsearch-row"
                  onClick={(event) => { if (!event.defaultPrevented) pickResult(); }}
                >
                  <UserAvatar username={person.displayName?.trim() || person.username} avatarUrl={person.avatarUrl} size={32} />
                  <span className="fb-gsearch-row-copy">
                    <span className="fb-gsearch-row-title">{person.displayName?.trim() || person.username}</span>
                    <span className="fb-gsearch-row-meta">@{person.username}</span>
                  </span>
                </Link>
              </ProfilePreview>
            </li>)}
          </ul>}
          {showEmpty && <div className="fb-search-note">
            <p><strong>No results found</strong><br />Try another search.</p>
            <button type="button" className="fb-search-reset" onClick={clearAll}>Start over</button>
          </div>}
          {!accountId && <p className="fb-search-note">Sign in to search reports and people.</p>}
        </>}
      </div>
    </motion.div>
  </>;
}

/**
 * One report result. The report's own photo sits in a fixed, avatar-sized box
 * beside the left-aligned title (never a magnifier pinned to the far end), and
 * the one shared hover card from `ReportPhotoPreview` is the only preview on
 * this row. Recent searches keep their own rows; a person's row carries the
 * person card instead.
 */
function SearchReportRow({ report, onPick }: { report: PostItem; onPick: () => void }) {
  return <ReportPhotoPreview post={report}>
    <PostLink to={`/posts/${report.id}`} className="fb-gsearch-row" onClick={onPick}>
      <SearchReportThumb report={report} />
      <span className="fb-gsearch-row-copy">
        <span className="fb-gsearch-row-title">{report.title}</span>
        <span className="fb-gsearch-row-meta">
          {report.type === "LOST" ? "Lost" : "Found"} · {report.category} · {statusLabel(report.status)}
        </span>
      </span>
    </PostLink>
  </ReportPhotoPreview>;
}

/**
 * The row's photo, resolved through the same private-media path as every other
 * report image. The box keeps its geometry while a key is being signed, when a
 * report has no photo, and after a failed load, so the row never shifts and a
 * missing image is never faked.
 */
function SearchReportThumb({ report }: { report: PostItem }) {
  const image = report.attachments.find((item) => item.mimeType.startsWith("image/"));
  const src = useMediaUrl(image?.fileUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = image !== undefined && failedUrl === image.fileUrl;
  const state = !image ? "none" : failed ? "failed" : src ? "ready" : "loading";
  return <span className="fb-gsearch-row-thumb" data-testid="search-report-thumb" data-state={state} aria-hidden="true">
    {image && src && !failed
      ? <img src={src} alt="" width={32} height={32} loading="lazy" onError={() => setFailedUrl(image.fileUrl)} />
      : failed ? <ImageOff size={16} aria-hidden="true" /> : null}
  </span>;
}

function FilterPill({
  text,
  accessibleName,
  active,
  open,
  controls,
  buttonRef,
  onClick,
}: {
  text: string;
  accessibleName: string;
  active: boolean;
  open: boolean;
  controls: string;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return <button
    ref={buttonRef}
    type="button"
    className="fb-search-pill"
    aria-label={accessibleName}
    aria-expanded={open}
    aria-controls={open ? controls : undefined}
    data-active={active ? "true" : undefined}
    data-open={open ? "true" : undefined}
    onClick={onClick}
  >
    <span className="fb-search-pill-text">{text}</span>
    <ChevronDown size={14} aria-hidden="true" className="fb-search-pill-chevron" />
  </button>;
}

function MenuOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return <button
    type="button"
    className="fb-search-menu-option"
    aria-pressed={selected}
    onClick={onSelect}
  >
    <span className="fb-search-menu-option-label">{children}</span>
    <span className="fb-search-menu-check" aria-hidden="true">
      {selected && <Check size={16} />}
    </span>
  </button>;
}

function FilterMenu({
  menu,
  filters,
  filtersId,
  menuRef,
  categoryQuery,
  onCategoryQuery,
  onPatch,
  onPreset,
  dateFromId,
  dateToId,
  onApplyBound,
  onClearBound,
}: {
  menu: FilterMenuKey;
  filters: SearchFilters;
  filtersId: string;
  menuRef: RefObject<HTMLDivElement | null>;
  categoryQuery: string;
  onCategoryQuery: (value: string) => void;
  onPatch: (key: FilterMenuKey, patch: Partial<SearchFilters>, close?: boolean) => void;
  onPreset: (preset: DatePreset) => void;
  dateFromId: string;
  dateToId: string;
  onApplyBound: (bound: DateBound, value: string) => void;
  onClearBound: (bound: DateBound) => void;
}) {
  const title = MENU_TITLES[menu];
  const range = appliedRange(filters);
  const preset = presetFor(filters);
  const categories = CATEGORY_OPTIONS.filter((option) =>
    option.label.toLowerCase().includes(categoryQuery.trim().toLowerCase()),
  );

  return <div
    className="fb-search-menu"
    id={`${filtersId}-${menu}`}
    role="group"
    aria-label={title}
    ref={menuRef}
  >
    <p className="fb-search-menu-title">{title}</p>
    {menu === "category" && <div className="fb-search-menu-search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={categoryQuery}
        placeholder="Find a category"
        aria-label="Find a category"
        autoComplete="off"
        onChange={(event) => onCategoryQuery(event.target.value)}
      />
    </div>}
    <div className="fb-search-menu-list">
      {menu === "type" && <>
        <MenuOption selected={!filters.type} onSelect={() => onPatch("type", { type: "" })}>All types</MenuOption>
        {POST_TYPE_OPTIONS.map((option) => <MenuOption
          key={option.value}
          selected={filters.type === option.value}
          onSelect={() => onPatch("type", { type: option.value })}
        >{option.label}</MenuOption>)}
      </>}

      {menu === "category" && <>
        <MenuOption selected={!filters.category} onSelect={() => onPatch("category", { category: "" })}>All categories</MenuOption>
        {categories.map((option) => <MenuOption
          key={option.value}
          selected={filters.category === option.value}
          onSelect={() => onPatch("category", { category: option.value })}
        >{option.label}</MenuOption>)}
        {categories.length === 0 && <p className="fb-search-menu-note">No categories match “{categoryQuery}”.</p>}
      </>}

      {menu === "status" && <>
        <MenuOption selected={!filters.status} onSelect={() => onPatch("status", { status: "" })}>Any status</MenuOption>
        {STATUS_OPTIONS.map((option) => <MenuOption
          key={option.value}
          selected={filters.status === option.value}
          onSelect={() => onPatch("status", { status: option.value })}
        >{option.label}</MenuOption>)}
      </>}

      {menu === "date" && <div className="fb-search-date-options">
        <div className="fb-search-date-presets">
          {DATE_PRESETS.map((option) => <button
            key={option.key}
            type="button"
            className="fb-search-date-preset"
            aria-pressed={preset === option.key}
            onClick={() => onPreset(option.key)}
          >
            <span>{option.label}</span>
            {preset === option.key && <Check size={14} aria-hidden="true" />}
          </button>)}
        </div>
        <div className="fb-search-menu-divider" role="separator" />
        {/* Both bounds are the app's shared date field. A value reaches the
            filter only when the picker's Confirm is pressed, so dismissing the
            sheet changes nothing. allowFuture keeps this filter's existing
            range: search has always allowed future days, unlike the report
            form. */}
        <div className="fb-search-date-fields">
          <div className="fb-search-date-field">
            <div className="fb-search-date-field-head">
              <span className="fb-search-date-field-label">From</span>
              {filters.dateFrom && <button
                type="button"
                className="fb-search-date-clear"
                aria-label="Clear from date"
                onClick={() => onClearBound("from")}
              >
                <X size={16} aria-hidden="true" />
              </button>}
            </div>
            <ReportDatePicker
              id={dateFromId}
              label="From date"
              title="From date"
              description="Show reports on or after this day."
              placeholder="Any date"
              value={filters.dateFrom}
              maxValue={validDay(filters.dateTo) ? filters.dateTo : undefined}
              allowFuture
              onChange={(value) => onApplyBound("from", value)}
            />
          </div>
          <div className="fb-search-date-field">
            <div className="fb-search-date-field-head">
              <span className="fb-search-date-field-label">To</span>
              {filters.dateTo && <button
                type="button"
                className="fb-search-date-clear"
                aria-label="Clear to date"
                onClick={() => onClearBound("to")}
              >
                <X size={16} aria-hidden="true" />
              </button>}
            </div>
            <ReportDatePicker
              id={dateToId}
              label="To date"
              title="To date"
              description="Show reports on or before this day."
              placeholder="Any date"
              value={filters.dateTo}
              minValue={validDay(filters.dateFrom) ? filters.dateFrom : undefined}
              allowFuture
              onChange={(value) => onApplyBound("to", value)}
            />
          </div>
        </div>
        {range.reversed && <p className="fb-search-menu-note fb-search-menu-error" role="alert">
          The start date must be on or before the end date.
        </p>}
        {range.invalid && !range.reversed && <p className="fb-search-menu-note fb-search-menu-error" role="alert">
          Enter a real calendar date.
        </p>}
        <p className="fb-search-menu-note">Matches the date the item was lost or found.</p>
      </div>}

      {menu === "sort" && <>
        <MenuOption selected={filters.sort === "newest"} onSelect={() => onPatch("sort", { sort: "newest" })}>Newest first</MenuOption>
        <MenuOption selected={filters.sort === "oldest"} onSelect={() => onPatch("sort", { sort: "oldest" })}>Oldest first</MenuOption>
      </>}
    </div>
  </div>;
}
