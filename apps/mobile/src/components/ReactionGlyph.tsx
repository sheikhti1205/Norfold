import { ThumbsDown, ThumbsUp } from "lucide-react";

/**
 * A reaction is an outline placeholder until it is yours.
 *
 * Owner direction 2026-11-18: the emoji is the committed state, not the
 * default. A neutral control therefore draws a monotone thumbs outline, and
 * only the reader's own reaction shows the platform emoji. Both forms occupy
 * the same box, so pressing a reaction never resizes the row.
 *
 * `size` is that box in pixels. The report action row asks for 34 (twice the
 * old glyph); the inline comment control and the appearance preview stay
 * small because they sit inside a sentence or a miniature.
 */
export function ReactionGlyph({ kind, mine, size = 18 }: {
  kind: "LIKE" | "DISLIKE";
  mine: boolean;
  size?: number;
}) {
  if (mine) {
    return (
      <span className="fb-reaction-emoji" style={{ fontSize: `${size * 0.94}px` }} aria-hidden="true">
        {kind === "LIKE" ? "👍" : "👎"}
      </span>
    );
  }
  const Icon = kind === "LIKE" ? ThumbsUp : ThumbsDown;
  return <Icon className="fb-reaction-outline" size={size} strokeWidth={1.75} aria-hidden="true" />;
}
