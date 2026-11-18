import type { CSSProperties } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

/**
 * A reaction is an outline placeholder until it is yours.
 *
 * Owner direction 2026-11-18: the emoji is the committed state, not the
 * default. A neutral control therefore draws a monotone thumbs outline, and
 * only the reader's own reaction shows the platform emoji. Both forms occupy
 * the same box, so pressing a reaction never resizes the row.
 *
 * `size` is that box in pixels. Every glyph in one action row is passed the
 * same size by its caller; the emoji is drawn a little smaller inside the box
 * because a colour emoji carries more visual weight than a 1.75px outline.
 * The size travels as a CSS variable so the shared `.fb-reaction-emoji` rule
 * can derive both the box and the font size without an inline font-size that
 * would win over the row's one-size rule.
 */
export function ReactionGlyph({ kind, mine, size = 18 }: {
  kind: "LIKE" | "DISLIKE";
  mine: boolean;
  size?: number;
}) {
  const box = { "--fb-reaction-size": `${size}px` } as CSSProperties;
  if (mine) {
    return (
      <span className="fb-reaction-emoji" style={box} aria-hidden="true">
        {kind === "LIKE" ? "👍" : "👎"}
      </span>
    );
  }
  const Icon = kind === "LIKE" ? ThumbsUp : ThumbsDown;
  return <Icon className="fb-reaction-outline" size={size} strokeWidth={1.75} style={box} aria-hidden="true" />;
}
