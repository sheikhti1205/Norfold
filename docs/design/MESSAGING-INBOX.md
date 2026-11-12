# Messaging inbox: two panes and a real back contract

Status: design decided, not implemented. Owner reference 2026-11-12
(Instagram Direct inbox).

## 1. What already exists

The two-pane structure is not new. `App.tsx:241` mounts `Connections` at
`/chats`, and `Messaging.tsx:480` already renders
`detail={conversationId ? <Outlet /> : <div className="fb-chat-empty">…}`.

So today there is:

- a list pane,
- a thread pane,
- an empty state with the copy `Choose a conversation`,
- a collapsed avatar rail, `ChatRail`, `Messaging.tsx:490-511`,
- and a shell rule that keeps the navigation beside a thread on wide screens,
  `Shell.tsx:54`, `showNav = chatThread ? width >= MEDIUM_MAX_PX : …`.

What is missing is the composition the owner showed, and a real way back from a
thread that is not the OS gesture.

## 2. The shape

One page, two panes, no modal.

| Condition | Layout |
| --- | --- |
| 900px and up | list pane 340px, thread pane fills the rest, 1px divider |
| 600 to 899 | list pane 280px, thread pane flexible |
| under 600 | one pane only: the list is the surface, a thread is a pushed screen |

The page sits inside the normal shell, beside the rail. It is not a dialog and it
does not cover the navigation.

## 3. List pane

Top to bottom:

1. **Header.** `Messages` on the left, a compose control on the right. No account
   name or account switcher here, because the sidebar already owns that.
2. **Search field.** `Search messages`, 44px, leading icon, clear action. It
   filters the list; it does not open a separate screen.
3. **Requests row.** A single row above the conversations, with a count when
   there is one, opening the requests list. Not a bare text link at the right of
   a heading, which is what the reference does and what we should not copy.
4. **Conversation rows.**

Row anatomy, 64px minimum:

- 48px avatar, left.
- Display name, weight 600. Weight 400 when the thread is read.
- Verification badge after the name when earned.
- Second line, muted, one line, ellipsis: the last message summary.
- Trailing time, top right, muted: `3h`, `2d`, then a date after a week.
- Unread marker: a dot on the avatar, not a separate column.
- Selection: `--fb-surface-container` background, no border, no accent bar.

Summary grammar, all from data the thread already has:

| Last event | Second line |
| --- | --- |
| own message | `You: {text}` |
| incoming text | `{text}` |
| attachment | `{name} sent an attachment` |
| voice | `{name} sent a voice message` |
| reaction | `Reacted to your message` |

The existing report context chip (`fb-chat-report-card`) stays where it is, in
the thread, not in the row. The row must stay one line of summary.

## 4. Thread pane

Unchanged in behaviour: the existing thread, header, composer, media, voice,
reactions, report card, and the existing overlay stack for sheets.

What changes is only its container: it fills the second pane rather than a
full page, and it keeps its own scroll.

## 5. Empty state

Right pane with no conversation selected:

- one outline glyph, 64px, `--fb-on-surface-variant`, a paper plane,
- `Your messages` as the heading,
- `Send a message to start a chat.` as the sentence,
- a primary `Send message` control.

Two states, not one:

| Condition | Content |
| --- | --- |
| conversations exist, none selected | the block above |
| no conversations at all | heading `No conversations yet`, sentence `Find someone to message from a report or search.`, primary `Find people` |

The reference's `Your note` rail item is a different product feature. Not copied.

## 6. The back contract

This is the part the owner asked for by name, and the part that does not exist
today.

Opening a conversation on a wide screen keeps the list and swaps the right pane.
That must still be a history entry, because two inputs have to undo it.

| Input | Where | Result |
| --- | --- | --- |
| Escape | inside a thread, wide screen | return to `/chats` with nothing selected, focus on the conversation row that was open |
| Android back | inside a thread | same as Escape |
| Back arrow | inside a thread, under 600px | return to the list |
| Escape | inbox, nothing selected | leave Messages for the previous surface |
| Android back | inbox | leave Messages, never exit the app from inside a thread |

Implementation shape:

- The thread is already a nested route. Keep it, so history is real.
- Register the handler with the existing `registerBackInterceptor`
  (`components/backNavigation.ts:34`) so an open dialog or sheet still consumes
  back first.
- Bind Escape to the same action through one hook, not a second global listener
  with its own precedence rules.
- On return, focus goes to the conversation row that was open, and the list keeps
  its scroll position.

## 7. Not copied from the reference

- The account name and chevron in the list header. The sidebar owns identity.
- `Requests` as plain text on the right of `Messages`. It becomes a row.
- `Your note`.
- The right-pane supplied by a marketing illustration. Ours is the empty block
  above.

## 8. Files

| File | Change |
| --- | --- |
| `apps/mobile/src/screens/Messaging.tsx` | list header, search, requests row, row anatomy, empty state |
| `apps/mobile/src/App.tsx` | routes already exist, verify the nested thread path |
| `apps/mobile/src/components/Shell.tsx` | already keeps nav beside a thread, no change expected |
| `apps/mobile/src/components/backNavigation.ts` | no change, the interceptor is registered by the screen |
| messaging CSS | pane widths, row heights, selected state, empty block |
| `Messaging*.test.tsx` | pane swap, Escape, back interceptor order, empty states |

## 9. Verification

- 320, 411, 768, 1024, 1280. The list is never squeezed under 280px, and the
  thread never collapses.
- Selecting a row swaps the right pane without a page flash or a scroll reset.
- Escape and Android back both return to the inbox with focus on the previous
  row.
- A dialog or sheet inside a thread consumes the first Escape, the thread the
  second.
- Inbox back leaves Messages. It never exits the app while a thread is open.
- Under 600px, the thread is full screen and the back arrow returns to the list.
- Unread counts survive the round trip.
- Contrast for the selected row, the muted summary, the time and the unread dot
  in all three themes.
- Anti-slop gate before and after.

## 10. Open questions

1. Search scope: filter the loaded list, or query the server? Recommendation:
   filter what is loaded until the list is paginated, then server search.
2. Requests: a row that opens a filtered list, or a filter chip beside `All`?
   Recommendation: a row, so the count is visible without opening anything.
3. Compose: opens a people picker, or starts a message from a report? Norfold
   conversations are report-scoped, so a blank compose may not exist. Needs a
   decision.
4. Does the list show report context under the summary? Recommendation: no, the
   row stays one line, the thread shows the report card.
5. Should Escape inside the composer clear the draft before it leaves the
   thread? Recommendation: yes, clear first, leave on the second press.
