// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Insights } from "./Insights";

const { posts, recoveries } = vi.hoisted(() => ({ posts: vi.fn(), recoveries: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "reader" } }) }));
vi.mock("../components/AppBar", () => ({ AppBar: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../services/posts", () => ({ fetchMyPosts: posts }));
vi.mock("../services/trust", () => ({ listMyRecoveries: recoveries }));
afterEach(cleanup);
beforeEach(() => { posts.mockReset(); recoveries.mockReset(); });

describe("Insights", () => {
  it("distinguishes loading from empty", () => {
    posts.mockReturnValue(new Promise(() => {})); recoveries.mockReturnValue(new Promise(() => {}));
    render(<Insights />);
    expect(screen.getByText("Loading your reports...")).toBeTruthy();
    expect(screen.queryByText("No insights yet")).toBeNull();
  });
  it("reports failures instead of zero", async () => {
    posts.mockRejectedValue(new Error()); recoveries.mockRejectedValue(new Error());
    render(<Insights />);
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText("No insights yet")).toBeNull();
  });
  it("shows empty reports and no average for no ratings", async () => {
    posts.mockResolvedValue({ items: [], nextCursor: null }); recoveries.mockResolvedValue([]);
    render(<Insights />);
    expect(await screen.findByText("No insights yet")).toBeTruthy();
    expect(screen.getByText("0 ratings")).toBeTruthy();
    expect(screen.queryByText(/average/)).toBeNull();
    expect(screen.getByText(/confirmation details are not available/)).toBeTruthy();
  });
  it("groups reports and averages received ratings once per return", async () => {
    posts.mockResolvedValue({ items: [{ type: "LOST", status: "OPEN" }, { type: "LOST", status: "OPEN" }, { type: "FOUND", status: "CLOSED" }], nextCursor: null });
    recoveries.mockResolvedValue([{ returnId: "a", counterpartRating: 5 }, { returnId: "a", counterpartRating: 5 }, { returnId: "b", counterpartRating: 3 }]);
    render(<Insights />);
    expect(await screen.findByText("Lost, Open: 2")).toBeTruthy();
    expect(screen.getByText("Found, Closed: 1")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("2 ratings, 4.0 average")).toBeTruthy());
  });
  it("does not present a partial report page as a total", async () => {
    posts.mockResolvedValue({ items: [{ type: "LOST", status: "OPEN" }], nextCursor: "next" }); recoveries.mockResolvedValue([]);
    render(<Insights />);
    expect(await screen.findByText(/full list could not be loaded/)).toBeTruthy();
    expect(screen.queryByText("Lost, Open: 1")).toBeNull();
  });
});
