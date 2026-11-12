# Desktop interactions

Four pointer-first behaviours for Norfold on a desktop window, worked out as a
live lab: `docs/design/desktop-interactions/index.html`.

Open that file directly from disk or over any local static server. It loads
nothing from the network — both photos are inline SVG data URIs, and every
person, handle and message is invented.

The lab is a scaled app frame, not a page: the rail, the report with its comment
thread, and the Messages two-pane view (conversation list, thread, composer).
Controls:

| Control | Values | Why it exists |
| --- | --- | --- |
| Width | 768 / 1024 / 1440 / 1920 | Sets the frame's real layout width and scales it to fit, with the shown percentage in the readout. All breakpoints are container queries on the frame, so this — not the browser window — decides the layout. |
| Theme | Light / Dark | Both themes, including the floating layers. |
| Input | Pointer / Touch | Sets `data-input` on the frame. Touch disables hover-opens and tooltips, keeps message actions visible at 44 px, and turns taps into the preview trigger. This makes the coarse-pointer rules checkable with a mouse. |
| Text | 100% / 150% / 200% | Scales the frame's base font size; the lab's typography is em-based, so text grows without the layout being pinned in px. |

It starts on the report, because that is where the comment identities and the
comment composer live. `Message June Park` and the rail's Messages icon are the
two ways into the thread; only the latter pushes a nav entry, which is what makes
`Go back` appear. `#messages` starts directly in the thread with an empty stack,
which is the "nowhere to go back" state.

---

## A. Profile hover preview

| | |
| --- | --- |
| **Trigger** | The avatar + handle control itself (`button.identity`, `aria-haspopup="dialog"`), not the row. A fine pointer must rest on it for 200 ms; moving across a message or comment row does nothing. |
| **Placement** | Anchored to the trigger's inline start, 8 px clear of the row that owns it, flipped above when there is no room below, clamped 8 px inside the frame. It can overlap a neighbouring row; it never covers its own. |
| **Dismiss** | Pointer leaving trigger + card together (140 ms grace so the gap between them is crossable), Escape, scrolling the surface, switching conversation, changing the lab's input or text control, opening the post pop-up. |
| **Must never** | Open because a pointer crossed a row; cover the row that owns it; put an action (Follow) in a hover-only layer with no keyboard route; depend on hover at all on a coarse pointer. |
| **Keyboard** | Focus opens it immediately, with no delay. Tab out closes it. Enter or Space suppresses the implicit click, opens the card and moves focus to Follow. Escape closes and returns focus to the trigger — a suppression flag stops the restore from re-opening the card through `focusin`. Follow is `aria-pressed` and announces `Following @handle`. Tab alone shows the card but does not walk into it, because the card lives in the overlay at the end of the app; Enter/Space is the documented way in. |
| **Touch fallback** | No hover. One tap on the handle opens it; a tap on the same handle or anywhere outside closes it. Enter/Space still works. |

Public accounts show bio, posts/followers/following and Follow. `@mira.k` is
private: lock, "The account is private", Follow, no bio and no counts.

## B. Contained shared-post pop-up

| | |
| --- | --- |
| **Trigger** | The shared report card in the transcript, the link pill under it, or the report photo on the report surface. All are `[data-post]` buttons. |
| **Layout** | At ≥900 px frame width: two columns — media on the left, 380 px context column — in a panel no taller than 660 px, so the image is `object-fit: contain`, letterboxed, capped at 72 vh and never full-bleed. Below 900 px: one column, image capped at 42 vh, the panel scrolls, the composer sticks to its bottom. |
| **Context column** | Author identity (the hover preview works inside the pop-up too), status chip, title, caption, Like / Dislike, Reply, Share, comment list, composer. Like and Dislike are mutually exclusive, toggle off on a second press and keep real counts. Reply focuses the composer. Share copies the URL and, when the clipboard is blocked (`file://`), says so with the URL instead of failing silently. |
| **Dismiss** | Close button, Escape, backdrop click. |
| **Must never** | Fill the window; lose the thread underneath; leave focus behind in the thread; let the page behind scroll. |
| **Keyboard** | Focus enters the panel (Close). Tab and Shift+Tab are trapped to the panel's real controls, and focus that has landed outside that set is pulled back to the first or last item. Escape closes. Focus returns to the trigger — or to the element that had it, if the browser focused the clicked button. |
| **Touch fallback** | Same pop-up, one column. The backdrop is the dismiss surface; comments and composer scroll inside the panel. |

## C. Message hover actions

| | |
| --- | --- |
| **Trigger** | Hovering anywhere on a message row, or focus landing within it, reveals three 30 px controls: Add reaction, Reply, More. They are `pointer-events: none` while hidden, so the row cannot be clicked through an invisible button. |
| **Tooltips** | 350 ms after resting on a control, placed above it and clamped inside the frame. Shown immediately on keyboard focus. Suppressed entirely when the frame is in touch mode. Every control also carries an `aria-label`, so the tooltip is never the only name. |
| **Emoji** | Opens a six-emoji strip above the row. Picking one adds a reaction chip with a count and marks it mine; picking the same emoji again removes it. Chips are real buttons (`aria-pressed`) and toggle themselves. |
| **Reply** | Quotes the message above the composer ("Replying to … · preview"), focuses the composer and keeps the transcript at the newest message. The quote is attached to the sent message. Cancel in the quote clears it. |
| **More** | Header is the message's own timestamp (`Sun 9:29 PM`), then Forward and Pin with trailing icons. Pin / Unpin toggles a `Pinned` marker above the message and announces the change. Forward swaps the popover body for a "Forward to" chooser of the other conversations, with a Back row. |
| **Dismiss** | Leaving the row hides the controls. Escape unwinds one layer at a time, topmost first: the post pop-up, then the More popover, then the reaction strip, then the preview card, then a tooltip. Scrolling, clicking elsewhere, switching conversation, opening the post pop-up and resizing all close the transient layers. |
| **Must never** | Require hover to discover an action with no other route; label a control only by its tooltip; leave a hidden control clickable; keep a popover anchored to a row that has scrolled away. |
| **Keyboard** | The row is focusable, Tab reaches each control (which reveals the row's controls through `:focus-within`), Enter/Space activates, Escape closes. The popover moves focus to its first row. |
| **Touch fallback** | The three controls stay on screen at 44 px, tooltips and hover-opens are off, so nothing waits for a hover. A 400 ms hold on a row — cancelled by 8 px of movement — also opens More, so the same menu is reachable without any visible control. |

The lab's rule and the app's current rule differ on one point: the app hides the
ellipsis on coarse pointers (`Messaging.css:349-351`) and relies on the hold. The
lab keeps the controls visible instead, because a 44 px target that never
disappears is the cheaper fallback to verify.

## D. Go back

| | |
| --- | --- |
| **Trigger** | `Go back` in the thread header. Hidden whenever the nav stack is empty — a deep link into `#messages` shows no button at all. |
| **Return** | Restores the previous surface and its saved `scrollTop`, then, only if the row that owned the visit (`#report-author`) would be off-screen, scrolls that column the minimum distance to bring it back and flashes it. The exact offset is restored first, so a reader lands where they left, not at the row. |
| **Dismiss** | Not applicable; it is a one-shot navigation. |
| **Must never** | Be a link to a fixed destination; appear with nowhere to go; leave focus in the surface being left; move the page behind the frame (the restore scrolls the column, never the document). |
| **Keyboard** | A real button (Enter/Space). After the restore, focus moves to the restored column, which is `tabindex="-1"` so it adds no tab stop. |
| **Touch fallback** | Identical — no hover state is involved. |

The report is a root destination: arriving at it from the rail clears the stack,
so the button disappears there too.

---

## What this replaces

### 1. Identity is currently a direct link, not a preview

`apps/mobile/src/components/UserIdentityTrigger.tsx:29-36` documents the present
rule — "There is deliberately no quick-card popover, mini profile, bottom sheet
or intermediate step: a person is a destination" — and `:44` renders it as
`<Link to={identityHref(person)}>`. `apps/mobile/src/components/CommentIdentityHeader.tsx:14-16`
is exactly that link in the comment header, which is the surface the lab's
comment rows reproduce.

Two pieces of dead scaffolding already point the other way:
`docs/DESIGN_SYSTEM.md:46` lists `UserQuickCard.tsx` as the identity owner, but no
such file exists in `apps/mobile/src`; `apps/mobile/src/components/adaptiveFoundation.css:70`
still carries `.fb-quick-popover { width: 20rem; }` alongside
`.fb-quick-trigger` and `.fb-quick-dialog`.

`apps/mobile/src/components/AdaptiveLayout.test.tsx:50-56` asserts that
`queryByRole("dialog")` is null for this trigger, so pattern A cannot ship
without changing that test and the comment above the component.

### 2. A shared post currently opens a page-sized report, then a full-viewport viewer

`apps/mobile/src/screens/Messaging.tsx:141` renders the shared report card as a
`<Link>` to `/posts/{reportId}`. `apps/mobile/src/App.tsx:299` routes
`/posts/:id` to `PostModal`, and `apps/mobile/src/components/PostModal.tsx:7-11`
mounts the whole `PostDetail` inside `AdaptiveTaskSurface width="report"` — a
task surface, not a pop-up with the conversation beside it. Inside it,
`apps/mobile/src/screens/PostDetail.tsx:1094-1100` sends the hero gallery to
`setLightbox`, and `:1425-1436` renders `MediaViewer` twice (comment photos and
the post lightbox). `apps/mobile/src/components/MediaViewer.tsx:119-145` is
yet-another-react-lightbox in a full-viewport portal (`zIndex: 100 + depth * 10`)
with a `fullscreen` toolbar button.

So today the path from a message to "look at this bag" is: leave the thread →
page-sized report → full-screen lightbox. The lab collapses that into one
contained pop-up whose media is bounded and letterboxed, with Like/Reply/Share
and the comments still in view. It does not replace zoom, fit or swipe; those
stay in `MediaViewer` if the pop-up adopts it.

### 3. Message actions are hidden behind one ellipsis, and omit reaction/forward

`apps/mobile/src/screens/Messaging.tsx:1743-1748` is a single ellipsis button
(`aria-haspopup="menu"`) per row. `apps/mobile/src/screens/Messaging.css:338-351`
fades it in only under `(hover: hover) and (pointer: fine)` and sets
`display: none` on coarse pointers; `Messaging.tsx:685-686` states that intent
("the visible ellipsis is a desktop affordance and is hidden from coarse
pointers"). The menu's contents are at `Messaging.tsx:1468-1502`: Reply, Copy
text, Pin/Unpin, Unsend, Delete for me, Report message — no reaction, no forward.
Reply's other routes are a 72 px swipe (`:214-218`, `:1650-1653`) and a 400 ms
hold (`:1655-1660`).

The lab replaces the discover-only-by-hover ellipsis with three always-named
controls, adds the reaction strip and the pinned marker, and puts the message's
timestamp above Forward and Pin. Reaction and forward for chat messages do not
exist in the app today, so those two are new affordances rather than a
relocation.

### 4. The thread header's back is a fixed link

`apps/mobile/src/screens/Messaging.tsx:1565` is `<Link to="/chats">` — it goes to
the conversation list no matter where the reader came from, and it is always
there. `apps/mobile/src/components/BackButton.tsx:19-35` already implements the
history-aware version the lab encodes, including the rule that the label must
describe where the button actually goes, with a fallback destination only when
there is no history.

## Not established

- Nothing in `apps/mobile` was changed. The lab is a single static HTML file; no
  product code, test or route was touched.
- The lab has not been opened in a browser during this work. The only automated
  check was a syntax check of the extracted inline script (`node --check`), which
  proves it parses, not that it behaves.
- Touch behaviour is simulated with `data-input="touch"`. No coarse-pointer
  device, long-press or on-screen keyboard was exercised.
- 200% text is a lab control scaling em-based typography. It does not prove the
  app's own 200% behaviour, and the 380 px context column is tight at that size
  even though it still scrolls.
- Chat reactions have no model, table or service today (only report reactions
  exist, via the feed's reaction owner). "Reuse the feed reaction owner" is a
  proposal here, not a verified integration.
- Pin limits are not modelled: the app caps a connected conversation at three
  pins (`Messaging.tsx:1485-1489`) and the lab does not.
- Forward only announces; there is no forwarding model or receipt.
- The 200 ms open delay, 350 ms tooltip delay and 140 ms close grace are lab
  values chosen to feel right. They are not measured from Instagram or from
  Norfold.
- The report in the lab is stood in for one post; the real report surface, its
  loading and error states, and the role-gated surfaces are out of scope.
- The <900 px breakpoint is a container query on the lab frame. The app sizes
  from the window, so the two will disagree near the boundary until the frame
  becomes the real container.

## Decision for the lead

Pattern A reverses a documented product rule, not just a component.
`UserIdentityTrigger.tsx:29-36` says a person is a destination with no
intermediate step, and `AdaptiveLayout.test.tsx:50-56` enforces it. Adopting the
hover preview means rewriting that comment and that test, and deciding whether
the preview is reachable by keyboard only, as in the lab, or by Tab as well.
Patterns B, C and D do not conflict with an existing test.
