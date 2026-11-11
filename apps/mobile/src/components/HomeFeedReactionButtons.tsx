import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { ReactionKind, ReactionSummary } from "@norfold/shared";
import { announce, announceQuietly } from "./LiveRegion";
import { useFeedLove } from "../hooks/useFeedLove";
import { applyCountDeltas, likeMine, likeState, nextReaction, reactionMoveDeltas } from "../services/reactions";
import { seedSummaryFromItem, toggleReaction } from "../services/feedReactions";

export function HomeFeedReactionButtons({ postId, likeCount, dislikeCount }: {
  postId: string;
  likeCount: number;
  dislikeCount: number;
}) {
  const love = useFeedLove(postId);
  const [localReaction, setLocalReaction] = useState<ReactionKind | null>(null);
  const [localSummary, setLocalSummary] = useState<ReactionSummary | null>(null);
  const [localPending, setLocalPending] = useState(false);
  const localPendingRef = useRef(false);
  const postIdRef = useRef(postId);
  postIdRef.current = postId;
  const [failed, setFailed] = useState(false);
  const myReaction = love ? love.myReaction : localReaction;
  const summary = love ? love.summary : localSummary;
  const likes = love ? love.likeCount : summary ? likeState(summary).count : likeCount;
  const dislikes = love ? love.dislikeCount : summary ? (summary.counts.DISLIKE ?? 0) : dislikeCount;
  const pending = love?.pending ?? localPending;
  const errorId = `home-feed-like-error-${postId}`;
  const [settledPost, setSettledPost] = useState<string | null>(null);
  useEffect(() => {
    if (settledPost === postId && !pending) {
      announceQuietly(`${likes} ${likes === 1 ? "like" : "likes"}, ${dislikes} ${dislikes === 1 ? "dislike" : "dislikes"}.`);
      setSettledPost(null);
    }
  }, [postId, likes, dislikes, pending, settledPost]);

  function fail() {
    setFailed(true);
    announce("Couldn't save your reaction. Please try again.");
  }

  async function onToggle(target: "LIKE" | "DISLIKE") {
    setFailed(false);
    if (love) {
      if (localPendingRef.current || love.pending) return;
      localPendingRef.current = true;
      const success = await love.toggle(target);
      localPendingRef.current = false;
      if (postIdRef.current === postId) {
        if (success) setSettledPost(postId);
        else fail();
      }
      return;
    }
    if (localPendingRef.current) return;
    localPendingRef.current = true;
    const previous = localReaction;
    const previousSummary = localSummary;
    const next = nextReaction(previous, target);
    const base = localSummary ?? seedSummaryFromItem(likeCount, dislikeCount, previous);
    const counts = applyCountDeltas(base.counts, reactionMoveDeltas(previous, next));
    setLocalReaction(next);
    setLocalSummary({ counts, myReaction: next, total: Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0) });
    setLocalPending(true);
    try {
      const res = await toggleReaction(postId, previous, target);
      setLocalReaction(res.myReaction);
      setLocalSummary(res.reactionCounts ?? seedSummaryFromItem(res.likeCount, res.dislikeCount, res.myReaction));
      if (postIdRef.current === postId) setSettledPost(postId);
    } catch {
      setLocalReaction(previous);
      setLocalSummary(previousSummary);
      fail();
    } finally {
      localPendingRef.current = false;
      setLocalPending(false);
    }
  }

  const likeActive = likeMine(myReaction);
  const dislikeActive = myReaction === "DISLIKE";
  const buttonClass = (active: boolean) => `fb-report-action min-h-[44px] min-w-[44px] gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "bg-surface-container text-on-surface" : "text-on-surface-variant"}`;

  return (
    <span className="relative flex min-w-0 flex-col gap-1">
      <span className="flex items-center">
        <button type="button" data-testid="home-feed-love" aria-label={`Like, ${likes} ${likes === 1 ? "like" : "likes"}`} aria-pressed={likeActive}
          aria-describedby={failed ? errorId : undefined} data-pending={pending ? "true" : "false"}
          disabled={pending} aria-busy={pending} onClick={() => void onToggle("LIKE")} className={buttonClass(likeActive)}>
          <ThumbsUp size={18} aria-hidden fill={likeActive ? "currentColor" : "none"} />
          <span className="tabular-nums">{likes}</span>
        </button>
        <button type="button" data-testid="home-feed-dislike" aria-label={`Dislike, ${dislikes} ${dislikes === 1 ? "dislike" : "dislikes"}`} aria-pressed={dislikeActive}
          aria-describedby={failed ? errorId : undefined} data-pending={pending ? "true" : "false"}
          disabled={pending} aria-busy={pending} onClick={() => void onToggle("DISLIKE")} className={buttonClass(dislikeActive)}>
          <ThumbsDown size={18} aria-hidden fill={dislikeActive ? "currentColor" : "none"} />
          <span className="tabular-nums">{dislikes}</span>
        </button>
      </span>
      {failed && <span id={errorId} role="alert" data-testid="home-feed-love-error" className="text-[11px] text-error">Couldn't save, try again</span>}
    </span>
  );
}
