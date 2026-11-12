# Owner decisions — 2026-11-12

A standalone record of what the owner settled, so an implementer can act without
the chat. Where the owner's wording was short it is quoted; the precise rule
follows.

**Status vocabulary**

- **decided** — the rule is settled; no further design input needed.
- **approved-for-design** — direction approved, implementation not written.
- **implemented, unverified** — code exists in the working tree; an independent
  check has not yet passed.
- **verified** — an independent check passed and the evidence is recorded here.

Nothing in this document is a completion claim beyond the status it states.

---

## Summary

| # | Decision | Status |
|---|---|---|
| 1 | Contained-post pop-up | approved-for-design |
| 2 | Masonry parameters | approved-for-design |
| 3 | Palette frozen / deferred | decided |
| 4 | No accent overlay on text boxes | implemented in the prototype, unverified |
| 5 | Search is a floating overlay only | implemented in the prototype, unverified |
| 6 | Notification bell toggles an anchored panel | implemented in the prototype, unverified |
| 7 | Blur on every floating layer | implemented in the prototype, unverified |
| 8 | Calendar with month/year jump, past-only | implemented in `ReportDatePicker` (unit-tested), rendered review unverified |
| 9 | Klipy is device-side only | decided; contract in `KLIPY-CLIENT.md` |
| 10 | Profile preview | approved for comments and feed cards; scope in `PROFILE-PREVIEW-SCOPE.md` |
| 11 | Nested settings and activity flow | implemented in prototype; rendered review pending |

---

## 1. Contained-post pop-up

**Rule.** A shared report opened from a conversation shows as a contained pop-up
with the conversation beside it, bounded letterboxed media, and Like/Reply/Share
and comments in view. It does not replace zoom, fit or swipe.

**Present today.** The path is a page-sized report then a full-viewport viewer:
`Messaging.tsx:141` links `/posts/{reportId}`; `App.tsx:299` routes
`/posts/:id` to `PostModal`; `PostModal.tsx:7-11` mounts the whole `PostDetail`
in an `AdaptiveTaskSurface`; `PostDetail.tsx:1094-1100` sends the hero gallery to
`setLightbox`. Documented in `DESKTOP-INTERACTIONS.md`.

**Status:** approved-for-design. Not implemented.

## 2. Masonry parameters

**Rule.**

- `auto` stays 1–4 columns.
- 5–6 columns are allowed **only** when the reader explicitly chooses masonry
  **and** the canvas is raised to 1660px.
- Preserve aspect ratio with crop-to-fill. No random heights.
- Navigation stays tile → report → viewer.
- A dense grid is gated on a second ~320px image derivative.

**Why the numbers.** `responsive.ts:49` `MASONRY_MIN_CARD_PX = 260`, `:51`
gutter 12, `:53` `MASONRY_MAX_COLUMNS = 4`, `:69`
`MASONRY_CANVAS_MAX_PX = 1152`; column boundaries `272n + 28` →
572/844/1116/1388/1660 (`MASONRY-STUDY.md`). The 182px structural floor is the
four 44px action controls. At the 1152 cap six columns gives 176.67px — under
even that floor, so it is not offered at the current cap. 1660 is the canvas
that keeps the 260px floor at six columns.

**Status:** approved-for-design. Parameters decided, not implemented.

## 3. Palette

**Owner wording:** "the color doesn't change. even if I want to change it it
will be later when I decide. Until then, things follow the set values unless a
problem arises."

**Rule.** The palette is frozen at its current values. No new accent, tint or
theme token is introduced by any of these decisions. A change waits for an
explicit future owner decision, or for a demonstrated problem with a set value.

**Status:** decided. No code change. Decisions 4–8 are not palette changes.

## 4. No accent overlay on text boxes

**Rule.** A text input keeps its normal surface. No accent fill, accent wash,
accent focus ring or accent selection is applied to the field itself. Emphasis
comes from the existing neutral border/focus treatment, not a coloured field
background. This applies in light, dark and amoled.

**Present today.** Prototype: `::selection` was `--fb-primary-container` and
text-entry `:focus-visible` was a 2px `--fb-focus` ring; both removed in
`docs/design/nav/prototype.html`. Product source has not been audited field by
field — treat "every text box" as unverified until that sweep is done.

**Status:** implemented in the prototype, unverified. Product sweep pending.

## 5. Search is a floating overlay only

**Rule.** Search is a floating overlay — centred on desktop, top-anchored on a
phone, over a blurred backdrop. There is no search page. The in-bar filter stays
inside the overlay.

**Present today.** Prototype: the appbar search icon and the sidebar Search row
open `#searchOverlay`; the old search surface was removed. Product source still
routes `/search` to a page: `App.tsx:231`, `TopUtilities.tsx:64`,
`SearchScreen.tsx:153`, with filters in the URL (`:172`).

**Status:** implemented in the prototype, unverified. Product change not started.

## 6. Notification bell toggles an anchored panel

**Rule.** The bell toggles an anchored panel that never covers the bell, with
`aria-expanded` correct and focus restored on every close path (click, Escape,
outside click, navigation).

**Present today.** Prototype: both appbar bells are `data-action="notifications"`
with `aria-haspopup`/`aria-expanded`/`aria-controls`; the panel is placed from the
trigger rect below it and every close path resets the state. Product: desktop
only, a `DialogTrigger` popover in `TopUtilities.tsx:65-67` and
`NotificationPopover.tsx:9-16` with `placement="bottom end"` and `offset={6}`;
below 600px the bell is a plain `Link to="/notifications"`.

**Status:** implemented in the prototype, unverified. Product phone half pending.

## 7. Blur on every floating layer

**Rule.** Every floating layer — search, notifications, settings, date popover —
sits over a blurred backdrop, on mobile and desktop. Blur is a property of the
layer, not of each call site.

**Present today.** Prototype: one shared backdrop with
`backdrop-filter: blur(12px) saturate(.9)`, dismisses on click. Product: blur is
opt-in and rare — `BottomSheet.tsx:160` only when `backdropBlur` is set;
`AuthLinkBootstrap.tsx:157` uses `backdrop-blur-sm`; `NotificationPopover.tsx:11`
has none. There is no shared floating-layer primitive.

**Status:** implemented in the prototype, unverified. Product change not started.

## 8. Every date entry opens the calendar, with month/year jump

**Rule.** Every date entry opens the calendar. The calendar can jump to a
specific month and year instead of crawling one month per click. Event dates
allow the past only.

**Present today.** `ReportDatePicker` now has an inline jump panel: a
month-year disclosure button with `aria-expanded`, a year stepper (Shift+Arrow
±10 years), a 3×4 month grid, `past-only` guards on future months and years, and
Escape closing the panel before the sheet. `displayedValue`/`value` are untouched
until Confirm, so jumping then cancelling is a no-op.

**Evidence.** `heavy-run npx vitest run apps/mobile/src/components/ReportDatePicker.test.tsx`
→ 50 passed / 0 failed (43 pre-existing + 7 new); `ReportEditor.test.tsx` →
16 passed; `tsc --noEmit` exit 0; eslint exit 0. Reported by the implementer and
not yet independently re-run by the lead.

Two surfaces still use raw date inputs: `AdvancedSearchFilters.tsx:229-230`
(`type="date"` for From/To) and `ModerationCaseSheet.tsx:458`. The implementer's
nesting assessment: both hosts sit inside a react-aria modal stack, while
`BottomSheet` is `fixed inset-0 z-50` with no portal — so a hosted picker would
paint behind the host surface, and two separate escape stacks could double-handle
Escape. `BottomSheet` needs a body portal and overlay-depth registration before
either surface can adopt the picker.

**Status:** implemented in `ReportDatePicker`, unit-tested; rendered review
unverified. The two raw date inputs remain open by design.

## 9. Klipy is device-side only

**Owner wording:** "The klipy contents shouldn't be loaded on our server side at
all. People should load them on their device and check their terms and others on
using it, if caching is allowed for faster access, we should enable users the
ability to cache things."

**Rule.** Norfold's servers never fetch, proxy, transform, cache, re-host or
store Klipy content. The device talks to Klipy directly under Klipy's terms.
Caching is a user-controlled, device-local setting.

**Present today.** Already true in code: `klipy.ts:24-26` states "no proxy, no
base64"; the allowlist is `:157-167`; the key is a build-time public identifier
compiled into the bundle (`scripts/check-klipy-config.mjs:110-111`). No Edge
Function references Klipy. The binding contract, including the provider's
thumbnail-only cache carve-out and the required message shape, is
[`KLIPY-CLIENT.md`](KLIPY-CLIENT.md).

**Status:** decided. The chat reference field needs a migration that is named but
not written and not applied.

## 10. Profile preview

**Rule.** On a fine pointer, hovering a person's identity may open a preview card
that still leads to the canonical profile. Touch is unchanged: the identity is a
link, with no long-press preview.

**Scope (lead decision).** In: comment and reply rows in report detail; feed cards
and report search results. Masonry tiles last, only after the preview layer is
proven to escape the tile's `translate3d` containing block. Out: chat header and
chat rows, people search, notifications, mention autocomplete, dialogs,
moderation, self surfaces, the report hero. Full table in
[`PROFILE-PREVIEW-SCOPE.md`](PROFILE-PREVIEW-SCOPE.md).

**What must change.** `UserIdentityTrigger.tsx:29-36` (the absolute "no
quick-card popover" comment), `AdaptiveLayout.test.tsx:54` and
`PeerIdentityActions.test.tsx:83` (both assert no dialog unconditionally), and the
dead `.fb-quick-*` styles.

**Status:** approved-for-design. Nothing implemented.

---

## 11. Nested settings and activity

Settings opens nested panels for account settings, appearance, activity
preferences, saved reports, reporting a problem, switching account and log out.
Activity supports read and unread, filtering, configurable retention defaulting
to seven days, and an activity-preferences entry. The bell preview shares the
activity data and read state. These examples are local prototype data.

On desktop, settings children appear beside the menu; on phones they replace its
contents and offer Back. Escape returns through the open levels. Retention offers
7, 14, 30 days and Never; read items older than the chosen period are hidden in
the prototype, not deleted from a server. Account and privacy preferences update
the synthetic profile, and notification preferences share the activity panel.
The prototype also models Activity loading and retry, report-specific detail,
account switching and a signed-out surface. These remain synthetic interactions,
not authentication or network requests.

**Status:** implemented in prototype; rendered review pending.
Product implementation and persistence are not claimed.

## What is deliberately absent

- No claim that any of the ten is released. Statuses 4–8 are prototype or
  working-tree changes, independently unverified.
- No palette change recorded, because the decision is to keep the set values.
- No migration file for decision 9; it is named only.
