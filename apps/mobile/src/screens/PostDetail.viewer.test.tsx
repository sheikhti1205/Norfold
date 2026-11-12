// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { posts } = vi.hoisted(() => ({ posts: {
  fetchPost: vi.fn(), fetchComments: vi.fn(), fetchSocialState: vi.fn(),
  addComment: vi.fn(), deleteComment: vi.fn(), reactToPost: vi.fn(), updatePostStatus: vi.fn(),
} }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" }, Plugins: {} }));
vi.mock("@capacitor/app-launcher", () => ({ AppLauncher: { openUrl: vi.fn() } }));
vi.mock("../services/posts", () => posts);
vi.mock("../services/realtime", () => ({ joinPostRoom: vi.fn(), leavePostRoom: vi.fn(), onRealtime: vi.fn(() => () => {}) }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "reader", username: "reader" } }) }));
vi.mock("../services/possibleMatches", () => ({ findPossibleMatches: vi.fn().mockResolvedValue({ available: true, candidatesConsidered: 0, matches: [] }), applyMatchesEngineToRuntime: () => true }));
vi.mock("../components/CommentComposer", () => ({ CommentComposer: () => <div data-testid="viewer-composer" /> }));

import { PostDetail } from "./PostDetail";

const post = {
  id: "p1", userId: "owner", author: { id: "owner", username: "owner" }, type: "LOST", status: "OPEN",
  title: "Lost wallet", description: "A wallet", category: "Accessories", eventDate: "2026-09-01",
  latitude: null, longitude: null, locationLabel: null, youtubeUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  likeCount: 0, dislikeCount: 0, ratingAvg: null, ratingCount: 0, commentCount: 0,
  attachments: [{ id: "a1", mimeType: "image/jpeg", fileUrl: "https://cdn.example/a.jpg", displayOrder: 1 }],
};
function renderDetail(contextual: boolean) {
  return render(<MemoryRouter initialEntries={["/posts/p1"]}><Routes><Route path="/posts/:id" element={<PostDetail contextual={contextual} />} /></Routes></MemoryRouter>);
}
describe("PostDetail viewer layout", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", "https://findback.test");
    posts.fetchPost.mockResolvedValue(post);
    posts.fetchComments.mockResolvedValue([]);
    posts.fetchSocialState.mockResolvedValue({ myReaction: null, myRating: null });
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

  it("shows both panes only in the contextual view", async () => {
    const view = renderDetail(true);
    expect(await screen.findByTestId("report-viewer-report-pane")).toBeTruthy();
    expect(screen.getByTestId("report-viewer-conversation-pane")).toBeTruthy();
    view.unmount();
    renderDetail(false);
    await screen.findByTestId("detail-comments");
    expect(screen.queryByTestId("report-viewer-report-pane")).toBeNull();
    expect(screen.queryByTestId("report-viewer-conversation-pane")).toBeNull();
  });
  it("places actions before the composer inside the conversation pane", async () => {
    renderDetail(true);
    const pane = await screen.findByTestId("report-viewer-conversation-pane");
    const actions = pane.querySelector("#detail-activity")!;
    const composer = within(pane).getByTestId("viewer-composer");
    expect(actions.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("omits the media region when there are no images", async () => {
    posts.fetchPost.mockResolvedValue({ ...post, attachments: [] });
    renderDetail(true);
    await screen.findByTestId("report-viewer-report-pane");
    expect(screen.queryByTestId("report-viewer-media")).toBeNull();
  });
  it.each([true, false])("renders one composer with contextual=%s", async (contextual) => {
    renderDetail(contextual);
    await screen.findByTestId("detail-comments");
    expect(screen.getAllByTestId("viewer-composer")).toHaveLength(1);
  });
  it("reveals report and actions together without concealing comments", async () => {
    posts.fetchPost.mockResolvedValue({ ...post, blockedAuthor: true });
    renderDetail(true);
    const report = await screen.findByTestId("report-viewer-report-pane");
    const conversation = screen.getByTestId("report-viewer-conversation-pane");
    expect(within(report).getByTestId("blocked-shield-content").getAttribute("aria-hidden")).toBe("true");
    expect(within(conversation).getByTestId("blocked-shield-content").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("detail-comments").closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getAllByRole("button", { name: "Show content" })).toHaveLength(1);
    fireEvent.click(within(report).getByRole("button", { name: "Show content" }));
    expect(within(report).getByTestId("blocked-shield-content").getAttribute("aria-hidden")).toBeNull();
    expect(within(conversation).getByTestId("blocked-shield-content").getAttribute("aria-hidden")).toBeNull();
  });
  it("conceals a different blocked report after navigation", async () => {
    posts.fetchPost.mockImplementation(async (id: string) => ({ ...post, id, blockedAuthor: true }));
    const router = createMemoryRouter([{ path: "/posts/:id", element: <PostDetail contextual /> }], { initialEntries: ["/posts/p1"] });
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show content" }));
    await act(async () => { await router.navigate("/posts/p2"); });
    const report = await screen.findByTestId("report-viewer-report-pane");
    expect(within(report).getByTestId("blocked-shield-content").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "Show content" })).toBeTruthy();
  });
});
