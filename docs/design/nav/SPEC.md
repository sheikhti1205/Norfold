# Norfold navigation specification

Status: **design contract, not a claim of implementation**. The structure follows
`prototype.html` except where this contract supersedes it; its data and hash routes
are synthetic. Existing paths remain compatible, and proposed paths require product
work. The navigation study remains the research record.

## 1. Information architecture

### Platform rule

Desktop web uses an expanded sidebar; Android phones and mobile web retain the
existing bottom pill. At `600–1023px`, web uses the collapsed rail. The phone pill
remains a subset: Feed, My Reports, Messages, Settings, plus New Report. Rename
Home and Chats to Feed and Messages without changing pill geometry. Settings opens
the same popover, never a settings surface. My Reports remains at `/my` and is
reachable through the account profile; it is not a desktop sidebar row.

Desktop and tablet order, top to bottom:

1. **Primary:** Feed, New Report, Search, Messages, Activity, Insights.
2. **Others:** Connect, Liked / Disliked, Saved, Recovered, Achievements.
3. **Bottom cluster:** account row (avatar and name) and adjacent gear button.

The account row is the only navigation entry to the signed-in profile; no Profile
row exists. The gear opens a nested floating popover above it, not a Settings row
or destination. Search opens an overlay, not a destination. Use Messages in
navigation; `/chats` remains the compatible route.

### Destinations, availability and empty states

These are target behaviours, not claims of implementation. New surfaces must be
built before their links are enabled; do not ship dead links or synthetic counts.
Proposed paths are not routes already in `App.tsx`. List surfaces need loading and
error states distinct from empty states.

| Row | Destination or action | Current-item rule | Empty state | Surface today / data needed |
| --- | --- | --- | --- | --- |
| Feed | `/` | Exact `/`; `/posts/:id` selects Feed when no more specific source is known. | No reports: offer filter reset or New Report. | Exists: feed reports and filters. |
| New Report | `/report` | `/report`; phone create action has the same accessible name and current semantics. | Blank form with report type and fields; no fabricated draft. | Exists: report creation. |
| Search | Opens search overlay; no navigation. | Button is not a current page; underlying route retains its current item. | Empty query: recent searches, or `No recent searches`; no matches: `No results found` and `Clear filters`. | Report and people search exist; overlay, message search, recent searches and advanced card require product work. Preserve `/search` compatibility without making it the sidebar destination. |
| Messages | `/chats` | `/chats` and `/chats/:conversationId`; `/connections*` redirects retain Messages selection. | No conversations: explain that messages appear here. | Exists: conversations, messages and unread state. |
| Activity | `/activity` (proposed) | `/activity` and descendants; `/notifications` selects Activity until migrated or redirected. | `No activity yet`. | **New product surface**. Existing `/notifications` is related, not proof of this surface. Needs authorized events, timestamps, read state and destinations; unstored events require new data. |
| Insights | `/insights` (proposed) | `/insights` and descendants. | `No insights yet`. | **New product surface**; metric rules and data limits below. |
| Connect | `/connect` (proposed) | `/connect` and descendants. | `No suggestions right now`. | **New product surface**. Needs eligible profiles, consent/privacy and blocking filters, suggestion generation and real counts; `/connections` is a legacy Messages redirect, not Connect. |
| Liked / Disliked | `/reactions` (proposed) | `/reactions` and filter query. | `No liked reports yet` or `No disliked reports yet`. | **New product surface**. Needs authorized reactions and reports. New reactions are like-only; creating dislikes requires a product decision and data support. Display legacy dislikes only where stored and authorized. |
| Saved | `/saved` | `/saved` and its query parameters. | `No saved reports yet`. | Exists: saved reports. |
| Recovered | `/recovered` (proposed) | `/recovered` and descendants. | `No completed returns yet`. | **New product surface**. Needs participant-authorized completed returns and linked reports; do not infer handover from generic closure. |
| Achievements | `/achievements` (proposed) | `/achievements` and descendants. | `No achievements yet`. | **New product surface**. Needs approved catalogue, earning criteria, eligible events and durable progress. Rules require a product decision; no badges or denominator until decided. `3 of 12` is illustrative, not real data. |
| Account row | `/profile` | Select account row for `/profile`, `/profile/edit`, `/my` and `/my/:id/edit`; phone pill selects My Reports for `/my*`. | Missing avatar uses canonical initial-based avatar; missing name uses existing account fallback. | Exists: authenticated account/profile data; reuse canonical avatar renderer. |
| Gear | Opens settings popover; no route change. | Button exposes `aria-expanded`; never `aria-current`. | Static entries; disabled unavailable actions explain why. | Existing settings and role-gated leaves are related functionality, not the new popover. Popover and non-navigating actions require product work. |

The popover entries, in order, are Settings, Appearance, Your activity, Saved,
Report a problem, Switch account, and Log out. A rule separates Log out from the
other six. Entries act within the popover or invoke an in-place action; none
navigates or opens a settings surface. Do not enable an entry until its action is
real. Existing direct routes, including `/settings` and `/search`, remain
compatible but are not destinations of these controls. For unrelated authenticated
routes select no row rather than assert a false current destination. Route back
controls remain owned by the canvas.

### Insights data contract

Insights reports only the signed-in person's own authorized records:

| Measure | Definition and availability |
| --- | --- |
| Report counts and state | Count owned reports grouped by stored type and current status. Historical transitions require new data if not retained. |
| Response latency | Elapsed time from creation to first qualifying response, with event type and timestamp identified. **Requires new data** unless existing authorized records reliably link response and timestamp; never estimate from unrelated messages. |
| Completed returns | Count confirmed completed return records in which the account participated, deduplicated by return; exclude unconfirmed closures. |
| Ratings | Count and average available recovery-linked ratings received by the account, subject to participant authorization; no average when count is `0`. |

Views and view-based rates **require new data** and are not displayed. Missing,
unavailable or unauthorized inputs are not zero; omit the measure or show an
unavailable state. No cross-account aggregates or synthetic prototype numbers.

## 2. Geometry

All breakpoints and dimensions are CSS pixels; use the actual viewport. The
sidebar is in normal flex flow, never overlaid.

| Viewport | Navigation | Width | Toggle |
| --- | --- | --- | --- |
| `<600px` | Existing phone bottom pill | Available width, centered at `max-width:44rem` | None |
| `600–1023px` | Collapsed rail | `76px` | None |
| `≥1024px` | Expanded sidebar by default; optionally collapsed | `260px` or `76px` | `44px × 44px` |

The pill retains slot padding `8px 16px 12px`, row gap `8px`, pill padding `4px`,
radius `999px`, links `min-width:44px; min-height:48px`, and `52px × 52px`
create action. At pill container width `≤24rem`, visually hide labels while
keeping accessible names. Keep current safe-area and keyboard rules.

Sidebar/rail: `flex:none`, `min-height:0`, `border-inline-end:1px solid
var(--fb-outline-variant)`, background `--fb-surface`. Header contains brand and
toggle. The list has `overflow-y:auto`, `overflow-x:hidden`, `8px` horizontal
padding; the separated footer holds account and gear. At rail width keep both
controls reachable without clipping. Make footer and list reachable by scrolling
the nav as a whole when height cannot fit both. Rows have `min-height:44px`, icon
`20px`, `12px` icon/label gap, `10px` radius, and `8px 10px` padding. Rail rows
center the icon, retain accessible names and use `min-height:48px`; headings and
counts are visually hidden, not lost to assistive technology. Labels and counts
use `--fb-on-surface` and `--fb-on-surface-variant`; show only genuine counts.

At `200%` text, widths stay `260px` and `76px`; labels wrap without truncation,
rows grow beyond their minimum and the nav scrolls vertically. Browser zoom changes
CSS viewport width and may change the active breakpoint.

### Scrollbars

Every scroll container, including document, nav, canvas and overlay lists, hides
its scrollbar at rest without reserving a gutter. On hover over that container or
while it is scrolling, reveal a `4px` overlay thumb; after scrolling stops, fade
it out after `900ms` unless still hovered. The thumb overlays content and never
changes layout. Wheel, trackpad, keyboard and touch scrolling remain functional;
`overflow:hidden` is not a scrollbar-hiding technique. Use an overlay scrollbar
implementation where native scrollbars cannot meet the no-gutter rule, retaining
native scroll semantics and keyboard access.

## 3. States

| State | Rule |
| --- | --- |
| Default | Transparent background, `--fb-on-surface` text and icon. |
| Hover | `--fb-surface-container` background only; no label layer while expanded. |
| Focus | `:focus-visible` uses `2px solid var(--fb-focus)` with `2px` offset; never remove the focus indicator. |
| Current | `aria-current="page"`, `--fb-primary-container` background, `--fb-on-primary-container` foreground, weight `600`; also distinguish in forced colors. |
| Attention | Messages and Activity may show a dot only for known unread data; include its meaning in the accessible name. Unknown or `0` means no dot. Connect count and Achievements progress require real eligible data. |
| Disabled | Unbuilt destinations are omitted until usable; temporarily unavailable actions use native disabled semantics and an explanation. |
| Gear default / hover / focus / open | Icon button named `Settings`, transparent at rest; hover uses `--fb-surface-container`; focus uses the focus rule above; open uses `--fb-primary-container` and `aria-expanded="true"`. |
| Popover items | Seven native buttons in §1 order; default transparent, hover `--fb-surface-container`, focus uses the focus rule; disabled items use native disabled semantics and an explanation. A `1px` rule precedes Log out. |
| Search rest / focused | Search trigger opens a floating bar with search icon, input placeholder `Search reports, messages and people…`, `Advanced search` button inside the bar and `Close search` button. Input focus uses the focus rule. |
| Search with query / no results | Results update live beneath the bar. Empty query shows recent searches or `No recent searches`; a query with no matches shows `No results found` and `Clear filters`. Loading and error states are distinct and never fabricate results. |
| Advanced card | `Advanced search` contains rows `Date posted`, `Exact match`, `Post type`, `From profile`, `Community or tag`. Each row has a leading icon and label; the four value rows have a trailing chevron and open their corresponding selector or input. `Exact match` has a trailing switch with `aria-checked`, not a chevron. `Apply` applies current choices and returns focus to the bar trigger. |

## 4. Collapse and expand

At `≥1024px`, the header button toggles between `260px` expanded and `76px`
collapsed. It is named `Collapse navigation` or `Expand navigation`, exposes
`aria-expanded`, and keeps focus after activation. Expanded is the default for a
new session. Persist only explicit choices in `sessionStorage` under
`norfold-nav-panel`, values `expanded` or `collapsed`; invalid or inaccessible
storage falls back to expanded and the in-memory toggle remains usable. Resize
never writes the preference; rail is forced at `600–1023px`, then the stored
choice returns at `≥1024px`.

Expanded rows have visible labels: **no hover flyout and no tooltip**. On the
collapsed rail only, a noninteractive hover/focus label may appear at least `16px`
beyond the content-facing edge, right in LTR and left in RTL. It must not intersect
rail or gutter, contain links or receive focus; dismiss on pointer leave, blur,
Escape, scroll, route change or expansion. Accessible names do not depend on it.
Hide it if it cannot fit without violating the gutter.

### Overlays

Layer order, bottom to top: content and navigation, notification pill, search
overlay, advanced card, settings popover; use a fixed overlay layer above the
shell and below modal dialogs. Search, settings popover and notification pill are
mutually exclusive: opening one closes either other one before it opens. The
advanced card is nested within search, not a competing overlay.

Anchor settings above the gear with `8px` separation, clamped to an `8px` viewport
margin; mirror inline alignment in RTL. Anchor search near the top of the content
at `16px` from its top edge; place results beneath the bar and the advanced card
adjacent to the bar, clamped to `8px` viewport margins. Neither affects layout.
Escape or outside click closes settings and returns focus to the gear. Escape,
outside click or `Close search` closes search and returns focus to its trigger.
When advanced is open, Escape first closes the card and returns focus to its
trigger; a subsequent Escape closes search. A pointer outside both card and bar
closes search. On mutual-exclusion replacement, focus the newly opened overlay
rather than returning focus to the previous trigger.

## 5. Keyboard

Use native links for routes and native buttons for actions; no roving tabindex or
focus trap. At `≥1024px`, tab order is skip link, collapse control, primary rows,
Others rows, account, gear, then main content. At `600–1023px` omit toggle; below
`600px`, preserve content-then-pill order after the skip link. Arrow keys retain
normal browser behaviour.

Opening the gear moves focus to the first enabled popover item; Tab and Shift+Tab
follow item order and can leave the nonmodal popover, closing it on focus leaving.
Escape or outside click closes it and returns focus to gear. Opening search moves
focus to its input; Tab follows input, advanced trigger, close control, then
available results. Closing search returns focus to its trigger. Opening the
advanced card moves focus to its first row; Tab follows the five rows then Apply;
Escape closes the card and returns focus to `Advanced search`. Switching the
Exact match control uses Space or Enter. All focus indicators follow §3.

`<nav aria-label="Primary">` contains the rows. At most one visible nav link has
`aria-current="page"`, according to §1. The toggle references the persistent
navigation list via `aria-controls`; collapsed labels remain in the accessibility
tree. Escape never changes a stored layout; dialogs own their focus rules.

`Skip to content` is first focusable, visible on focus, targets
`<main id="fb-main" tabindex="-1">`, and moves focus there. Crossing `600px`,
restore focus to the equivalent destination if it exists, otherwise main; crossing
`1024px` with focus on the disappearing toggle, focus the current row or main.
Never move focus to `body`. Route headings own route announcements.

## 6. Motion

Sidebar expand/collapse changes in-flow width and reflows the canvas. Use **no
width animation**: switch `76px ↔ 260px` in one frame; labels and current state
paint in final geometry in the same frame. Keep scroll position and toggle focus.
Hover background can use `motionDurations.fast` (`150ms`). Existing phone pill
motion remains unchanged.

Popover entrance uses `popoverVariants` from `uiMotion`: opacity `0 → 1`, scale
`0.96 → 1`, y `4px → 0`, with `motionDurations.standard` (`220ms`) and
`motionEasings.out` (`cubic-bezier(0.2, 0, 0, 1)`). Search overlay and advanced
card use `fadeUpVariants`: opacity `0 → 1`, y `12px → 0`, with the same duration
and easing. Animate only transform and opacity; never animate layout. Under
`prefers-reduced-motion: reduce` or the app's reduced-motion setting, optional
transitions resolve to `0ms`, immediately showing opacity `1`, scale `1`, y `0`;
focus and current indicators are immediate.

## 7. Persistence

The session-scoped `norfold-nav-panel` choice in §4 is separate from
`findback.appearance.v1`, account state, and the existing phone navigation setting.
Do not sync it across accounts or persist it in localStorage. A reload in the same
tab restores it; a new session defaults to expanded. Do not write on mount, route
change or resize. If storage fails, keep the choice in memory for the page lifetime.

## 8. Interaction with the content canvas

`<nav>` is `flex:none`; `<main>` is `flex:1 1 0; min-width:0`. Available content
width is viewport width minus nav width, before internal padding:

| Viewport | Expanded `260px` | Collapsed `76px` |
| --- | --- | --- |
| `1024px` | `764px` | `948px` |
| `1280px` | `1020px` | `1204px` |
| `1440px` | `1180px` | `1364px` |

The `764px` minimum at the expanded breakpoint is the content floor before
padding, not a promise that every inner pane fits. The canvas never forces the
sidebar to shrink or introduces document horizontal scrolling. Feed columns use
actual content width. Messages uses its own split fallback. Collapsing or
expanding does not reset scroll.

Search, its advanced card and settings popover overlay the canvas and never alter
content geometry. At a fixed viewport, zoom, scroll position and nav state, record
`#fb-main.getBoundingClientRect()` (`x`, `y`, `width`, `height`) before opening,
while each overlay is open, and after closing; every value must match within `1px`.
Also compare `clientWidth` and `clientHeight` exactly to detect scrollbar gutters.

Authenticated desktop and tablet nav remains present on report detail and other
shell routes; fullscreen and modal report-editor surfaces retain existing nav
hiding rules. Phone keyboard hiding remains unchanged.

## 9. Public and auth surfaces

Primary navigation renders only inside the authenticated `Shell`; viewport width
never adds it to public or authentication surfaces. Splash, onboarding, auth,
profile completion, signed-out landing, `/shared/:id` and public legal documents
keep their own chrome. Public legal pages do not gain search/bell utilities.

## 10. Edge cases

| Case | Rule |
| --- | --- |
| RTL | Nav is at inline-start, on the right; use logical borders, spacing and placement. Collapsed labels open to inline-end beyond the `16px` gutter. Mirror directional toggle glyphs only. |
| `200%` text / long labels | Wrap without ellipsis; grow row height and scroll nav vertically. Preserve accessible names and targets of at least `44px`. |
| True black | Use `--fb-surface` and `1px --fb-outline-variant` edge; never depend on shadow alone for separation. |
| Offline | Keep route links and current state; do not invent cached results or counts. Hide unknown counts; each destination owns offline/error feedback. |
| Resize `599↔600` | Switch pill and rail without writing preference; restore focus as in §5. |
| Resize `1023↔1024` | Force `76px` below `1024px`; restore remembered `260px` or `76px` choice above it, with no write or width tween. |
| Forced colors | Give `[aria-current="page"]` a `2px solid Highlight` outline; preserve focus outline. |
| Short viewport | Nav content including account and gear remains reachable by vertical scrolling; no clipped focused row. |
| No eligible counts | Do not show `0` for unknown values; do not use prototype examples as live data. |

## 11. Copy deck

| Surface | Exact label |
| --- | --- |
| Primary | `Feed`, `New Report`, `Search`, `Messages`, `Activity`, `Insights` |
| Group | `Others` |
| Others | `Connect`, `Liked / Disliked`, `Saved`, `Recovered`, `Achievements` |
| Bottom cluster | `Your account`, `Settings` |
| Popover | `Settings`, `Appearance`, `Your activity`, `Saved`, `Report a problem`, `Switch account`, `Log out` |
| Search | `Search reports, messages and people…`, `Advanced search`, `Close search`, `Recent searches`, `No recent searches`, `No results found`, `Clear filters` |
| Advanced card | `Advanced search`, `Date posted`, `Exact match`, `Post type`, `From profile`, `Community or tag`, `Apply` |
| Toggle | `Collapse navigation`, `Expand navigation` |
| Accessibility | `Primary`, `Skip to content` |
| Count formats | `{N} suggestions`, `{earned} of {total}`; render only actual data. |

The phone pill retains `My Reports`; shared destinations use the labels above.
`Chats` is not navigation copy; `/chats` remains a compatibility detail. Other
empty-state copy is specified in §1.

## 12. Acceptance table

These are implementation criteria, not claims that product code or the prototype
has passed them. Check light, dark and true-black where applicable.

| # | Test | Pass criterion |
| --- | --- | --- |
| 1 | IA | Available sidebar items follow §1 order; New Report is row `2`; account and gear occupy the bottom cluster. Unbuilt links do not ship. |
| 2 | Desktop | At `1024`, `1280`, `1440`, fresh-session nav width is `260px`; main width is `764`, `1020`, `1180px` respectively. |
| 3 | Collapse | At `≥1024`, button toggles `260↔76px`, updates name and `aria-expanded`, and retains focus. |
| 4 | Tablet | At `600` and `1023`, rail is `76px`, no toggle or pill. |
| 5 | Handover | At `599`, pill only; `600`, rail only; `1023`, rail only; `1024`, sidebar or saved collapsed rail, never pill. |
| 6 | Expanded hover | Hover and focus every row for `500ms`: no flyout or tooltip appears; hover changes background only. |
| 7 | Collapsed label | At `600` and `1024` collapsed, label starts at least `16px` beyond rail edge, never intersects rail or gutter, has no focusable descendants, and dismisses per §4. Repeat RTL. |
| 8 | Phone | At `320` and `390`, pill geometry and keyboard behaviour remain as §2; Feed and Messages labels and accessible names match desktop. |
| 9 | Text | At `200%`, nav width remains fixed; labels wrap, rows grow, all rows and footer are reachable, and document has no horizontal overflow. |
| 10 | Keyboard | Skip link focuses `#fb-main`; tab order follows §5, no trap, focus survives toggle and breakpoint changes. |
| 11 | Current | At most one nav `[aria-current="page"]`; test `/`, `/report`, `/chats/:id`, `/profile/edit`, `/saved`, and each built new route. Account owns profile current state; Search and gear never claim it. |
| 12 | Persistence | Explicit toggle survives same-tab reload; `1024→1023→1024` restores choice with no storage write on resize. New session defaults expanded. |
| 13 | Motion | Width has no transition; overlays use §6 transform/opacity tokens. Reduced motion makes optional transitions `0ms` and shows final state. |
| 14 | Data | New surfaces have real authorized data or honest empty/loading/error states; no fabricated counts, ratings, progress or response latency. |
| 15 | Themes and offline | True-black edge and focus/current indicators remain visible; offline unknown counts are hidden and destination errors are honest. |
| 16 | Public | `/auth`, `/shared/:id`, `/privacy`, `/terms`, `/community-guidelines` contain no authenticated primary nav at `1440px`. |
| 17 | Rendered review | Inspect `320`, `600`, `1024`, `1280`, `1440px`, `100%` and `200%` text, light/dark/true-black, keyboard, empty/error/loading and short-height scrolling. |
| 18 | Profile entry | No Profile row; the bottom account row is the only navigation entry to the signed-in profile. |
| 19 | Settings action | Gear opens the seven-entry popover; each enabled item acts in place, with no route navigation or settings surface. Log out is separated by a rule. |
| 20 | Popover focus | Opening focuses first enabled item; Escape and outside click close and return focus to gear; replacement by another overlay focuses the new overlay. |
| 21 | Search dismissal | Open search separately and dismiss with Escape, `Close search`, and outside click; each restores focus to Search. With advanced open, first Escape closes the card. |
| 22 | Advanced card | Five named rows each have icon and label; four value rows have chevrons, Exact match has a working switch, and `Apply` applies and returns focus to the trigger. |
| 23 | Overlay geometry | Measure `#fb-main` per §8 before, during and after search and settings independently; rect values differ by at most `1px`, client dimensions exactly match. |
| 24 | Scrollbars | In every scroll container, no bar or reserved gutter is visible at rest; hover or scroll reveals a `4px` overlay thumb, which fades after `900ms` without hover. Wheel, trackpad, keyboard and touch still scroll. |
| 25 | Overlay exclusivity | Opening search, settings or notification pill closes either other one; advanced card remains nested in search. |
