// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFeedMock, handlers, onRealtimeMock, tabTapState } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    fetchFeedMock: vi.fn(),
    handlers,
    tabTapState: { tapCount: 0 },
    onRealtimeMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => handlers.get(event)?.delete(handler);
    }),
  };
});

vi.mock("../services/posts", () => ({ fetchFeed: fetchFeedMock }));
vi.mock("../services/realtime", () => ({ onRealtime: onRealtimeMock }));
vi.mock("../services/people", () => ({ searchPeople: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) }));
vi.mock("../auth", () => {
  // One stable identity: the overlay keys its requests off the account id, and
  // a fresh object on every render would also churn every consumer.
  const user = { id: "u1", username: "tester" };
  return { useAuth: () => ({ user }) };
});
vi.mock("../components/TabTap", () => ({ useTabTap: () => tabTapState }));
vi.mock("../components/PostList", () => ({
  PostList: ({ items, error, emptySubtitle, onRetry, masonryColumns }: { items: Array<{ id: string }>; error: string | null; emptySubtitle: string; onRetry: () => Promise<void>; masonryColumns?: number }) => (
    <div>
      <span data-testid="post-columns">{masonryColumns}</span>
      {error ? <><p role="alert">{error}</p><button onClick={() => void onRetry()}>Try again</button></> : null}
      {!error && items.length === 0 ? <p>{emptySubtitle}</p> : null}
      <ul data-testid="posts">{items.map((i) => <li key={i.id}>{i.id}</li>)}</ul>
    </div>
  ),
}));

import { Home } from "./Home";
import { GlobalSearchOverlay } from "../components/GlobalSearchOverlay";
import { resetGlobalSearch } from "../components/globalSearch";
import { buildFeedCacheKey, clearFeedCaches, saveFeedCache } from "../hooks/feedCache";
import { consumeBackIntercept, resetBackInterceptors } from "../components/backNavigation";
import { ringOutcome } from "../test-utils/focusRingCascade";

function emit(event: string, payload: unknown) {
  for (const handler of handlers.get(event) ?? []) handler(payload);
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderHome(entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Home />
      <GlobalSearchOverlay />
      <LocationProbe />
    </MemoryRouter>,
  );
}

afterEach(() => resetGlobalSearch());

/**
 * The inline field only renders when a query is restored from the URL: a
 * shared link must show its active filter. The magnifier itself opens the
 * app-wide search overlay (owner order 2026-11-13), so typing tests either
 * start from `/?q=…` or drive the overlay's own field.
 */

describe("Home realtime", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
    onRealtimeMock.mockClear();
    handlers.clear();
    tabTapState.tapCount = 0;
    clearFeedCaches();
    fetchFeedMock.mockResolvedValue({
      items: ["a", "b", "c"].map((id) => ({ id, title: id })),
      nextCursor: null,
      total: 3,
    });
  });

  afterEach(() => {
    cleanup();
    clearFeedCaches();
    resetBackInterceptors();
  });

  it("reconciles a deleted post in place without refetching", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    fetchFeedMock.mockClear();

    act(() => emit("post:deleted", { postId: "b", op: "DELETE" }));

    expect(screen.queryByText("b")).toBeNull();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(fetchFeedMock).not.toHaveBeenCalled();
  });

  it("refreshes an invalidated scope-filtered feed at the top", async () => {
    renderHome("/?status=OPEN");
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    await waitFor(() =>
      expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ status: "OPEN" }), undefined),
    );
    fetchFeedMock.mockClear();

    act(() => emit("feed:changed", { invalidate: true }));

    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/new post/i)).toBeNull();
    expect(screen.queryByText(/^updates$/i)).toBeNull();
  });

  it("refreshes an invalidated unfiltered feed at the top", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());

    fetchFeedMock.mockClear();

    act(() =>
      emit("feed:changed", { invalidate: true }),
    );

    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledTimes(1));
  });

  it("shows Updates, not a count, when a search query makes membership unprovable", async () => {
    // A query in force is enough: the overlay is the entry point now, but a
    // shared `?q=` link must behave exactly as before.
    const { container } = renderHome("/?q=wallet");
    await waitFor(() =>
      expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "wallet" }), undefined),
    );
    expect(await screen.findByText("b")).toBeTruthy();

    // Scroll the reader down, then receive an invalidation.
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).toBeTruthy();
    (scroller as HTMLElement).scrollTop = 100;

    act(() =>
      emit("feed:changed", { invalidate: true }),
    );

    expect(await screen.findByRole("button", { name: "Updates — tap to refresh" })).toBeTruthy();
    expect(screen.queryByText(/new post/i)).toBeNull();
  });

  it("keeps the app bar inside the feed's own scroll", async () => {
    const { container } = renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    const toolbar = screen.getByTestId("home-toolbar");

    // Owner feedback 2026-11-06: the bar must leave at exactly the reader's
    // scroll speed. That is only true when the browser moves it as part of the
    // scroll, so it has to be a child of the feed's scroller — not a fixed row
    // reacting to a timer, which reflowed the feed under the finger.
    expect(scroller.contains(toolbar)).toBe(true);
    // The brand row is the first thing in the scroll, so the feed starts below
    // it at rest and there is no gap to close.
    expect(scroller.firstElementChild?.firstElementChild).toBe(toolbar);

    for (const top of [12, 30, 75, 140, 460]) {
      scroller.scrollTop = top;
      fireEvent.scroll(scroller);
    }

    // Nothing about the bar changes with scroll: no collapse state, no inert
    // row, no height transition of its own.
    expect(screen.getByTestId("home-toolbar")).toBe(toolbar);
    expect(toolbar.hasAttribute("inert")).toBe(false);
    expect(toolbar.getAttribute("data-collapsed")).toBeNull();
    expect(toolbar.className).not.toContain("shrink-0");
    // The bar holds no brand unit any more (it lives in the sidebar), so there
    // is no collapse stage to test: the whole bar still leaves and returns with
    // the content and never resizes on its own.
    expect(container.querySelector('[data-testid="home-brand-wordmark"]')).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Norfold" })).toBeTruthy();

    // Scrolling back up is the same mechanism in reverse — the row was never
    // unmounted, so it returns with the content.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(scroller.contains(screen.getByTestId("home-toolbar"))).toBe(true);
  });

  it("opens the app-wide search overlay without moving the feed", async () => {
    const { container } = renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;

    // Part-way through: the bar is on its way out at the reader's own speed.
    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);

    // Search is a floating overlay: it does not need the bar back on screen,
    // so the feed keeps the reader's position.
    fireEvent.click(screen.getByTestId("home-search-open"));
    const overlay = await screen.findByRole("search");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(overlay).getByRole("searchbox", { name: "Search reports, messages and people" })),
    );
    expect(scroller.scrollTop).toBe(40);
  });

  it("ignores a legacy type parameter instead of stranding a filtered feed", async () => {
    // The All/Lost/Found chips are gone (owner order 2026-11-13). A copied or
    // bookmarked `?type=LOST` link must not leave the reader on a filtered feed
    // with no control to clear it.
    renderHome("/?type=LOST");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
    for (const [filters] of fetchFeedMock.mock.calls) {
      expect(filters).not.toHaveProperty("type");
    }
    expect(screen.queryByRole("radio", { name: "Lost" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "All" })).toBeNull();
    expect(screen.getByText("b")).toBeTruthy();
  });

  it("restores the search query from the URL on mount", async () => {
    renderHome("/?q=wallet");
    expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("wallet");
    await waitFor(() =>
      expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "wallet" }), undefined),
    );
  });

  it("keeps Home's URL and feed untouched while the search overlay is used", async () => {
    renderHome("/?status=OPEN");
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    expect(screen.getByTestId("location").textContent).toBe("/?status=OPEN");

    // The magnifier opens the shared overlay; typing there never rewrites the
    // Home URL or the feed underneath.
    fireEvent.click(screen.getByTestId("home-search-open"));
    const overlay = await screen.findByRole("search");
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    expect(screen.getByTestId("location").textContent).toBe("/?status=OPEN");
  });

  it("restores Home advanced filters and clears them without dropping q", async () => {
    renderHome("/?q=phone&category=Electronics&status=OPEN&sort=oldest");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "phone", category: "Electronics", status: "OPEN", sort: "oldest" }), undefined,
    ));
    fireEvent.click(screen.getByRole("button", { name: "Remove category filter: Electronics" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove status filter: Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove sort filter: Oldest first" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/?q=phone"));
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: "phone", category: undefined, status: undefined, sort: "newest" }), undefined,
    ));
  });

  it("offers Create report on the unfiltered empty feed", async () => {
    fetchFeedMock.mockResolvedValueOnce({ items: [], nextCursor: null, total: 0 });
    renderHome();
    expect(await screen.findByText(/Tap Create report/)).toBeTruthy();
  });

  it("suggests broader search when advanced filters find no results", async () => {
    fetchFeedMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    renderHome("/?category=Electronics&status=OPEN");
    expect(await screen.findByText("Try different filters or a broader search.")).toBeTruthy();
  });

  it("preserves retry on an empty-feed error", async () => {
    fetchFeedMock.mockRejectedValueOnce(new Error("network down"));
    renderHome();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledTimes(2));
  });

  it("restores filtered results from the detail-to-Home session cache", async () => {
    const entry = "/?category=Electronics&status=OPEN&sort=oldest&q=wallet";
    saveFeedCache(buildFeedCacheKey("home:feed", {
      category: "Electronics", status: "OPEN", sort: "oldest", q: "wallet",
    }), { items: [{ id: "cached", title: "Cached result" }] as never, total: 1, cursor: null, scrollTop: 0 });
    renderHome(entry);
    expect(await screen.findByText("cached")).toBeTruthy();
    expect(fetchFeedMock).not.toHaveBeenCalled();
  });

  it("clears a URL-restored query from the inline filter field", async () => {
    renderHome("/?q=wallet");
    const field = screen.getByLabelText("Search posts") as HTMLInputElement;
    expect(field.value).toBe("wallet");
    expect(screen.getByRole("button", { name: "Close search" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(field.value).toBe("");
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("q="));
  });

  it("closing the inline filter field collapses it and drops the query", async () => {
    renderHome("/?q=wallet");
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(screen.queryByLabelText("Search posts")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("q="));
  });

  it("re-tapping the active Home tab at the top refreshes and scrolls smoothly", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    try {
      const { rerender } = renderHome();
      await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
      fetchFeedMock.mockClear();

      tabTapState.tapCount = 1;
      rerender(
        <MemoryRouter initialEntries={["/"]}>
          <Home />
          <LocationProbe />
        </MemoryRouter>,
      );

      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledTimes(1));
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it("re-tapping the active Home tab at the top scrolls instantly under reduced motion", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    try {
      const { rerender } = renderHome();
      await waitFor(() => expect(screen.getByText("b")).toBeTruthy());

      tabTapState.tapCount = 1;
      rerender(
        <MemoryRouter initialEntries={["/"]}>
          <Home />
          <LocationProbe />
        </MemoryRouter>,
      );

      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" }));
    } finally {
      window.matchMedia = originalMatchMedia;
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it("restores the cached scroll position on return without refetching", async () => {
    saveFeedCache(buildFeedCacheKey("home:feed", { type: "", sort: "newest" }), {
      items: [{ id: "cached", title: "Cached result" }] as never,
      total: 1,
      cursor: null,
      scrollTop: 200,
    });
    const { container } = renderHome();
    expect(await screen.findByText("cached")).toBeTruthy();
    expect(fetchFeedMock).not.toHaveBeenCalled();

    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).toBeTruthy();
    await waitFor(() => expect((scroller as HTMLElement).scrollTop).toBe(200));
  });

  it("saves the reader's place on the way to Post Detail and restores it on return", async () => {
    // The save half of the pair above. React detaches the scroll ref before the
    // hook's unmount cleanup runs, so this failed in the product (the cache got
    // scrollTop 0) while the seeded test above stayed green.
    const first = renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    const scroller = first.container.querySelector(".fb-home-feed") as HTMLElement;
    scroller.scrollTop = 240;
    // jsdom does not fire a scroll event on assignment; the real container does.
    fireEvent.scroll(scroller);
    first.unmount();

    fetchFeedMock.mockClear();
    const second = renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    const restored = second.container.querySelector(".fb-home-feed") as HTMLElement;
    await waitFor(() => expect(restored.scrollTop).toBe(240));
    expect(fetchFeedMock).not.toHaveBeenCalled();
  });

  it("shows the updates pill when scrolled and removes it cleanly on tap", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    try {
      const { container } = renderHome();
      await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
      expect(screen.queryByText(/new post/i)).toBeNull();

      const scroller = container.querySelector(".overflow-y-auto");
      expect(scroller).toBeTruthy();
      (scroller as HTMLElement).scrollTop = 100;

      act(() =>
        emit("feed:changed", { invalidate: true }),
      );
      expect(await screen.findByRole("button", { name: "Updates — tap to refresh" })).toBeTruthy();

      // A second invalidation remains an update, not a new-post count.
      act(() =>
        emit("feed:changed", { invalidate: true }),
      );
      expect(await screen.findByRole("button", { name: "Updates — tap to refresh" })).toBeTruthy();
      expect(screen.getByText("a")).toBeTruthy();

      fetchFeedMock.mockClear();
      fireEvent.click(screen.getByRole("button", { name: /tap to refresh/i }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledTimes(1));
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      await waitFor(() => expect(screen.queryByRole("button", { name: "Updates — tap to refresh" })).toBeNull());
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

});

describe("Home brand and search affordances", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
    onRealtimeMock.mockClear();
    handlers.clear();
    tabTapState.tapCount = 0;
    clearFeedCaches();
    fetchFeedMock.mockResolvedValue({
      items: ["a", "b", "c"].map((id) => ({ id, title: id })),
      nextCursor: null,
      total: 3,
    });
  });

  afterEach(() => {
    cleanup();
    clearFeedCaches();
    resetBackInterceptors();
  });

  function renderAndWait() {
    const rendered = renderHome();
    return waitFor(() => expect(screen.getByText("b")).toBeTruthy()).then(() => rendered);
  }

  it("keeps the brand in the sidebar, not on the feed bar", async () => {
    await renderAndWait();

    // Owner feedback 2026-11-13: the mark and wordmark now live in the sidebar,
    // so a second copy in the feed bar was duplicate chrome. The screen keeps
    // its heading for assistive tech without drawing a second brand row.
    expect(screen.queryByTestId("home-brand")).toBeNull();
    expect(screen.queryByRole("button", { name: /scroll the feed to the top/i })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Norfold" })).toBeTruthy();
  });

  it("returns a scrolled reader to the top on a tab tap without a network refresh", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    try {
      const { container, rerender } = await renderAndWait();
      const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
      scroller.scrollTop = 400;
      fetchFeedMock.mockClear();

      tabTapState.tapCount = 1;
      rerender(
        <MemoryRouter initialEntries={["/"]}>
          <Home />
          <LocationProbe />
        </MemoryRouter>,
      );

      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" }));
      // Getting back to the top is not a refresh request.
      expect(fetchFeedMock).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  // `tapCount` lives above the route outlet and never resets, so the effect that
  // serves a tap must consume it once. These two tests are the ones the suite
  // was missing: they mount with a tap already recorded, which is what a
  // remount sees, and they change the feed scope, which is what a chip tap
  // does.
  it("does not replay the last tab tap when Home remounts (Post Detail → Back)", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    try {
      // The reader tapped the active Home tab once, and that mount served it.
      tabTapState.tapCount = 1;
      const first = await renderAndWait();
      first.unmount();
      scrollTo.mockClear();
      fetchFeedMock.mockClear();

      await renderAndWait();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A round trip to a post keeps the restored scroll position and its cached
      // feed: no jump to the top and no refetch.
      expect(scrollTo).not.toHaveBeenCalled();
      expect(fetchFeedMock).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it("does not rewind the reader when the feed scope changes after a tap", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    try {
      const { rerender } = renderHome("/?status=OPEN");
      await waitFor(() => expect(screen.getByText("b")).toBeTruthy());

      tabTapState.tapCount = 1;
      rerender(
        <MemoryRouter initialEntries={["/?status=OPEN"]}>
          <Home />
          <LocationProbe />
        </MemoryRouter>,
      );
      await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
      scrollTo.mockClear();
      fetchFeedMock.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Remove status filter: Open" }));

      // The filter change refetches exactly once, from its own effect, and must
      // not be mistaken for a tab tap, which both rewound the feed under the
      // reader and added a second `fetchFeed` on top of the filter's own one.
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledTimes(1));
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });
});

describe("Home feed redesign (reference-inspired)", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
    onRealtimeMock.mockClear();
    handlers.clear();
    tabTapState.tapCount = 0;
    clearFeedCaches();
    fetchFeedMock.mockResolvedValue({
      items: ["a", "b", "c"].map((id) => ({ id, title: id })),
      nextCursor: null,
      total: 3,
    });
  });

  afterEach(() => {
    cleanup();
    clearFeedCaches();
    resetBackInterceptors();
  });

  it("offers no discovery scope chips and no post-type radios", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    // Scope belongs to search now (owner order 2026-11-13): Home must not keep
    // a second row of Nearby/Open/Recent buttons.
    for (const name of ["Nearby", "Open", "Recent"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("radio", { name: "All" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Lost" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Found" })).toBeNull();
  });

  it("keeps one compact row: the search action trails, with no second brand", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());

    // The owner's requirement: an idle Home has no resident search field and no
    // second line of chrome, so the feed keeps the space.
    expect(screen.queryByLabelText("Search posts")).toBeNull();
    expect(screen.getByTestId("home-toolbar").textContent).not.toMatch(/signed in as/);
    // The sidebar owns the visible brand; this row must not repeat it.
    expect(screen.queryByTestId("home-brand")).toBeNull();
    expect(screen.queryByTestId("home-brand-wordmark")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Norfold" })).toBeTruthy();

    // The actions trail the title unit; the magnifier is the one search entry,
    // and no separate sliders control duplicates the search filters.
    expect(screen.queryByRole("button", { name: /^filters/i })).toBeNull();
    expect(screen.getByTestId("home-search-open").getAttribute("aria-label")).toBe("Open search");
  });

  it("opens the app-wide overlay and puts focus in its field", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());

    fireEvent.click(screen.getByTestId("home-search-open"));
    const overlay = await screen.findByRole("search");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(overlay).getByRole("searchbox", { name: "Search reports, messages and people" })),
    );
  });

  it("keeps one top-level heading on the compact row", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Norfold");
    // NIT: the heading wraps the brand button, whose label is an instruction.
    // The page's H1 must announce the page's name, not the control's hint.
    expect(screen.getByRole("heading", { level: 1, name: "Norfold" })).toBeTruthy();
  });

  it("restores a query from the URL without raising the keyboard", async () => {
    // The field is present because it holds a value — but nothing is focused, so
    // a shared link never opens the keyboard on the reader.
    renderHome("/?q=wallet");
    const restored = screen.getByLabelText("Search posts") as HTMLInputElement;
    expect(restored.value).toBe("wallet");
    expect(document.activeElement).not.toBe(restored);
  });

  it("returns focus to the magnifier when the overlay closes", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    const trigger = screen.getByTestId("home-search-open");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Close search" }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("lets Android Back close a focused field instead of leaving Home", async () => {
    renderHome("/?q=wallet");
    fireEvent.focus(screen.getByLabelText("Search posts"));

    act(() => expect(consumeBackIntercept()).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText("Search posts")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("q="));
  });

  it("keeps Back as navigation while the query is only a browsing filter", async () => {
    // A typed-but-unfocused query is how the reader browses results; Back must
    // still navigate rather than silently discard the filter.
    renderHome("/?q=wallet");
    expect(screen.getByLabelText("Search posts")).toBeTruthy();
    expect(consumeBackIntercept()).toBe(false);
  });

  it("keeps Back as navigation when focus moves from the field to another search control", async () => {
    // Close and Clear live inside the search row, so the row keeps focus when
    // the field loses it. Back must disarm on the *field's* focus, not the
    // row's, or one Back press silently discards a typed query
    // (review HOME-SCROLL-FIXFORWARD-R2 MINOR-1).
    renderHome("/?q=wallet");
    const input = screen.getByLabelText("Search posts");
    fireEvent.focus(input);
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Close search" }) });

    expect(consumeBackIntercept()).toBe(false);
    expect(screen.getByLabelText("Search posts")).toBeTruthy();
  });

  it("returns focus to the field after Clear so the next Tab is not skipped", async () => {
    // Clearing is done in order to retype. The Clear button unmounts with the
    // query, so without an explicit hand-back focus lands on <body>
    // (review HOME-SCROLL-FIXFORWARD-R2 MINOR-2).
    renderHome("/?q=wallet");
    const input = screen.getByLabelText("Search posts");
    fireEvent.focus(input);
    const clear = await screen.findByRole("button", { name: "Clear search" });
    // A pointer press takes focus off the field before the click lands.
    act(() => input.blur());
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(clear);

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.getAttribute("value")).toBe("");
  });
});

describe("Home app-bar focus ring (index.css cascade)", () => {
  const css = readFileSync("src/index.css", "utf8");
  const HAS = { hasSelector: true } as const;
  const LEGACY = { hasSelector: false } as const;

  // These read the real declarations, in real specificity order, for a given
  // engine generation — not the selector text. The previous version matched
  // block headers, so a higher-specificity `outline: 0` override passed, and it
  // asserted that the `:focus-within` fallback must not exist at all, which is
  // the one rule that keeps a ring on a WebView without `:has()` (Chromium
  // < 105; `minSdk 24` does not bound the WebView).

  it("keeps a ring on the pill where :has() is unsupported", () => {
    const legacyInput = ringOutcome(css, LEGACY, "input");
    // Without the fallback this is `null` — the field painted nothing at all,
    // because the input's own ring is suppressed in every engine.
    expect(legacyInput.pill).toBe("2px solid var(--fb-focus)");
    expect(legacyInput.pillOffset).toBe("2px");
    expect(legacyInput.input).toBe("none");
  });

  it("paints exactly one ring per control where :has() exists", () => {
    const modernInput = ringOutcome(css, HAS, "input");
    expect(modernInput.pill).toBe("2px solid var(--fb-focus)");
    expect(modernInput.input).toBe("none");

    // Tab to Close/Clear: the button keeps the app-wide ring and the pill must
    // not add a second contour.
    const modernButton = ringOutcome(css, HAS, "button");
    expect(modernButton.pill).toBe("none");
    expect(modernButton.button).toBe("2px solid var(--fb-focus)");

    // Nothing focused, nothing painted.
    expect(ringOutcome(css, HAS, "none").pill).toBeNull();
  });

  it("accepts the legacy double contour, but never a missing ring", () => {
    // Documented trade-off of the fallback: a `:focus-within` pill ring cannot
    // tell which descendant was focused, so on those engines a button focus
    // shows the pill contour too. Two contours are a cosmetic regression on an
    // old engine; zero contours is the accessibility defect this pins.
    const legacyButton = ringOutcome(css, LEGACY, "button");
    expect(legacyButton.pill).toBe("2px solid var(--fb-focus)");
    expect(legacyButton.button).toBe("2px solid var(--fb-focus)");
  });

  it("is not defeated by a higher-specificity override", () => {
    // Self-check of the evaluator against the exact counterexample from the
    // review: `html .fb-search-field-pill:has(...) { outline: 0 }` beat the
    // old text-matching test while painting nothing. If a rule like this lands
    // in index.css, the two tests above fail.
    const defeated = ringOutcome(
      `${css}\nhtml .fb-search-field-pill:has(input:focus-visible) { outline: 0; }`,
      HAS,
      "input",
    );
    expect(defeated.pill).toBe("0");
  });
});

describe("Home masonry width (adaptive navigation)", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
    onRealtimeMock.mockClear();
    handlers.clear();
    clearFeedCaches();
    fetchFeedMock.mockResolvedValue({
      items: ["a", "b", "c"].map((id) => ({ id, title: id })),
      nextCursor: null,
      total: 3,
    });
  });

  it("counts columns from the feed's own width, not the viewport", async () => {
    const previous = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    try {
      renderHome();
      await waitFor(() => expect(screen.getByTestId("posts")).toBeTruthy());
      const canvas = screen.getByTestId("home-feed-canvas");
      // Unmeasured (jsdom): the viewport fallback, i.e. 600 -> two columns.
      expect(screen.getByTestId("post-columns").textContent).toBe("2");

      // The side rail takes 104px out of this row: the feed reports 496.
      Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 496 });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => expect(screen.getByTestId("post-columns").textContent).toBe("1"));
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previous });
    }
  });
});
