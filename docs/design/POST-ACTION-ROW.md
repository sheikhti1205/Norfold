# Post action row: icon meanings and order

Status: design decided, not implemented. Owner reference 2026-11-12 (X post
anatomy), which takes precedence over the current arrangement.

## 1. The lesson in the reference

Each icon carries exactly one meaning, every count sits immediately after the
icon it belongs to, and nothing needs a text label. The row reads left to right
from conversation, through reaction, through reach, ending with the two
retention actions.

Reference order: comments, reposts, likes, views, bookmark, share.
Norfold order: comments, like, dislike, views, save, share.

Norfold has no repost and does not gain one. Like and dislike are separate
reactions here, which the owner confirmed stays.

## 2. What exists today

`apps/mobile/src/components/PostActionRow.tsx:73-90` lays out, in this order:

1. `slots.like` (the caller's reaction control)
2. comments, with count
3. `slots.share`
4. `slots.save`

So the row currently opens with a reaction, buries the conversation, and puts
share ahead of save. The counts and the 44px targets are already correct, and
`HomeFeedReactionButtons.tsx` already renders like and dislike as two adjacent
controls with counts. The change is order, plus the missing view count.

## 3. Target order

| Slot | Icon | Meaning | Count |
| --- | --- | --- | --- |
| Comments | speech bubble | replies on this report | shown, always |
| Like | thumb up | I find this useful | shown, always |
| Dislike | thumb down | this is not useful | shown, always |
| Views | bar chart | how many times the report was opened | shown when the count is above zero |
| Save | bookmark | keep this for later | none |
| Share | button with arrow | send it somewhere else | none |

Save and share carry no count because neither has a number a reader can act on.
That matches the reference, and it keeps the row from turning into six numbers.

Why this order: the first three answer "what happened here", views answer "how
many people saw it", and the last two are the actions that leave a marker on the
reader's own account. Grouping the reader's own actions at the end matches the
reference and stops the eye at the same place.

## 4. States

- Like and dislike are mutually exclusive. Exactly one may be active.
- Active: icon filled, `--fb-on-surface`, count in `--fb-on-surface`.
- Inactive: icon outline, `--fb-on-surface-variant`, count in the same tone.
- Save is a toggle: filled bookmark when saved, outline when not.
- Comments is not a toggle. It is a link on the feed and a focus mover on the
  detail screen, exactly as today.
- Share is a button that opens the existing share sheet. No state.
- Pending: the pressed control keeps its optimistic state and gets
  `aria-busy`. Counts never jump twice for one tap.

## 5. Sizes and spacing

- Every control keeps a 44px minimum target, as today.
- 18px icons, 0.0625rem between icon and count, 0.125rem between controls.
- Counts use tabular numerals so a change does not shift the row.
- The row never wraps. On a 320px screen the six controls fit because save and
  share carry no numbers; if a count grows past four digits it is abbreviated
  (`1.2K`), and the full number stays in the accessible label.
- No pill, no border, no filled chip on the row itself. The pressed state is the
  only fill.

## 6. Accessibility

- The group keeps `role="group"` with `aria-label="Report actions"`.
- Every control has an accessible name that includes its count, for example
  `Like, 12 likes`, `Views, 1200 views`, `Save report`.
- Icons are `aria-hidden`.
- `aria-pressed` on like, dislike and save.
- The count is never the only signal of the active state.

## 7. One gap, and it blocks the row

**Views do not exist.** `packages/shared/src/schema.ts:231-235` has
`likeCount`, `dislikeCount` and `commentCount` on a post and no view count, and
no impression table exists. The row design accepts a views slot, but the slot
must stay empty until the data is real.

What a real view count requires, in order:

1. An impression row written when a report detail opens, deduplicated per viewer
   per report per day. Server side, not client counted.
2. A count exposed on the post and feed payloads, the same way the reaction
   counts already are.
3. A retention rule, because impressions grow without bound.

Until those exist, the row ships with five controls: comments, like, dislike,
save, share. No placeholder zero, no invented number.

## 8. Files

| File | Change |
| --- | --- |
| `apps/mobile/src/components/PostActionRow.tsx` | reorder slots, add the optional views slot |
| `apps/mobile/src/components/PostActionRow.css` | spacing, abbreviation, no-wrap |
| `apps/mobile/src/components/HomeFeedReactionButtons.tsx` | unchanged, already correct |
| `PostDetail.tsx` | slot order, views slot when data exists |
| `PostActionRow.test.tsx` | order, labels, abbreviated counts |

## 9. Verification

- Order matches the table at 320, 411 and 1280.
- No wrap, no overflow, no control under 44px.
- Like and dislike never both active.
- Counts stay put when tapped (tabular numerals).
- `aria-label` carries the full number when the visible count is abbreviated.
- Contrast for inactive and active counts in light, dark and AMOLED.
- Anti-slop gate before and after.
