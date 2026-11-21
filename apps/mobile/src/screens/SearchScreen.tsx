import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Search } from "lucide-react";
import { useSearchParams } from "react-router";
import { useAuth } from "../auth";
import type { PostItem, PostType } from "@norfold/shared";
import { AppBar } from "../components/AppBar";
import { SearchField } from "../components/SearchField";
import { EmptyState } from "../components/PostCard";
import { PostLink } from "../components/PostNavigation";
import { ReportPhotoPreview } from "../components/ReportPhotoPreview";
import { NewPostsPill } from "../components/NewPostsPill";
import { PeopleSearch } from "../components/PeopleSearch";
import { statusLabel } from "../components/Segmented";
import { useFeed } from "../hooks/useFeed";
import { useUrlParam } from "../hooks/useUrlParam";
import { useTabTap } from "../components/TabTap";
import { useMediaUrl } from "../services/media/privateMedia";
import { timeAgo } from "../utils/dates";
import { AdvancedSearchFilters, useAdvancedSearchFilters } from "./AdvancedSearchFilters";
import { SearchNearbyControls, useSearchNearby } from "./SearchNearby";
import "./SearchScreen.css";
import type { NlFilterPatch } from "../services/search/nlFilters";
import { cleanPlace, matchesPlace } from "../services/search/placeScope";
import { nlExtractLive, asNlExtractOutcome, type NlExtractOutcome } from "../services/liveNarrowTasks";
import { shouldReduceMotion } from "../components/uiMotion";

type TypeFilter = PostType | "ALL";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const day = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

interface SearchScreenProps {
  /** Injected NL extractor (test fakes or a live extractNlFilters composer).
   * Absent means the live transport. Explicit undefined means no extractor, so
   * ordinary search runs alone and nothing is ever guessed. */
  nlExtract?: (input: string) => Promise<NlFilterPatch | NlExtractOutcome>;
  /** Feed restriction for a search opened from My reports (`scope=mine`). */
  mineAccountId?: string;
}

export function SearchScreen(props: SearchScreenProps) {
  const { user } = useAuth();
  return <AccountSearchScreen key={user?.id ?? "signed-out"} {...props} />;
}

function AccountSearchScreen(props: SearchScreenProps) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const people = params.get("scope") === "people";
  // Opened from My reports, search is scoped to that owner's reports.
  const mine = params.get("scope") === "mine";
  const [peopleQuery, setPeopleQuery] = useUrlParam("people");
  // People and Search are different places, not two tabs of one screen:
  // People is the directory, Search is the report search. Rendering
  // ReportSearch under the directory mounted a second, unreachable search
  // screen and offered a Reports tab on a page that is about people.
  if (people) return <PeopleDirectory query={peopleQuery} onQueryChange={setPeopleQuery} />;
  return <div className="fb-search-screen">
    <ReportSearch {...props} mineAccountId={mine ? user?.id : undefined} />
  </div>;
}

function PeopleDirectory({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return <div className="fb-search-screen">
    <AppBar title="People" backTo="/" backLabel="Back" utilities={false} />
    <div className="fb-connect-canvas px-3 pt-2">
      <SearchField
        value={query}
        onChange={onQueryChange}
        ariaLabel="Search people"
        placeholder="Name or @username"
        onClear={() => onQueryChange("")}
      />
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="fb-connect-canvas px-4">
        <PeopleSearch query={query} />
      </div>
    </div>
  </div>;
}

function ReportSearch(props: SearchScreenProps) {
  // Default-on live transport: a bare mount (App.tsx) gets nlExtractLive.
  // An explicit prop — including explicit undefined — always wins so tests
  // can inject fakes or pin the disabled copy.
  const nlExtract = "nlExtract" in props ? props.nlExtract : nlExtractLive;
  const mineAccountId = props.mineAccountId;
  const { tapCount } = useTabTap();
  // Imperative travel (scroll-to-top) cannot see MotionConfig — collapse to
  // instant when the OS prefers reduced motion. Read live (not the cached
  // framer-motion singleton) so the value is exact at render/scroll time.
  const reduceMotion = shouldReduceMotion();
  // Every filter survives in the URL so back-nav, deep-links, and copied
  // links restore the exact search the reader was looking at.
  const [typeParam, setTypeParam] = useUrlParam("type");
  const type: TypeFilter = typeParam === "LOST" || typeParam === "FOUND" ? typeParam : "ALL";
  const setType = useCallback((next: TypeFilter) => setTypeParam(next === "ALL" ? "" : next), [setTypeParam]);
  const advanced = useAdvancedSearchFilters();
  const nearby = useSearchNearby();
  const [qParam, setQParam] = useUrlParam("q");
  const [query, setQuery] = useState(qParam);
  const [appliedQuery, setAppliedQuery] = useState(qParam.trim());
  // The place scope. A place is a NAME the reader typed, matched on the
  // device against the place field of a report — the feed RPC has no place
  // filter, and the app must never invent a coordinate for one. The URL
  // carries what the reader typed; only a usable name is ever in force.
  const [placeParam, setPlaceParam] = useUrlParam("place");
  const place = cleanPlace(placeParam);
  // Ordinary and extracted dates share controls and the same URL contract.
  const [dateFromParam, setDateFromParam] = useUrlParam("dateFrom");
  const [dateToParam, setDateToParam] = useUrlParam("dateTo");
  // Each bound is judged on its own: one impossible day must not throw away
  // the other, valid one. Only a reversed range invalidates both.
  const fromParamUsable = !dateFromParam || validDay(dateFromParam);
  const toParamUsable = !dateToParam || validDay(dateToParam);
  const reversedRange = Boolean(
    fromParamUsable && toParamUsable && dateFromParam && dateToParam &&
    dateFromParam > dateToParam,
  );
  const invalidDates = !fromParamUsable || !toParamUsable || reversedRange;
  // The APPLIED bounds. The chips, the filter count and the feed all use
  // these, so a value the feed never received can never be counted as a
  // filter the reader has on.
  const dateFrom = fromParamUsable && !reversedRange ? dateFromParam : "";
  const dateTo = toParamUsable && !reversedRange ? dateToParam : "";
  const [, setSearchParams] = useSearchParams();
  const [clearingFilters, setClearingFilters] = useState(false);
  function clearSearchFilters() {
    nlRequest.current += 1;
    advanced.clearAll();
    setDateFromParam("");
    setDateToParam("");
    setPlaceParam("");
    nearby.clear();
    // The TYPE is a chip in the same row as "Clear filters", so clearing
    // every filter clears it too. A control that sits next to a filter it
    // does not clear is a lie about what it does.
    setType("ALL");
    setClearingFilters(true);
  }
  // Finish a combined clear atomically; independent URL effects must not
  // resurrect a sibling filter from their old rendered location.
  useEffect(() => {
    if (!clearingFilters) return;
    setClearingFilters(false);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ["category", "status", "sort", "dateFrom", "dateTo", "place", "type", "near"]) next.delete(key);
      return next;
    }, { replace: true });
  }, [clearingFilters, setSearchParams]);
  // The extractor reads the settled phrase without altering the literal query.
  const ordinaryQueryRef = useRef(query);
  ordinaryQueryRef.current = query;
  const liveFilters = {
    type,
    place,
    category: advanced.category,
    status: advanced.status,
    dateFrom,
    dateTo,
  };
  const liveFiltersRef = useRef(liveFilters);
  liveFiltersRef.current = liveFilters;
  const filterContext = JSON.stringify([type, place, advanced.category, advanced.status, advanced.sort, dateFrom, dateTo, nearby.feedFilters]);
  const filterContextRef = useRef(filterContext);
  filterContextRef.current = filterContext;
  const nlRequest = useRef(0);
  const lastExtractedPhrase = useRef("");
  useEffect(() => () => { nlRequest.current += 1; }, []);

  async function applyExtractedFilters(text: string) {
    if (nlExtract === undefined || text === "") return;
    const request = ++nlRequest.current;
    // The reader's filters at the moment the question was asked. An answer
    // only writes a field that was empty then and is still empty now, so a
    // choice made while it was in flight is never overwritten.
    const atRequest = { ...liveFiltersRef.current };
    const contextAtRequest = filterContextRef.current;
    // Alive means: this answer still belongs to the words in the field. A
    // newer phrase, a changed field or an unmount drops the answer.
    const alive = () => request === nlRequest.current && ordinaryQueryRef.current.trim() === text;
    try {
      const outcome = asNlExtractOutcome(await nlExtract(text));
      if (!alive() || filterContextRef.current !== contextAtRequest || outcome.kind === "failed") return;
      const patch = outcome.patch;
      const current = liveFiltersRef.current;
      if (patch.postType !== undefined &&
        atRequest.type === "ALL" && current.type === "ALL") setType(patch.postType);
      if (patch.place !== undefined) {
        const extractedPlace = cleanPlace(patch.place);
        if (extractedPlace !== "" && atRequest.place === "" && current.place === "") setPlaceParam(extractedPlace);
      }
      if (patch.category !== undefined && atRequest.category === "" && current.category === "") advanced.setCategory(patch.category);
      if (patch.status !== undefined &&
        atRequest.status === "" && current.status === "") advanced.setStatus(patch.status);
      // A date that is not a real day, or a reversed range, is not a filter.
      const fromReal = patch.dateFrom === undefined || validDay(patch.dateFrom);
      const toReal = patch.dateTo === undefined || validDay(patch.dateTo);
      const reversed =
        patch.dateFrom !== undefined && patch.dateTo !== undefined &&
        fromReal && toReal && patch.dateFrom > patch.dateTo;
      if (fromReal && toReal && !reversed &&
        atRequest.dateFrom === "" && atRequest.dateTo === "" &&
        current.dateFrom === "" && current.dateTo === "") {
        if (patch.dateFrom !== undefined) setDateFromParam(patch.dateFrom);
        if (patch.dateTo !== undefined) setDateToParam(patch.dateTo);
      }
    } catch {
      // Ordinary search already ran; automatic extraction never blocks it.
    }
  }
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreSentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search input ~400ms — do not network-fetch every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setAppliedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // One extraction per settled phrase, with editable filters as the receipt.
  useEffect(() => {
    // An emptied field forgets the phrase: typing it again is a new search.
    if (appliedQuery === "") {
      lastExtractedPhrase.current = "";
      return;
    }
    if (appliedQuery === lastExtractedPhrase.current) return;
    lastExtractedPhrase.current = appliedQuery;
    void applyExtractedFilters(appliedQuery);
    // The extractor reads the live filter context through a ref; re-running
    // it on every filter change would fight the reader's own choices.
  }, [appliedQuery]);

  // Publish the typed phrase to the URL once it settles. It stays the phrase
  // the reader typed, so reopening the link re-derives the same filters.
  useEffect(() => {
    setQParam(appliedQuery);
  }, [appliedQuery, setQParam]);

  const { items, total, loading, loadingMore, error, failedOperation, updatesAvailable, hasMore, refresh, loadMore } = useFeed(
    {
      ...(mineAccountId ? { userId: mineAccountId } : {}),
      type: type === "ALL" ? "" : type,
      category: advanced.category || undefined,
      status: advanced.status || undefined,
      sort: advanced.sort,
      q: appliedQuery || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      ...nearby.feedFilters,
    },
    { cacheKey: "search:feed", scrollRef },
  );
  const lastOperation = useRef<"refresh" | "more">("refresh");
  useEffect(() => { lastOperation.current = "refresh"; }, [refresh]);
  const refreshReports = useCallback(() => {
    lastOperation.current = "refresh";
    return refresh();
  }, [refresh]);
  const loadMoreReports = useCallback(() => {
    lastOperation.current = "more";
    return loadMore();
  }, [loadMore]);

  // The list watches for its own end. The sentinel leaves with the list, so a
  // state change (empty, error) can never keep paginating a hidden surface.
  useEffect(() => {
    const el = moreSentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      // Do not auto-paginate while an append error is showing: the user must
      // press Retry, otherwise the visible button races a background retry.
      if (entries[0]?.isIntersecting && hasMore && !loadingMore && !error) {
        void loadMoreReports();
      }
    }, { rootMargin: "240px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, error, loadMoreReports, items, place]);

  // The place scope is applied ON THE DEVICE: the feed RPC matches the
  // title and the description and has no place filter, so the loaded
  // reports are kept by the place field they carry. The count in the
  // toolbar says how many of the LOADED reports the place kept — it is
  // never paired with the feed's own total, because the place cannot
  // narrow that total and the pair would claim more than the reader can
  // see. More pages may hold more reports in the place; the count grows
  // with them, so the line says "loaded", never a total.
  const placeInForce = place !== "";
  const visibleItems = placeInForce
    ? items.filter(item => matchesPlace(item.locationLabel, place))
    : items;
  // The feed itself found nothing: no report matches the words and filters.
  const feedEmpty = items.length === 0 && !loading && !error;
  // The feed found reports, but none of them carries the place.
  const placeEmpty = items.length > 0 && placeInForce && visibleItems.length === 0 && !loading;

  // Active Search tab tap: rerun current filters + scroll top, preserve filters.
  // Smooth normally, instant when the OS prefers reduced motion.
  useEffect(() => {
    if (tapCount === 0) return;
    void refreshReports();
    scrollRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [tapCount, refreshReports, reduceMotion]);

  const filterPanel = <AdvancedSearchFilters compactTrigger
    filters={{ ...advanced, clearAll: clearSearchFilters }}
    additionalControls={<SearchNearbyControls nearby={nearby} />}
    additionalFilters={nearby.active ? [{ key: "nearby", label: `Nearby: ${nearby.radius} km`, clear: nearby.clear }] : []}
    dateRange={{ from: dateFrom, to: dateTo,
      draftFrom: validDay(dateFromParam) ? dateFromParam : dateFrom,
      draftTo: validDay(dateToParam) ? dateToParam : dateTo,
      onFromChange: setDateFromParam, onToChange: setDateToParam,
    }}
    postType={{ value: type === "ALL" ? "" : type, onChange: next => setType(next === "" ? "ALL" : next) }}
    place={{ value: placeParam, applied: place, onChange: setPlaceParam }}
  />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AppBar
        title={mineAccountId ? "Search my reports" : "Search"}
        // The count is route chrome, not a second heading row. At 320dp the
        // bar drops the subtitle by its own container rule and the list still
        // carries the answer.
        subtitle={!loading && (!error || items.length > 0) ? (
          <span role="status">
            {placeInForce
              ? `${visibleItems.length} matching report${visibleItems.length === 1 ? "" : "s"} loaded for ${place}`
              : `${total} result${total === 1 ? "" : "s"}`}
          </span>
        ) : undefined}
        backTo="/"
        backLabel="Back"
        utilities={false}
      />

      {/* One inset for the whole route: the bar's own 12px, the search field
          and every result row share the SAME left edge, so the header title,
          the pill's border and the row's photo start on one line at every
          width. Nothing is centred in a canvas. */}
      <div className="fb-search-canvas flex flex-col gap-2 pb-2 pt-2" data-testid="search-toolbar">
        {/* One search field for this screen. Everything that narrows the feed
            except the words lives behind the filter trigger, including the
            LOST/FOUND type (owner order 2026-11-14). Smart filters run
            automatically from the same words; the chips are the receipt. */}
        <div className="fb-search-row">
          <SearchField
            value={query}
            onChange={setQuery}
            ariaLabel="Search posts"
            placeholder="Search title or description…"
            inputRef={searchInputRef}
            onClear={() => setQuery("")}
          />
          {filterPanel}
        </div>

        {invalidDates && <p role="alert" className="text-sm text-error">Choose a valid date range: use real days, with the start date on or before the end date.</p>}
      </div>

      {/* The results keep a floor of their own. The column above is bounded so
          it can never be taller than the screen, but a bound that eats the
          whole screen would leave the reader with a sliver of a list and no
          way to tell an empty search from a broken one. The floor holds the
          list at a usable height, and the column gives up the difference. */}
      <div ref={scrollRef} data-testid="search-results-scroller" className="min-h-[4rem] flex-1 overflow-y-auto">
        <div className="fb-search-canvas fb-search-results">
        <NewPostsPill count={0} hasUpdates={updatesAvailable} onTap={() => { void refreshReports(); scrollRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); }} />
        {feedEmpty || placeEmpty ? (
          <EmptyState
            compact
            icon={<Search size={16} aria-hidden />}
            title={placeEmpty ? hasMore ? "No matching reports loaded yet" : `No report in ${place} yet` : "No matches"}
            subtitle={
              placeEmpty
                ? error && lastOperation.current === "more"
                  ? "Couldn't load more reports. Try again."
                  : error
                    ? "Couldn't refresh reports. Try again."
                  : hasMore
                  ? "Try another place, or load more reports."
                  : "Try another place."
                : "Try different filters or a broader search."
            }
            action={
              placeEmpty && error
                ? lastOperation.current === "more"
                  ? { label: "Retry loading more reports", onPress: () => void loadMoreReports() }
                  : { label: "Retry", onPress: () => void refreshReports() }
                : placeEmpty && hasMore
                  ? { label: "Show more reports", onPress: () => void loadMoreReports() }
                  : undefined
            }
          />
        ) : loading && visibleItems.length === 0 ? (
          <SearchResultSkeleton />
        ) : error && visibleItems.length === 0 ? (
          <EmptyState
            compact
            icon={<Search size={16} aria-hidden />}
            title="Could not load"
            subtitle={error}
            action={{ label: "Try again", onPress: () => void refreshReports() }}
          />
        ) : (
          <>
            {error && (
              <div className="fb-search-result-banner" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => void (failedOperation === "loadMore" ? loadMoreReports() : refreshReports())}
                >
                  Retry
                </button>
              </div>
            )}
            <ul className="fb-search-result-list" aria-label="Search results">
              {visibleItems.map(item => <li key={item.id}><SearchResultRow post={item} /></li>)}
            </ul>
            <div ref={moreSentinelRef} aria-hidden />
            {loadingMore && <p className="fb-search-result-note" role="status">Loading more…</p>}
            {hasMore && !loadingMore && !error && <button type="button" className="fb-surface-button" onClick={() => void loadMoreReports()}>Show more reports</button>}
            {!hasMore && visibleItems.length > 0 && <p className="fb-search-result-note">You are all caught up.</p>}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * One result. The report's own photo is a small squircle beside the title (the
 * same shape language as an avatar), so the row reads from one left edge with
 * the search field instead of starting inside a centred card. The one shared
 * `ReportPhotoPreview` hover card stays anchored to this row.
 */
function SearchResultRow({ post }: { post: PostItem }) {
  return <ReportPhotoPreview post={post}>
    <PostLink to={`/posts/${post.id}`} className="fb-search-result-row" data-testid="search-result-row">
      <SearchResultThumb post={post} />
      <span className="fb-search-result-copy">
        <span className="fb-search-result-title">{post.title}</span>
        <span className="fb-search-result-meta">
          {post.type === "LOST" ? "Lost" : "Found"} · {statusLabel(post.status)} ·{" "}
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{timeAgo(post.createdAt)}</time>
        </span>
      </span>
    </PostLink>
  </ReportPhotoPreview>;
}

/**
 * The row's photo, resolved through the same private-media path as every other
 * report image. The box keeps its geometry while a key is being signed, when
 * a report has no photo, and after a failed load, so the row never shifts.
 */
function SearchResultThumb({ post }: { post: PostItem }) {
  const image = post.attachments.find(item => item.mimeType.startsWith("image/"));
  const src = useMediaUrl(image?.fileUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = image !== undefined && failedUrl === image.fileUrl;
  const state = !image ? "none" : failed ? "failed" : src ? "ready" : "loading";
  return <span className="fb-search-result-thumb fb-avatar-squircle" data-testid="search-result-thumb" data-state={state} aria-hidden="true">
    {image && src && !failed
      ? <img src={src} alt="" width={36} height={36} loading="lazy" onError={() => setFailedUrl(image.fileUrl)} />
      : !image || failed ? <ImageOff size={16} aria-hidden="true" /> : null}
  </span>;
}

/** Three rows of the shape the results are about to take: no layout jump. */
function SearchResultSkeleton() {
  return <div className="fb-search-result-skeleton" role="status" aria-label="Loading posts">
    {[0, 1, 2].map(index => <div key={index} className="fb-search-result-skeleton-row" aria-hidden="true">
      <span className="fb-search-result-skeleton-thumb" />
      <span className="fb-search-result-skeleton-copy">
        <span className="fb-search-result-skeleton-line is-title" />
        <span className="fb-search-result-skeleton-line is-meta" />
      </span>
    </div>)}
  </div>;
}
