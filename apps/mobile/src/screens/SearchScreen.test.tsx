// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchFeedMock, tabTapState, nlExtractLiveMock } = vi.hoisted(() => ({
  fetchFeedMock: vi.fn(),
  tabTapState: { tapCount: 0 },
  nlExtractLiveMock: vi.fn(),
}));
const locationFixMock = vi.hoisted(() => vi.fn());
vi.mock("../services/locationAdapter", () => ({
  createProductionLocationAdapter: () => ({}),
  requestFixWithGeneration: locationFixMock,
}));

// This suite asserts the settled result state, not the status row's motion
// choreography. Under a fully loaded suite the shared exit-before-enter
// handoff can leave the old count mounted; render the current child directly
// so the assertion observes the state the reader is meant to end up in.
vi.mock("framer-motion", async (importOriginal) => ({
  ...await importOriginal<typeof import("framer-motion")>(),
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../services/posts", () => ({ fetchFeed: fetchFeedMock }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "u1", username: "tester" } }) }));
vi.mock("../components/TabTap", () => ({ useTabTap: () => tabTapState }));
vi.mock("../services/liveNarrowTasks", async () => {
  // Only the live extraction seam is replaced. The result normaliser is real:
  // a patch-shaped fake must keep meaning "the extractor ran".
  const actual = await vi.importActual<typeof import("../services/liveNarrowTasks")>("../services/liveNarrowTasks");
  return { ...actual, nlExtractLive: nlExtractLiveMock };
});

import { SearchScreen } from "./SearchScreen";
vi.mock("../services/people", async original => ({
  ...await original<typeof import("../services/people")>(),
  searchPeople: async () => ({ items: [], nextCursor: null }),
}));
import { clearFeedCaches } from "../hooks/feedCache";
import * as feedHook from "../hooks/useFeed";
import { clearNearbySession, getNearbySession } from "../services/nearby";
import { makePost } from "../fixture/posts";
import { chooseSelectOption } from "../test-utils/select";
import { mustProfile, stubGenerate } from "../services/ai/ops/testSupport";
import { extractNlFilters, toValidatedPatch, type NlFilterPatch } from "../services/search/nlFilters";

/** The profile the op tests use: the real validator chain, a fake model. */
const PROFILE = "test-thought-envelope";

// The results list watches for its pagination sentinel. jsdom has no
// IntersectionObserver, so the boundary is faked here — the list's own
// behaviour is not what this suite is about.
beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderSearch(entry = "/search") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SearchScreen />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("SearchScreen URL filters", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
    nlExtractLiveMock.mockReset();
    nlExtractLiveMock.mockResolvedValue({});
    tabTapState.tapCount = 0;
    clearFeedCaches();
    clearNearbySession();
    fetchFeedMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  });

  afterEach(() => {
    cleanup();
    clearFeedCaches();
  });

  it("renders People as a people directory without a Reports tab or report search", async () => {
    renderSearch("/search?scope=people");
    expect(screen.getByRole("heading", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search people" })).toBeTruthy();
    // The old Connect page mounted the whole report search behind a hidden
    // attribute and offered a Reports tab. Neither belongs on a people page.
    expect(screen.queryByRole("searchbox", { name: "Search posts" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Search type" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
    expect(screen.queryByRole("button", { name: "People" })).toBeNull();
  });

  it("keeps Search report-only, with no people tab to leave through", () => {
    renderSearch("/search");
    expect(screen.getByRole("searchbox", { name: "Search posts" })).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search people" })).toBeNull();
    expect(screen.queryByRole("button", { name: "People" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
  });

  it("keeps ordinary search visible with a compact advanced-filter launcher", () => {
    renderSearch("/search");
    expect(screen.getByRole("searchbox", { name: "Search posts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Search filters" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
  });

  it("restores every filter from the URL on mount", async () => {
    fetchFeedMock.mockImplementation(async (filters) => ({
      items: filters.type === "FOUND" && filters.category === "Electronics" && filters.status === "OPEN" && filters.sort === "oldest" && filters.q === "phone"
        ? [makePost("phone-result", { title: "Found phone" })] : [], nextCursor: null, total: 1,
    }));
    renderSearch("/search?type=FOUND&category=Electronics&status=OPEN&sort=oldest&q=phone");
    expect(await screen.findByText("Found phone")).toBeTruthy();
    await waitFor(() =>
      expect(fetchFeedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "FOUND",
          category: "Electronics",
          status: "OPEN",
          sort: "oldest",
          q: "phone",
        }),
        undefined,
      ),
    );
    // The type is restored into the sheet AND summarised by its chip; there is
    // no permanent All/Lost/Found rail to read a radio state from.
    expect(screen.getByText("Type: Found")).toBeTruthy();
    expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("phone");
  });

  it("opts report results into the shared search-only photo hover preview", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
    try {
      fetchFeedMock.mockResolvedValue({
        items: [makePost("photo-result", {
          title: "Photo result",
          attachments: [{
            id: "a1",
            postId: "photo-result",
            fileUrl: "https://cdn.example/photo.jpg",
            mimeType: "image/jpeg",
            fileName: "photo.jpg",
            fileSize: 10,
            createdAt: "2026-11-18T00:00:00.000Z",
          }],
        })],
        nextCursor: null,
        total: 1,
      });
      renderSearch("/search?q=photo");
      expect(await screen.findByText("Photo result")).toBeTruthy();
      // Exactly one shared preview wrapper, and the canonical feed media is
      // still the report's own tap target inside it.
      const triggers = document.querySelectorAll(".fb-report-preview-trigger");
      expect(triggers).toHaveLength(1);
      expect(triggers[0]?.querySelector("[data-testid='masonry-media']")).toBeTruthy();
      // The card itself still renders beside its wrapped media.
      expect(triggers[0]?.parentElement?.textContent).toContain("Photo result");
    } finally {
      window.matchMedia = original;
    }
  });

  it("hides the result count until a first request succeeds", async () => {
    let resolve!: (value: { items: never[]; nextCursor: null; total: number }) => void;
    fetchFeedMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderSearch();
    expect(screen.queryByText("0 results")).toBeNull();
    resolve({ items: [], nextCursor: null, total: 0 });
    expect(await screen.findByText("0 results")).toBeTruthy();
  });

  it("does not announce a zero count after a failed first request", async () => {
    fetchFeedMock.mockRejectedValueOnce(new Error("offline"));
    renderSearch();
    await screen.findByText("Could not load");
    expect(screen.queryByText("0 results")).toBeNull();
  });

  it("keeps the distance changed while location is pending", async () => {
    let resolveFix!: (value: { kind: string; lat: number; lng: number }) => void;
    locationFixMock.mockImplementation(() => new Promise(resolve => { resolveFix = resolve; }));
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use my location once" }));
    await chooseSelectOption(screen.getByLabelText("Distance"), "25 km");
    resolveFix({ kind: "fix", lat: 12.345, lng: 77.654 });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("near=25"));
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ radiusM: 25000 }), undefined));
    expect(getNearbySession()?.radiusKm).toBe(25);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Remove nearby filter: 25 km" })).toBeTruthy();
    expect(fetchFeedMock).not.toHaveBeenCalledWith(expect.objectContaining({ radiusM: 10000 }), undefined);
  });

  it("degrades unknown deep-linked values to empty", async () => {
    renderSearch("/search?category=Bogus&status=Bogus");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
    const [filters] = fetchFeedMock.mock.calls[0] as [Record<string, unknown>];
    expect(filters.category).toBeUndefined();
    expect(filters.status).toBeUndefined();
  });

  it("writes filter edits back to the URL", async () => {
    renderSearch();
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    await chooseSelectOption(await screen.findByLabelText("Type"), "Found");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/search?type=FOUND"));
    expect(await screen.findByText("Type: Found")).toBeTruthy();
  });

  it("offers the app's calendar instead of native date inputs", async () => {
    renderSearch("/search?dateFrom=2026-10-01&dateTo=2026-10-21");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(await screen.findByRole("button", { name: /From date\. Oct 1, 2026/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /To date\. Oct 21, 2026/ })).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector('input[type="date"]')).toBeNull();
    expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: "2026-10-01", dateTo: "2026-10-21" }), undefined);
    expect(nlExtractLiveMock).not.toHaveBeenCalled();
  });

  it("restores dates and clears all filters together without losing the query", async () => {
    renderSearch("/search?q=wallet&category=Electronics&dateFrom=2026-10-01&dateTo=2026-10-21");
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(await screen.findByRole("button", { name: /From date\. Oct 1, 2026/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /To date\. Oct 21, 2026/ })).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Clear all filters")!);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/search?q=wallet"));
    expect(screen.getByRole("button", { name: /From date\. Any date/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /To date\. Any date/ })).toBeTruthy();
  });

  it("does not send impossible or reversed date bounds to the feed", async () => {
    // A REVERSED range is meaningless as a whole, so neither bound is sent.
    renderSearch("/search?dateFrom=2026-10-21&dateTo=2026-01-01");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
    expect(fetchFeedMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ dateFrom: undefined, dateTo: undefined }));
    expect(screen.getByRole("alert").textContent).toMatch(/valid date range/i);
  });

  it("shows the entered range in the sheet so a reversed one can be fixed", async () => {
    // The feed takes no date from a reversed range, but the reader must still
    // SEE what they typed — otherwise the mistake vanishes silently.
    renderSearch("/search?dateFrom=2026-10-21&dateTo=2026-01-01");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(await screen.findByRole("button", { name: /From date\. Oct 21, 2026/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /To date\. Jan 1, 2026/ })).toBeTruthy();
    // No date chip claims a filter that is not applied.
    expect(screen.queryByRole("button", { name: /remove start date filter/i })).toBeNull();
  });

  it("keeps the valid bound when only the other day is impossible", async () => {
    // One impossible day must not throw away the other, VALID one: the
    // reader asked for a range and half of it is usable.
    renderSearch("/search?dateFrom=2026-02-30&dateTo=2026-10-21");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
    expect(fetchFeedMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ dateFrom: undefined, dateTo: "2026-10-21" }),
    );
    // The sheet shows what is really applied, so the impossible day is not
    // presented as a filter the reader has on.
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(await screen.findByRole("button", { name: /From date\. Any date/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /To date\. Oct 21, 2026/ })).toBeTruthy();
  });

  it("scrolls to top smoothly on tab tap", async () => {
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    try {
      const { rerender } = renderSearch();
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
      expect(scrollTo).not.toHaveBeenCalled();
      tabTapState.tapCount = 1;
      rerender(
        <MemoryRouter initialEntries={["/search"]}>
          <SearchScreen />
          <LocationProbe />
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" }),
      );
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it("scrolls to top instantly on tab tap under reduced motion", async () => {
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn();
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
      const { rerender } = renderSearch();
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
      expect(scrollTo).not.toHaveBeenCalled();
      tabTapState.tapCount = 1;
      rerender(
        <MemoryRouter initialEntries={["/search"]}>
          <SearchScreen />
          <LocationProbe />
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" }),
      );
    } finally {
      window.matchMedia = originalMatchMedia;
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it("clear button appears while typing and clears the query, URL param, and feed filter", async () => {
    renderSearch();
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "phone" } });
    await waitFor(
      () => expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "phone" }), undefined),
      { timeout: 3000 },
    );
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("q=phone"));
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();

    fetchFeedMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("");
    // Clearing restores the cached unfiltered feed instead of refetching:
    // the URL param drops and no network call fires.
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("q="));
    expect(fetchFeedMock).not.toHaveBeenCalled();
  });

  describe("automatic smart filters", () => {
    function renderWithNl(nlExtract?: (input: string) => Promise<unknown>, entry = "/search") {
      return render(
        <MemoryRouter initialEntries={[entry]}>
          <SearchScreen nlExtract={nlExtract as never} />
          <LocationProbe />
        </MemoryRouter>,
      );
    }

    it("applies an extracted patch to the ordinary filters without a button", async () => {
      const seen: string[] = [];
      fetchFeedMock.mockImplementation(async (filters) => ({
        items: filters.category === "Bags & Wallets" && filters.status === "OPEN" && filters.dateFrom === "2026-09-18" && filters.dateTo === "2026-09-25"
          ? [makePost("wallet-result", { title: "Black wallet result" })] : [], nextCursor: null, total: 1,
      }));
      renderWithNl(async (input: string) => {
        seen.push(input);
        return {
          query: "black wallet",
          category: "Bags & Wallets",
          status: "OPEN",
          dateFrom: "2026-09-18",
          dateTo: "2026-09-25",
        };
      });
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      // No Smart search button exists: the settled phrase is the trigger.
      expect(screen.queryByRole("button", { name: "Smart search" })).toBeNull();
      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "black wallet lost last week" },
      });

      expect(await screen.findByText("Category: Bags & Wallets")).toBeTruthy();
      expect(await screen.findByText("Status: Open")).toBeTruthy();
      expect(await screen.findByRole("button", { name: "Remove start date filter: 2026-09-18" })).toBeTruthy();
      expect(await screen.findByRole("button", { name: "Remove end date filter: 2026-09-25" })).toBeTruthy();
      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(
          expect.objectContaining({
            category: "Bags & Wallets",
            status: "OPEN",
            dateFrom: "2026-09-18",
            dateTo: "2026-09-25",
          }),
          undefined,
        ),
      );
      expect(seen).toEqual(["black wallet lost last week"]);
      expect(await screen.findByText("Black wallet result")).toBeTruthy();
      // The reader's words are never rewritten under them, even when the
      // extractor proposes a cleaner query.
      expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("black wallet lost last week");
    });

    it("stays silent when no confident filters are extracted", async () => {
      renderWithNl(async () => ({}));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "vague" } });

      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "vague" }), undefined),
      );
      // Automatic extraction has no button, note, or install offer to show.
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
      expect(screen.queryByTestId("smart-search-offer-row")).toBeNull();
      expect(screen.queryByRole("heading", { name: "Local search helper" })).toBeNull();
      expect(screen.queryByText(/Category:/)).toBeNull();
      expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("vague");
    });

    it("does not offer an install when extraction cannot run", async () => {
      renderWithNl(async () => ({ kind: "failed", failure: { stage: "helper", code: "NOT_SET_UP" } }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "wallet" } });

      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "wallet" }), undefined),
      );
      expect(screen.queryByRole("heading", { name: "Local search helper" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
    });

    it("does not rewrite the field when the extractor proposes a cleaned query", async () => {
      renderWithNl(async () => ({ query: "black wallet" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "black wallet lost last week" } });

      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "black wallet lost last week" }), undefined),
      );
      await new Promise(resolve => setTimeout(resolve, 0));
      expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("black wallet lost last week");
    });

    it("refuses an extracted date that is not a real day", async () => {
      renderWithNl(async () => ({ query: "black wallet", dateFrom: "2026-02-30", dateTo: "2026-03-01" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "black wallet" } });

      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "black wallet" }), undefined),
      );
      // The whole range is refused: no half-applied date and no alert copy.
      expect(screen.getByTestId("location").textContent).not.toContain("dateFrom=");
      expect(screen.getByTestId("location").textContent).not.toContain("dateTo=");
      expect(screen.queryByRole("button", { name: "Remove start date filter" })).toBeNull();
    });

    it("ignores an answer for a phrase the reader has already replaced", async () => {
      let answer!: (value: Record<string, string>) => void;
      renderWithNl(() => new Promise(resolve => { answer = resolve; }));
      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "old wallet" },
      });
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "old wallet" }), undefined));

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "new phone" } });
      answer({ query: "old wallet", category: "Bags & Wallets" });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("new phone");
      expect(screen.queryByText("Category: Bags & Wallets")).toBeNull();
    });

    it("ignores an answer that arrives after the screen is gone", async () => {
      const errors: unknown[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...args) => { errors.push(args); });
      let answer!: (value: Record<string, string>) => void;
      const extract = vi.fn(() => new Promise(resolve => { answer = resolve as typeof answer; }));
      const view = renderWithNl(extract);
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "black wallet" } });
      // The settled phrase starts the extraction; the answer is still out
      // when the reader leaves the screen.
      await waitFor(() => expect(extract).toHaveBeenCalledWith("black wallet"));
      const callsBeforeUnmount = fetchFeedMock.mock.calls.length;
      view.unmount();
      answer({ query: "black wallet", category: "Bags & Wallets" });
      await new Promise(resolve => setTimeout(resolve, 0));
      spy.mockRestore();

      expect(errors).toEqual([]);
      expect(fetchFeedMock.mock.calls.length).toBe(callsBeforeUnmount);
    });

    it("runs once per settled phrase", async () => {
      const extract = vi.fn(async () => ({}));
      renderWithNl(extract);
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "wallet" } });
      await waitFor(() => expect(extract).toHaveBeenCalledWith("wallet"));
      // A filter change is not a new phrase.
      fireEvent.click(screen.getByRole("button", { name: "Filters" }));
      await chooseSelectOption(await screen.findByLabelText("Type"), "Found");
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(extract).toHaveBeenCalledTimes(1);
    });

    it("extracts again when the phrase is cleared and typed again", async () => {
      const extract = vi.fn(async () => ({ category: "Electronics" }));
      renderWithNl(extract);
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      const field = () => screen.getByLabelText("Search posts");
      fireEvent.change(field(), { target: { value: "phone" } });
      await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));

      fireEvent.change(field(), { target: { value: "" } });
      await waitFor(() =>
        expect(screen.getByTestId("location").textContent).not.toContain("q=phone"),
      );

      fireEvent.change(field(), { target: { value: "phone" } });
      await waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
    });

    it("uses ordinary search when extraction fails", async () => {
      renderWithNl(async () => {
        throw new Error("boom");
      });
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "wallet" } });

      expect((screen.getByLabelText("Search posts") as HTMLInputElement).value).toBe("wallet");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "wallet" }), undefined));
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
    });

    it("does nothing when no extractor is wired", async () => {
      render(
        <MemoryRouter initialEntries={["/search"]}>
          <SearchScreen nlExtract={undefined} />
          <LocationProbe />
        </MemoryRouter>,
      );
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Smart search" })).toBeNull();

      fireEvent.change(screen.getByLabelText("Search posts"), { target: { value: "phone" } });
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "phone" }), undefined));
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/search?q=phone"));
    });

    it("defaults a bare mount to the live transport", async () => {
      nlExtractLiveMock.mockReset();
      nlExtractLiveMock.mockResolvedValue({ category: "Electronics" });
      renderSearch();
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "black wallet lost last week" },
      });

      await waitFor(() =>
        expect(nlExtractLiveMock).toHaveBeenCalledWith("black wallet lost last week"),
      );
      expect(await screen.findByText("Category: Electronics")).toBeTruthy();
    });

    it("an explicit extractor wins over the live default", async () => {
      nlExtractLiveMock.mockReset();
      renderWithNl(async () => ({ category: "Electronics" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "explicit query" },
      });

      expect(await screen.findByText("Category: Electronics")).toBeTruthy();
      expect(nlExtractLiveMock).not.toHaveBeenCalled();
    });
  });

  describe("Search S2: the explicit type and the place", () => {
    function renderWithNl(
      nlExtract: (input: string) => Promise<NlFilterPatch>,
      entry = "/search",
    ) {
      return render(
        <MemoryRouter initialEntries={[entry]}>
          <SearchScreen nlExtract={nlExtract as never} />
          <LocationProbe />
        </MemoryRouter>,
      );
    }

    const dhakaReport = makePost("s2-dhaka", {
      title: "Umbrella in Gulshan",
      locationLabel: "Gulshan, Dhaka",
    });
    const chattogramReport = makePost("s2-chattogram", {
      title: "Umbrella in Agrabad",
      locationLabel: "Agrabad, Chattogram",
    });

    function twoReports() {
      fetchFeedMock.mockResolvedValue({
        items: [dhakaReport, chattogramReport],
        nextCursor: null,
        total: 2,
      });
    }

    it("applies an extracted LOST/FOUND type to the ordinary control", async () => {
      renderWithNl(async () => ({ query: "black wallet", postType: "LOST" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "black wallet lost" },
      });

      // The type lands in the filter sheet the reader already uses for every
      // other narrowing control, and it is summarised as a chip that can be
      // removed. There is no button: the settled phrase is the trigger.
      expect(await screen.findByText("Type: Lost")).toBeTruthy();
      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ type: "LOST" }), undefined),
      );
    });

    it("keeps the reader's own type when the extraction disagrees", async () => {
      // The reader's own choice is their answer: automatic extraction does
      // not overrule it, and the chips show only the reader's type.
      renderWithNl(async () => ({ postType: "LOST" }), "/search?type=FOUND");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "black wallet lost" },
      });

      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ type: "FOUND" }), undefined),
      );
      expect(screen.queryByText("Type: Lost")).toBeNull();
      expect(screen.getByText("Type: Found")).toBeTruthy();
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
    });

    it("applies an extracted place and narrows the results to it", async () => {
      twoReports();
      renderWithNl(async () => ({ query: "umbrella", place: "Gulshan" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "umbrella lost in Gulshan" },
      });

      expect(await screen.findByText("Place: Gulshan")).toBeTruthy();
      // The place is applied ON THE DEVICE: the report that names it is
      // kept, the one that does not is out.
      await waitFor(() => expect(screen.getByText("Umbrella in Gulshan")).toBeTruthy());
      expect(screen.queryByText("Umbrella in Agrabad")).toBeNull();
      // The count never claims more than the reader can see: it counts the
      // LOADED reports the place kept, never a total.
      expect(await screen.findByText("1 matching report loaded for Gulshan")).toBeTruthy();
    });

    it("keeps the reader's own place when the extraction disagrees", async () => {
      twoReports();
      renderWithNl(async () => ({ place: "Gulshan" }), "/search?place=Chattogram");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "umbrella lost in Gulshan" },
      });

      await waitFor(() => expect(screen.getByText("Place: Chattogram")).toBeTruthy());
      expect(screen.queryByText("Place: Gulshan")).toBeNull();
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
      // The reader's place still decides the results.
      await waitFor(() => expect(screen.getByText("Umbrella in Agrabad")).toBeTruthy());
      expect(screen.queryByText("Umbrella in Gulshan")).toBeNull();
    });

    it("removes the place like any other filter", async () => {
      twoReports();
      renderWithNl(async () => ({ query: "umbrella", place: "Gulshan" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "umbrella lost in Gulshan" },
      });
      expect(await screen.findByText("Place: Gulshan")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Remove place filter: Gulshan" }));

      await waitFor(() =>
        expect(screen.getByTestId("location").textContent).not.toContain("place="),
      );
      await waitFor(() => expect(screen.queryByText("Place: Gulshan")).toBeNull());
      // Without the place every loaded report is in scope again.
      expect(screen.getByText("Umbrella in Agrabad")).toBeTruthy();
    });

    it("filters by a place the reader types, without Smart Search", async () => {
      twoReports();
      renderSearch("/search");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
      fireEvent.change(await screen.findByLabelText("Place"), {
        target: { value: "Gulshan" },
      });

      await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("place=Gulshan"));
      await waitFor(() => expect(screen.getByText("Umbrella in Gulshan")).toBeTruthy());
      expect(screen.queryByText("Umbrella in Agrabad")).toBeNull();
      expect(await screen.findByText("1 matching report loaded for Gulshan")).toBeTruthy();
      expect(nlExtractLiveMock).not.toHaveBeenCalled();
    });

    it("never applies a refused place, and says nothing", async () => {
      // The REAL path: the patch is built by the validator, so the refusal
      // is carried by the patch itself instead of vanishing inside it.
      // A bare number is not a place name. Automatic extraction is silent,
      // so the refusal produces no chip, no param and no note.
      twoReports();
      renderWithNl(async () => toValidatedPatch({ query: "umbrella", place: "42" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "umbrella near 42" },
      });

      // Ordinary search still runs on the reader's words.
      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.objectContaining({ q: "umbrella near 42" }), undefined),
      );
      await new Promise(resolve => setTimeout(resolve, 0));
      // The refused place is never a filter: no chip, no URL param, and no
      // report dropped.
      expect(screen.queryByText(/^Place:/)).toBeNull();
      expect(screen.getByTestId("location").textContent).not.toContain("place=");
      expect(screen.getByText("Umbrella in Gulshan")).toBeTruthy();
      expect(screen.getByText("Umbrella in Agrabad")).toBeTruthy();
      expect(screen.queryByText(/loaded for /)).toBeNull();
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
    });

    it("applies the usable filter and drops a refused place silently", async () => {
      // The category is a real filter; the refused place is not. The reader
      // sees the category chip and no place chip — the chips are the receipt.
      twoReports();
      renderWithNl(async () => toValidatedPatch({ query: "umbrella", category: "Bags & Wallets", place: "42" }));
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "umbrella in a bag near 42" },
      });

      expect(await screen.findByText("Category: Bags & Wallets")).toBeTruthy();
      expect(screen.queryByText(/^Place:/)).toBeNull();
      expect(screen.getByTestId("location").textContent).not.toContain("place=");
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(
          expect.objectContaining({ category: "Bags & Wallets" }),
          undefined,
        ),
      );
    });

    it("fails the whole extraction closed on a coordinate, leaving ordinary search", async () => {
      // The op contract refuses a coordinate in ANY slot (R5), so the whole
      // extraction is refused rather than half-applied — ordinary search runs
      // on the reader's words, and nothing is announced.
      twoReports();
      renderWithNl(async (input: string) =>
        extractNlFilters(
          stubGenerate(JSON.stringify({ query: "umbrella", place: "23.8103, 90.4125" })),
          input,
          mustProfile(PROFILE),
        ),
      );
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText("Search posts"), {
        target: { value: "umbrella at 23.8103, 90.4125" },
      });

      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(
          expect.objectContaining({ q: "umbrella at 23.8103, 90.4125" }),
          undefined,
        ),
      );
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(screen.queryByText(/^Place:/)).toBeNull();
      expect(screen.getByTestId("location").textContent).not.toContain("place=");
      expect(screen.queryByTestId("smart-search-note-row")).toBeNull();
    });

    it("never applies a coordinate the reader typed either", async () => {
      // The reader's own text stays in the field so it can be fixed — the
      // same shape as an impossible date. It is still not a filter.
      twoReports();
      renderSearch("/search");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
      fireEvent.change(await screen.findByLabelText("Place"), {
        target: { value: "23.8103, 90.4125" },
      });

      expect(
        await screen.findByText(/a map coordinate is not a place/i),
      ).toBeTruthy();
      expect(screen.getByText("Umbrella in Gulshan")).toBeTruthy();
      expect(screen.getByText("Umbrella in Agrabad")).toBeTruthy();
      expect(screen.queryByText(/^Place:/)).toBeNull();
      expect(screen.queryByText(/loaded for /)).toBeNull();
    });

    it("shows the canonical empty state, in its compact variant, with a real heading", async () => {
      // T3: the results area is a strip. The canonical tall empty state
      // (48px of padding, the icon on its own line) pushes the WORDS below
      // the fold at 320dp / 125% text — and the words are the message. So
      // the screen uses the canonical EmptyState's COMPACT variant: one
      // empty state, not a second one.
      //
      // What jsdom can prove: the canonical component is the one rendered,
      // the heading is still an h2 (the heading level is not lost), and the
      // words are there. What jsdom CANNOT prove: that the words are above
      // the fold — that needs a rendered check at 320dp / 125% text, which
      // does not exist yet and is not claimed.
      renderSearch("/search");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      const empty = await screen.findByTestId("empty-state");
      expect(empty.className).toContain("py-2");
      expect(empty.className).not.toContain("py-12");
      const heading = screen.getByRole("heading", { name: "No matches" });
      expect(heading.tagName).toBe("H2");
      expect(heading.className).toContain("text-sm");
      expect(screen.getByText("Try different filters or a broader search.")).toBeTruthy();
    });

    it("says so when the place keeps none of the loaded reports, and offers more", async () => {
      fetchFeedMock.mockResolvedValueOnce({ items: [chattogramReport], nextCursor: "page-2", total: 2 })
        .mockResolvedValueOnce({ items: [dhakaReport], nextCursor: null, total: 1 });
      renderSearch("/search?place=Gulshan");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      expect(await screen.findByText("No matching reports loaded yet")).toBeTruthy();
      expect(screen.getByText("Try another place, or load more reports.")).toBeTruthy();
      // The reader can widen the search themselves: the place is applied on
      // the device, so more reports may carry the place.
      fireEvent.click(screen.getByRole("button", { name: "Show more reports" }));
      await waitFor(() =>
        expect(fetchFeedMock).toHaveBeenCalledWith(expect.anything(), "page-2"),
      );
      expect(await screen.findByText("Umbrella in Gulshan")).toBeTruthy();
      expect(screen.queryByText("Umbrella in Agrabad")).toBeNull();
    });

    it("retries a failed page without losing the place or resetting the cursor", async () => {
      fetchFeedMock.mockResolvedValueOnce({ items: [chattogramReport], nextCursor: "page-2", total: 2 })
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [dhakaReport], nextCursor: null, total: 1 });
      renderSearch("/search?place=Gulshan");
      fireEvent.click(await screen.findByRole("button", { name: "Show more reports" }));
      expect(await screen.findByText("No matching reports loaded yet")).toBeTruthy();
      fireEvent.click(await screen.findByRole("button", { name: "Retry loading more reports" }));
      expect(await screen.findByText("Umbrella in Gulshan")).toBeTruthy();
      expect(fetchFeedMock.mock.calls.map(call => call[1])).toEqual([undefined, "page-2", "page-2"]);
    });

    it("retries a failed refresh when no more pages are available", async () => {
      const originalScrollTo = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = vi.fn();
      try {
      fetchFeedMock.mockResolvedValueOnce({ items: [chattogramReport], nextCursor: null, total: 1 })
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [dhakaReport], nextCursor: null, total: 1 });
      const { rerender } = renderSearch("/search?place=Gulshan");
      expect(await screen.findByText("No report in Gulshan yet")).toBeTruthy();
      tabTapState.tapCount = 1;
      rerender(<MemoryRouter initialEntries={["/search?place=Gulshan"]}><SearchScreen /><LocationProbe /></MemoryRouter>);
      expect(await screen.findByText("Couldn't refresh reports. Try again.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("Umbrella in Gulshan")).toBeTruthy();
      expect(fetchFeedMock.mock.calls.map(call => call[1])).toEqual([undefined, undefined, undefined]);
      } finally {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      }
    });

    it("retries a failed refresh instead of loading the next page", async () => {
      const originalScrollTo = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = vi.fn();
      try {
        fetchFeedMock.mockResolvedValueOnce({ items: [chattogramReport], nextCursor: "page-2", total: 2 })
          .mockRejectedValueOnce(new Error("offline"))
          .mockResolvedValueOnce({ items: [dhakaReport], nextCursor: null, total: 1 });
        const { rerender } = renderSearch("/search?place=Gulshan");
        expect(await screen.findByRole("button", { name: "Show more reports" })).toBeTruthy();
        tabTapState.tapCount = 1;
        rerender(<MemoryRouter initialEntries={["/search?place=Gulshan"]}><SearchScreen /><LocationProbe /></MemoryRouter>);
        expect(await screen.findByText("Couldn't refresh reports. Try again.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry loading more reports" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("Umbrella in Gulshan")).toBeTruthy();
        expect(fetchFeedMock.mock.calls.map(call => call[1])).toEqual([undefined, undefined, undefined]);
      } finally {
        HTMLElement.prototype.scrollTo = originalScrollTo;
      }
    });

    it("offers refresh retry for a refresh error even when more pages exist", async () => {
      const refresh = vi.fn().mockResolvedValue(undefined);
      const loadMore = vi.fn().mockResolvedValue(undefined);
      const useFeed = vi.spyOn(feedHook, "useFeed").mockReturnValue({
        items: [chattogramReport], total: 2, loading: false, refreshing: false,
        loadingMore: false, error: "offline", hasMore: true, refresh, loadMore,
        removeItem: vi.fn(), patchItem: vi.fn(),
      });
      try {
        const { rerender } = renderSearch("/search?place=Gulshan");
        expect(screen.getByText("Couldn't refresh reports. Try again.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry loading more reports" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(refresh).toHaveBeenCalledOnce();
        expect(loadMore).not.toHaveBeenCalled();
        useFeed.mockReturnValue({
          items: [dhakaReport], total: 1, loading: false, refreshing: false,
          loadingMore: false, error: null, hasMore: false, refresh, loadMore,
          removeItem: vi.fn(), patchItem: vi.fn(),
        });
        rerender(<MemoryRouter initialEntries={["/search?place=Gulshan"]}><SearchScreen /><LocationProbe /></MemoryRouter>);
        expect(await screen.findByText("Umbrella in Gulshan")).toBeTruthy();
      } finally {
        useFeed.mockRestore();
      }
    });

    it("does not offer to load more reports when there is nothing more to load", async () => {
      fetchFeedMock.mockResolvedValue({
        items: [chattogramReport],
        nextCursor: null,
        total: 1,
      });
      renderSearch("/search?place=Gulshan");
      await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

      expect(await screen.findByText("No report in Gulshan yet")).toBeTruthy();
      // The sentence follows the truth: there is nothing more to load.
      expect(screen.getByText("Try another place.")).toBeTruthy();
      expect(screen.queryByText(/load more reports/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Show more reports" })).toBeNull();
    });
  });
});
