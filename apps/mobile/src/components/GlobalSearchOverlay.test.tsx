// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostItem, SearchedProfile } from "@norfold/shared";

const io = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  searchPeople: vi.fn(),
  user: { id: "searcher" } as { id: string } | null,
  pointer: { fine: false },
}));
vi.mock("../auth", () => ({ useAuth: () => ({ user: io.user }) }));
vi.mock("../services/posts", () => ({ fetchFeed: io.fetchFeed }));
vi.mock("../services/people", () => ({ searchPeople: io.searchPeople }));
// Hover previews exist only on a fine pointer; jsdom has none. The switch is
// explicit so the hover contract is tested without pretending jsdom can hover.
vi.mock("./inputCapabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inputCapabilities")>();
  return { ...actual, useFinePointer: () => io.pointer.fine };
});

import { GlobalSearchOverlay } from "./GlobalSearchOverlay";
import { resetGlobalSearch, toggleGlobalSearch, useGlobalSearchOpen } from "./globalSearch";

// Vitest does not transform CSS imports for the test environment (the `?inline`
// module is empty), so the layer contract is asserted against the stylesheet
// source itself rather than a blank string.
const searchStyles = readFileSync(resolve(process.cwd(), "src/components/GlobalSearchOverlay.css"), "utf8");

const report = {
  id: "report-1",
  title: "Blue wallet near the library",
  type: "LOST",
  category: "WALLETS",
  status: "OPEN",
  attachments: [],
} as unknown as PostItem;
const photoReport = {
  ...report,
  id: "report-photo",
  title: "Blue wallet with a photo",
  attachments: [{
    id: "a1",
    postId: "report-photo",
    fileUrl: "https://cdn.example/wallet.jpg",
    mimeType: "image/jpeg",
    fileName: "wallet.jpg",
    fileSize: 10,
    createdAt: "2026-11-18T00:00:00.000Z",
  }],
} as unknown as PostItem;
const person = {
  id: "person-1",
  username: "amira",
  displayName: "Amira Saleh",
  avatarUrl: null,
} as SearchedProfile;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** Today's month, so the tests do not depend on the wall clock's month. */
function thisMonth(day: number) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  return {
    year,
    iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    label: `${MONTH_NAMES[month]} ${day}, ${year}`,
  };
}

function RouteProbe() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname + location.search}</output>;
}

function Harness() {
  const open = useGlobalSearchOpen();
  return <MemoryRouter initialEntries={["/"]}>
    <button type="button" aria-expanded={open}
      onClick={(event) => toggleGlobalSearch(event.currentTarget)}>Open search</button>
    <GlobalSearchOverlay />
    <RouteProbe />
  </MemoryRouter>;
}

async function openSearch() {
  const trigger = screen.getByRole("button", { name: "Open search" });
  fireEvent.click(trigger);
  const overlay = await screen.findByRole("search");
  return { overlay, trigger };
}

async function openFilters() {
  const { overlay } = await openSearch();
  const toggle = within(overlay).getByRole("button", { name: "Advanced search" });
  fireEvent.click(toggle);
  const bar = within(overlay).getByRole("group", { name: "Advanced search" });
  return { overlay, toggle, bar };
}

beforeEach(() => {
  io.user = { id: "searcher" };
  io.pointer.fine = false;
  io.fetchFeed.mockReset();
  io.searchPeople.mockReset();
  io.fetchFeed.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  io.searchPeople.mockResolvedValue({ items: [], nextCursor: null });
  localStorage.clear();
  resetGlobalSearch();
});
afterEach(() => { cleanup(); resetGlobalSearch(); vi.unstubAllGlobals(); });

describe("app-wide search", () => {
  it("keeps a visible focus ring on the filter pills", () => {
    expect(searchStyles).toMatch(/\.fb-search-pill:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--fb-focus\)/s);
    expect(searchStyles).not.toMatch(/\.fb-search-pill:focus-visible\s*\{[^}]*outline:\s*none/s);
  });

  it("keeps the full viewport backdrop below the search surface", async () => {
    render(<Harness />);
    const { overlay } = await openSearch();
    const backdrop = document.querySelector<HTMLElement>(".fb-search-backdrop");
    expect(backdrop).toBeTruthy();
    expect(overlay.classList.contains("fb-search-overlay")).toBe(true);
    expect(searchStyles).toMatch(/\.fb-search-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*70;/s);
    expect(searchStyles).toMatch(/\.fb-search-overlay\s*\{[^}]*z-index:\s*74;/s);
    expect(searchStyles).not.toMatch(/\[data-global-search="true"\][^{]*fb-app-bar/);
  });

  it("opens one floating bar over the app without navigating", async () => {
    render(<Harness />);
    const { overlay, trigger } = await openSearch();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const field = within(overlay).getByRole("searchbox", { name: "Search reports, messages and people" });
    expect(document.activeElement).toBe(field);
    expect(within(overlay).getByText("Recent searches")).toBeTruthy();
    expect(within(overlay).getByText("No recent searches")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("/");
    // The bar carries the prototype's three controls and nothing else.
    expect(within(overlay).getByRole("button", { name: "Advanced search" })).toBeTruthy();
    expect(within(overlay).getByRole("button", { name: "Close search" })).toBeTruthy();
  });

  it("replaces recent searches with live reports and people as the query changes", async () => {
    io.fetchFeed.mockResolvedValue({ items: [report], nextCursor: null, total: 1 });
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    expect(await within(overlay).findByText("Blue wallet near the library")).toBeTruthy();
    expect(await within(overlay).findByText("Amira Saleh")).toBeTruthy();
    expect(within(overlay).queryByText("Recent searches")).toBeNull();
    expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ q: "wallet" }));
    expect(io.searchPeople).toHaveBeenCalledWith("wallet", expect.objectContaining({ limit: 5 }));
  });

  it("keeps a photo report's real thumbnail beside its left-aligned title", async () => {
    io.fetchFeed.mockResolvedValue({ items: [photoReport], nextCursor: null, total: 1 });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });

    const row = await within(overlay).findByRole("link", { name: /Blue wallet with a photo/ });
    // The overlay row owns its own names: the /search toolbar's
    // `.fb-search-row` grid must never reach it (that grid pinned the copy to
    // the far-right column).
    expect(row.classList.contains("fb-gsearch-row")).toBe(true);
    expect(row.classList.contains("fb-search-row")).toBe(false);

    const thumb = within(row).getByTestId("search-report-thumb");
    expect(row.firstElementChild).toBe(thumb);
    expect(thumb.getAttribute("data-state")).toBe("ready");
    const image = thumb.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://cdn.example/wallet.jpg");
    // The title beside it names the report; the thumbnail stays decorative.
    expect(image.getAttribute("alt")).toBe("");

    const copy = row.querySelector(".fb-gsearch-row-copy")!;
    const title = copy.querySelector(".fb-gsearch-row-title")!;
    const meta = copy.querySelector(".fb-gsearch-row-meta")!;
    expect(title.textContent).toBe("Blue wallet with a photo");
    expect(title.nextElementSibling).toBe(meta);
    // Thumbnail first, then the copy: nothing can sit between them or push
    // the title across the row.
    expect(thumb.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps a fixed neutral box for a report without a photo", async () => {
    io.fetchFeed.mockResolvedValue({ items: [report], nextCursor: null, total: 1 });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    const row = await within(overlay).findByRole("link", { name: /Blue wallet near the library/ });
    const thumb = within(row).getByTestId("search-report-thumb");
    expect(thumb.getAttribute("data-state")).toBe("none");
    expect(thumb.querySelector("img")).toBeNull();
    // The reserved geometry lives on the row, not on a fabricated image.
    expect(thumb.classList.contains("fb-gsearch-row-thumb")).toBe(true);
    expect(within(row).getByText("Blue wallet near the library")).toBeTruthy();
  });

  it("falls back inside the same box when a report photo fails", async () => {
    io.fetchFeed.mockResolvedValue({ items: [photoReport], nextCursor: null, total: 1 });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    const row = await within(overlay).findByRole("link", { name: /Blue wallet with a photo/ });
    fireEvent.error(within(row).getByTestId("search-report-thumb").querySelector("img")!);
    const failed = within(row).getByTestId("search-report-thumb");
    expect(failed.getAttribute("data-state")).toBe("failed");
    expect(failed.querySelector("img")).toBeNull();
    expect(within(row).getByText("Blue wallet with a photo")).toBeTruthy();
  });

  it("uses the shared hover preview once per report result on a fine pointer", async () => {
    io.pointer.fine = true;
    io.fetchFeed.mockResolvedValue({ items: [photoReport], nextCursor: null, total: 1 });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });

    const row = await within(overlay).findByRole("link", { name: /Blue wallet with a photo/ });
    const trigger = row.parentElement!;
    expect(trigger.classList.contains("fb-report-preview-trigger")).toBe(true);
    expect(trigger.parentElement?.tagName).toBe("LI");
    // One shared wrapper per result, and no interactive element was added
    // around the row link.
    expect(overlay.querySelectorAll(".fb-report-preview-trigger")).toHaveLength(1);
    expect(trigger.querySelector("button")).toBeNull();
  });

  it("opens the picked report and closes the floating search", async () => {
    io.fetchFeed.mockResolvedValue({ items: [report], nextCursor: null, total: 1 });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    const row = await within(overlay).findByRole("link", { name: /Blue wallet near the library/ });
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/posts/report-1"));
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("says so and offers to start over when nothing matches", async () => {
    render(<Harness />);
    const { overlay } = await openSearch();
    const field = within(overlay).getByRole("searchbox");
    fireEvent.change(field, { target: { value: "zzzz" } });
    expect(await within(overlay).findByText("No results found")).toBeTruthy();
    fireEvent.click(within(overlay).getByRole("button", { name: "Start over" }));
    expect((field as HTMLInputElement).value).toBe("");
    expect(await within(overlay).findByText("Recent searches")).toBeTruthy();
  });

  it("remembers a submitted query and Enter opens the full results page", async () => {
    io.fetchFeed.mockResolvedValue({ items: [report], nextCursor: null, total: 1 });
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    await within(overlay).findByText("Blue wallet near the library");
    fireEvent.keyDown(within(overlay).getByRole("searchbox"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/search?q=wallet"));
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    const reopened = await screen.findByRole("search");
    expect(await within(reopened).findByRole("button", { name: "wallet" })).toBeTruthy();
  });

  it("returns focus to the control that opened it on Escape", async () => {
    render(<Harness />);
    const { trigger } = await openSearch();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens compact filter pills and applies a type without leaving the search", async () => {
    render(<Harness />);
    const { overlay } = await openSearch();
    const toggle = within(overlay).getByRole("button", { name: "Advanced search" });
    fireEvent.click(toggle);
    const bar = within(overlay).getByRole("group", { name: "Advanced search" });
    // The old form used native selects; every filter is now a pill + panel.
    expect(within(bar).queryByRole("combobox")).toBeNull();

    fireEvent.click(within(bar).getByRole("button", { name: "Type" }));
    const menu = within(bar).getByRole("group", { name: "Type" });
    fireEvent.click(within(menu).getByRole("button", { name: "Lost" }));

    expect(within(bar).queryByRole("group", { name: "Type" })).toBeNull();
    const activePill = within(bar).getByRole("button", { name: "Type: Lost" });
    expect(document.activeElement).toBe(activePill);
    expect(screen.getByTestId("route").textContent).toBe("/");
    // A filter with no words still searches: it is a real query state.
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ type: "LOST" })));
  });

  it("opens a designed calendar and lets the month and year drill down", async () => {
    render(<Harness />);
    const { overlay, bar } = await openFilters();

    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    expect(within(menu).getByRole("button", { name: "Last 7 days" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Last 30 days" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "This year" })).toBeTruthy();
    // No native date inputs survive the redesign.
    expect(within(menu).queryByRole("textbox")).toBeNull();

    fireEvent.click(within(menu).getByRole("button", { name: /^From date/ }));
    expect(within(bar).getByRole("group", { name: "Start date" })).toBeTruthy();
    // The pills stay mounted (so their scroll position survives) while the
    // results card yields the room to the calendar.
    expect(within(bar).getByRole("button", { name: /^Date/ })).toBeTruthy();
    expect(within(overlay).queryByText("Recent searches")).toBeNull();

    // Month opens the month list; choosing one returns to that month's days.
    fireEvent.click(within(menu).getByRole("button", { name: "Choose month" }));
    fireEvent.click(within(menu).getByRole("button", { name: "March" }));
    expect(within(menu).getByRole("button", { name: "Choose month" }).textContent).toBe("March");

    // Year opens the year list; choosing one shows that year's months.
    const pageStart = Math.floor(thisMonth(1).year / 12) * 12;
    fireEvent.click(within(menu).getByRole("button", { name: "Choose year" }));
    fireEvent.click(within(menu).getByRole("button", { name: String(pageStart + 1) }));
    fireEvent.click(within(menu).getByRole("button", { name: "June" }));

    const chosenYear = pageStart + 1;
    fireEvent.click(within(menu).getByRole("button", { name: `June 15, ${chosenYear}` }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: `${chosenYear}-06-15`,
    })));

    // The date options return, the trigger shows the day, and focus is on it.
    const fromTrigger = within(menu).getByRole("button", { name: /^From date/ });
    expect(fromTrigger.textContent).toContain("Jun 15");
    expect(document.activeElement).toBe(fromTrigger);
  });

  it("scrolls the open pill back into view when a chosen value widens it", async () => {
    render(<Harness />);
    const { bar } = await openFilters();

    const datePill = within(bar).getByRole("button", { name: "Date" });
    fireEvent.click(datePill);
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    fireEvent.click(within(menu).getByRole("button", { name: /^From date/ }));

    // A phone cannot fit every pill. Choosing a day widens "Date" into
    // "From Nov 15"; the row must follow the label instead of leaving half
    // the value scrolled out of sight.
    const scroll = vi.fn();
    datePill.scrollIntoView = scroll;
    fireEvent.click(within(menu).getByRole("button", { name: thisMonth(15).label }));

    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" }));
    expect(within(bar).getByRole("button", { name: /^Date/ })).toBe(datePill);
  });

  it("disables days outside the other bound and clears one bound", async () => {
    render(<Harness />);
    const { bar } = await openFilters();
    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });

    const from = thisMonth(15);
    const early = thisMonth(10);
    const late = thisMonth(20);

    // Set From first.
    fireEvent.click(within(menu).getByRole("button", { name: /^From date/ }));
    fireEvent.click(within(menu).getByRole("button", { name: from.label }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: from.iso,
    })));

    // To cannot precede From: the calendar disables day 10 and allows day 20.
    fireEvent.click(within(menu).getByRole("button", { name: /^To date/ }));
    const disabledDay = within(menu).getByRole("button", { name: early.label }) as HTMLButtonElement;
    const allowedDay = within(menu).getByRole("button", { name: late.label }) as HTMLButtonElement;
    expect(disabledDay.disabled).toBe(true);
    expect(allowedDay.disabled).toBe(false);

    fireEvent.click(allowedDay);
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: from.iso,
      dateTo: late.iso,
    })));

    // Clear one bound without touching the other.
    fireEvent.click(within(menu).getByRole("button", { name: /^From date/ }));
    fireEvent.click(within(menu).getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      const last = io.fetchFeed.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(last?.dateFrom).toBeUndefined();
      expect(last?.dateTo).toBe(late.iso);
    });
    expect(within(menu).getByRole("button", { name: "From date, any date" })).toBeTruthy();
  });

  it("searches the category list and keeps the chosen category in the pill", async () => {
    render(<Harness />);
    const { bar } = await openFilters();
    fireEvent.click(within(bar).getByRole("button", { name: "Category" }));
    const menu = within(bar).getByRole("group", { name: "Category" });
    const field = within(menu).getByRole("searchbox", { name: "Find a category" });
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "wallet" } });
    expect(within(menu).getByRole("button", { name: "Bags & Wallets" })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "Electronics" })).toBeNull();
    fireEvent.click(within(menu).getByRole("button", { name: "Bags & Wallets" }));

    expect(within(bar).getByRole("button", { name: "Category: Bags & Wallets" })).toBeTruthy();
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ category: "Bags & Wallets" })));
  });

  it("counts active filters, clears them from the bar, and keeps the query", async () => {
    render(<Harness />);
    const { overlay, bar } = await openFilters();
    fireEvent.click(within(overlay).getByRole("searchbox"));
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });

    fireEvent.click(within(bar).getByRole("button", { name: "Type" }));
    fireEvent.click(within(within(bar).getByRole("group", { name: "Type" })).getByRole("button", { name: "Lost" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Status" }));
    fireEvent.click(within(within(bar).getByRole("group", { name: "Status" })).getByRole("button", { name: "Open" }));

    const toggle = within(overlay).getByRole("button", { name: "Advanced search, 2 active" });
    expect(within(toggle).getByText("2")).toBeTruthy();

    // Clear is a real button beside the filter icon, not an underlined link
    // hiding at the end of the pill row.
    const clear = within(overlay).getByRole("button", { name: "Clear filters" });
    expect(clear.nextElementSibling).toBe(toggle);
    expect(within(bar).queryByRole("button", { name: "Clear filters" })).toBeNull();

    fireEvent.click(clear);
    expect(document.activeElement).toBe(toggle);
    expect(within(bar).getByRole("button", { name: "Type" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Status" })).toBeTruthy();
    expect(within(overlay).getByRole("searchbox")).toHaveProperty("value", "wallet");
    expect(within(overlay).queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("closes the calendar, the filter panel, the filter row and the search one Escape at a time", async () => {
    render(<Harness />);
    const { overlay, toggle, bar } = await openFilters();

    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    fireEvent.click(within(bar).getByRole("button", { name: /^From date/ }));
    expect(within(bar).getByRole("group", { name: "Start date" })).toBeTruthy();

    // One: the calendar returns to the date options, focus on its trigger.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(bar).queryByRole("group", { name: "Start date" })).toBeNull();
    expect(within(bar).getByRole("button", { name: "Last 7 days" })).toBeTruthy();
    expect(document.activeElement).toBe(within(bar).getByRole("button", { name: /^From date/ }));

    // Two: the date panel closes and the Date pill takes focus.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(bar).queryByRole("group", { name: "Date lost or found" })).toBeNull();
    expect(document.activeElement).toBe(within(bar).getByRole("button", { name: "Date" }));

    // Three: the filter row closes.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(overlay).queryByRole("group", { name: "Advanced search" })).toBeNull();
    expect(document.activeElement).toBe(toggle);

    // Four: the search closes.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("closes on an outside press", async () => {
    render(<Harness />);
    await openSearch();
    const backdrop = document.querySelector(".fb-search-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.pointerDown(backdrop!);
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("does not search when signed out and never fabricates results", async () => {
    io.user = null;
    render(<Harness />);
    const { overlay } = await openSearch();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    expect(await within(overlay).findByText("Sign in to search reports and people.")).toBeTruthy();
    expect(io.fetchFeed).not.toHaveBeenCalled();
    expect(io.searchPeople).not.toHaveBeenCalled();
  });
});
