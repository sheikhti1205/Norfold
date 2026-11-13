// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { PostItem } from "@norfold/shared";
import { Insights, reportsByMonth } from "./Insights";

const { posts, recoveries } = vi.hoisted(() => ({ posts: vi.fn(), recoveries: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "reader" } }) }));
vi.mock("../components/AppBar", () => ({ AppBar: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../services/posts", () => ({ fetchMyPosts: posts }));
vi.mock("../services/trust", () => ({ listMyRecoveries: recoveries }));
afterEach(cleanup);
beforeEach(() => { posts.mockReset(); recoveries.mockReset(); });

function figureNamed(caption: string): HTMLElement {
  const node = screen.getByText(caption).closest("figure");
  if (!node) throw new Error(`No figure named ${caption}`);
  return node;
}

describe("Insights", () => {
  it("distinguishes loading from empty", () => {
    posts.mockReturnValue(new Promise(() => {})); recoveries.mockReturnValue(new Promise(() => {}));
    render(<Insights />);
    expect(screen.getByText("Loading your reports...")).toBeTruthy();
    expect(screen.queryByText("No reports yet.")).toBeNull();
  });

  it("reports failures instead of zero", async () => {
    posts.mockRejectedValue(new Error()); recoveries.mockRejectedValue(new Error());
    render(<Insights />);
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText("No reports yet.")).toBeNull();
  });

  it("shows empty reports and no average for no ratings", async () => {
    posts.mockResolvedValue({ items: [], nextCursor: null }); recoveries.mockResolvedValue([]);
    render(<Insights />);
    expect(await screen.findByText("No reports yet.")).toBeTruthy();
    expect(screen.getByText("0 ratings")).toBeTruthy();
    expect(screen.queryByText(/average/)).toBeNull();
    expect(screen.queryByText("Reports over time")).toBeNull();
  });

  it("draws the type split, status bars and rating average once per return", async () => {
    posts.mockResolvedValue({
      items: [
        { type: "LOST", status: "OPEN", createdAt: "2026-11-05T10:00:00Z" },
        { type: "LOST", status: "OPEN", createdAt: "2026-11-20T10:00:00Z" },
        { type: "FOUND", status: "CLOSED", createdAt: "2026-10-15T10:00:00Z" },
      ],
      nextCursor: null,
    });
    recoveries.mockResolvedValue([
      { returnId: "a", counterpartRating: 5 },
      { returnId: "a", counterpartRating: 5 },
      { returnId: "b", counterpartRating: 3 },
    ]);
    render(<Insights />);

    await screen.findByText("Lost and found");
    const mix = figureNamed("Lost and found");
    expect(within(mix).getByText("Lost")).toBeTruthy();
    expect(within(mix).getByText("2")).toBeTruthy();
    expect(within(mix).getByText("1")).toBeTruthy();

    const status = figureNamed("Status");
    expect(within(status).getByText("Resolved 1 of 3 (33%)")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("2 ratings, 4.0 average")).toBeTruthy());
    expect(within(figureNamed("How you were rated")).getByText("5 stars")).toBeTruthy();
  });

  it("does not present a partial report page as a total", async () => {
    posts.mockResolvedValue({ items: [{ type: "LOST", status: "OPEN", createdAt: "2026-11-05T10:00:00Z" }], nextCursor: "next" });
    recoveries.mockResolvedValue([]);
    render(<Insights />);
    expect(await screen.findByText(/full list could not be loaded/)).toBeTruthy();
    expect(screen.queryByText("Lost and found")).toBeNull();
  });
});

describe("reportsByMonth", () => {
  it("buckets real createdAt values into the last six months and skips junk", () => {
    const items = [
      { createdAt: "2026-11-05T10:00:00Z" },
      { createdAt: "2026-11-20T10:00:00Z" },
      { createdAt: "2026-08-15T10:00:00Z" },
      { createdAt: "2026-01-01T10:00:00Z" },
      { createdAt: "not-a-date" },
    ] as PostItem[];
    const months = reportsByMonth(items, new Date(2026, 10, 15));
    expect(months.map((month) => month.count)).toEqual([0, 0, 1, 0, 0, 2]);
  });
});
