# Report viewer: media left with its description, conversation right

Status: design revised 2026-11-12 after the owner's frame-by-frame reference.
Not implemented.

Owner direction, verbatim: "I want the previous flow to be the default where
things appears like this. image on the side. But more smaller. Description goes
below the image. And, Commenting on the side. But see, we need to bring the like,
share and other buttons above the comment (text box)."

So the previous two-pane flow stays the default. What changes is what lives in
each pane, and where the action row sits.

## 1. What the reference actually shows

Frames extracted from the owner's recording, 2880x1628, sampled every 10 seconds.
The relevant stretch is 2:05 to 3:45, Facebook's photo viewer.

Left: the image, filling the media area edge to edge, with a black surround.

Right rail, top to bottom:

1. Author header. Avatar, page name, age, and an overflow control.
2. Caption. Long text, clamped with `See more`.
3. A divider.
4. **Action row.** Like with its count, comment with its count, share with its
   count, and the reaction summary chips at the right end.
5. Comments and replies, scrolling.
6. Composer, pinned at the bottom. Avatar, `Comment as <name>` field, then a row
   of icons (emoji, photo, sticker, GIF, profile) and a send arrow.

The rail is roughly 38 percent of the viewport, the media about 56.

Three things follow that are worth stating plainly, because they are the whole
point of the reference:

- The action row is not in a footer with the composer. It heads the comment
  column, directly under the caption.
- The caption and the comments are separate blocks divided by that action row,
  not one continuous scroll.
- The composer is a two-row block, field plus icons, and it never scrolls away.

## 2. Where this design follows the owner and departs from the reference

The owner's own sentence splits the reference in two, deliberately:

| Reference | Here |
| --- | --- |
| caption in the right rail | description moves **below the image**, in the left pane |
| media fills its area | media is **contained and smaller**, so the description has room under it |
| actions head the comment column | actions sit **directly above the composer**, so the row and the field it acts on stay adjacent at every width |

The last row is the one place this note does not copy the reference literally.
The owner asked for the buttons above the comment box, and both positions
satisfy that; the one chosen is the one that reads identically at every
breakpoint and never leaves a 44px row stranded at the top of a column the
reader has scrolled past. If the head of the column turns out to be wanted after
all, it is one CSS change: move `.fb-report-actions` from the footer group to the
top of the comment column.

## 3. What already exists

Not a new surface. Three pieces are already in the app:

- `App.tsx:299` mounts `PostModal` at `/posts/:id` behind `RequireAuth`.
- `PostModal.tsx` wraps `PostDetail contextual` in `AdaptiveTaskSurface` with
  `width="report"`.
- `AdaptiveTaskSurface.tsx` is react-aria `Modal` plus `Dialog`, with a body
  level `ModalOverlay`, an overlay depth stack, a dismissable backdrop, a close
  button, and `useKeyboardInset`.

`adaptiveFoundation.css` sizes `.fb-report-panel` at `max-width: 960px` with one
scrolling `.fb-surface-body`, and already collapses to a full-height panel on
compact widths.

So the work is layout, not plumbing.

## 4. Geometry

| Condition | Panel | Split |
| --- | --- | --- |
| 1280 and up | `width: min(1280px, 88vw)`, `height: min(92vh, 960px)` | left `1fr`, right `minmax(400px, 0.85fr)` |
| 900 to 1279 | `width: 92vw`, `height: 90vh` | same split |
| under 900 | full screen, square corners, existing compact path | single column |

At 1280 by 800 the panel is 1126 by 704, about 77 percent of the viewport, which
holds the "roughly 75 percent" target. At that width the left pane is about 610
and the right about 516, above the 400px floor that keeps comment text readable.

Existing surface: 0.75rem radius, elevated surface, backdrop blur. No new shadow
stack, no black surround. The reference's black letterbox belongs to a photo
viewer that owns the whole screen; this panel sits on the app surface.

## 5. Left pane: the report itself

Three regions, top to bottom, in one scroll.

1. **Media.** Contained, `object-fit: contain`, centred, with
   `max-height: 62%` of the pane height, on the existing surface-variant
   background rather than black. Multi-photo: horizontal paging with the existing
   counter, no thumbnail strip. No media: the region is not rendered at all.
2. **Author line.** Avatar, display name with the verification badge, `@handle`,
   relative age, the existing `Connect` control when the reader is not the
   author, and the overflow menu at the right.
3. **Title, description and meta.** The report title at heading size, then the
   description body, then the facts row: absolute date, category, location. The
   absolute date lives here now, not under the action row, because it describes
   the report and not the conversation.

A long description scrolls inside this pane. It never pushes the media out of
view permanently, because the media is the first thing in the same scroll.

## 6. Right pane: the conversation

Three regions, fixed at top and bottom, one scrolling middle.

1. **Pinned footer** (not a header): the action row, then the composer directly
   under it. This is the change the owner asked for.
2. **Scrolling middle:** the comments.
3. There is no third pinned region. The pane does not need an author header,
   because identity moved to the left pane.

**Action row.** Order and semantics come from `docs/design/POST-ACTION-ROW.md`:
comments, like, dislike, views when a count exists, save, share. Outline icons at
24px, count immediately after its icon, no text labels, 44px targets.
`aria-pressed` on like, dislike and save; the counts are in the accessible name,
not read as separate text. Separated from the composer by a hairline divider.

**Composer.** Two rows, matching the reference's structure without copying its
decorations:

- row one: the reader's avatar, the `Add a comment` field, send.
- row two: the existing comment tools (media, mention) at 44px, left aligned.
  No stickers, no GIFs, no profile-card icon.

On focus the field expands to three lines. `useKeyboardInset` already handles the
mobile keyboard. Sending keeps the optimistic insert that `PostDetail` already
does, and the new comment appears at the top of the list so no scroll is needed.

## 7. Why the row is not a footer-only bar

Three costs, accepted and mitigated:

- The like, save and share controls are not visible while reading comments
  unless the footer is in view. It always is, because the footer is pinned.
- A pinned 44px row plus a two-row composer is about 140px of the 704px pane. On
  a 900px-tall viewport that leaves roughly 500px for comments, which is enough
  for four to five comments before scrolling.
- The action row acts on the report while sitting in the comment pane. The
  divider and the count grouping carry that, and the row is never rendered
  inside a comment.

## 8. Closing and returning

Three exits, all equivalent: the shrink control in the panel header at 44px,
the backdrop, and Escape.

Returning restores place:

- focus goes back to the element that opened the viewer,
- scroll position comes from the existing id-based feed anchoring, not a
  remembered pixel offset,
- the intercepted route calls `navigate(-1)`, today's behaviour,
- a cold `/posts/:id` load closes to the feed, not a blank page.

`role="dialog"` with `aria-modal`, one accessible title which is the report
title. The two panes are regions, not two dialogs.

## 9. Every entry point uses it

Feed cards in all layouts including masonry, search results, saved and recovered
rows, activity rows, notification rows, an in-app shared link, and a report
referenced inside another report.

One component, one route. A second presentation anywhere means this design has
been broken.

## 10. Compact widths

Under 900px the panel is full screen, single column:

1. media at the top, `max-height: 45vh`, swipeable, counter kept,
2. author line,
3. title, description, meta,
4. comments, scrolling,
5. **action row pinned, then composer pinned under it**, above the safe area.

This is the same order as desktop, with the panes stacked. The action row above
the composer holds on both, which is the reason for choosing that position.

## 11. Files

| File | Change |
| --- | --- |
| `apps/mobile/src/components/PostModal.tsx` | unchanged, already the route host |
| `apps/mobile/src/components/AdaptiveTaskSurface.tsx` | a wider `report` variant with two pane slots |
| `apps/mobile/src/components/adaptiveFoundation.css` | pane grid, contained media, pinned footer group, compact stack |
| `apps/mobile/src/screens/PostDetail.tsx` | contextual layout renders report pane plus conversation pane |
| `apps/mobile/src/components/PostActionRow.tsx` | moves into the report footer group, semantics unchanged |
| `apps/mobile/src/components/PostDetail*.test.tsx` | pane presence, pinned footer, no-media collapse |

## 12. Verification

- 320, 411, 768, 1024, 1280, 1600. No horizontal overflow, no clipped pane, no
  scroll in a region that should not scroll.
- Panel area at 1280 x 800 is at least 75 percent of the viewport.
- Media is contained, not stretched, and never taller than 62 percent of its
  pane; a portrait photo and a panorama both sit correctly.
- The comments scroll; the action row and composer do not move.
- The action row is above the composer at every width, and the divider between
  them is visible.
- Author identity appears once, in the left pane, and the absolute date appears
  once, beside it.
- Backdrop, Escape and the shrink control all return with focus on the trigger
  and the feed anchor intact; a cold load closes to the feed.
- A report with no photos renders one full-width pane.
- A report with six photos pages without layout shift.
- Keyboard: Tab reaches the pane, every action, the field and the tools, and
  never escapes the dialog.
- Contrast for the divider, the pinned edges, the counts and the disabled send,
  in light, dark and AMOLED.
- Anti-slop gate before and after.

## 13. Open questions

1. Does the description under the image scroll with the media, or stay fixed
   below it? Note takes the first: one scroll, media first.
2. Comment order: newest first or oldest first. Unset.
3. Do comment rows use like and dislike, or like only? Recommendation: match the
   report row so the reader learns one model.
4. Does the media pane collapse entirely for a report with no photos, giving the
   conversation the full panel? Note says yes.
5. Is the action row above the composer correct, or should it move to the head of
   the comment column as the reference does? One-line change either way.
6. Should the panel cap at 960px tall on very tall screens? Recommendation: yes,
   so it never becomes a full-height sheet on a 4K display.
