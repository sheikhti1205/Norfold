// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoryValue, chooseCategory } from "../test-utils/reportCategory";
import { selectValue } from "../test-utils/select";

const { fetchFeedMock } = vi.hoisted(() => ({ fetchFeedMock: vi.fn() }));

vi.mock("../services/posts", () => ({ fetchFeed: fetchFeedMock }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "u1", username: "tester" } }) }));
vi.mock("../components/TabTap", () => ({ useTabTap: () => ({ tapCount: 0 }) }));

import { SearchScreen } from "./SearchScreen";
import { clearFeedCaches } from "../hooks/feedCache";

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

describe("SearchScreen filter sheet (G14)", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
    clearFeedCaches();
    fetchFeedMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  });

  afterEach(() => {
    cleanup();
    clearFeedCaches();
  });

  it("keeps the one query field visible and collects the type with the advanced filters", async () => {
    renderSearch();
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

    // Visible row retained: one search field, no type rail beside it.
    expect(screen.getByLabelText("Search posts")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "All" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Lost" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Found" })).toBeNull();

    // Advanced filters are NOT on the visible row anymore.
    expect(screen.queryByLabelText("Category")).toBeNull();
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByLabelText("Sort")).toBeNull();

    // A Filters launcher opens the sheet, which now owns the type too.
    const trigger = screen.getByRole("button", { name: /^filters/i });
    fireEvent.click(trigger);
    expect(await screen.findByLabelText("Type")).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
    expect(screen.getByLabelText("Sort")).toBeTruthy();
  });

  it("sheet edit round-trips to a removable chip + the URL", async () => {
    renderSearch();
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /^filters/i }));
    await screen.findByLabelText("Category");
    await chooseCategory("Electronics");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Chip appears; URL carries the filter (existing :18-35 semantics).
    expect(await screen.findByRole("button", { name: /remove category filter/i })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("category=Electronics"),
    );
    await waitFor(() =>
      expect(fetchFeedMock).toHaveBeenCalledWith(
        expect.objectContaining({ category: "Electronics" }),
        undefined,
      ),
    );

    // Removing the chip clears the URL param (filterability preserved).
    fireEvent.click(screen.getByRole("button", { name: /remove category filter/i }));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).not.toContain("category="),
    );
    expect(screen.queryByRole("button", { name: /remove category filter/i })).toBeNull();
  });

  it("clear-all removes every advanced filter and chip", async () => {
    renderSearch("/search?type=FOUND&category=Electronics&status=OPEN&sort=oldest&q=phone");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

    expect(await screen.findByRole("button", { name: /remove category filter/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove status filter/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove sort filter/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^clear filters$/i }));
    // The type is a CHIP in the same row as "Clear all filters" now, so
    // clearing every filter clears the type too. (This expectation changed
    // from "/search?type=FOUND&q=phone" when the type became a chip: the
    // control's meaning changed, so the pinned contract changed with it.)
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/search?q=phone"),
    );
    expect(screen.queryByRole("button", { name: /remove category filter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove status filter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove sort filter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove type filter/i })).toBeNull();
  });

  it("keeps one labelled clear control, disabled when empty and enabled after a selection", async () => {
    renderSearch();
    const clear = screen.getByRole("button", { name: "Clear filters" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(1);
    expect((dialog.querySelector("button.fb-search-filter-clear") as HTMLButtonElement).disabled).toBe(true);
    await chooseCategory("Electronics");
    expect((dialog.querySelector("button.fb-search-filter-clear") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dialog.querySelector("button.fb-search-filter-clear")!);
    await waitFor(() => expect(screen.queryByRole("button", { name: /remove category filter/i })).toBeNull());
  });

  it("deep-linked advanced filters restore chips without opening the sheet", async () => {
    renderSearch("/search?category=Electronics&status=OPEN&sort=oldest");
    await waitFor(() => expect(fetchFeedMock).toHaveBeenCalled());

    // Chips render from the URL alone.
    expect(await screen.findByRole("button", { name: /remove category filter/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove status filter/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove sort filter/i })).toBeTruthy();

    // The sheet still reflects the deep-linked values when opened.
    fireEvent.click(screen.getByRole("button", { name: /^filters/i }));
    expect(categoryValue()).toBe("Electronics");
    expect(selectValue("Status")).toBe("Open");
    expect(selectValue("Sort")).toBe("Oldest first");
  });
});
