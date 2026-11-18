import type { ReactNode } from "react";
import { PostLink } from "./PostNavigation";
import { MessageSquare } from "lucide-react";
import { useHoverLabel } from "./HoverLabel";
import "./PostActionRow.css";

/**
 * The one flat action row: like, dislike, comments, views/insights and share,
 * evenly distributed across the full width of the card.
 *
 * WHY SLOTS AND NOT PROPS: the reaction state owner differs per surface. The
 * home feed's reaction controls live in `HomeFeedReactionButtons` (feed
 * reaction provider), the detail screen owns its own. This component therefore
 * NEVER owns, fetches or re-implements reaction state — it only lays the
 * controls out evenly and guarantees the row's own affordances (the comment
 * control with its visible + announced count).
 *
 * ORDER IS PART OF THE CONTRACT (owner direction): reactions first, comments
 * third, the views/insights metric fourth, share last. A reactions pair keeps
 * its two controls in one slot so the shared pending/rollback state stays
 * atomic; that slot takes two equal columns.
 */
export interface PostActionRowSlots {
  /** Like + dislike as one state owner. Spans two equal columns. */
  reactions?: ReactNode;
  /** A single reaction control, when a surface has no dislike. */
  like?: ReactNode;
  /** A separate dislike control, when a surface does not use `reactions`. */
  dislike?: ReactNode;
  /** The views/insights metric (an informational slot, never a fake button). */
  insights?: ReactNode;
  /** Legacy alias for `insights`. */
  views?: ReactNode;
  /** Optional Save/bookmark control — another lane owns that component. */
  save?: ReactNode;
  /** Called when the comment affordance is activated. */
  onComments?: () => void;
  /** Share control (the caller slots the existing share button in). */
  share?: ReactNode;
}

export interface PostActionRowProps {
  slots: PostActionRowSlots;
  commentCount: number;
  className?: string;
  /**
   * Extension to the base contract: when set, the comment affordance renders
   * as a router link to that destination (the home feed deep-links to
   * `/posts/:id#detail-comments`, which keeps middle-click / open-in-new-tab
   * and the link role). When it is unset the affordance is a button that calls
   * `slots.onComments` — the shape a screen that only wants to move focus to
   * its own comment box uses.
   */
  commentsHref?: string;
  /**
   * A surface that already shows the conversation beside the report does not
   * need a second control that only scrolls to it (owner direction
   * 2026-11-18). The control stays on every surface where comments are not
   * already on screen.
   */
  hideComments?: boolean;
}

/**
 * One horizontal row of icon-only actions. Nothing in it is a pill, a filled
 * chip or a text label: the icons carry the meaning, the counts are visible
 * next to their icon, and every control keeps a >=44px hit area.
 */
export function PostActionRow({ slots, commentCount, className, commentsHref, hideComments = false }: PostActionRowProps) {
  const commentLabel = `Comments, ${commentCount}`;
  const { hoverLabel } = useHoverLabel();
  const commentControl = (
    <>
      <MessageSquare size={18} aria-hidden />
      <span className="tabular-nums">{commentCount}</span>
    </>
  );
  const insights = slots.insights ?? slots.views;
  return (
    <div
      data-testid="post-action-row"
      role="group"
      aria-label="Report actions"
      className={`fb-post-action-row flex w-full min-w-0 flex-nowrap items-center gap-0.5${
        className ? ` ${className}` : ""
      }`}
    >
      {slots.reactions ? (
        <span className="fb-post-action-reactions" data-testid="post-action-reactions">
          {slots.reactions}
        </span>
      ) : (
        slots.like
      )}
      {slots.dislike}
      {!hideComments && (commentsHref ? (
        <PostLink
          to={commentsHref}
          aria-label={commentLabel}
          className="fb-report-action"
          data-action="comment"
          {...hoverLabel("Comments")}
        >
          {commentControl}
        </PostLink>
      ) : (
        <button
          type="button"
          onClick={slots.onComments}
          disabled={!slots.onComments}
          aria-label={commentLabel}
          className="fb-report-action"
          data-action="comment"
          {...hoverLabel("Comments")}
        >
          {commentControl}
        </button>
      ))}
      {insights}
      {slots.save}
      {slots.share}
    </div>
  );
}
