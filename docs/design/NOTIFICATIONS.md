# Notifications: per-type design, not one global flow

Status: design decided at note level, not implemented. Owner correction
2026-11-12: each notification type needs its own consideration. A single row,
preview and menu rule applied to every type is wrong, and this note now leads
with the type matrix.

## 1. The types that actually exist

Found in source, not assumed.

The live check constraint on `notifications.type`
(`20261022173000_moderation_reports_sanctions_appeals.sql:765-768`) is seven
values: `LIKE`, `DISLIKE`, `COMMENT`, `MENTION`, `STATUS`, `REACTION`,
`MODERATION`. It was widened twice, by `reaction_notification_feed` and then by
the moderation migration.

The renderer also handles `UNKNOWN` (`Notifications.tsx:66-87`), which the
database can never produce, so any list UI has to survive eight values.

One piece of dead configuration: `NotificationSettings.tsx:61-67` offers a
`Messages` toggle with a "someone sends you a message" hint, and no such
notification type exists in the schema or in any producing function. Chat unread
is its own counter. That toggle currently controls nothing and needs either
wiring or removal.

Routing is already type-aware, which is the right foundation
(`Notifications.tsx:47-64`):

| Type | Route | Existing label |
| --- | --- | --- |
| `COMMENT` | `/posts/{id}?comment={cid}#detail-comments` | commented on your report |
| `MENTION` | same | mentioned you |
| `LIKE` | `/posts/{id}#detail-activity` | liked your report |
| `DISLIKE` | same | disliked your report |
| `REACTION` | same | reacted to your report with {kind} |
| `STATUS` | `/posts/{id}#detail-manage` | status update |
| `MODERATION` | the case or appeal | review update |
| `UNKNOWN` | the report | sent you an update |

`STATUS` is the only type whose actor is nullable, so it falls back to the
product name, and it is the only type that maps legacy preview strings
(`Notifications.tsx:622-632`).

## 2. The per-type matrix

Columns that matter per type, because they differ.

| | LIKE | DISLIKE | REACTION | COMMENT | MENTION | STATUS | MODERATION |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Actor | person | person | person | person | person | none | none |
| Notify at all | yes | **proposed no** | yes | yes | yes | yes | yes |
| Row title | `Maya liked your report` | withdrawn | `Maya reacted with {kind}` | `Maya commented on your report` | `Maya mentioned you` | `Status update` | `Review update` |
| Subject line | report title | withdrawn | report title | report title | report title | report title | decision subject |
| Body excerpt | none | none | none | 2 lines of the comment | 2 lines around the mention | status preview, unclamped | decision text, unclamped |
| Hover card | report thumb + title | withdrawn | report thumb + title | report thumb + title + 2 comment lines | same, mention highlighted | report thumb + title | none |
| Inline action | none | withdrawn | none | none | none | `Review` | `View decision` |
| Click target | report activity | withdrawn | report activity | the comment | the comment | report manage | the case |
| Bundling | yes, per report, 24h | withdrawn | per report and kind | no | no | no | no |
| Mute scope | this report | withdrawn | this report | this report | this report | this report | case only |
| Read pruning | 7 days | withdrawn | 7 days | 7 days | 7 days | **never** | **never** |

`UNKNOWN` renders the shared fallback row: product glyph, `sent you an update`,
no excerpt, no inline action, no bundling, still removable, still pruned.

## 3. The types that need judgement, not rules

### 3.1 DISLIKE should not notify at all

A dislike produces a notification whose entire content is "someone does not like
your report". It carries no information the report does not already show, it
invites retaliation, and it is the only type a reader would want to switch off
immediately.

Recommendation: keep the count on the report, stop generating the notification
row, and keep the existing `DISLIKE` handling in the renderer for old rows.
This is a product decision, and it is question 1 below.

### 3.2 LIKE and REACTION bundle, alone among the types

Five people liking the same report should be one row, not five:

- `Maya and 2 others liked your report`
- bundle window 24 hours, per report, per type
- `REACTION` bundles per kind and never across kinds, because
  "reacted with a heart and a laugh" reads as a bug
- a bundle's click target is the report activity, same as a single like
- a bundle is unread while any member is unread

No other type bundles. Two comments on the same report are two separate reads of
two separate sentences, and merging them would hide one.

### 3.3 STATUS is a receipt, not an event

`STATUS` records an outcome on a report: matched, recovered, closed. It has no
actor, it is the only evidence in the list that something finished, and it is
the row a reader may come back for weeks later.

So it is exempt from the read-item pruning window, it never bundles, it carries
`Review` as an inline action, and its preview is shown unclamped, which the
current renderer already does (`Notifications.tsx:656`).

### 3.4 MODERATION is also a receipt

Same reasoning as `STATUS`: a decision a reader may need to find later. Never
pruned, never bundled, no hover card, and its own explicit action. It also must
never be silently removable by a bulk gesture applied to "recent activity".

### 3.5 COMMENT and MENTION are the only types with a real preview

They are the only ones carrying text worth previewing. The hover card shows the
report thumbnail, the title, and two lines of the comment. For `MENTION` the
mentioned handle is emphasised inside those two lines.

Both click through to the comment itself, not the report top, which the route
already does.

### 3.6 MESSAGES is not a row here

Chat unread is a separate counter with its own surface. If a message ever appears
in this list it must not double-count with the chat badge, and it must not be
removable from here while the message stays unread there.

## 4. What genuinely is global

Only mechanics, never content rules.

- **Row anatomy.** Avatar or product glyph, actor plus action, subject, time,
  unread dot. The matrix decides what fills each part.
- **Hover actions.** On a fine pointer, pointing at any row reveals
  `Mark read or unread` and `Remove`, replacing the timestamp. Verified mail
  pattern, and the reason it is safe here is that both actions also exist in the
  menu.
- **Row menu.** Right click, 450ms long press with a short haptic, overflow
  control, Shift+F10. Items are filtered by the matrix above: `Mark as read`,
  `Mark as unread`, `Remove from activity`, then the type's own entries.
- **Unread model.** The bell counts unread, caps at `99+`, and opening the
  popover marks nothing.
- **Gesture physics.** Long press cancels past 8px of movement so swipe and
  scroll still win. A gesture is never the only path to an action.
- **Accessibility.** Each type has one accessible name that states actor, action
  and subject, and the badge or excerpt is never the only signal.

## 5. Filters, revised by type

`All` and `Unread` only.

`Mentions` is a type, not a category, so it could be a third chip later. It is
not in the first set because a mention is already unmistakable in the row, and a
third chip that filters to nearly the whole list is worse than no chip.

No automatic classification, no focused partition. Both need manual correction
machinery and both can bury a lost-item update.

## 6. Grouping

Time labels, `Today`, `This week`, `Earlier`, newest first, no sticky headings.
A group whose members are all pruned or filtered renders nothing, heading
included.

`STATUS` and `MODERATION` rows sit in their own time group like everything else;
exemption from pruning is not exemption from dating.

## 7. Removal, per type

- `Remove from activity` removes the reader's entry. It never touches the report,
  the comment, the reaction or the decision.
- Six second undo, then the row moves to the `Deleted` view for the retention
  window.
- `STATUS` and `MODERATION` can be removed explicitly but are not swept by the
  read-pruning job.
- No `Delete forever`.

## 8. Open questions for the owner

1. Do we stop generating `DISLIKE` notifications, or keep them in-app only and
   out of push?
2. Does an open popover mark anything read, or only an opened row?
3. Are `STATUS` and `MODERATION` the complete set of receipts that must never be
   pruned, or does a possible match belong there too?
4. Does muting a report mute all types for that report, or only the type that was
   muted?
5. Is `Remove from activity` the wording you want, or should it read delete?
6. Should bundling apply to `LIKE` only, or to `REACTION` per kind as proposed?
7. Is a `Mentions` chip wanted in the first set?

## 9. Verification, once built

- Every type renders its own title, subject, excerpt and target, checked against
  the matrix, including `UNKNOWN`.
- Bundling: three likes on one report become one row, two comments never do.
- `STATUS` and `MODERATION` survive a pruning run that removes read `LIKE` rows.
- Hover card appears only for the types in the matrix, and only with content.
- Menu items differ per type and never show a dead entry.
- Removal restores from the `Deleted` view and never affects the underlying item.
- 320, 411, 768, 1280, light, dark, AMOLED, 200% text.
- Anti-slop gate before and after.

## 10. Sources

Gmail categories, focused inbox, right-click actions, bulk select, trash
retention, archive and snooze (Google Support). Outlook focused inbox, reading
pane, right-click archive and rules, delete and recovery, mobile long-press
selection, badge scope (Microsoft Support). X notification views. Threads and
Instagram activity types. Facebook notification count and mark-all-read.
Messenger desktop mute, chat precedent only.

The study could not verify a hover content preview on notifications in any of
these products, which is why the preview here is type-gated to the two types that
carry text and is never the only path to the information.
