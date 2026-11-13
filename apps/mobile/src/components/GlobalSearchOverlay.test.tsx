// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostItem, SearchedProfile } from "@norfold/shared";

const io = vi.hoisted(() => ({
  fetchFeed: vi.fn(),
  searchPeople: vi.fn(),
  user: { id: "searcher" } as { id: string } | null,
}));
vi.mock("../auth", () => ({ useAuth: () => ({ user: io.user }) }));
vi.mock("../services/posts", () => ({ fetchFeed: io.fetchFeed }));
vi.mock("../services/people", () => ({ searchPeople: io.searchPeople }));

import { GlobalSearchOverlay } from "./GlobalSearchOverlay";
import { resetGlobalSearch, toggleGlobalSearch, useGlobalSearchOpen } from "./globalSearch";

const report = {
  id: "report-1",
  title: "Blue wallet near the library",
  type: "LOST",
  category: "WALLETS",
  status: "OPEN",
} as unknown as PostItem;
const person = {
  id: "person-1",
  username: "amira",
  displayName: "Amira Saleh",
  avatarUrl: null,
} as SearchedProfile;

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

beforeEach(() => {
  io.user = { id: "searcher" };
  io.fetchFeed.mockReset();
  io.searchPeople.mockReset();
  io.fetchFeed.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  io.searchPeople.mockResolvedValue({ items: [], nextCursor: null });
  localStorage.clear();
  resetGlobalSearch();
});
afterEach(() => { cleanup(); resetGlobalSearch(); });

describe("app-wide search", () => {
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

  it("says so and offers to clear the filters when nothing matches", async () => {
    render(<Harness />);
    const { overlay } = await openSearch();
    const field = within(overlay).getByRole("searchbox");
    fireEvent.change(field, { target: { value: "zzzz" } });
    expect(await within(overlay).findByText("No results found")).toBeTruthy();
    fireEvent.click(within(overlay).getByRole("button", { name: "Clear filters" }));
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

  it("opens the advanced card, keeps focus in the bar and applies without leaving", async () => {
    render(<Harness />);
    const { overlay } = await openSearch();
    const advanced = within(overlay).getByRole("button", { name: "Advanced search" });
    fireEvent.click(advanced);
    const card = within(overlay).getByRole("group", { name: "Advanced search" });
    fireEvent.change(within(card).getByLabelText("Post type"), { target: { value: "LOST" } });
    fireEvent.click(within(card).getByRole("button", { name: "Apply" }));
    expect(within(overlay).queryByRole("group", { name: "Advanced search" })).toBeNull();
    expect(document.activeElement).toBe(advanced);
    expect(screen.getByTestId("route").textContent).toBe("/");
    // A filter with no words still searches: it is a real query state.
    await waitFor(() => expect(io.fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ type: "LOST" })));
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
