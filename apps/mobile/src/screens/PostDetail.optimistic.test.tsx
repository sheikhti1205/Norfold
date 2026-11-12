// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" }, Plugins: {} }));
vi.mock("@capacitor/app-launcher", () => ({ AppLauncher: { openUrl: vi.fn() } }));

const { postsMock, findMock, authState, realtimeHandlers } = vi.hoisted(() => ({
  postsMock: {
    fetchPost: vi.fn(), fetchComments: vi.fn(), fetchSocialState: vi.fn(), addComment: vi.fn(),
    deleteComment: vi.fn(), reactToPost: vi.fn(), updatePostStatus: vi.fn(),
  },
  findMock: vi.fn(),
  authState: { user: { id: "u2", username: "owner" } },
  realtimeHandlers: new Map<string, (payload: unknown) => void>(),
}));
vi.mock("../services/posts", () => postsMock);
vi.mock("../services/realtime", () => ({
  joinPostRoom: vi.fn(), leavePostRoom: vi.fn(),
  onRealtime: vi.fn((event: string, handler: (payload: unknown) => void) => {
    realtimeHandlers.set(event, handler);
    return () => { realtimeHandlers.delete(event); };
  }),
}));
vi.mock("../auth", () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock("../services/possibleMatches", () => ({ findPossibleMatches: findMock, applyMatchesEngineToRuntime: () => true }));

import { PostDetail } from "./PostDetail";
import { LiveRegion } from "../components/LiveRegion";

const basePost = {
  id: "p1", userId: "u2", author: { id: "u2", username: "owner" }, type: "FOUND", status: "OPEN",
  title: "Found keys", description: "plain description", category: "Electronics", eventDate: "2026-09-01",
  latitude: null, longitude: null, locationLabel: null, youtubeUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  likeCount: 0, dislikeCount: 0, ratingAvg: null, ratingCount: 0, commentCount: 0, attachments: [],
};

function makeComment(id: string, username: string, body: string, parentId: string | null = null, depth = 0) {
  return { id, postId: "p1", parentId, depth, body, createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z", author: { id: `u-${id}`, username } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function renderDetail() {
  return render(<MemoryRouter initialEntries={["/posts/p1"]}>
    <Routes><Route path="/posts/:id" element={<PostDetail />} /></Routes><LiveRegion />
  </MemoryRouter>);
}

async function submit(body: string) {
  fireEvent.change(await screen.findByRole("combobox", { name: "Comment" }), { target: { value: body } });
  fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
}

describe("PostDetail comment write revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeHandlers.clear();
    postsMock.fetchPost.mockResolvedValue(basePost);
    postsMock.fetchSocialState.mockResolvedValue({ myReaction: null, myRating: null });
    findMock.mockResolvedValue({ available: true, candidatesConsidered: 0, matches: [] });
    postsMock.addComment.mockImplementation(async (_postId: string, body: string, parentId: string | null) =>
      makeComment("c-new", "owner", body, parentId, parentId ? 1 : 0));
  });
  afterEach(cleanup);

  it("paints the created comment while revalidation is pending", async () => {
    const refresh = deferred<ReturnType<typeof makeComment>[]>();
    postsMock.fetchComments.mockResolvedValueOnce([]).mockReturnValue(refresh.promise);
    renderDetail();
    await waitFor(() => expect(postsMock.fetchComments).toHaveBeenCalledTimes(1));
    await submit("new comment body");
    await waitFor(() => expect(postsMock.fetchComments).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("new comment body")).toBeTruthy();
    await act(async () => { refresh.resolve([makeComment("c-new", "owner", "new comment body")]); });
  });

  it("places a created reply inside its root while revalidation is pending", async () => {
    const root = makeComment("root", "rootU", "root body");
    const refresh = deferred<ReturnType<typeof makeComment>[]>();
    postsMock.fetchComments.mockResolvedValueOnce([root]).mockReturnValue(refresh.promise);
    renderDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Reply to rootU" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reply to rootU" }), { target: { value: "new reply body" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(postsMock.fetchComments).toHaveBeenCalledTimes(2));
    const reply = await screen.findByText("new reply body");
    expect(document.getElementById("detail-comment-root")?.contains(reply)).toBe(true);
    expect(postsMock.addComment).toHaveBeenCalledWith("p1", "new reply body", "root");
    await act(async () => { refresh.resolve([root, makeComment("c-new", "owner", "new reply body", "root", 1)]); });
  });

  it("keeps one row when the authoritative list contains the created comment", async () => {
    const refresh = deferred<ReturnType<typeof makeComment>[]>();
    postsMock.fetchComments.mockResolvedValueOnce([]).mockReturnValue(refresh.promise);
    renderDetail();
    await waitFor(() => expect(postsMock.fetchComments).toHaveBeenCalledTimes(1));
    await submit("unique comment body");
    await waitFor(() => expect(postsMock.fetchComments).toHaveBeenCalledTimes(2));
    await act(async () => { refresh.resolve([makeComment("c-new", "owner", "unique comment body")]); });
    await waitFor(() => expect(screen.getAllByText("unique comment body")).toHaveLength(1));
    expect(document.querySelectorAll('[id="detail-comment-c-new"]')).toHaveLength(1);
  });

  it("retains the draft and announces the error when the write fails", async () => {
    postsMock.fetchComments.mockResolvedValue([]);
    postsMock.addComment.mockRejectedValue(new Error("write failed"));
    renderDetail();
    await waitFor(() => expect(postsMock.fetchComments).toHaveBeenCalledTimes(1));
    await submit("keep this draft");
    await waitFor(() => expect(screen.getByTestId("live-region-announcement").textContent).toBe("Couldn't post your comment. Try again."));
    expect(screen.getAllByText("Couldn't post your comment. Try again.").length).toBeGreaterThan(0);
    expect(within(document.body).getByRole("combobox", { name: "Comment" })).toHaveProperty("value", "keep this draft");
    expect(document.getElementById("detail-comment-c-new")).toBeNull();
  });
});
