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
  fetchProfile: vi.fn(),
  fetchConnections: vi.fn(),
  extract: vi.fn(),
  user: { id: "searcher" } as { id: string } | null,
  pointer: { fine: false },
}));
vi.mock("../auth", () => ({
  useAuth: () => ({ user: io.user }),
  useOptionalAuth: () => ({ user: io.user }),
}));
vi.mock("../services/posts", () => ({ fetchFeed: io.fetchFeed }));
vi.mock("../services/liveNarrowTasks", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/liveNarrowTasks")>(),
  nlExtractLive: io.extract,
}));
vi.mock("../services/people", () => ({ searchPeople: io.searchPeople }));
// The people row now carries the one person card. Its own reads are mocked so a
// tap opens the card without reaching a real profile or connection endpoint.
vi.mock("../services/profile", () => ({ fetchPublicProfile: io.fetchProfile }));
vi.mock("../services/connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/connections")>();
  return { ...actual, fetchConnectionCount: io.fetchConnections };
});
vi.mock("../services/messaging/useMessaging", () => ({
  useMessaging: () => ({ accountId: null, status: "closed", currentProjections: null }),
}));
// Hover previews exist only on a fine pointer; jsdom has none. The switch is
// explicit so the hover contract is tested without pretending jsdom can hover.
vi.mock("./inputCapabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inputCapabilities")>();
  return { ...actual, useFinePointer: () => io.pointer.fine };
});

import { GlobalSearchOverlay } from "./GlobalSearchOverlay";
import { clearProfilePreviewCache } from "./ProfilePreview";
import { resetGlobalSearch, toggleGlobalSearch, useGlobalSearchOpen } from "./globalSearch";
import { resetModalLayers } from "../hooks/modalLayers";

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
const publicProfile = {
  id: "person-1",
  username: "amira",
  displayName: "Amira Saleh",
  avatarUrl: null,
  emailVerified: true,
  phoneVerified: false,
  bio: "Keeps the reading room noticeboard current.",
  locationLabel: "Central Library",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

// The picker names its own month heading and jump buttons with the runtime
// locale (`Intl.DateTimeFormat` with no locale), so the test must format the
// same way instead of assuming en-US month names.
const MONTH_LONG = new Intl.DateTimeFormat(undefined, { month: "long" });
const MONTH_YEAR_LABEL = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

const PICKER_DATE_LABEL = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A day inside the month the picker opens on. Fixed day numbers keep the
 * assertions off the month boundary: "yesterday" or "tomorrow" can fall in the
 * adjacent month, where the cell is not rendered at all.
 */
function utcDayInMonth(day: number) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  const iso = date.toISOString().slice(0, 10);
  return { iso, label: DAY_LABEL.format(new Date(`${iso}T00:00:00Z`)) };
}

function lastUtcDayInMonth() {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return utcDayInMonth(day);
}

/** 15th of next month: always ahead of today and always mid-month. */
function nextMonthFifteenth() {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const month = (now.getUTCMonth() + 1) % 12;
  const iso = `${year}-${String(month + 1).padStart(2, "0")}-15`;
  return {
    iso,
    label: DAY_LABEL.format(new Date(`${iso}T00:00:00Z`)),
    heading: MONTH_YEAR_LABEL.format(new Date(year, month, 1)),
  };
}

/** A month in the picker's opening year, chosen so the heading must change. */
function otherMonth() {
  const now = new Date();
  const month = now.getUTCMonth() === 0 ? 1 : 0;
  const year = now.getUTCFullYear();
  return {
    buttonName: `${MONTH_LONG.format(new Date(2024, month, 15))} ${year}`,
    heading: MONTH_YEAR_LABEL.format(new Date(year, month, 1)),
  };
}

/** The overlay's presets are local calendar days; format the same fields. */
function localIso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

/** Type a query and return the live people row it produced. */
async function searchPeopleRow(query = "wallet") {
  const { overlay } = await openSearch();
  fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: query } });
  const row = await within(overlay).findByRole("link", { name: /Amira Saleh/ });
  return { overlay, row };
}

/** Open the month menu, then the shared picker's own From sheet. */
async function openFromPicker() {
  const { overlay, bar } = await openFilters();
  fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
  const menu = within(bar).getByRole("group", { name: "Date lost or found" });
  const trigger = within(menu).getByRole("button", { name: "From date. Any date" });
  // jsdom's click does not move focus the way a real pointer press does; the
  // sheet restores focus to whatever was focused when it opened.
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "From date" });
  return { overlay, bar, menu, trigger, dialog };
}

beforeEach(() => {
  io.user = { id: "searcher" };
  io.pointer.fine = false;
  io.fetchFeed.mockReset();
  io.searchPeople.mockReset();
  io.fetchProfile.mockReset();
  io.fetchConnections.mockReset();
  io.extract.mockReset().mockResolvedValue({});
  io.fetchFeed.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  io.searchPeople.mockResolvedValue({ items: [], nextCursor: null });
  io.fetchProfile.mockResolvedValue(publicProfile);
  io.fetchConnections.mockResolvedValue(null);
  clearProfilePreviewCache();
  localStorage.clear();
  resetGlobalSearch();
  resetModalLayers();
});
afterEach(() => { cleanup(); resetGlobalSearch(); resetModalLayers(); vi.unstubAllGlobals(); });

describe("app-wide search", () => {
  it("automatically applies extracted filters without rewriting the search", async () => {
    io.extract.mockResolvedValue({ category: "Electronics" });
    render(<Harness />);
    const { overlay } = await openSearch();
    const field = within(overlay).getByRole("searchbox");
    fireEvent.change(field, { target: { value: "lost phone" } });
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(
      expect.objectContaining({ q: "lost phone", category: "Electronics" }),
    ));
    expect(field).toHaveProperty("value", "lost phone");
    expect(within(overlay).getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });

  it("ignores an extraction that finishes after a manual filter selection", async () => {
    let answer!: (value: { type: "FOUND"; postType: "FOUND" }) => void;
    io.extract.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    render(<Harness />);
    const { overlay, bar } = await openFilters();
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });
    await waitFor(() => expect(io.extract).toHaveBeenCalledWith("wallet"));
    fireEvent.click(within(bar).getByRole("button", { name: "Type" }));
    fireEvent.click(within(within(bar).getByRole("group", { name: "Type" })).getByRole("button", { name: "Lost" }));
    answer({ type: "FOUND", postType: "FOUND" });
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ type: "LOST" })));
    expect(within(bar).getByRole("button", { name: "Type: Lost" })).toBeTruthy();
  });
  it("keeps a visible focus ring on the filter pills", () => {
    expect(searchStyles).toMatch(/\.fb-search-pill:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--fb-focus\)/s);
    expect(searchStyles).not.toMatch(/\.fb-search-pill:focus-visible\s*\{[^}]*outline:\s*none/s);
  });

  it("has no second calendar implementation of its own", () => {
    // The search date fields reuse the canonical ReportDatePicker sheet. A
    // search-owned calendar stylesheet is the regression this guards against.
    expect(searchStyles).not.toMatch(/\.fb-search-calendar/);
    expect(searchStyles).not.toMatch(/\.fb-search-date-trigger/);
    expect(searchStyles).toMatch(/\.fb-search-date-fields\s*\{/);
  });

  it("centres the overlay with insets instead of a transform that would trap the sheet", () => {
    // The shared date sheet is position: fixed. A transform on the overlay would
    // make it the containing block for that sheet, so centring must not use
    // translate. Comments are stripped first so the rule's own explanation of
    // that constraint is not mistaken for a declaration.
    const css = searchStyles.replace(/\/\*[\s\S]*?\*\//g, "");
    const overlayRule = /\.fb-search-overlay\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(overlayRule).toMatch(/inset:\s*0;/);
    expect(overlayRule).toMatch(/margin:\s*auto;/);
    expect(overlayRule).toMatch(/height:\s*fit-content;/);
    expect(overlayRule).not.toMatch(/transform|translate/);

    // The phone override keeps the measured top anchor and side insets.
    const phoneRule =
      /@media\s*\(max-width:\s*599px\)\s*\{[\s\S]*?\.fb-search-overlay\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(phoneRule).toMatch(/inset:\s*0\s+8px\s+auto\s+8px;/);
    expect(phoneRule).toMatch(/margin:\s*0;/);
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

  it("opens the shared date picker for a bound instead of a second calendar", async () => {
    render(<Harness />);
    const { overlay, bar } = await openFilters();

    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    expect(within(menu).getByRole("button", { name: "Last 7 days" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Last 30 days" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "This year" })).toBeTruthy();
    // No native date inputs survive the redesign.
    expect(within(menu).queryByRole("textbox")).toBeNull();

    const fromTrigger = within(menu).getByRole("button", { name: "From date. Any date" });
    fromTrigger.focus();
    fireEvent.click(fromTrigger);
    const dialog = await screen.findByRole("dialog", { name: "From date" });

    // The shared sheet is the only calendar the overlay mounts: its test ids
    // and react-aria grid are the whole date UI here.
    expect(within(dialog).getByTestId("calendar-surface")).toBeTruthy();
    expect(within(dialog).getByRole("grid")).toBeTruthy();
    expect(overlay.querySelector(".fb-search-calendar")).toBeNull();
    expect(overlay.querySelectorAll('[data-testid="calendar-surface"]')).toHaveLength(1);
    // The independent Monday-first month/year controls are gone.
    expect(within(dialog).queryByRole("button", { name: "Choose month" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Choose year" })).toBeNull();

    // The shared picker still offers its one month/year jump control.
    fireEvent.click(within(dialog).getByRole("button", { name: /choose month and year/i }));
    const jumpPanel = within(dialog).getByTestId("calendar-jump-panel");
    const target = otherMonth();
    fireEvent.click(within(jumpPanel).getByRole("button", { name: target.buttonName }));
    await waitFor(() => expect(
      within(dialog).getByRole("heading", { name: new RegExp(escapeRegex(target.heading)) }),
    ).toBeTruthy());

    // The pills stay mounted (so their scroll position survives) while the
    // shared sheet covers the results.
    expect(within(bar).getByRole("button", { name: /^Date/ })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "From date" })).toBeNull());
  });

  it("applies a date preset's real bounds and clears both of them on Any date", async () => {
    render(<Harness />);
    const { overlay, bar } = await openFilters();
    // A word keeps the feed live after the dates return to "any".
    fireEvent.change(within(overlay).getByRole("searchbox"), { target: { value: "wallet" } });

    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    let menu = within(bar).getByRole("group", { name: "Date lost or found" });
    expect(within(menu).getByRole("button", { name: "Any date" }).getAttribute("aria-pressed")).toBe("true");

    // "Last 7 days" is the local calendar day six days back through today.
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    fireEvent.click(within(menu).getByRole("button", { name: "Last 7 days" }));

    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: localIso(start),
      dateTo: localIso(today),
    })));
    // The panel closes, and the date pill names the preset it applied.
    expect(within(bar).queryByRole("group", { name: "Date lost or found" })).toBeNull();
    const presetPill = within(bar).getByRole("button", { name: "Date: Last 7 days" });
    expect(document.activeElement).toBe(presetPill);

    // Any date resets both bounds, not just one: the pill returns to "Date".
    fireEvent.click(presetPill);
    menu = within(bar).getByRole("group", { name: "Date lost or found" });
    expect(within(menu).getByRole("button", { name: "Last 7 days" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(menu).getByRole("button", { name: "Any date" }));

    await waitFor(() => {
      const call = io.fetchFeed.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(call?.dateFrom).toBeUndefined();
      expect(call?.dateTo).toBeUndefined();
    });
    expect(within(bar).getByRole("button", { name: "Date" })).toBeTruthy();
  });

  it("does not apply a picked date until the shared picker is confirmed", async () => {
    render(<Harness />);
    const { bar, menu, trigger } = await openFromPicker();
    const picked = utcDayInMonth(15);

    fireEvent.click(within(screen.getByRole("dialog", { name: "From date" }))
      .getByRole("button", { name: new RegExp(escapeRegex(picked.label), "i") }));
    // A picked day is a draft: the filter and its query are untouched.
    expect(io.fetchFeed).not.toHaveBeenCalled();
    expect(within(bar).getByRole("button", { name: /^Date/ })).toBeTruthy();

    fireEvent.click(within(screen.getByRole("dialog", { name: "From date" }))
      .getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "From date" })).toBeNull());
    expect(within(menu).getByRole("button", { name: "From date. Any date" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(io.fetchFeed).not.toHaveBeenCalled();

    // Confirm is the one commit point.
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "From date" });
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(escapeRegex(picked.label), "i") }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: picked.iso,
    })));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(within(menu).getByRole("button", { name: `From date. ${PICKER_DATE_LABEL.format(new Date(`${picked.iso}T00:00:00Z`))}` })).toBeTruthy();
  });

  it("scrolls the open pill back into view when a chosen value widens it", async () => {
    render(<Harness />);
    const { bar } = await openFilters();

    const datePill = within(bar).getByRole("button", { name: "Date" });
    fireEvent.click(datePill);
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    const fromTrigger = within(menu).getByRole("button", { name: "From date. Any date" });
    fromTrigger.focus();
    fireEvent.click(fromTrigger);
    const dialog = await screen.findByRole("dialog", { name: "From date" });

    // A phone cannot fit every pill. Choosing a day widens "Date" into
    // "From Nov 15"; the row must follow the label instead of leaving half
    // the value scrolled out of sight.
    const scroll = vi.fn();
    datePill.scrollIntoView = scroll;
    fireEvent.click(within(dialog).getByRole("button", { name: /^today$/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" }));
    expect(within(bar).getByRole("button", { name: /^Date/ })).toBe(datePill);
  });

  it("bounds the end date by the start date and clears one bound", async () => {
    render(<Harness />);
    const { bar } = await openFromPicker();
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    // Both days sit inside the month the picker opens on, so the assertions
    // never depend on where today falls in the month.
    const first = utcDayInMonth(1);
    const last = lastUtcDayInMonth();

    // Set From to the month's last day through the shared picker.
    fireEvent.click(within(screen.getByRole("dialog", { name: "From date" }))
      .getByRole("button", { name: new RegExp(escapeRegex(last.label), "i") }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "From date" }))
      .getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: last.iso,
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "From date" })).toBeNull());

    // To cannot precede From: the shared picker disables the earlier day and
    // still allows the bound itself.
    const toTrigger = within(menu).getByRole("button", { name: "To date. Any date" });
    toTrigger.focus();
    fireEvent.click(toTrigger);
    const dialog = await screen.findByRole("dialog", { name: "To date" });
    const disabledDay = within(dialog).getByRole("button", { name: new RegExp(escapeRegex(first.label), "i") });
    const allowedDay = within(dialog).getByRole("button", { name: new RegExp(escapeRegex(last.label), "i") });
    expect(disabledDay.getAttribute("aria-disabled")).toBe("true");
    expect(allowedDay.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(allowedDay);
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: last.iso,
      dateTo: last.iso,
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "To date" })).toBeNull());

    // Clear one bound without touching the other.
    fireEvent.click(within(menu).getByRole("button", { name: "Clear from date" }));
    await waitFor(() => {
      const call = io.fetchFeed.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
      expect(call?.dateFrom).toBeUndefined();
      expect(call?.dateTo).toBe(last.iso);
    });
    // Read the focus back after the clear has rendered: the closing date
    // sheet's focus return is still in flight when the click lands.
    await waitFor(() => {
      const emptied = within(menu).getByRole("button", { name: "From date. Any date" });
      expect(document.activeElement).toBe(emptied);
    });
  });

  it("blocks the days after the end bound when choosing the start bound", async () => {
    render(<Harness />);
    const { bar } = await openFilters();
    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });

    // End mid-month, so the following day is still in the same grid.
    const end = utcDayInMonth(15);
    const toTrigger = within(menu).getByRole("button", { name: "To date. Any date" });
    toTrigger.focus();
    fireEvent.click(toTrigger);
    let dialog = await screen.findByRole("dialog", { name: "To date" });
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(escapeRegex(end.label), "i") }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateTo: end.iso,
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "To date" })).toBeNull());

    // The start may not pass the end, but the end day itself is inclusive.
    const afterEnd = utcDayInMonth(16);
    const fromTrigger = within(menu).getByRole("button", { name: "From date. Any date" });
    fromTrigger.focus();
    fireEvent.click(fromTrigger);
    dialog = await screen.findByRole("dialog", { name: "From date" });
    const blocked = within(dialog).getByRole("button", { name: new RegExp(escapeRegex(afterEnd.label), "i") });
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    const inclusive = within(dialog).getByRole("button", { name: new RegExp(escapeRegex(end.label), "i") });
    expect(inclusive.getAttribute("aria-disabled")).not.toBe("true");

    // A blocked day cannot be committed: with no draft, Confirm stays disabled.
    fireEvent.click(blocked);
    expect(within(dialog).getByRole("button", { name: /^confirm$/i }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(inclusive);
    const confirm = within(dialog).getByRole("button", { name: /^confirm$/i });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: end.iso,
      dateTo: end.iso,
    })));
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
    expect((within(overlay).getByRole("button", { name: "Clear filters" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes the shared date sheet, the date panel, the filter row and the search one Escape at a time", async () => {
    render(<Harness />);
    const { overlay, toggle, bar } = await openFilters();

    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    const fromTrigger = within(menu).getByRole("button", { name: "From date. Any date" });
    fromTrigger.focus();
    fireEvent.click(fromTrigger);
    await screen.findByRole("dialog", { name: "From date" });

    // One: the shared sheet closes; the date panel behind it stays open.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "From date" })).toBeNull());
    expect(within(bar).getByRole("group", { name: "Date lost or found" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(fromTrigger));

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

  it("keeps future dates selectable in search while reports stay past-only", async () => {
    render(<Harness />);
    const { bar } = await openFilters();
    fireEvent.click(within(bar).getByRole("button", { name: "Date" }));
    const menu = within(bar).getByRole("group", { name: "Date lost or found" });
    const toTrigger = within(menu).getByRole("button", { name: "To date. Any date" });
    toTrigger.focus();
    fireEvent.click(toTrigger);
    const dialog = await screen.findByRole("dialog", { name: "To date" });

    // The future opt-in keeps the filter's historical domain: an explicit
    // allowFuture, not a silent change to the report picker's past-only cap.
    const nextMonthButton = within(dialog).getByRole("button", { name: /next month/i }) as HTMLButtonElement;
    expect(nextMonthButton.disabled).toBe(false);
    fireEvent.click(nextMonthButton);

    const next = nextMonthFifteenth();
    await waitFor(() => expect(
      within(dialog).getByRole("heading", { name: new RegExp(escapeRegex(next.heading)) }),
    ).toBeTruthy());
    const cell = within(dialog).getByRole("button", { name: new RegExp(escapeRegex(next.label), "i") });
    expect(cell.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(cell);
    fireEvent.click(within(dialog).getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({
      dateTo: next.iso,
    })));
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

  it("opens the person card on a touch tap without closing the search", async () => {
    io.fetchFeed.mockResolvedValue({ items: [report], nextCursor: null, total: 1 });
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { overlay, row } = await searchPeopleRow();

    // The people row carries the one person card; a report row keeps its own
    // search-only photo preview and is not a person trigger.
    expect(row.closest(".fb-profile-preview-trigger")).toBeTruthy();
    const reportRow = within(overlay).getByRole("link", { name: /Blue wallet near the library/ });
    expect(reportRow.closest(".fb-profile-preview-trigger")).toBeNull();
    // Nothing is read for a profile until the card is actually asked for.
    expect(io.fetchProfile).not.toHaveBeenCalled();

    fireEvent.click(row, { detail: 1 });

    const card = await screen.findByTestId("profile-preview");
    // The tap hands focus to the card's first action, so the reader lands
    // inside the card instead of behind it.
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    // A tap opens the card; it must not also dismiss the search behind it.
    expect(screen.getByRole("search")).toBeTruthy();
    // Pressing inside the portalled card is not an outside press on the search.
    fireEvent.pointerDown(card);
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("/");
    await waitFor(() => expect(io.fetchProfile).toHaveBeenCalledWith("amira"));
  });

  it("navigates from the card's View full profile and closes the search", async () => {
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { row } = await searchPeopleRow();
    fireEvent.click(row, { detail: 1 });
    const card = await screen.findByTestId("profile-preview");

    fireEvent.click(within(card).getByRole("link", { name: "View full profile" }), { detail: 1 });

    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/u/amira"));
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("closes only the card from its Close, leaving the search open", async () => {
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { row } = await searchPeopleRow();
    fireEvent.click(row, { detail: 1 });
    const card = await screen.findByTestId("profile-preview");

    fireEvent.click(within(card).getByRole("button", { name: "Close profile preview" }), { detail: 1 });

    await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
    // The identity gets its focus back; landing there must not reopen the card.
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(screen.queryByTestId("profile-preview")).toBeNull();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("/");
  });

  it("closes the card first and the search on the next Escape", async () => {
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { row } = await searchPeopleRow();
    fireEvent.click(row, { detail: 1 });
    await screen.findByTestId("profile-preview");

    fireEvent.keyDown(row, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(screen.queryByTestId("profile-preview")).toBeNull();
    expect(screen.getByRole("search")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("opens the person card on a fine-pointer rest and still navigates on click", async () => {
    io.pointer.fine = true;
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { row } = await searchPeopleRow();

    fireEvent.pointerOver(row.closest(".fb-profile-preview-trigger")!, { pointerType: "mouse" });
    expect(await screen.findByTestId("profile-preview")).toBeTruthy();
    // A rest is not a tap: the search field keeps focus.
    expect(screen.getByTestId("profile-preview").contains(document.activeElement)).toBe(false);

    fireEvent.click(row, { detail: 1 });
    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/u/amira"));
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });

  it("keeps the direct destination for a keyboard activation", async () => {
    io.searchPeople.mockResolvedValue({ items: [person], nextCursor: null });
    render(<Harness />);
    const { row } = await searchPeopleRow();

    fireEvent.click(row, { detail: 0 });

    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/u/amira"));
    expect(screen.queryByTestId("profile-preview")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
  });
});
