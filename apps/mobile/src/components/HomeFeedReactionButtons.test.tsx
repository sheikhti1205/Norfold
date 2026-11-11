// @vitest-environment jsdom
import type { PostItem } from "@norfold/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeFeedReactionButtons } from "./HomeFeedReactionButtons";
import { announce, announceQuietly, LiveRegion } from "./LiveRegion";
import { FeedLoveProvider, type FeedPatchItem } from "../hooks/useFeedLove";

const { feedFetchMock, likeToggleMock, rpcMock } = vi.hoisted(() => ({
  feedFetchMock: vi.fn(),
  likeToggleMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../services/feedReactions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/feedReactions")>();
  return { ...actual, fetchFeedReactionState: feedFetchMock, toggleReaction: likeToggleMock };
});

vi.mock("../services/supabaseClient", () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

function post(): PostItem {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  return {
    id: "p1",
    userId: "u1",
    author: { id: "u1", username: "alice", emailVerified: false, phoneVerified: false, avatarUrl: null, createdAt: twoHoursAgo },
    type: "LOST",
    status: "OPEN",
    title: "Lost dog",
    description: "Near the park.",
    category: "Pet Accessories",
    eventDate: "2026-09-29",
    latitude: null,
    longitude: null,
    locationLabel: null,
    youtubeUrl: null,
    createdAt: twoHoursAgo,
    updatedAt: twoHoursAgo,
    likeCount: 24,
    dislikeCount: 1,
    ratingAvg: null,
    ratingCount: 0,
    commentCount: 0,
    attachments: [],
  } as PostItem;
}

function renderButton(
  target: PostItem = post(),
  reactions: Record<string, { myReaction: "LIKE" | "DISLIKE" | "HELPFUL" | null; myRating: number | null }> = {},
) {
  feedFetchMock.mockResolvedValue(reactions);
  return render(
    <MemoryRouter>
      <FeedLoveProvider items={[target]} patchItem={vi.fn() as unknown as FeedPatchItem}>
        <HomeFeedReactionButtons postId={target.id} likeCount={target.likeCount} dislikeCount={target.dislikeCount} />
      </FeedLoveProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  feedFetchMock.mockReset();
  likeToggleMock.mockReset();
  rpcMock.mockReset();
  feedFetchMock.mockResolvedValue({});
  likeToggleMock.mockResolvedValue({
    postId: "p1",
    likeCount: 25,
    dislikeCount: 1,
    myReaction: "LIKE",
    reactionCounts: {
      counts: { LOVE: 25, DISLIKE: 1 },
      myReaction: "LIKE",
      total: 26,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HomeFeedReactionButtons (Like and Dislike)", () => {
  it("keeps background count updates silent", () => {
    const listener = vi.fn();
    const normalListener = vi.fn();
    window.addEventListener("findback:announce-quietly", listener);
    window.addEventListener("findback:announce", normalListener);
    render(<LiveRegion />);
    const view = render(<HomeFeedReactionButtons postId="p1" likeCount={2} dislikeCount={0} />);
    view.rerender(<HomeFeedReactionButtons postId="p1" likeCount={3} dislikeCount={0} />);
    expect(listener).not.toHaveBeenCalled();
    expect(normalListener).not.toHaveBeenCalled();
    expect(screen.queryByTestId("snackbar-message")).toBeNull();
    window.removeEventListener("findback:announce-quietly", listener);
    window.removeEventListener("findback:announce", normalListener);
  });
  it.each([true, false])("announces only settled counts after a local tap (provider: %s)", async (provider) => {
    const quiet = vi.fn();
    window.addEventListener("findback:announce-quietly", quiet);
    let release!: (value: unknown) => void;
    likeToggleMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const item = { ...post(), likeCount: 2, dislikeCount: 0 };
    if (provider) renderButton(item);
    else render(<HomeFeedReactionButtons postId="p1" likeCount={2} dislikeCount={0} />);
    fireEvent.click(screen.getByTestId("home-feed-love"));
    expect(screen.getByTestId("home-feed-love").textContent).toBe("3");
    expect(quiet).not.toHaveBeenCalled();
    await act(async () => release({ postId: "p1", likeCount: 4, dislikeCount: 0, myReaction: "LIKE", reactionCounts: { counts: { LOVE: 4 }, myReaction: "LIKE", total: 4 } }));
    await waitFor(() => expect(quiet).toHaveBeenCalledTimes(1));
    expect((quiet.mock.calls[0]?.[0] as CustomEvent<string>).detail).toBe("4 likes, 0 dislikes.");
    window.removeEventListener("findback:announce-quietly", quiet);
  });
  it("keeps normal snackbars separate from quiet announcements", () => {
    render(<LiveRegion />);
    act(() => announce("Could not save"));
    expect(screen.getByTestId("live-region-announcement").textContent).toBe("Could not save");
    expect(screen.getByTestId("snackbar-message").textContent).toBe("Could not save");
    act(() => announceQuietly("3 likes"));
    expect(screen.getByTestId("live-region-announcement").textContent).toBe("3 likes");
    expect(screen.getByTestId("snackbar-message").textContent).toBe("Could not save");
  });
  it("uses a later snapshot's counts without losing the viewer's reaction", async () => {
    const original = { ...post(), reactionSummary: { counts: { LOVE: 24, DISLIKE: 1 }, total: 25, myReaction: null } } as PostItem;
    const view = (item: PostItem) => <MemoryRouter><FeedLoveProvider items={[item]} patchItem={vi.fn()}><HomeFeedReactionButtons postId="p1" likeCount={item.likeCount} dislikeCount={item.dislikeCount} /></FeedLoveProvider></MemoryRouter>;
    const rendered = render(view(original));
    fireEvent.click(screen.getByTestId("home-feed-love"));
    await waitFor(() => expect(screen.getByTestId("home-feed-love").getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(screen.getByTestId("home-feed-love").getAttribute("aria-busy")).toBe("false"));
    rendered.rerender(view({ ...original, reactionSummary: { counts: { LOVE: 26, DISLIKE: 1 }, total: 27, myReaction: "LIKE" } } as PostItem));
    expect(screen.getByTestId("home-feed-love").textContent).toBe("26");
    expect(screen.getByTestId("home-feed-love").getAttribute("aria-pressed")).toBe("true");
  });
  it("keeps the like testid, flat styling and 44px target, and offers no picker", () => {
    renderButton();
    const like = screen.getByTestId("home-feed-love");
    expect(like.tagName).toBe("BUTTON");
    expect(like.getAttribute("type")).toBe("button");
    expect(like.className).toMatch(/fb-report-action/);
    expect(like.className).toMatch(/min-h-\[44px\]/);
    expect(like.className).toMatch(/min-w-\[44px\]/);
    // The tray, its chevron and every hold gesture are gone.
    expect(screen.queryByTestId("home-feed-choose-reaction")).toBeNull();
    expect(screen.queryByTestId("reaction-tray")).toBeNull();
    expect(like.getAttribute("aria-haspopup")).toBeNull();
  });

  it("likes with LIKE and unlikes with null on a second tap", async () => {
    renderButton();
    const like = screen.getByTestId("home-feed-love");
    expect(like.getAttribute("aria-pressed")).toBe("false");
    expect(like.textContent).toBe("24");
    expect(like.getAttribute("aria-label")).toBe("Like, 24 likes");

    fireEvent.click(like);

    await waitFor(() => expect(likeToggleMock).toHaveBeenCalledWith("p1", null, "LIKE"));
    await waitFor(() => expect(like.getAttribute("aria-pressed")).toBe("true"));
    expect(like.getAttribute("aria-label")).toBe("Like, 25 likes");

    expect(like.textContent).toBe("25");

    // The second tap sees the written LIKE and clears the caller's row.
    fireEvent.click(like);
    await waitFor(() => expect(likeToggleMock).toHaveBeenLastCalledWith("p1", "LIKE", "LIKE"));
  });

  it("counts positive kinds only — a DISLIKE never fills the control", async () => {
    likeToggleMock.mockResolvedValue({
      postId: "p1",
      likeCount: 20,
      dislikeCount: 4,
      myReaction: "LIKE",
      reactionCounts: {
        counts: { LOVE: 20, WOW: 3, DISLIKE: 4 },
        myReaction: "LIKE",
        total: 27,
      },
    });
    renderButton();
    const like = screen.getByTestId("home-feed-love");

    fireEvent.click(like);

    await waitFor(() => expect(like.textContent).toBe("23"));
  });

  it("treats a hydrated canonical-era kind as mine and clears it on the next tap", async () => {
    renderButton(post(), { p1: { myReaction: "HELPFUL", myRating: null } });
    const like = screen.getByTestId("home-feed-love");

    await waitFor(() => expect(like.getAttribute("aria-pressed")).toBe("true"));
    expect(like.getAttribute("aria-label")).toBe("Like, 24 likes");
    expect(like.textContent).toBe("24");

    fireEvent.click(like);

    // The second argument is the caller's CURRENT reaction (what the toggle
    // reads to decide the move) — not the wire write. The wire write is always
    // LIKE/null and is pinned in `feedReactions.test.ts`.
    await waitFor(() => expect(likeToggleMock).toHaveBeenCalledWith("p1", "HELPFUL", "LIKE"));
  });

  it("does not double-fire while a Like is in flight", async () => {
    let release!: (value: unknown) => void;
    likeToggleMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderButton();
    const like = screen.getByTestId("home-feed-love");

    fireEvent.click(like);
    await waitFor(() => expect(like.getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(like);

    expect(likeToggleMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ postId: "p1", likeCount: 25, dislikeCount: 1, myReaction: "LIKE" });
    });
    await waitFor(() => expect(like.getAttribute("aria-busy")).toBe("false"));
  });

  it("announces a failed Like inline and reverts the control", async () => {
    const heard: string[] = [];
    const quiet = vi.fn();
    window.addEventListener("findback:announce-quietly", quiet);
    const handler = (e: Event) => {
      heard.push((e as CustomEvent<string>).detail ?? "");
    };
    window.addEventListener("findback:announce", handler);
    try {
      likeToggleMock.mockRejectedValueOnce(new Error("offline"));
      renderButton();
      const like = screen.getByTestId("home-feed-love");

      fireEvent.click(like);

      expect((await screen.findByTestId("home-feed-love-error")).textContent).toMatch(/try again/i);
      await waitFor(() => expect(heard.join(" ")).toMatch(/try again/i));
      expect(like.getAttribute("aria-pressed")).toBe("false");
      expect(like.getAttribute("aria-label")).toBe("Like, 24 likes");
      expect(like.getAttribute("aria-describedby")).toBe("home-feed-like-error-p1");
      expect(quiet).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("findback:announce-quietly", quiet);
      window.removeEventListener("findback:announce", handler);
    }
  });

  it("falls back to its own state outside a provider", async () => {
    render(<HomeFeedReactionButtons postId="p1" likeCount={3} dislikeCount={1} />);
    const like = screen.getByTestId("home-feed-love");
    expect(like.getAttribute("aria-label")).toBe("Like, 3 likes");
    expect(like.textContent).toBe("3");

    fireEvent.click(like);

    await waitFor(() => expect(likeToggleMock).toHaveBeenCalledWith("p1", null, "LIKE"));
    await waitFor(() => expect(like.getAttribute("aria-pressed")).toBe("true"));
  });

  it("switches Like to Dislike and shows both counts", async () => {
    likeToggleMock.mockResolvedValueOnce({ postId: "p1", likeCount: 23, dislikeCount: 2, myReaction: "DISLIKE", reactionCounts: { counts: { LOVE: 23, DISLIKE: 2 }, myReaction: "DISLIKE", total: 25 } });
    renderButton(post(), { p1: { myReaction: "LIKE", myRating: null } });
    const like = screen.getByRole("button", { name: "Like, 24 likes" });
    const dislike = screen.getByRole("button", { name: "Dislike, 1 dislike" });
    await waitFor(() => expect(like.getAttribute("aria-pressed")).toBe("true"));
    expect(dislike.textContent).toBe("1");
    expect(dislike.className).toContain("min-h-[44px]");
    expect(dislike.className).toContain("min-w-[44px]");
    fireEvent.click(dislike);
    await waitFor(() => expect(likeToggleMock).toHaveBeenCalledWith("p1", "LIKE", "DISLIKE"));
    await waitFor(() => expect(dislike.getAttribute("aria-pressed")).toBe("true"));
    expect(like.getAttribute("aria-pressed")).toBe("false");
    expect(like.textContent).toBe("23");
    expect(dislike.textContent).toBe("2");
  });

  it("rolls back a failed local Dislike and both counts", async () => {
    likeToggleMock.mockRejectedValueOnce(new Error("offline"));
    render(<HomeFeedReactionButtons postId="p1" likeCount={3} dislikeCount={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Dislike, 1 dislike" }));
    await screen.findByTestId("home-feed-love-error");
    expect(screen.getByRole("button", { name: "Like, 3 likes" }).textContent).toBe("3");
    expect(screen.getByRole("button", { name: "Dislike, 1 dislike" }).textContent).toBe("1");
    expect(screen.getByRole("button", { name: "Dislike, 1 dislike" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reverts the local fallback when the Like fails", async () => {
    likeToggleMock.mockRejectedValueOnce(new Error("offline"));
    render(<HomeFeedReactionButtons postId="p1" likeCount={3} dislikeCount={1} />);
    const like = screen.getByTestId("home-feed-love");

    fireEvent.click(like);

    await waitFor(() => expect(screen.getByTestId("home-feed-love-error")).toBeTruthy());
    expect(like.getAttribute("aria-pressed")).toBe("false");
  });
});
