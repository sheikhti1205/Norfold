# Owner order 2026-11-12: the surfaces pass

Status: **active goal**. Recorded from the owner's message of 2026-11-12 with five
reference images. This file is the ledger of record: the owner does not restate
requirements, and no item here is dropped because it was inconvenient.

The owner's words that frame the whole order: "suck it up and have everything
built completely. Don't stop until then. If a issue occurs, defer it for later."
So: each item ships as its own commit, a blocked item is recorded as blocked and
the pass continues, and the pass is not declared complete until every row below
is either `done` or `blocked` with a named blocker.

## R1. One account control

Two separate controls at the foot of the rail (an account avatar and a gear) is
wrong. There is one identity control.

- It shows the account name, the account avatar and the earned badge together.
- It is a single button. Pressing it opens the account popover.
- The gear does not sit beside it as a second control.
- Settings is reached through the popover, not through a sibling icon.
- Compact rail: the avatar alone, with the name in the accessible name.

Decided shape, because the owner asked for a judgement rather than an
instruction: the row reads avatar, then name over `@handle`, then badge, with the
whole row as the trigger. The gear glyph survives only inside the popover as the
`Settings` row's icon.

Acceptance: one focusable control in the rail footer; name and badge visible at
every expanded width; no second settings control anywhere in the rail.

## R2. Popover rows open a preview, not a route

> **Superseded in part, 2026-11-13.** Hover previews are removed by owner order:
> rows are click-driven and a row's panel replaces the list **inside the same
> card**, never floating beside it. The retained requirement is that each row
> opens real content rather than a route. See the correction section below.

The account popover's rows currently navigate. The owner wants the row to open a
**nested floating popover showing what is inside**: previews, live values, the
thing itself.

- Hovering a row with a fine pointer, or tapping it with a coarse pointer, opens
  a floating preview beside the popover.
- The preview is a portal layer with its own elevation, dismisses on Escape,
  outside press, and on leaving along the row, and never steals focus from the
  popover itself.
- Each row's preview carries real content: Appearance shows the theme and
  navigation tiles, Activity preferences shows the per-type switches, Saved shows
  the most recent saved reports, Settings shows the account panel (R3).
- Rows without a meaningful preview (Log out) do not pretend to have one.
- Keyboard: focus moves into the preview on open and returns to the row on close.

Acceptance: pointer hover over `Appearance` opens a preview containing the theme
tiles; keyboard `Enter` on the same row opens it; Escape closes only the preview
first, then the popover.

## R3. Settings opens a floating account panel

> **Superseded, 2026-11-13.** Settings now opens the settings window directly,
> and the account slice (identity, contact rules) lives at `/settings/account`,
> mounted by that window. The panel described here duplicated the settings tree;
> it is not built twice. See the correction section below.

Pressing `Settings` inside the popover opens a floating panel, not the settings
page.

- The panel holds account-level settings that are missing today: display name,
  handle, profile visibility, who can message you, who can connect with you,
  who can see your contact details, and the meagre preferences that have no home
  yet.
- Contact rules are real settings with stored values, not decorative rows.
- Anything that needs more room than a floating panel is one press away from the
  full page; the panel is not a replacement for Settings, it is the account slice
  of it.
- Back returns to the popover, not to the app root.

Acceptance: pressing Settings shows a panel with at least the four contact rules;
each rule persists and re-reads; Back returns to the account popover.

## R4. Messaging accepts files of every type, safely

- Photos, videos, audio, documents, archives, any type the account may send.
- Supabase Storage is a transport only: the bytes land in a private bucket, the
  client decides what it received, and the UI renders image, video, audio, PDF,
  or a generic file card accordingly.
- Dangerous and executable types are refused by extension **and** by detected
  MIME, before upload and again server-side: `bat`, `cmd`, `com`, `scr`, `pif`,
  `exe`, `msi`, `dll`, `ps1`, `vbs`, `vbe`, `js`, `jse`, `wsf`, `wsh`, `hta`,
  `jar`, `reg`, `lnk`, `cpl`, `inf`, `gadget`, `application`, `app`, `apk`,
  `dmg`, `pkg`, `deb`, `rpm`, `sh`, `bash`, `zsh`, `py`, `pl`, `rb`, `php`.
- `svg` is refused as a rendered image because it can carry script; it may be
  sent as a download-only file card if the owner wants it later.
- HTML is never rendered from an upload. Downloads use `Content-Disposition:
  attachment` and a `text/plain` or `application/octet-stream` type.
- Per-file cap and per-conversation budget are enforced client-side and named in
  the UI; the bucket policy enforces ownership.
- Filenames are sanitised for display, never used as a path.

Acceptance: a `.pdf`, a `.mp4`, a `.zip` and a `.bat` are attempted; the first
three upload and render in their own card, the fourth is refused with a plain
sentence before any byte leaves the device.

Implementation state (2026-11-13): the client lane, the private bucket
migration (`20261112170000_chat_file_transport.sql`) and the refusal list are
written and tested at the unit level. The migration is **not applied**, so no
live upload can succeed yet; live acceptance also needs a signed-in session,
which this session does not have consent to use. Blocked on owner approval to
apply the migration, then one signed-in attempt. Retention sweep for transport
objects is a named follow-up, not part of this row.

## R5. Emoji, stickers and GIFs in every composer

- The report comment composer and both chat composers carry the same three
  affordances: emoji, stickers, GIFs.
- Stickers and GIFs come from the existing Klipy client contract; when the key is
  absent the control explains itself instead of disappearing silently.
- Emoji insertion lands at the caret, never at the end, and never breaks an open
  IME composition.
- Picking any of them returns focus to the text field.

Acceptance: emoji picked mid-string lands at the caret; a sticker lands as an
attachment in comments and as a message in chat; the GIF tab is reachable from
both composers.

## R6. The composer never loses focus

- Pressing Send does not blur the text field, in comments or in chat.
- The field is never `disabled` while a send is in flight; it is `readOnly` at
  most, and the send control is what becomes unavailable.
- Enter sends. Shift+Enter inserts a newline. Ctrl/Cmd/Alt+Enter keep whatever the
  platform does. IME composition never sends.
- This is fine-pointer behaviour. Touch keeps newline on Enter, and the Android
  keyboard path is untouched.

Acceptance: a test asserts `document.activeElement` is still the textarea after a
pointer Send and after the send settles; Shift+Enter produces a newline and no
send; coarse input still does not send on Enter.

## R7. Every sidebar collapses

- The primary navigation rail collapses, which it already can, and the choice
  persists.
- The chat conversation list collapses.
- The chat details pane on the right collapses.
- Both chat panes are collapsible independently, by a visible control, with the
  state persisted and announced (`aria-expanded`), and the thread keeps a usable
  width when both are closed.
- Keyboard reachable, and the control is a button, never a bare glyph.

Acceptance: with both chat sidebars closed the thread still renders at 1024 and
at 1280; reopening restores the exact previous widths; state survives a reload.

## R8. The rail is resizable

Owner order 2026-11-13, stated twice. The pinned rail must be resizable; a
previous pass removed drag resizing and that is not acceptable.

- Pointer drag on the rail's inner edge, clamped to 200-360px, persisted as
  `railWidth` in the appearance store. Default remains 224.
- Keyboard: the separator is focusable; ArrowLeft/ArrowRight step, Home/End jump
  to the bounds, and `aria-valuenow` reports the current width.
- The collapsed rail is unchanged (72/80px); the stored width governs the
  expanded rail only.
- The account popover reads the same `--fb-rail-w` variable, so its width and
  the rail never drift apart.

Acceptance: dragging the separator changes the rail width and the content column
reflows in the same paint; the width survives a reload; keyboard steps and
clamps at both bounds; a 360px rail does not break the account popover.

## Status

| ID | Item | Status |
| --- | --- | --- |
| R1 | One account control | done |
| R2 | Row panels, not routes | done as click-driven in-card panels; hover previews superseded 2026-11-13 |
| R3 | Settings surface | done in source as the settings window; contact rules at `/settings/account`; signed-in rendered review unverified |
| R4 | All-type attachments, safely | blocked, live acceptance pending |
| R5 | Emoji, stickers, GIFs everywhere | done |
| R6 | Composer focus and Enter | done |
| R7 | Collapsible sidebars | done |
| R8 | Resizable rail | done in source; pointer and keyboard verified rendered |

A row moves to `done` only with the acceptance check above observed. A row that
cannot complete moves to `blocked` with the blocker named, and the pass carries
on with the next row.

### 2026-11-13 rendered pass

- The account popover opened off-screen on a phone: it was hard-placed to the
  right of its trigger with flipping disabled, so a 287px panel sat at x=347 on a
  390px viewport. Placement now follows the layout and may flip.
- The nested panel sat outside the popover's box while `.fb-popover` scrolls, so
  an open panel turned the menu into a horizontally scrolling card. Wide sizes
  now carry both panes inside one card; a phone opens the panel first in the
  scroll area.
- The conversation composer at 320dp collapsed its field to 66px and clipped its
  own placeholder ("Mes"). Under 400px of the composer's own width the attachment
  cluster now hides behind `>`, decided by a container query, and the field keeps
  146-161px.
- The emoji palette measured itself against the window; it now measures against
  the composer, so a 390px phone gets a 261-273px palette with no sideways
  overflow.

### 2026-11-13 correction: menu panels and the settings window

The owner corrected the R2/R3 reading in the same session, with the ChatGPT
account menu as the reference:

- **No hover previews.** A row's panel replaces the list inside the same card.
  Open and close are presses, not pointer crossings. This removes the second
  floating layer and the "preview beside the popover" geometry that had already
  put a 287px panel at x=347 on a 390px phone.
- **Rows, in order:** identity (name, badge, chevron; pressing offers account
  switching), Personalization, Activity preferences, Settings, Report a problem,
  Help, Log out.
- **Settings opens the settings window directly**, not an option list and not an
  account-only panel. The window mounts the same settings route tree as the
  `/settings` URL (`screens/settingsRoutes.tsx`, declared once), on its own
  memory history, so closing returns to the app exactly where the reader was and
  an in-window section visit leaves no settings URL behind.
- **Every settings destination opens in the window.** Activity preferences,
  Report a problem, Help and "Open Personalization" open the window at that
  section; so does any in-app link to `/settings` or `/settings/*`, intercepted
  once at the shell. A row never swaps the page behind the window for a separate
  settings screen. A standing `/settings` URL still renders the standalone page,
  so a deep link keeps working.
- **Outside press dismisses the window**, Escape dismisses it, and Android Back
  walks the window's own sections first, then closes it.
- **The page behind stays visible, blurred** (owner's explicit recall): the
  backdrop is an 18px blur with a light scrim, and the window surface itself is
  frosted, 84% surface with a 30px blur. Nothing is hidden behind an opaque
  sheet.
- **Wide placement:** the popover opens above the trigger, is exactly
  `--fb-rail-w` wide, is pulled back by the rail's 12px padding so it spans the
  rail's outer edges, and covers the rail's own destinations. Below 900px it is
  above and end-aligned; the window is full-screen.

Acceptance evidence: rendered at 1016px wide — menu 224x347 at x=0, flush with
the 224px rail, seven rows in order; Settings window 955x601 with the blurred
page visible through it; outside press and Escape both close it; keyboard
resize 224→256 and pointer drag 256→360 both persisted, and the menu tracked the
360px rail. Signed-in settings content and phone-width rendered review remain
unverified in this session (no personal-session consent).

### 2026-11-13 rendered pass: one search surface

Owner order in this session: the app bar's magnifier must open the prototype's
floating search, and every search entry must reach that same surface. Reviewed
through the dev-only `/__fixture/chrome` stage with headless Chromium, because
the desktop session was locked and the in-app browser could not capture pixels.
Captures: 1280x800, 390x844 and 320x720, in light, dark, AMOLED and xlarge text.

- Geometry: the desktop pill is 640x48, centred at x=320 on a 1280 viewport;
  the phone pill is 374x52 at x=8 (8px margins) with its top at 61, exactly 8px
  below the 53px app bar; 320dp gives 304x52 at x=8..312. No horizontal overflow
  at any width. The first capture was anchored at the viewport centre instead of
  centred on it (right edge 1280 on a 1280 viewport) because Motion writes its
  scale animation into the inline `transform`, which overrode the CSS translate.
  The individual `translate` property now centres all three widths. The settings
  window holds 1080x720 at x=100..1180 and is full-bleed at both phone widths.
- The phone prompt clipped mid-word at the filter icon ("...and peop") because
  Chrome ignores `text-overflow` on `::placeholder`. The prompt is a real
  ellipsized element now: "Search reports, messages and p…" at 390 and "Search
  reports, …" at 320/xlarge, with the input's aria-label unchanged. The filter
  and close controls in both search pills are 44x44.
- Interaction: focus lands in the field; Tab runs Advanced search, Close search,
  then the recent searches; Escape closes and returns focus to the app-bar
  trigger with aria-expanded=false; an outside press closes it; Apply closes the
  filter card and returns focus to Advanced search. The settings window opens
  its destinations in place, Escape and an outside press close it, and its
  search bar attaches under the header with no bell.
- Contrast from computed styles: the muted prompt measures 8.18:1 in light and
  8.36:1 in dark and AMOLED; result titles 15.43:1 and 14.47:1. Recents,
  no-results, loading ("Searching…") and error ("Try again") states exist in
  source with tests; the signed-out query renders "Sign in to search reports
  and people.".
- Not covered: signed-in settings content, live search loading/error, and touch
  targets on a physical device. The fixture has no session, so the settings list
  is empty by design and signed-in destinations are filtered out of settings
  search. Device acceptance still needs owner consent.

### 2026-11-13 pass: compact filters, custom calendar, app-bar trim

Owner direction in this session: remove the app bar's sliders control as
redundant with the search filters, make Clear a real button beside the filter
icon, and make the phone layout meaningfully more compact. "Apply closes the
filter card" from the pass above no longer exists: choosing an option applies it
live and returns focus to its pill.

- **App bar.** Home renders the brand, notifications and the magnifier only.
  `HomeTopBar` lost its `filterButton` prop, and Home's old advanced-filter sheet
  is gone. `AdvancedSearchFilters` gained `hideSheet` so Home keeps the
  active-filter chips: a URL such as `/?category=…` can never become invisible
  just because its only control moved into search.
- **Clear.** `Clear filters` is a 30px outlined pill inside the search bar,
  immediately left of the 44px filter control; the underlined `Clear` link is
  removed. It appears only while a filter is active and returns focus to the
  filter control. The empty-state action is now `Clear search`, because it also
  clears the query.
- **Filter tray.** One horizontal row of five pills (Type, Category, Status,
  Date, Sort) with one inline panel open at a time. No native `<select>` and no
  native date input remain. The opened pill scrolls itself into view, including
  after a value widens its label ("Date" becomes "From Nov 20"); at 320dp the
  measured scrollLeft is 55 and the pill's right edge lands exactly on the row's
  right edge (312).
- **Date.** The panel is a 2x2 preset grid (Any date, Last 7 days, Last 30
  days, This year) over From and To triggers; both triggers stay visible at
  320dp in a 290px column. The calendar is app-styled: six fixed week rows,
  accent-filled selected day (rgb(53, 104, 212) with white text), outlined today,
  and out-of-range days disabled from the other bound. The month header opens a
  month list; the year opens a year list, then a month list for that year; each
  choice returns to the day grid. Clear and Today actions sit in a footer row.
- **Compaction (rendered, 320dp unless noted).** Search bar 52 to 46px; pills
  44 to 36px; menu options 44 to 40px, 38px on phone; calendar nav 36px; day
  cells 35px at 320 and 41px at 390; date-options panel 434 to 290px; menu 434
  to 386px. Desktop keeps the roomier sizes: 46px bar, 40px pills, 360px
  calendar, two side-by-side date triggers.
- **Rendered evidence.** Live dev app inside the 320x640 and 390x640 review
  frame, plus 992x644 desktop: light, dark, AMOLED, and xlarge text (20px root).
  Calendar boxes measured 264x376 at 320, 300x407 at 390 and 360x458 on desktop;
  no panel overlapped the overlay bounds and no horizontal overflow appeared.
  A fresh reload followed by a full click-through (open search, filters, Date,
  From, month list, pick March, year list, pick a year, pick a day, Clear bound,
  then Escape through the layers) produced zero console errors.
- **Antislop after-pass.** R-02 found four pre-existing em dashes; all were
  replaced in the files this change owns: the brand button's accessible name is
  now "Norfold, scroll the feed to the top", the Nearby notice uses a period, and
  the two Search place validation strings use a period and a comma. No decorative
  glow, gradient, invented data or dead control was added, and the accent stays
  on the selected day and active count only.
- **Access trade-off.** The compact phone pill row is 36px tall and the 320dp
  calendar day is 35px; both clear WCAG 2.2's 24px minimum but sit below the
  44px iOS guidance. That is the owner-directed compaction limit for a 7-column
  grid inside a 304px overlay. Revisit if a device pass shows mis-taps.
- **Verification.** `npm run typecheck -w apps/mobile` exits 0; ESLint reports
  no errors on the changed TypeScript files (the CSS file is outside the ESLint
  config). Full mobile suite at this state: 8419 passed, 4 failed, in 2 files
  this change does not touch. `auth.recoveryOtp` stops at the environment guard
  `Public share origin must be a bare public HTTPS origin`; `sqliteHistory`
  hits Windows `EPERM` removing its temp directory. Both fail in isolation and
  are recorded as environment-bound, not regressions. Two stale tests left by
  earlier work were repaired here: the accent-migration expectation now matches
  the stored preferences instead of the exact appearance shape (so a new
  setting cannot break it), and the account-deletion suite mocks the
  contact-rules load so its alert query sees exactly one alert. Focused runs:
  138 tests across overlay, Home, AdvancedSearchFilters and SearchScreen; 140
  token-contrast and motion tests.
- **Still unverified.** Signed-in settings pixels, live search loading/error
  states, and physical-device touch all remain unverified; device acceptance
  needs owner consent.

### 2026-11-13 pass: rail brand control, create placement, Home discovery scope

Owner direction in this session: the rail's expand/collapse control becomes the
app logo, with the name shown while the column is open and the mark alone when
collapsed; the brand sits inside the sidebar, left-aligned like the destination
icons. The rail's large `+` moves next to the bell. Home's Nearby/Open/Recent
row is removed because scope belongs to search.

- **Brand control.** `.fb-nav-rail-head` now holds one `.fb-nav-brand` button:
  the canonical `BrandMark` (`size={28} shape="tile" alt=""`) plus the `Norfold`
  wordmark, with `aria-pressed` and the action name `Expand navigation` /
  `Collapse navigation`. Hover and `:focus-visible` share the destination row
  treatment. The old `.fb-nav-pin` glyph is gone.
- **Alignment.** Pinned: nav 224px, the brand button starts at x=12 and its mark
  at x=24, while the first destination glyph starts at x=23. The wordmark
  follows the mark at the same inset as destination labels. Collapsed: nav 72px,
  the 48px brand button is centred at x=12, the mark is x=22 with its centre on
  36, the rail centre, and the first destination glyph centres on 35. The
  wordmark is hidden and the action name is `Expand navigation`.
- **Create placement.** The rail no longer renders a create action.
  `TopUtilities` renders a 44px `Create report` icon link before the bell when
  the resolved layout is rail; phones keep the bottom bar's floating `+` and
  show no utility create. Clicking the utility link in the dev app opened
  `#/report` and the `Create report` dialog.
- **Home scope.** `HomeFilterChips.tsx` and `HomeNearby.test.tsx` are deleted
  with the chip row, the nearby session, the radius sheet, the map fallback and
  the snack. Search already owns Nearby (`SearchNearbyControls`), Status=Open
  and the date presets, so no search control was added. Home still reads
  `?status=OPEN` from the URL for a filtered feed.
- **Chrome subscription.** `TopUtilities` reads `useStoredNavLayout()` rather
  than `useAppearance()`. The fixture's page-wide text hold is the only
  root-font-size writer; the full appearance hook re-applied the stored scale
  inside the review fixture and broke `fixture.test.tsx` at 112.5%. The read-only
  subscription keeps the layout reactive without a second appearance writer.
- **Rendered evidence.** 800x650 light: pinned rail 224px with the wordmark,
  create, bell and search in that order; collapsed rail 72px with the mark only.
  320x650: light, dark, AMOLED and xlarge text (125% root). Home shows no Nearby
  or Recent row; the bottom bar keeps the floating `+`; the header holds the
  brand, bell and search. No horizontal overflow at 320 xlarge (`scrollWidth`
  320). The wordmark token pair measured 14.63:1 against the rail surface in
  light.
- **Antislop after-pass.** R-02 PASS: no em dash added; the visible string is
  the product name. R-03 PASS: four 320px renders, no overflow. R-23 PASS:
  reused the canonical `BrandMark`; no asset created. R-24/R-26 PASS: create
  navigates to `#/report` and opens the dialog; the brand toggles the rail; no
  dead control added. R-25 PASS: wordmark on `--fb-surface` measured 14.63:1
  light; the dark pair is the label pair already measured in the nav matrix.
  R-27 PASS: Home's loading, empty and error states remain. R-32/R-39 PASS:
  native button and link, accessible names, existing focus treatment. R-34 PASS:
  light, dark and AMOLED rendered. R-35 PASS: the dev app was run; the brand was
  clicked (224 to 72) and the create link was clicked (`#/report` plus dialog).
  R-36/R-38 PASS: no fabricated content. R-04/R-09/R-10/R-12/R-13/R-19/R-29/
  R-31 PASS: existing icon set, no decorative badge, glass, glow, shadow or new
  motion; the palette is unchanged and each decision is recorded here or in
  source comments. R-40 N/A: this change adds no media or third-party script.
- **Verification.** `npm run typecheck` exits 0; ESLint exits 0 on the changed
  TypeScript files; targeted suites (`fixture`, `TopUtilities`, `Shell`, `Home`)
  pass 154 tests. The full mobile suite: 8404 passed, 4 failed.
  `auth.recoveryOtp` stops at the environment guard `Public share origin must be
  a bare public HTTPS origin`; the three `sqliteHistory` failures hit Windows
  `EPERM` removing a temp directory. Both fail in isolation and are not caused
  by this change.
- **Open question.** Home's own header lockup (brand, then `Norfold`) now sits
  beside the pinned rail's lockup, so the same brand appears twice in one top
  row. It was left in place because it is Home's scroll-to-top control, not part
  of the rail change; suppressing it when the rail is pinned is an owner
  decision.
- **Still unverified.** Physical-device touch and the real-account path were not
  exercised in this pass. Device acceptance needs owner consent.

