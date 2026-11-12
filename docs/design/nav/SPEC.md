# Norfold navigation specification

Status: **design contract, not a claim of implementation**. The structure follows
`prototype.html`; its data and hash routes are synthetic. Production routes below
are explicit: existing paths remain compatible, and proposed paths require product
work. This document supersedes the old rail/flyout decision; the navigation study
remains the research record.

## 1. Information architecture

### Platform rule

Desktop web uses an expanded sidebar because a desk has width. Android phones and
mobile web use the same existing bottom pill because a phone needs thumb reach.
At 600–1023 CSS px, web uses the collapsed rail. The platform presentations may
differ; destination identity, labels, relative ordering of shared destinations,
and current-item semantics must not. The unchanged phone pill is a subset: Feed,
My Reports, Messages, Settings, plus New Report; other destinations remain
reachable through their existing or newly built surfaces. Rename its existing
Home and Chats navigation labels to Feed and Messages without changing geometry or
behaviour. My Reports remains available at `/my` and through Profile; it is not a
desktop sidebar row. New Report remains the phone pill's separate create action.

Desktop and tablet order, top to bottom:

1. **Primary:** Feed, New Report, Search, Messages, Activity, Profile, Insights.
2. **Others:** Connect, Liked / Disliked, Saved, Recovered, Achievements.
3. **Bottom:** Settings, then the account row, separated from the scrolling list.

New Report is the second row, not a floating action: creating a report is the
product's primary act, while the account row owns the bottom. Settings sits
immediately above that account row. Use Messages everywhere in user-facing
navigation; `/chats` remains the compatible route, not a visible label.

### Destinations, availability and empty states

The rows below are the **target** information architecture. New surfaces must be
built before their links are enabled; do not ship dead links or synthetic counts.
Existing data or a related screen is not itself the new surface. Paths marked
proposed are reserved by this contract, not routes already in `App.tsx`.
All list surfaces also need loading and error states, distinct from empty.

| Row | Destination | Current-item rule | Empty state | Surface today / data needed |
| --- | --- | --- | --- | --- |
| Feed | `/` | Exact `/`; report detail `/posts/:id` selects Feed when no more specific source is known. | No reports: offer filter reset or New Report. | Exists: feed reports and filters. |
| New Report | `/report` | `/report`; the phone create action has the same accessible name and current semantics. | Blank form with report type and fields; no fabricated draft. | Exists: report creation. |
| Search | `/search` | `/search` and its query parameters. | No query: prompt for a search; no matches: offer clear filters. | Exists: report and people search. |
| Messages | `/chats` | `/chats` and `/chats/:conversationId`; `/connections*` redirects retain Messages selection. | No conversations: explain that messages appear here. | Exists: conversations, messages and unread state. |
| Activity | `/activity` (proposed) | `/activity` and its descendants; `/notifications` selects Activity until migrated or redirected. | No activity: “No activity yet”. | **New product surface**. Existing `/notifications` is a related screen, not proof of the planned activity surface. Needs authorized notification/activity events, timestamps, read state and event destinations; events not stored require new data. |
| Profile | `/profile` | `/profile` and `/profile/edit`; account row is a separate link to the same destination but never duplicates `aria-current`. | No reports: offer New Report; missing optional profile fields stay empty. | Exists: own profile and own reports. |
| Insights | `/insights` (proposed) | `/insights` and descendants. | No eligible reports or returns: “No insights yet”. | **New product surface**; metric rules and data limits below. |
| Connect | `/connect` (proposed) | `/connect` and descendants. | No eligible suggestions: “No suggestions right now”. | **New product surface**. Needs eligible profiles, consent/privacy and blocking filters, suggestion generation and a real eligible-suggestions count; existing `/connections` is a legacy Messages redirect, not Connect. |
| Liked / Disliked | `/reactions` (proposed) | `/reactions` and its filter query. | No items in selected filter: “No liked reports yet” or “No disliked reports yet”. | **New product surface**. Needs the account's report reactions and authorized report records. Existing new reactions are like-only; a new dislike capability requires a product decision and new data support, so do not imply new dislikes can be created. Legacy dislikes may be displayed only where stored and authorized. |
| Saved | `/saved` | `/saved` and its query parameters. | No saved reports: “No saved reports yet”. | Exists: saved reports. |
| Recovered | `/recovered` (proposed) | `/recovered` and descendants. | No completed returns: “No completed returns yet”. | **New product surface**. Needs participant-authorized completed return records and linked reports; do not infer a completed handover from a generic closed state. |
| Achievements | `/achievements` (proposed) | `/achievements` and descendants. | No earned achievements: “No achievements yet”. | **New product surface**. Needs an approved achievement catalogue, earning criteria, eligible events and durable progress. Earning rules **require a product decision**; do not award badges or render a denominator until decided. `3 of 12` is an illustrative format, not real data. |
| Settings | `/settings` | `/settings` and `/settings/**`; legacy `/help`, `/about`, `/ai-connection` select Settings. | Settings catalogue is static; if a search yields no matches, offer clearing it. | Exists: Settings and its role-gated leaves. |
| Account row | `/profile` | Never carries `aria-current`; Profile is the sole current row for `/profile*`. | Missing avatar uses the canonical initial-based avatar; no name uses the account's existing fallback. | Exists: authenticated account/profile data; reuse the canonical avatar renderer. |

`/my` and `/my/:id/edit` select Profile on desktop because own reports are reached
through Profile; on the phone pill they select My Reports. These are different
presentation owners of the same destination, not different current semantics.
For unrelated authenticated routes, select no row rather than assert a false
current destination. Route back controls remain owned by the canvas.

### Insights data contract

Insights reports only the signed-in person's own data, using authorized records:

| Measure | Definition and availability |
| --- | --- |
| Report counts and state | Count owned reports, grouped by their stored type and current status. Existing reports supply current state; historical state transitions require new data if not retained. |
| Response latency | Elapsed time from report creation to the first qualifying response, with the event type and timestamp identified by the implementation. **Requires new data** unless existing authorized records can reliably link that response and timestamp to the report; never estimate from unrelated messages. |
| Completed returns | Count confirmed completed return records in which the account participated, deduplicated by return. Existing recovery workflow is the data source; exclude unconfirmed closures. |
| Ratings | Count and average of available recovery-linked ratings received by the account, subject to participant authorization; no average when count is 0. |

Views and view-based rates **require new data** and are not displayed. Missing,
unavailable or unauthorized inputs are not zero; omit the measure or show an
unavailable state. No cross-account aggregates or synthetic prototype numbers.

## 2. Geometry

All breakpoints and dimensions are CSS pixels; use the actual viewport, not the
prototype's frame container. The sidebar is in normal flex flow, never overlaid.

| Viewport | Navigation | Width | Toggle |
| --- | --- | --- | --- |
| `<600px` | Existing phone bottom pill | Available width, centered at `max-width: 44rem` | None |
| `600–1023px` | Collapsed rail | `76px` | None |
| `≥1024px` | Expanded sidebar by default; optionally collapsed | `260px` or `76px` | `44px × 44px` |

The pill retains slot padding `8px 16px 12px`, row gap `8px`, pill padding `4px`,
radius `999px`, links `min-width:44px; min-height:48px`, and `52px × 52px`
create action. At pill container width `≤24rem`, visually hide labels while
keeping accessible names. Keep the current pill's safe-area and keyboard rules.

Sidebar/rail: `flex:none`, `min-height:0`, `border-inline-end:1px solid
var(--fb-outline-variant)`, background `--fb-surface`. Header contains the brand
and toggle. The list has `overflow-y:auto`, `overflow-x:hidden`, `8px` horizontal
padding; the separated footer contains Settings then account. Make footer and
list reachable by scrolling the nav as a whole when height cannot fit both.
Rows have `min-height:44px`, icon `20px`, `12px` icon/label gap, `10px` radius,
and `8px 10px` padding. Rail rows center the icon, retain accessible names and
use `min-height:48px`; section headings and counts are visually hidden, not lost
to assistive technology. Labels and counts use `--fb-on-surface` and
`--fb-on-surface-variant`; show only genuine counts.

At 200% text, widths stay `260px` and `76px`; labels wrap without truncation,
rows grow beyond their minimum and the nav scrolls vertically. The phone pill
retains accessible names and its existing narrow-container rule. Browser zoom
changes CSS viewport width and therefore may change the active breakpoint.

## 3. States

| State | Rule |
| --- | --- |
| Default | Transparent background, `--fb-on-surface` text and icon. |
| Hover | `--fb-surface-container` background only; no label layer while expanded. |
| Focus | `:focus-visible` uses `2px solid var(--fb-focus)` with `2px` offset; never remove the focus indicator. |
| Current | `aria-current="page"`, `--fb-primary-container` background, `--fb-on-primary-container` foreground, weight `600`; also distinguish in forced colors. |
| Attention | Messages and Activity may show a dot only for known unread data; include its meaning in the accessible name. Unknown or `0` means no dot. Connect's suggestion count and Achievements progress appear only from real eligible data. |
| Disabled | Unbuilt and unavailable destinations are omitted until usable; do not render a dead link. A temporarily unavailable action, if rendered, uses native disabled semantics and an explanation. |

## 4. Collapse and expand

At `≥1024px`, the header button toggles between `260px` expanded and `76px`
collapsed. It is named `Collapse navigation` or `Expand navigation`, exposes
`aria-expanded`, and keeps focus after activation. Expanded is the default for a
new session. Persist only explicit choices in `sessionStorage` under
`norfold-nav-panel`, values `expanded` or `collapsed`; invalid or inaccessible
storage falls back to expanded and the in-memory toggle remains usable. Resize
never writes the preference; the rail is forced at `600–1023px`, then the stored
choice returns at `≥1024px`.

Expanded rows have visible labels: **no hover flyout and no tooltip**. On the
collapsed rail only, a noninteractive hover/focus label may appear at least
`16px` beyond the rail's content-facing edge. In LTR this is to the right; in RTL
mirror to the left. It must not intersect the rail or the first `16px` of
content. It cannot contain links or receive focus; dismiss on pointer leave,
blur, Escape, scroll, route change or expansion. Accessible names do not depend
on this label. Hide it if it cannot fit without violating the gutter.

## 5. Keyboard

Use native links for routes and a native button for collapse; no roving tabindex,
no menu role and no focus trap. At `≥1024px`, tab order is skip link, collapse
control, primary rows, Others rows, Settings, account, then main content. At
`600–1023px` omit the toggle; below `600px`, preserve the existing content-then-
pill order after the skip link. Arrow keys retain normal browser behaviour.

`<nav aria-label="Primary">` contains the rows. At most one visible nav link has
`aria-current="page"`, according to §1; the duplicate account link never has it.
The toggle references the persistent navigation list via `aria-controls`.
Collapsed labels remain in the accessibility tree. Escape dismisses only the
optional collapsed label, never changes a stored layout; dialogs own their own
Escape and focus rules.

`Skip to content` is the first focusable element, visible on focus, targets
`<main id="fb-main" tabindex="-1">`, and moves focus there. When crossing `600px`,
restore focus to the equivalent destination if it exists, otherwise to main;
when crossing `1024px` with focus on the disappearing toggle, focus the current
row or main. Never move focus to `body`. Route headings own route announcements.

## 6. Motion

Sidebar expand/collapse changes in-flow width and therefore reflows the canvas.
Choose **no width animation**: switch `76px ↔ 260px` in one frame to avoid
per-frame reflow jank. Labels and current state paint in their final geometry in
the same frame; keep scroll position and toggle focus. Hover background can use
`motionDurations.fast` (`150ms`) without moving layout. Existing phone pill
motion remains unchanged. Under `prefers-reduced-motion: reduce` or the app's
reduced-motion setting, all optional transitions resolve to `0ms`; focus and
current indicators are immediate.

## 7. Persistence

The session-scoped `norfold-nav-panel` choice in §4 is separate from
`findback.appearance.v1`, account state, and the existing phone navigation setting.
Do not sync it across accounts or persist it in localStorage. A reload in the
same tab restores it; a new session defaults to expanded. Do not write on mount,
route change or resize. If storage fails, keep the choice in memory for the
current page lifetime.

## 8. Interaction with the content canvas

`<nav>` is `flex:none`; `<main>` is `flex:1 1 0; min-width:0`. The available
content width is viewport width minus the nav width, before internal padding:

| Viewport | Expanded `260px` | Collapsed `76px` |
| --- | --- | --- |
| `1024px` | `764px` | `948px` |
| `1280px` | `1020px` | `1204px` |
| `1440px` | `1180px` | `1364px` |

The `764px` minimum at the expanded breakpoint is the content floor before
padding, not a promise that every inner pane fits. The canvas never forces the
sidebar to shrink or introduces document horizontal scrolling. Feed columns use
actual content width. Settings keeps its existing list/detail split inside the
canvas, never duplicated in the sidebar: apply the existing `SplitView` width
test, including `320px` minimum detail and its actual list reservation. With a
`22rem` reservation at a `16px` root, `1024 − 260 − 352 = 412px` detail, so
two panes fit; at a `32px` root, the reservation is `704px`, leaving `60px`, so
use one pane. Preserve drafts, back navigation and focus on fallback. Messages
uses its own split fallback. Collapsing or expanding does not reset scroll.

Authenticated desktop and tablet nav remains present on report detail and other
shell routes; fullscreen and modal report-editor surfaces retain their existing
nav hiding rules. Phone keyboard hiding remains unchanged.

## 9. Public and auth surfaces

Primary navigation renders only inside the authenticated `Shell`; viewport width
never adds it to public or authentication surfaces. Splash, onboarding, auth,
profile completion, signed-out landing, `/shared/:id` and public legal documents
keep their own chrome. Public legal pages do not gain search/bell utilities.

## 10. Edge cases

| Case | Rule |
| --- | --- |
| RTL | Nav is at inline-start, on the right; use logical borders, spacing and placement. The optional collapsed label opens to inline-end, left in RTL, beyond the `16px` gutter. Mirror directional toggle glyphs only. |
| 200% text / long labels | Wrap without ellipsis; grow row height and scroll nav vertically. Preserve every accessible name and target of at least `44px`. |
| True black | Use `--fb-surface` and `1px --fb-outline-variant` edge; never depend on shadow alone for separation. |
| Offline | Keep route links and current state; do not invent cached results or counts. Unknown unread and suggestion values are hidden; each destination owns offline/error feedback. |
| Resize `599↔600` | Switch pill and rail without writing session preference; restore focus as in §5. |
| Resize `1023↔1024` | Force `76px` below `1024px`; restore the remembered `260px` or `76px` choice above it, with no write and no width tween. |
| Forced colors | Give `[aria-current="page"]` a `2px solid Highlight` outline; preserve the focus outline. |
| Short viewport | Nav content including Settings and account remains reachable by vertical scrolling; no clipped focused row. |
| No eligible counts | Do not show `0` for unknown values; do not use prototype examples as live data. |

## 11. Copy deck

| Surface | Exact label |
| --- | --- |
| Primary | `Feed`, `New Report`, `Search`, `Messages`, `Activity`, `Profile`, `Insights` |
| Group | `Others` |
| Others | `Connect`, `Liked / Disliked`, `Saved`, `Recovered`, `Achievements` |
| Footer | `Settings`, `Your account` |
| Toggle | `Collapse navigation`, `Expand navigation` |
| Accessibility | `Primary`, `Skip to content` |
| Count formats | `{N} suggestions`, `{earned} of {total}`; render only actual data. |

The phone pill retains `My Reports`; its shared destinations use the exact labels
above. `Chats` is not navigation copy; `/chats` remains a route compatibility
detail. Empty-state copy is specified in §1.

## 12. Acceptance table

These are implementation acceptance criteria, not claims that product code or
the prototype has passed them. Check light, dark and true-black where applicable.

| # | Test | Pass criterion |
| --- | --- | --- |
| 1 | IA | Available sidebar links follow §1 order; New Report is row `2`; Settings immediately precedes account. Unbuilt links do not ship. |
| 2 | Desktop | At `1024`, `1280`, `1440`, fresh-session nav width is `260px`; main width is `764`, `1020`, `1180px` respectively. |
| 3 | Collapse | At `≥1024`, button toggles `260↔76px`, updates name and `aria-expanded`, and retains focus. |
| 4 | Tablet | At `600` and `1023`, rail is `76px`, no toggle or pill. |
| 5 | Handover | At `599`, pill only; `600`, rail only; `1023`, rail only; `1024`, sidebar or explicitly saved collapsed rail, never pill. |
| 6 | Expanded hover | Hover and focus every row for `500ms`: no flyout or tooltip appears; hover changes background only. |
| 7 | Collapsed label | At `600` and `1024` collapsed, any hover label starts at least `16px` beyond the content-facing rail edge; it never intersects rail or gutter, has no focusable descendants, and dismisses per §4. Repeat RTL. |
| 8 | Phone | At `320` and `390`, pill geometry and keyboard behaviour remain as §2; Feed and Messages labels and accessible names match desktop vocabulary. |
| 9 | Text | At `200%`, nav width remains fixed; labels wrap, rows grow, all rows and footer are reachable, and document has no horizontal overflow. |
| 10 | Keyboard | Skip link focuses `#fb-main`; tab order follows §5, no trap, focus survives toggle and breakpoint changes. |
| 11 | Current | At most one nav `[aria-current="page"]`; test `/`, `/report`, `/search`, `/chats/:id`, `/profile/edit`, `/saved`, `/settings/account`, plus each built new route. Account never duplicates Profile. |
| 12 | Persistence | Explicit toggle survives same-tab reload; `1024→1023→1024` restores choice with no storage write on resize. New session defaults expanded. |
| 13 | Motion | Width has no transition; geometry reaches final width in one frame. Reduced motion makes optional transitions `0ms`. |
| 14 | Settings | At `1024` expanded and `16px` root, `22rem` list leaves `412px` detail; at `32px` root it falls back to one pane without losing draft or focus. |
| 15 | Data | New surfaces have real authorized data or honest empty/loading/error states; no fabricated counts, ratings, progress or response latency. |
| 16 | Themes and offline | True-black edge and focus/current indicators remain visible; offline unknown counts are hidden and destination errors are honest. |
| 17 | Public | `/auth`, `/shared/:id`, `/privacy`, `/terms`, `/community-guidelines` contain no authenticated primary nav at `1440px`. |
| 18 | Rendered review | Inspect `320`, `600`, `1024`, `1280`, `1440px`, `100%` and `200%` text, light/dark/true-black, keyboard, empty/error/loading and short-height scrolling. |
