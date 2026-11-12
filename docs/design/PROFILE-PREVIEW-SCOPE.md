# Profile preview — where it belongs

Status: **scope proposal with a lead decision on the first set. Not implemented.**
The owner approved a profile hover preview *in the desktop lab*. This document
answers only "on which surfaces", surface by surface. It changes no source and
authorises no build beyond the first set named at the end.

Read with `docs/design/DESKTOP-INTERACTIONS.md` §1 ("Identity is currently a
direct link, not a preview") and the "Pattern A reverses a documented product
rule" section.

---

## 1. The rule in force today

`apps/mobile/src/components/UserIdentityTrigger.tsx:29-36`, verbatim:

> A person's avatar and name are ONE direct link to their full-screen profile.
>
> There is deliberately no quick-card popover, mini profile, bottom sheet or
> intermediate step: a person is a destination. Rows that also do something
> else (a chat row, a helper picker) split their hit targets instead of making
> the identity a selector.

`:44` renders it as `<Link to={identityHref(person)} …>`. The destination is
one canonical route (`identityHref`, `:17-23` → `/u/{username}`), with context
carried in the query string and revalidated server-side.

The same rule is restated in CSS: `apps/mobile/src/components/conversationInfo.css:63`
— "A person's avatar/name is a link, never a button that opens a popover."

## 2. Pointer rule — what the codebase already has

There is an existing, canonical fine-pointer check; a preview must reuse it
rather than invent a second one.

- `apps/mobile/src/components/inputCapabilities.ts:3` —
  `export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";`
- `:5-7` `hasFinePointer()`, `:9-14` `subscribe()`, `:17` `useFinePointer()`,
  whose server snapshot is `false`.

`:16` states the intent: "Input capability, not a phone/tablet or touch-device
guess." That is precisely the gate a hover preview needs. Anything built must
branch on `useFinePointer()`, not on viewport width, so a touch laptop and a
phone in landscape stay on the current path.

## 3. Conflicts that determine placement

- **Absolutely-positioned masonry tiles.** `apps/mobile/src/components/FeedMasonry.tsx:181-190`
  places every tile with `className="absolute left-0 top-0"` and
  `transform: translate3d(...)`. A `transform` creates a containing block and a
  stacking context, so a preview rendered inside a tile cannot escape the tile's
  box. Any masonry adoption must portal the preview to a layer root, not the
  tile.
- **Nested interactive.** The identity is already a `<Link>`
  (`UserIdentityTrigger.tsx:44`). A hover preview needs a hover target that is
  not a link, or a link that also opens a popover — the second is the nested
  interactive pattern the codebase avoids (`apps/mobile/src/components/PostCard.tsx:57-58`:
  "A wrapping link would invalidate their native keyboard/assistive
  semantics").
- **Row-as-identity.** Several surfaces make the entire row the profile link
  (`PeopleSearch.tsx:57-63`) or the conversation link
  (`Messaging.tsx:519-523`, `:606-627`). There is no separate identity target to
  hover, and adding one would split a hit target the code deliberately keeps whole.
- **Dialogs.** `PeerIdentityActions.tsx:139-142` renders identity as plain text
  inside a `Dialog`. A preview there would be a dialog inside a dialog.
- **Virtualised lists.** None exist. `react-window`, `react-virtual` and
  `@tanstack/react-virtual` are absent from the workspace, so the
  virtualised-recycling conflict class does not currently apply. If one is added
  later, hover state must be keyed to item identity, not row position.
- **Scroll containers.** Feed, search results and comment threads scroll under
  the pointer. A preview must not open on incidental transit; the lab's 200 ms
  rest delay is the mitigation and is not optional.

## 4. The identity trigger and its two tests

Adopting a preview on desktop collides with four things that assert the
opposite:

1. The doc comment at `UserIdentityTrigger.tsx:29-36` says there is
   "deliberately no quick-card popover".
2. `apps/mobile/src/components/AdaptiveLayout.test.tsx:50-56`, test
   "identity is a direct profile link, not a quick-card popover", asserts at
   `:54` `expect(screen.queryByRole("dialog")).toBeNull()`.
3. `apps/mobile/src/components/PeerIdentityActions.test.tsx:78-84`, test
   "renders the identity as a direct profile link with no quick-card dialog",
   asserts the same at `:83`.
4. Dead scaffolding already points the other way: `docs/DESIGN_SYSTEM.md:46`
   lists a `UserQuickCard.tsx` that does not exist in `apps/mobile/src`;
   `apps/mobile/src/components/adaptiveFoundation.css:69-71` still carries
   `.fb-quick-trigger` alongside `.fb-quick-popover`/`.fb-quick-dialog`;
   `PostAnatomy.css:3,24` and `CommentThread.css:4` still style
   `.fb-quick-trigger`.

**What must change if adopted on desktop**

- Rewrite the `:29-36` comment so the rule is scoped: a person is a destination
  on touch; on a fine pointer the identity may preview and still navigate.
- Make both `queryByRole("dialog")` assertions pointer-conditional — still null
  under a coarse pointer, non-null under a fine one. They cannot stay
  unconditional.
- Give `UserIdentityTrigger` two render paths: the existing `<Link>` for coarse
  pointers, and a `Button aria-haspopup="dialog"` + layered popover for fine
  pointers.
- Either adopt the `.fb-quick-*` residue or delete it; leaving styled classes
  that no component renders keeps advertising a component that doesn't exist.

**Can the mobile path stay untouched?** Yes, behaviourally: `useFinePointer()`
returns `false` on touch (`inputCapabilities.ts:5-7,17`), so the `<Link>` branch
is what ships there. But the *tests* and the *comment* must still change,
because they assert the absence of a dialog unconditionally, and the comment
states an absolute rule the desktop path would break.

## 5. Surface inventory

Every surface that renders another person's identity. "Inert" means the identity
is not an independent interactive target.

| # | Surface | Where | Today | Link/inert | Recommendation | Reason / conflict |
|---|---|---|---|---|---|---|
| 1 | Feed card, classic/editorial/home-feed | `PostCardContent.tsx:116` → `PostAnatomy.tsx:19-26` → `UserIdentityTrigger.tsx:44` | avatar+name, one link | link | **Hover card (desktop), tap-through (touch)** | Dense list is the lab's case; no containment issue. |
| 2 | Feed card, masonry | same chain, inside `FeedMasonry.tsx:181-190` | same link | link | **Hover card, portalled** | `translate3d` tile traps an in-tile layer; must render at a layer root. |
| 3 | Report detail hero | `PostDetail.tsx:1089` → `PostIdentityHeader` | same link | link | **Tap-through only** | The page already *is* the full destination; a preview duplicates it. |
| 4 | Comment row (report detail) | `PostDetail.tsx:976` → `CommentIdentityHeader.tsx:14-16` | avatar+@handle link | link | **Hover card (desktop)** | The lab reproduces this exact row. |
| 5 | Reply row | same as 4 | same | link | **Hover card (desktop)** | Same thread density as 4. |
| 6 | Chat thread header | `ChatIdentity.tsx:35` | link inside the `h1` | link | **Tap-through only** | Already 1:1 with this person; header is a primary control. |
| 7 | Conversation list row | `Messaging.tsx:608-609` avatar, `:625` row link | avatar inert, row opens chat | row link | **No card** | Identity is not an independent target; profile lives in the header (`:603-605`). |
| 8 | Collapsed chat rail | `Messaging.tsx:519-521` avatar `aria-hidden`, `:523` row link | avatar inert | row link | **No card** | Same rule as 7 (`:516-517`). |
| 9 | Chat details identity block | `Messaging.tsx:1561-1562` | avatar + name, plain text | inert | **No card** | This *is* the profile-information surface. |
| 10 | Chat details "View profile" | `Messaging.tsx:1540` | direct profile link | link | **No card** | Already the destination row. |
| 11 | Voice message avatar | `Messaging.tsx:402` | avatar inside the player control | inert | **No card** | Nested interactive; hovering a play control must not open a panel. |
| 12 | Notification actor | `Notifications.tsx:635-636` | decorative avatar | inert | **No card** | Row navigates; the avatar carries no separate meaning. |
| 13 | People search row | `PeopleSearch.tsx:57-63` | whole row is the profile link | row link | **Tap-through only** | The row is the identity; a card would restate it. |
| 14 | Report search results | `PostCardContent.tsx:116` chain | identity link | link | **Hover card**, same as 1 | Consistency with the feed card. |
| 15 | Mention autocomplete | `MentionAutocomplete.tsx:5,11` | avatar inside a combobox option | inert | **No card** | Typing context; pointer transit must never open a layer. |
| 16 | Peer-connect dialog | `PeerIdentityActions.tsx:139-142` | avatar + name, plain text in a `Dialog` | inert | **No card** | Nested dialog. |
| 17 | Moderation case author | `ModerationCaseSheet.tsx:84-86` | plain text fields | inert | **No card** | Moderator evidence, deliberately non-interactive (`:43`). |
| 18 | Blocked author row | `BlockedByViewerShield.tsx:103-109` | `inert` + `aria-hidden` | impossible | **No card** | A hover card cannot fire; correct by construction. |
| 19 | Settings self header / remembered accounts | `SettingsProfileHeader.tsx:15-20`, `RememberedAccounts.tsx:38-41` | self identity / account switch | link/button | **No card** | Previewing yourself is meaningless. |
| 20 | Profile page hero | `ProfileHero.tsx:14-27` | avatar + @handle | inert | **No card** | The page is the destination. |

### Checked and excluded

- **Matches surfaces render report links, not people.** `PossibleMatches.tsx:233-239`
  and `ReportMatches.tsx:131-144` link `/posts/{id}`; no author identity is
  rendered, so there is nothing to preview.
- **No per-message author avatar.** Chat is strictly 1:1
  (`apps/mobile/src/services/messaging/policy.ts:29-30`, two participants), so
  messages carry no author chip; only the voice player (`Messaging.tsx:402`)
  draws one.
- **No followers/following surface exists** in the app. Out of scope; do not
  invent one to host a preview.
- **No standalone "owner card" component** was found. Ownership identity routes
  through `PostIdentityHeader`/`PostCardContent`, covered by rows 1-2.

## 6. Decision — first implementation set

Adopted by the lead on 2026-11-12. Desktop / fine pointer only; the touch path is
unchanged and gets no long-press preview.

**In**

1. **Comment and reply rows in report detail** (`PostDetail.tsx:976` →
   `CommentIdentityHeader.tsx:14-16`). No containment problem, the lab row is
   this row, and the benefit is clearest.
2. **Feed cards and report search results** (`PostCardContent.tsx:116` chain),
   classic / editorial / home-feed layouts. Same chain as 1; the container
   differs.
3. **Masonry tiles**, last, and only after the preview layer is proven to escape
   the tile's `translate3d` containing block (`FeedMasonry.tsx:181-190`). Ship
   last because it is the only placement with a real layout constraint.

**Out**, with reasons

- **Chat header, chat rows, chat rail, chat details, voice avatar** — identity is
  not a destination there; the conversation is. A preview would split hit targets
  the messaging code deliberately keeps whole (`Messaging.tsx:516-517,603-605`).
- **People search, notifications, mention autocomplete** — the row is the
  identity, or the surface is text entry; a card adds nothing and can hijack
  pointer transit.
- **Peer-connect dialog, moderation sheet** — nested dialog / deliberately
  non-interactive text.
- **Self-identity surfaces** — nothing to preview.
- **Report detail hero** — the page is already the destination.
- **Every touch path** — stays tap-through.

## 7. Still open

- Whether the preview is reachable by keyboard beyond the trigger (the lab shows
  it on focus but does not walk into it). A product call, not decided here.
- Whether the two identity tests get a pointer-mocked variant or one
  parameterised test.
- Whether the `.fb-quick-*` residue is adopted or deleted. Implementation choice.
