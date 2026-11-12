// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { posts, recordReportView } = vi.hoisted(() => ({
  posts: { fetchPost: vi.fn(), fetchComments: vi.fn(), fetchSocialState: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(), reactToPost: vi.fn(), updatePostStatus: vi.fn() },
  recordReportView: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" }, Plugins: {} }));
vi.mock("@capacitor/app-launcher", () => ({ AppLauncher: { openUrl: vi.fn() } }));
vi.mock("../services/posts", () => posts);
vi.mock("../services/reportViews", () => ({ recordReportView }));
vi.mock("../services/realtime", () => ({ joinPostRoom: vi.fn(), leavePostRoom: vi.fn(), onRealtime: vi.fn(() => () => {}) }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "reader", username: "reader" } }) }));
vi.mock("../services/possibleMatches", () => ({ findPossibleMatches: vi.fn().mockResolvedValue({ available: true, candidatesConsidered: 0, matches: [] }), applyMatchesEngineToRuntime: () => true }));
vi.mock("../components/CommentComposer", () => ({ CommentComposer: () => <div /> }));

import { PostDetail } from "./PostDetail";

const post = {
  id: "p1", userId: "owner", author: { id: "owner", username: "owner" }, type: "LOST", status: "OPEN",
  title: "Lost wallet", description: "A wallet", category: "Accessories", eventDate: "2026-09-01",
  latitude: null, longitude: null, locationLabel: null, youtubeUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  likeCount: 0, dislikeCount: 0, ratingAvg: null, ratingCount: 0, commentCount: 0, attachments: [],
};

function renderDetail() {
  const router = createMemoryRouter([{ path: "/posts/:id", element: <PostDetail /> }], { initialEntries: ["/posts/p1"] });
  const view = render(<StrictMode><RouterProvider router={router} /></StrictMode>);
  return { router, ...view };
}

describe("PostDetail views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", "https://findback.test");
    posts.fetchPost.mockImplementation(async (id: string) => ({ ...post, id }));
    posts.fetchComments.mockResolvedValue([]);
    posts.fetchSocialState.mockResolvedValue({ myReaction: null, myRating: null });
    recordReportView.mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("omits zero views", async () => {
    posts.fetchPost.mockResolvedValue({ ...post, viewCount: 0 });
    renderDetail();
    await screen.findByTestId("post-action-row");
    expect(screen.queryByLabelText(/^Views,/)).toBeNull();
  });

  it("shows the full view count in the accessible name", async () => {
    posts.fetchPost.mockResolvedValue({ ...post, viewCount: 1200 });
    renderDetail();
    const views = await screen.findByLabelText("Views, 1200 views");
    expect(views.tagName).toBe("SPAN");
    expect(views.textContent).toBe("1200");
  });

  it("records once per report, including in-place navigation and StrictMode", async () => {
    const { router, rerender } = renderDetail();
    await screen.findByTestId("post-action-row");
    rerender(<StrictMode><RouterProvider router={router} /></StrictMode>);
    expect(recordReportView.mock.calls).toEqual([["p1"]]);
    await act(async () => { await router.navigate("/posts/p2"); });
    await waitFor(() => expect(recordReportView.mock.calls).toEqual([["p1"], ["p2"]]));
  });

  it("leaves the report visible when recording rejects", async () => {
    recordReportView.mockRejectedValue(new Error("offline"));
    renderDetail();
    expect(await screen.findByText("Lost wallet")).toBeTruthy();
    expect(screen.getByTestId("post-action-row")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  });
});
