import { useEffect, useRef, useState } from "react";
import { HomeTopBar } from "./HomeTopBar";
import { toggleGlobalSearch } from "../components/globalSearch";
import { TopUtilities } from "../components/TopUtilities";
import { PostList } from "../components/PostList";
import { MASONRY_CANVAS_CLASS, READABLE_COLUMN_CLASS, feedDensity, masonryColumns, resolveFeedLayout, useContentWidth, useViewportWidth } from "../components/responsive";
import { useFeedLayoutPreference } from "../services/feedLayoutPreference";
import { PullToRefresh, type PullToRefreshHandle } from "../components/PullToRefresh";
import { NewPostsPill } from "../components/NewPostsPill";
import { useFeed } from "../hooks/useFeed";
import { FeedLoveProvider } from "../hooks/useFeedLove";
import { useUrlParam } from "../hooks/useUrlParam";
import { onRealtime } from "../services/realtime";
import { reactionCountsFromJson } from "../services/reactions";
import { useTabTap } from "../components/TabTap";
import { buildFeedCacheKey, clearNewPostCount, getNewPostCount, incrementNewPostCount } from "../hooks/feedCache";
import { AdvancedSearchFilters, useAdvancedSearchFilters } from "./AdvancedSearchFilters";
import type { FeedFilters } from "../services/posts";
import { useShouldReduceMotion } from "../components/uiMotion";
import { registerBackInterceptor } from "../components/backNavigation";

const HOME_CACHE_KEY = "home:feed";

/**
 * A tab re-tap refreshes only when the feed is still at the top. The bar now
 * scrolls away with the feed, so "at the top" is the same test as before: the
 * scroller has not left its first few pixels.
 */
const CHROME_TOP_ZONE = 24;

export function Home() {
  const { tapCount } = useTabTap();
  // Imperative travel (scroll-to-top) cannot see MotionConfig — collapse to
  // instant when the app's effective preference says so. The hook (not the
  // plain reader) keeps this value live when the reader flips the in-app
  // Reduce switch while Home is mounted.
  const reduceMotion = useShouldReduceMotion();

  // CF-010 §6/§23: the stored layout preference resolved against this viewport.
  // Resolution depends on the width *band*, so a few pixels of movement (a
  // scrollbar appearing, a keyboard opening) cannot re-lay-out the feed.
  const { layout: feedLayout } = useFeedLayoutPreference();
  const viewportWidth = useViewportWidth();
  const resolvedLayout = resolveFeedLayout(feedLayout, viewportWidth);
  // Wide canvas for the ragged grid (photographs want width); a readable column
  // for the single-column layouts, so a desktop window does not stretch titles
  // to absurd line lengths. Both are centred, so no phone-width strip survives.
  const canvasClass = resolvedLayout === "masonry" ? MASONRY_CANVAS_CLASS : READABLE_COLUMN_CLASS;
  // The feed's column count follows the box the feed actually gets, not the
  // viewport: with the side rail on, the rail takes 6.5rem out of this row and
  // a viewport-based count would drop cards under their 260px floor. Measured
  // (not computed from a rail constant) so it stays right at every text scale.
  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedWidth = useContentWidth(feedRef, viewportWidth);
  // Search and scope survive in the URL so back-nav, deep-links, and copied
  // links restore the feed the reader was looking at. Post type is no longer a
  // Home dimension: search owns typed filtering, and the old All/Lost/Found
  // chips duplicated it.
  const [qParam, setQParam] = useUrlParam("q");
  const [query, setQuery] = useState(qParam);
  const [appliedQuery, setAppliedQuery] = useState(qParam.trim());
  // Search activation: the field rests as a compact affordance and expands
  // into its active state on focus/input; clear/cancel collapse it back.
  const [searchFocused, setSearchFocused] = useState(false);
  /**
   * Whether the *text field* has DOM focus, as opposed to the row being
   * engaged. Close, Clear and Filters live inside the row, so tabbing to them
   * keeps `searchFocused` true while the field is no longer focused, and
   * Android Back must follow the field (review HOME-SCROLL-FIXFORWARD-R2
   * MINOR-1). A ref, not state: this is only read when Back is pressed, and a
   * state update on every focus change would re-render the animated row while
   * the browser is moving focus into it.
   */
  const searchFieldFocused = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchActive = searchFocused || query.length > 0;
  const advanced = useAdvancedSearchFilters();
  // Discovery scope (Nearby, Open, Recent) belongs to search now. Home keeps
  // only the filters a shared URL can restore; it has no second scope row.

  const feedFilters: FeedFilters = {
    q: appliedQuery || undefined,
    category: advanced.category || undefined,
    status: advanced.status || undefined,
    sort: advanced.sort,
  };
  const scopedCacheKey = buildFeedCacheKey(HOME_CACHE_KEY, feedFilters);
  const [newPostCount, setNewPostCount] = useState(() => getNewPostCount(scopedCacheKey));
  const [hasUpdates, setHasUpdates] = useState(false);
  const scrollRef = useRef<PullToRefreshHandle>(null);

  // The app bar is part of the feed's own scroll.
  // It used to sit outside the scroller and animate its height away on a timer,
  // which reflowed the feed under the reader's finger (the reported yank). It
  // now scrolls out with the content at exactly the speed the reader scrolls
  // and returns the moment they reverse, so nothing ever changes the feed's
  // geometry. `chromePinned` therefore has nothing left to pin.

  // Debounce the search box so each keystroke does not hit the API.
  useEffect(() => {
    const t = setTimeout(() => setAppliedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Publish the applied query to the URL once it settles.
  useEffect(() => {
    setQParam(appliedQuery);
  }, [appliedQuery, setQParam]);

  const { items, loading, refreshing, loadingMore, error, failedOperation, updatesAvailable, hasMore, refresh, loadMore, removeItem, patchItem } = useFeed(
    feedFilters,
    { cacheKey: HOME_CACHE_KEY, scrollRef },
  );

  // Active Home tab tap (CF-010 §5): a tap from partway down the feed returns
  // the reader to the top; a tap already at the top is a refresh request. A tap
  // must not cost a network round trip merely to get back to the top, and a
  // tap at the top must not leave a stale feed.
  // Smooth normally, instant under reduced motion. Scroll restore after Post
  // Detail comes from the useFeed session cache (items + scrollTop survive
  // unmount); mounting here never replays card entrances — no list animation is
  // owned by this file.
  //
  // `tapCount` is a monotonic session counter that lives above the route
  // outlet, so it outlives this screen. Consuming it as a one-shot (the ref
  // starts at the count this mount saw, and only a *higher* count acts) is what
  // stops the tap from being replayed by everything else that re-runs this
  // effect: a remount (Post Detail → Back, which must keep the restored scroll
  // position) and a scope change (scope chip, category, status, sort, debounced
  // query — `refresh`/`scopedCacheKey` change identity on all of them).
  const handledTapRef = useRef(tapCount);
  useEffect(() => {
    if (tapCount === handledTapRef.current) return;
    handledTapRef.current = tapCount;
    const atTop = (scrollRef.current?.scrollTop ?? 0) <= CHROME_TOP_ZONE;
    if (atTop) void refresh();
    scrollRef.current?.scrollToTop(reduceMotion ? "auto" : "smooth");
    setNewPostCount(0);
    setHasUpdates(false);
    clearNewPostCount(scopedCacheKey);
  }, [tapCount, refresh, scopedCacheKey, reduceMotion]);

  // Live: only new inserts increment new-posts; else show Updates. Never yank scroll.
  useEffect(() => {
    const off = onRealtime("feed:changed", (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const change =
        typeof p.change === "string"
          ? p.change.toUpperCase()
          : typeof p.op === "string"
            ? p.op.toUpperCase()
            : typeof p.type === "string"
              ? p.type.toUpperCase()
              : null;
      // Only a genuine INSERT is a new post. Comment/reaction/rating triggers
      // broadcast feed:changed with a non-INSERT change kind.
      const isInsert = change === "INSERT" || p.isNew === true;
      const scrolled = (scrollRef.current?.scrollTop ?? 0) > 40;
      if (!isInsert) {
        if (!scrolled) void refresh();
        else setHasUpdates(true);
        return;
      }

      // Prove filter membership from the broadcast metadata. When an active
      // search query or advanced filter makes membership unprovable, show
      // generic Updates.
      const matchesFilter = !appliedQuery && !advanced.category && !advanced.status;
      if (scrolled) {
        if (matchesFilter) {
          incrementNewPostCount(scopedCacheKey, 1);
          setNewPostCount(getNewPostCount(scopedCacheKey));
        } else {
          setHasUpdates(true);
        }
      } else {
        void refresh();
      }
    });
    return off;
  }, [refresh, scopedCacheKey, appliedQuery, advanced.category, advanced.status]);

  // A post was deleted: reconcile it in place. Never refetch here — a full
  // refresh would rerender/reorder the list underneath a scrolled reader.
  useEffect(() => {
    const off = onRealtime("post:deleted", (payload) => {
      const postId = (payload as { postId?: unknown })?.postId;
      if (typeof postId === "string") removeItem(postId);
    });
    return off;
  }, [removeItem]);

  // Live reaction counts: patch the affected feed card in place (legacy
  // buckets + per-kind summary). Comment broadcasts target comment rows on
  // PostDetail — the feed shows no comment rows, so they are ignored here.
  // The caller's own reaction is preserved from the cached item: the
  // broadcast carries counts only, never my_reaction. Never refetch here.
  useEffect(() => {
    const off = onRealtime("reaction:changed", (payload) => {
      const p = (payload ?? {}) as {
        postId?: unknown;
        commentId?: unknown;
        likeCount?: unknown;
        dislikeCount?: unknown;
        reactionCounts?: unknown;
      };
      if (typeof p.postId !== "string" || typeof p.commentId === "string") return;
      const counts = reactionCountsFromJson(p.reactionCounts);
      const total = Object.values(counts).reduce<number>((s, n) => s + (n ?? 0), 0);
      patchItem(p.postId, (prev) => ({
        ...(typeof p.likeCount === "number" ? { likeCount: p.likeCount } : {}),
        ...(typeof p.dislikeCount === "number" ? { dislikeCount: p.dislikeCount } : {}),
        ...(p.reactionCounts === undefined
          ? {}
          : {
              reactionSummary: {
                counts,
                total,
                myReaction: prev.reactionSummary?.myReaction ?? null,
              },
            }),
      }));
    });
    return off;
  }, [patchItem]);

  useEffect(() => {
    setNewPostCount(getNewPostCount(scopedCacheKey));
    setHasUpdates(false);
  }, [scopedCacheKey]);

  function onNewPostsTap() {
    void refresh();
    scrollRef.current?.scrollToTop(reduceMotion ? "auto" : "smooth");
    setNewPostCount(0);
    setHasUpdates(false);
    clearNewPostCount(scopedCacheKey);
  }

  // The bar no longer needs a scroll listener: it is part of the scroller, so
  // the browser moves it. Nothing here reacts per pixel, nothing here can
  // reflow the feed.
  function collapseSearch() {
    setQuery("");
    setSearchFocused(false);
    searchFieldFocused.current = false;
    searchInputRef.current?.blur();
  }

  /**
   * The magnifier opens the app's one search overlay,
   * never a resident field: search is not a destination, and the feed keeps its
   * geometry. A `?q=` URL still shows the active filter below.
   */
  function openSearch(trigger: HTMLButtonElement) {
    toggleGlobalSearch(trigger);
  }

  useEffect(() => {
    if (searchFocused) searchInputRef.current?.focus();
  }, [searchFocused]);

  // Android Back closes an open, focused field instead of navigating. The
  // interceptor is only armed while the field has focus: a typed-but-unfocused
  // query is a browsing filter by then, and Back must keep its navigation
  // meaning rather than silently discard it.
  useEffect(
    () =>
      registerBackInterceptor(() => {
        if (!searchFieldFocused.current) return false;
        searchFieldFocused.current = false;
        setQuery("");
        setSearchFocused(false);
        searchInputRef.current?.blur();
        return true;
      }),
    [],
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* The bar is inside the feed's own scroll.
          It leaves at exactly the speed the reader scrolls and comes back the
          moment they reverse — no timer, no height animation, so the feed's
          geometry never changes under the finger. That is the whole fix for
          the reported drag/yank. The new-posts pill stays outside the scroller
          (it is viewport chrome, not feed content). */}
      <PullToRefresh ref={scrollRef} onRefresh={refresh} disabled={loading || refreshing} className="fb-home-feed flex-1">
        <div className="flex flex-col gap-4">
          <header data-testid="home-toolbar" className="pt-5">
            <div className={`${canvasClass} px-4`}>
            <HomeTopBar
              utilities={<TopUtilities showSearch={false} />}
              expanded={searchActive}
              query={query}
              onQueryChange={setQuery}
              onOpen={openSearch}
              onClear={() => setQuery("")}
              onClose={collapseSearch}
              onFocus={() => {
                searchFieldFocused.current = true;
                setSearchFocused(true);
              }}
              onFieldBlur={() => {
                searchFieldFocused.current = false;
              }}
              onBlur={() => {
                searchFieldFocused.current = false;
                setSearchFocused(false);
              }}
              inputRef={searchInputRef}
            />
            </div>
          </header>

          {/* UXN-2: batch-hydrated Love state + optimistic feed-cache patching.
              PostList itself is untouched — the provider flows state to each
              home-feed card's Love toggle via context. */}
          <FeedLoveProvider items={items} patchItem={patchItem}>
            <div className={canvasClass} ref={feedRef} data-testid="home-feed-canvas">
              <PostList
                items={items}
                loading={loading}
                loadingMore={loadingMore}
                error={error}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onRetry={refresh}
                failedOperation={failedOperation}
                density={feedDensity(resolvedLayout)}
                masonryColumns={masonryColumns(feedWidth)}
                emptyTitle={appliedQuery || advanced.category || advanced.status ? "No matches" : "Nothing here yet"}
                emptySubtitle={
                  advanced.category || advanced.status
                    ? "Try different filters or a broader search."
                    : appliedQuery
                      ? `No posts match “${appliedQuery}”.`
                      : "Tap Create report to post a lost or found item."
                }
              />
            </div>
          </FeedLoveProvider>
        </div>
      </PullToRefresh>

      <AdvancedSearchFilters
        filters={advanced}
        hideTrigger
        hideSheet
      />

      <NewPostsPill count={newPostCount} hasUpdates={hasUpdates || updatesAvailable} onTap={onNewPostsTap} overlay />

    </div>
  );
}
