import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import { Clock, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
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
import { friendlyError } from "../utils/friendlyErrors";
import { CATEGORY_OPTIONS } from "./CategoryField";
import { POST_TYPE_OPTIONS, STATUS_OPTIONS, statusLabel } from "./Segmented";
import { UserAvatar } from "./UserAvatar";
import { closeGlobalSearch, useGlobalSearchOpen } from "./globalSearch";
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
 */

interface SearchFilters {
  type: PostType | "";
  category: Category | "";
  status: PostStatus | "";
  sort: "newest" | "oldest";
}

const EMPTY_FILTERS: SearchFilters = { type: "", category: "", status: "", sort: "newest" };
const RECENT_KEY = "norfold-search-recent";
const RECENT_LIMIT = 5;

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

function filtersActive(filters: SearchFilters) {
  return Boolean(filters.type || filters.category || filters.status || filters.sort !== "newest");
}

function searchParamsFor(query: string, filters: SearchFilters) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  return params;
}

export function GlobalSearchOverlay() {
  const open = useGlobalSearchOpen();
  return <AnimatePresence>{open && <SearchSurface />}</AnimatePresence>;
}

function SearchSurface() {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent(user?.id));  const [reports, setReports] = useState<PostItem[]>([]);
  const [people, setPeople] = useState<SearchedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phoneTop, setPhoneTop] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const filterToggle = useRef<HTMLButtonElement>(null);
  const resultsId = useId();
  const filtersId = useId();

  const trimmed = query.trim();
  const deferred = useDebounced(trimmed, 220);
  const active = filtersActive(filters);
  const shouldSearch = deferred.length > 0 || active;

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

  // Escape closes the advanced card first, then search - the trigger owns
  // focus in both cases.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (filtersOpen) {
        setFiltersOpen(false);
        filterToggle.current?.focus();
        return;
      }
      closeGlobalSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

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
        q: deferred,
        type: filters.type,
        category: filters.category,
        status: filters.status,
        sort: filters.sort,
      }).then((page) => page.items.slice(0, 5))
      : Promise.resolve([]);
    const peopleRequest: Promise<SearchedProfile[]> = accountId && deferred.length > 0
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
  }, [accountId, attempt, deferred, filters, shouldSearch]);

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
    setQuery("");
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    input.current?.focus();
  }

  function applyFilters() {
    setFiltersOpen(false);
    filterToggle.current?.focus();
  }

  function seeAll() {
    if (trimmed) remember(trimmed);
    const params = searchParamsFor(trimmed, filters);
    closeGlobalSearch();
    navigate(`/search${params.size ? `?${params}` : ""}`);
  }

  function pickResult() {
    if (trimmed) remember(trimmed);
    closeGlobalSearch();
  }

  const resultCount = reports.length + people.length;
  const showRecent = !shouldSearch;
  const showEmpty = Boolean(accountId) && shouldSearch && !loading && !error && resultCount === 0;

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
      aria-label="Search reports, messages and people"
      style={phoneTop === null ? undefined : {
        top: phoneTop,
        maxHeight: `calc(100dvh - ${phoneTop}px - 12px)`,
      }}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
    >
      <div className="fb-search-bar">
        <Search size={18} aria-hidden="true" className="fb-search-magnifier" />
        <div className="fb-search-field">
          <input
            ref={input}
            data-global-search-input
            type="search"
            value={query}
            autoFocus
            autoComplete="off"
            aria-label="Search reports, messages and people"
            aria-controls={shouldSearch ? resultsId : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                seeAll();
              } else if (event.key === "ArrowDown" && resultCount > 0) {
                event.preventDefault();
                document.getElementById(resultsId)?.querySelector<HTMLElement>("a")?.focus();
              }
            }}
          />
          {/* A native placeholder cannot ellipsize in Chrome, and a phone was
              cutting the prompt mid-word at the filter icon. A real element
              elides it honestly at every width; the input keeps its aria-label
              as the accessible name. */}
          {query === "" && (
            <div className="fb-search-placeholder" aria-hidden="true">
              <span>Search reports, messages and people…</span>
            </div>
          )}
        </div>
        <button
          ref={filterToggle}
          type="button"
          className="fb-search-iconbtn"
          aria-label="Advanced search"
          aria-expanded={filtersOpen}
          aria-controls={filtersOpen ? filtersId : undefined}
          data-active={filtersOpen || active || undefined}
          onClick={() => {
            if (filtersOpen) { setFiltersOpen(false); return; }
            setFiltersOpen(true);
          }}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
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

      {filtersOpen && <div className="fb-search-filters" id={filtersId} role="group" aria-label="Advanced search">
        <Field label="Post type" value={filters.type} onChange={(value) => setFilters((current) => ({ ...current, type: value as PostType | "" }))}
          options={[{ value: "", label: "All types" }, ...POST_TYPE_OPTIONS]} />
        <Field label="Category" value={filters.category} onChange={(value) => setFilters((current) => ({ ...current, category: value as Category | "" }))}
          options={[{ value: "", label: "All categories" }, ...CATEGORY_OPTIONS]} />
        <Field label="Status" value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value as PostStatus | "" }))}
          options={[{ value: "", label: "Any status" }, ...STATUS_OPTIONS]} />
        <Field label="Sort" value={filters.sort} onChange={(value) => setFilters((current) => ({ ...current, sort: value === "oldest" ? "oldest" : "newest" }))}
          options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]} />
        <div className="fb-search-filter-actions">
          <button type="button" className="fb-search-reset" onClick={clearAll}>Clear filters</button>
          <button type="button" className="fb-search-apply" onClick={applyFilters}>Apply</button>
        </div>
      </div>}

      <div className="fb-search-card" aria-live="polite">
        {showRecent && <>
          <p className="fb-search-card-title">Recent searches</p>
          {recent.length === 0
            ? <p className="fb-search-note">No recent searches</p>
            : <ul className="fb-search-list">
              {recent.map((value) => <li key={value}>
                <button type="button" className="fb-search-row" onClick={() => pickRecent(value)}>
                  <Clock size={18} aria-hidden="true" className="fb-search-row-icon" />
                  <span className="fb-search-row-copy"><span className="fb-search-row-title">{value}</span></span>
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
              <Link to={`/posts/${report.id}`} className="fb-search-row" onClick={pickResult}>
                <Search size={18} aria-hidden="true" className="fb-search-row-icon" />
                <span className="fb-search-row-copy">
                  <span className="fb-search-row-title">{report.title}</span>
                  <span className="fb-search-row-meta">
                    {report.type === "LOST" ? "Lost" : "Found"} · {report.category} · {statusLabel(report.status)}
                  </span>
                </span>
              </Link>
            </li>)}
            {people.map((person) => <li key={`person-${person.id}`}>
              <Link to={`/u/${encodeURIComponent(person.username)}`} className="fb-search-row" onClick={pickResult}>
                <UserAvatar username={person.displayName?.trim() || person.username} avatarUrl={person.avatarUrl} size={32} />
                <span className="fb-search-row-copy">
                  <span className="fb-search-row-title">{person.displayName?.trim() || person.username}</span>
                  <span className="fb-search-row-meta">@{person.username}</span>
                </span>
              </Link>
            </li>)}
          </ul>}
          {showEmpty && <div className="fb-search-note">
            <p><strong>No results found</strong><br />Try another search.</p>
            <button type="button" className="fb-search-reset" onClick={clearAll}>Clear filters</button>
          </div>}
          {!accountId && <p className="fb-search-note">Sign in to search reports and people.</p>}
        </>}
      </div>
    </motion.div>
  </>;
}

function Field({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  return <div className="fb-search-filter-row">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>;
}
