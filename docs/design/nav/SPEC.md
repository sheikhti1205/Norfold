# Norfold navigation specification

Status: **implementation contract.** This document is normative for the primary
navigation (rail, panel, flyout, bottom pill). Where it disagrees with
[`../NAVIGATION-STUDY.md`](../NAVIGATION-STUDY.md), this document wins; the study
is the research record behind it.

Date: 12 November 2026. `main` only. No product source was changed to write this
document and nothing here is committed.

Every value below is a number, a token, a selector or a rule. Where two existing
sources disagree, this document chooses one and says why. Anything not covered
here is out of scope rather than "similar to" something.

**Evidence base.** Source at HEAD `8e905b38` plus the uncommitted working tree
(`git status --short`: 18 modified files, including the Phase 1 route-home
fixes). Files read in full or in the relevant range:

| File | What it owns |
| --- | --- |
| `apps/mobile/src/components/Shell.tsx` | Shell layout, `PrimaryNav`, `NAV`, `HIDE_NAV`, focus restore |
| `apps/mobile/src/components/Shell.nav.css` | Pill and rail geometry |
| `apps/mobile/src/components/navLayout.ts` | `resolveNavLayout` |
| `apps/mobile/src/components/responsive.ts` | `COMPACT_MAX_PX`, `MEDIUM_MAX_PX`, `useContentWidth` |
| `apps/mobile/src/appearance.ts` | `findback.appearance.v1`, migration, `navLayout` |
| `apps/mobile/src/components/uiMotion.ts` | Duration/easing/spring tokens |
| `apps/mobile/src/design/density.ts` | `minTouchTarget`, `iconSize` |
| `apps/mobile/src/design/colorSystem.ts` | `--fb-*` palette roles |
| `apps/mobile/src/index.css` | Safe-area owner, focus ring |
| `apps/mobile/src/App.tsx` | Route table and route guards |
| `apps/mobile/src/components/SplitView.tsx` | Settings/Chats list-detail fallback |
| `apps/mobile/src/components/TopUtilities.tsx` | Search/notifications utilities |
| `docs/DESIGN_SYSTEM.md` | Canonical owners and route vocabulary |

**Non-goals.** No drag-resizable rail, no command palette, no org/tenant
switcher, no account popover in the rail, no second navigation system for public
surfaces, no changes to the bottom pill's behaviour beyond what §2 restates.

---

## 1. Information architecture

### 1.1 The three layers

```
Layer 1  RAIL      4 global destinations, one selection. Icons at 72/80px,
                   icon + label at 224px. Always in flow, always present
                   inside the authenticated shell at >=600px.
Layer 2  PANEL     The pages of the selected destination, 1-2 rows.
                   Two renders: pinned (in flow, 224px) or flyout (overlay).
Layer 3  CANVAS    The routed screen. Owns its own header, lists and scrollers.
```

Only layer 1 is a navigation owner. Layer 2 is an index *of* layer 1's selection.
Layer 3 never moves into layer 1 (see §1.4).

### 1.2 Layer 1 — the rail (global)

Exactly four, in this DOM and visual order:

| # | Label | Route | Icon (`lucide-react`) | Area |
| --- | --- | --- | --- | --- |
| 1 | `Home` | `/` | `Home` | Reading |
| 2 | `My Reports` | `/my` | `ClipboardList` | Own reports |
| 3 | `Chats` | `/chats` | `MessageCircle` | Conversations |
| 4 | `Settings` | `/settings` | `Settings` | Account and preferences |

Plus one **action**, rendered after the destinations (not a destination):

| Action | Route | Icon | Accessible name |
| --- | --- | --- | --- |
| Create report | `/report` | `Plus` | `Create report` |

The list is `NAV` (`Shell.tsx:29-34`) — unchanged. No destination is added to the
rail by this specification.

### 1.3 Layer 2 — the panel (section-scoped)

Panel rows exist only where the area owns a route that the canvas does not already
name on every one of its screens. Every row below is an existing route in
`App.tsx`; nothing is invented.

| Area | Panel header | Rows (route) | Why these rows |
| --- | --- | --- | --- |
| `Home` | Home | `Home` (`/`) | The area is one page. A panel that padded this would be cosplay (study §4). |
| `My Reports` | My Reports | `My reports` (`/my`), `Saved` (`/saved`) | `/saved` is a real route (`App.tsx:236`) reachable only through Profile → "Saved reports" (`Profile.tsx:118`), and it currently resolves to **no selected rail row** (`Shell.tsx:210-213` falls through to the raw pathname). Naming it here closes an orphan. |
| `Chats` | Chats | `Conversations` (`/chats`) | Threads are canvas content, not navigation. One row is the truth. |
| `Settings` | Settings | `All settings` (`/settings`), `Your profile` (`/profile`) | `/profile*` is already mapped to the Settings area by `Shell.tsx:212` but has no row anywhere; naming it makes the existing mapping visible instead of implicit. The Settings **catalogue** (account, preferences, intelligence, privacy, more) stays in the canvas — see §1.4. |

**Hard limits.**

- Maximum rows in any panel: **2**. Current: 1, 2, 1, 2. This is the number the
  owner's "Supabase shape" decision cannot exceed without a new decision.
- No panel may contain a route that is not in `apps/mobile/src/App.tsx`.
- No panel may nest. There is no third level anywhere.
- Group headers: **0 rendered.** The treatment is specified in §2.7 so a future
  second group cannot invent one, but a panel with one group renders no header.

### 1.4 What must NOT be in the rail, and why

| Excluded | Canonical owner | Reason |
| --- | --- | --- |
| Search (`/search`) | `TopUtilities.tsx:64` (utility) and `HomeTopBar`'s field | `DESIGN_SYSTEM.md:42` puts bell and search in utilities, not destinations. It is reachable from a 44px control on every shell screen that renders a top bar; promoting it to a destination creates a second owner for the same route. |
| Notifications (`/notifications`) | `TopUtilities.tsx:65-67`, `NotificationPopover.tsx` | Unread state belongs to one owner. A rail badge would be a second badge owner for the same account data. |
| Profile (`/profile`) | Settings area, panel row `Your profile` | It is a Settings leaf, not a product area. |
| Saved reports (`/saved`) | My Reports panel row | A collection of the reader's own reports, not a product area. |
| Legal documents (`/privacy`, `/terms`, `/community-guidelines`) | Public routes (`App.tsx:177-179`) and Settings → Legal | Public surfaces never carry the rail (§9). |
| Help (`/help`), About (`/about`), AI connection (`/ai-connection`) | Settings leaves (`/settings/help`, `/settings/about`, `/settings/ai/connections`) | Each has a Settings screen. Two entries for one screen is the duplication `DESIGN_SYSTEM.md:54-57` forbids. |
| The Settings catalogue | `Settings.tsx` `SplitView` list | The canvas already draws it as a list. Mirroring it inside the panel puts two settings lists side by side at 840px. |
| Staff console (`/settings/team`, `/settings/moderation/*`) | Settings, role-gated rows (`Settings.tsx:355-381`) | Role-gated. A rail row that only some accounts see is a layout that changes identity per account. |
| Account / theme / workspace switcher | `Settings`, `TopUtilities` | Console furniture (study §4). |
| Command palette, keyboard chord | — | Nothing to palletize over (study §4). |
| Unread badges on any destination | `TopUtilities` | One badge owner (§3.4). |

### 1.5 Route → area (the selection is a total function)

The rail must never be in a state where nothing is current, so area resolution is
defined for every authenticated path. This replaces the ad-hoc `selectedPath`
chain at `Shell.tsx:210-213`.

| Path | Current rail row |
| --- | --- |
| `/` | Home |
| `/search` | Home |
| `/notifications` | Home |
| `/posts/:id` | Home |
| `/u/:username` | Home |
| `/my`, `/my/:id/edit` | My Reports |
| `/saved` | My Reports |
| `/chats`, `/chats/:conversationId` | Chats |
| `/connections`, `/connections/:conversationId` | Chats |
| `/settings`, `/settings/**` | Settings |
| `/profile`, `/profile/edit` | Settings |
| `/help`, `/about`, `/ai-connection` | Settings |
| `/report` | **none** — the create action is pressed, not a destination |
| `/onboarding`, `/auth`, `**` auth screens, `/shared/:id`, legal documents | n/a (no rail, §9) |

Group membership is by *area*, not by prefix, so `/saved` does not silently
belong to Home and `/help` does not silently belong to nothing.

### 1.6 Layer 3 — what stays in the canvas

The routed screen keeps: its own top bar (one per route — `AppBar`, `HomeTopBar`,
`SettingsPage`'s sticky bar, the conversation header), its lists, its filters, its
scrollers and its back controls. The shell never stacks a second utility strip
above a route's own bar (`Shell.tsx:125-128`).

The canvas owns back navigation. The rail is not a substitute for it, and a
back control is never restyled into a home link (study §6 row 11).

---

## 2. Geometry

All values in CSS px. Breakpoints are the app's existing constants:
`COMPACT_MAX_PX = 600`, `MEDIUM_MAX_PX = 840` (`responsive.ts:19-21`); 1200 is the
existing rail-widen point (`Shell.nav.css:103`).

```
   <600            600-839          840-1199               >=1200
   bottom pill     rail 72          rail 72 | panel 224    rail 80 | panel 224
                   no pin           pin at >=840           pin at >=840
                   flyout           flyout (unless pinned) flyout (unless pinned)
```

Schematic at 1024px, pinned:

```
+--------------------------------------------------------------+
| .fb-app-viewport  (100dvh, safe-area padding, overflow hidden)|
| +----------+------------------------------------------------+ |
| | <nav>    | <main>  min-w-0 flex-1                         | |
| | 224px    |  +------------------------------------------+  | |
| | +------+ |  | route chrome (AppBar / HomeTopBar / ...) |  | |
| | |toggle| |  +------------------------------------------+  | |
| | +------+ |  | RouteTransition -> screen                |  | |
| | Home     |  |                                          |  | |
| | My Rep.  |  |                                          |  | |
| | Chats    |  |                                          |  | |
| | Settings |  |                                          |  | |
| | -------- |  |                                          |  | |
| | All set. |  |                                          |  | |
| | Profile  |  |                                          |  | |
| | +Create  |  |                                          |  | |
| +----------+------------------------------------------------+ |
+--------------------------------------------------------------+
```

### 2.1 Phone, below 600px — unchanged

| Element | Value | Source |
| --- | --- | --- |
| Slot padding | `8px 16px 12px` | `Shell.nav.css:7` |
| Row max-width | `44rem`, centred, `gap: 8px` | `Shell.nav.css:9-16` |
| Pill | radius `999px`, padding `4px`, 1px `--fb-outline-variant`, background `--fb-surface-container-low` | `Shell.nav.css:17-23` |
| Link | `flex: 1 1 0`, `min-width: 44px`, `min-height: 48px`, gap `4px`, radius `999px`, padding `4px 2px` | `Shell.nav.css:24-29` |
| Selected link | `flex: 2 1 0`, weight 600 | `Shell.nav.css:30` |
| Icon | 22px, stroke 2 (selected 2.5), `transform: scale(1.12)` when selected | `Shell.tsx:250-255`, `Shell.nav.css:37-38` |
| Label | `0.75rem`, line-height `1.2`, single line | `Shell.nav.css:50-53` |
| Create | 52×52 circle, after the pill | `Shell.nav.css:64-69` |
| Container query `<=24rem` | labels visually hidden, selected link `flex: 1 1 0` | `Shell.nav.css:57-63` |

Nothing in this band changes. There is no rail, no drawer, no flyout.

### 2.2 Collapsed rail — 600–1199 at 72px, ≥1200 at 80px

| Element | 600–1199 | ≥1200 |
| --- | --- | --- |
| Nav width | `72px` | `80px` |
| Nav padding | `12px 8px` | `12px 8px` |
| Nav background | `--fb-surface` | `--fb-surface` |
| Nav edge | `border-inline-end: 1px solid --fb-outline-variant` | same |
| Nav gap (header / list / create) | `8px` | `8px` |
| Header slot | **absent** (`0px`) | **absent** (`0px`) |
| List gap between rows | `4px` | `4px` |
| Row size | `100% x min-height 48px` (inner width `56px`) | inner width `64px` |
| Row padding | `8px 4px` | `8px 4px` |
| Row radius | `16px` | `16px` |
| Row layout | column, `gap: 2px`, icon centred | same |
| Icon | `22px`, stroke 2 / 2.5 selected | same |
| Label | visually hidden (`sr-only`), always in the accessibility tree | same |
| Create | `52x52` circle, `margin-inline: auto`, after the list | same |
| Overflow | `overflow-y: auto`, `overscroll-behavior: contain` | same |

`Shell.nav.css:81-104` already produces most of this; the changes are the removal
of the tooltip in rail mode and the header slot (see §2.3, §4).

**Why the header slot is absent below 840.** A reserved 44px slot would push the
four destinations 52px down in a 72px-wide column, and the band where the rail is
the only navigation is also the band with the least vertical room (a landscape
phone is 390px tall). The cost is a 52px shift of the list when a window crosses
839→840; that is a deliberate window resize, not a scroll or a hover, and §10
records it.

**Fixed px, not rem.** `responsive.ts:273-275` and `Shell.nav.css:77-78` both
claim the rail is sized in `rem` (`6.5rem`). It is not, and this specification
keeps it in `px` on purpose: at a 32px root a `rem` rail would be 144px and a
`14rem` panel 448px — half of a 600px screen, for four icons. The two comments are
stale and must be corrected when the rail work lands (`NAVIGATION-STUDY.md` §5).

### 2.3 Pinned panel — 224px at ≥840

| Element | Value |
| --- | --- |
| Nav width | `224px` (identical at 840 and at 1440) |
| Nav padding | `12px` all sides |
| Header row | `44px` tall; contains the toggle `44x44` + `gap: 8px` + area name |
| Area name | `0.8125rem` (13px), weight 600, `--fb-on-surface`, single line, `overflow-wrap: anywhere` |
| Gap header → list | `8px` |
| Area list gap | `2px` |
| Area row | `min-height: 44px`, `width: 100%` (`200px` inner), padding `8px 12px`, radius `12px`, icon `20px` + `gap: 12px` + label |
| Area label | `0.875rem` (14px), line-height `1.35`, weight 500 (600 when current), `overflow-wrap: anywhere`, **no truncation** |
| Gap area list → page list | `12px` |
| Page row | `min-height: 44px`, padding `8px 12px`, radius `12px`, **no icon**, label `0.875rem`, weight 400 (`--fb-on-surface-variant`; `--fb-on-surface` when current) |
| Page label width | `224 - 24 (nav padding) - 24 (row padding) = 176px` |
| Area label text width | `200 - 24 (row padding) - 20 (icon) - 12 (gap) = 144px` |
| Create (expanded) | full width `200px`, `min-height: 44px`, radius `999px`, background `--fb-primary`, colour `--fb-on-primary`, icon `Plus 20px` + `gap: 8px` + label `0.875rem`/600 |
| Gap list → create | `8px` |
| Panel list overflow | `overflow-y: auto`, `overscroll-behavior: contain`; the header does **not** scroll |
| Edge | `border-inline-end: 1px solid --fb-outline-variant` |

**The arithmetic that justifies 840.** 840 − 224 = **616px** of content, above the
600px `COMPACT_MAX_PX` floor. At 600 a pinned panel would leave 376px, below the
floor, which is why the toggle does not exist there.

**The tightest label case, stated as numbers.** `144px` of text at 200% text
(root 32px ⇒ a 14px label renders at 28px). "My Reports" at 28px Roboto semibold
is ≈150px on one line, so it wraps to two lines and the row grows to `~72px`. The
panel width does not change. That is the case §12 row 11 measures.

### 2.4 Flyout geometry

| Property | Value |
| --- | --- |
| Width | `224px` (same as the panel — one visual language) |
| Inline offset | `navWidth + 8px` ⇒ `80px` at 72px rail, `88px` at 80px rail |
| Block offset | `clamp(hoveredRowTop - 8px, 8px, viewportHeight - flyoutHeight - 8px)` |
| Padding | `12px` |
| Radius | `12px` |
| Background | `--fb-surface-container-low` |
| Border | `1px solid --fb-outline-variant` (this, not the shadow, is what separates it in true-black) |
| Shadow | `var(--shadow-md)` |
| Max height | `min(420px, 100dvh - 16px)`; internal `overflow-y: auto` |
| Title | area name, `0.8125rem`/600, `padding: 0 12px 8px` |
| Rows | identical to §2.3 page rows |
| Position | `fixed`; portalled to `document.body` |
| z-index | `60` |

Portalled for a hard reason: `.fb-nav-rail` carries `overflow-y: auto`
(`Shell.nav.css:87`), so an absolutely positioned child would be clipped by the
rail's own scroll box.

### 2.5 Per-breakpoint summary

| Property | <600 | 600–839 | 840–1199 | ≥1200 |
| --- | --- | --- | --- | --- |
| Navigation form | bottom pill | collapsed rail | collapsed rail **or** panel | collapsed rail **or** panel |
| Nav width | full width | 72 | 72 / 224 | 80 / 224 |
| Content width at 1440-wide window | n/a | 1440−72 = 1368 | 1440−72 / 1440−224 | 1440−80 / 1440−224 |
| Pin toggle | no | no | yes | yes |
| Flyout | no | yes | yes unless pinned | yes unless pinned |
| Visible labels | selected link only | none | panel yes, rail no | panel yes, rail no |
| Selected shape | pill behind icon+label | pill behind icon (`16px` radius) | pill behind icon, or filled row | same |
| Create | 52 circle | 52 circle | 52 circle / full pill | same |
| Icon size | 22 | 22 | 22 collapsed / 20 panel | 22 / 20 |
| Min row height | 48 | 48 | 48 collapsed / 44 rows | 48 / 44 |
| Horizontal scroll | never | never | never | never |

### 2.6 200% text

Root font 32px (double the default 16px; the app's own maximum text scale is
125% = 20px, so 200% is reachable only through OS/WebView text scaling and browser
zoom — which also halves the CSS width and therefore moves the band, see §10).

| Element | At 100% | At 200% |
| --- | --- | --- |
| Rail / panel widths | 72 / 80 / 224 | **unchanged** (px) |
| Area label | 14px | 28px, wraps to ≤3 lines |
| Area row height | 44 | grows (`~72px` at 2 lines) |
| Page label | 14px | 28px, wraps |
| Page row height | 44 | grows |
| Area name (header) | 13px | 26px, wraps, header grows past 44px |
| Icons | 22 / 20 | **unchanged** — SVG `size` is a px prop; the icon is decorative and `aria-hidden`, and scaling it would grow every row without adding legibility |
| Flyout | 224 | 224, max-height still `min(420, 100dvh − 16)` |
| Min touch target | 44 | 44 (`density.ts:28`) |

Rows are `min-height`, never `height`, so text growth always wins over geometry.

### 2.7 Group header (specified, not rendered)

| Property | Value |
| --- | --- |
| Font | `0.75rem` (12px), weight 600, `letter-spacing: 0.02em`, sentence case |
| Colour | `--fb-on-surface-variant` |
| Case | **sentence case** — the reference's uppercase monospaced labels are console furniture (study §4) |
| Block spacing | `16px` above, `4px` below |
| Padding | `0 12px` |
| Rendered | only when a panel has ≥2 groups. Today: **0** panels qualify. |

---

## 3. States

### 3.1 Rail destination (all four, identical)

| State | Paint | Notes |
| --- | --- | --- |
| Default | background transparent; icon `--fb-on-surface-variant`; stroke 2 | |
| Hover (fine pointer) | background `--fb-surface-container-low`; icon `--fb-on-surface` | opens the flyout after 120ms (§4) |
| Hover (coarse pointer) | same paint; **no flyout** | touch has no hover |
| Focus-visible | `outline: 2px solid --fb-focus; outline-offset: 2px` (`index.css:80-83`) | never on `:focus` alone, so a pointer click does not ring |
| Pressed | `scale: 0.96` (`pressFeedback.iconButton`), `motionDurations.instant` | |
| Current (`aria-current="page"`) | `--fb-primary-container` pill at `inset: 0`, radius inherit (`Shell.nav.css:31-34`); icon + label `--fb-on-primary-container`; stroke 2.5; icon `scale(1.12)` | pill is a shared-layout element (§6) |
| Unread count 0 / 1 / 9 / 99+ | **no count is ever rendered in the rail** | §3.4 |
| Disabled | does not exist — a destination is never disabled; an unavailable area is omitted entirely | |
| Loading | does not exist — the nav is static markup and never mounts a skeleton | study §3 |

### 3.2 Panel row

| State | Paint |
| --- | --- |
| Default | text `--fb-on-surface` (area rows) / `--fb-on-surface-variant` (page rows); background transparent |
| Hover | background `--fb-surface-container-low` |
| Focus-visible | same 2px `--fb-focus` ring, offset 2 |
| Current | background `--fb-primary-container`; text `--fb-on-primary-container`; area rows also weight 600 |
| Pressed | no scale — rows are `44px` and a scale would shimmy the list |
| Disabled | does not exist |
| Loading | does not exist |

### 3.3 Panel and flyout states

| Surface | State | Definition |
| --- | --- | --- |
| Panel | collapsed | `data-expanded="false"`; width 72/80; page list `hidden` |
| Panel | expanded (pinned) | `data-expanded="true"`, width 224, `navRailExpanded === true` |
| Panel | scrolling | page list scrolls, header fixed, `overscroll-behavior: contain` |
| Panel | empty | **cannot occur.** Every area resolves to ≥1 row; a unit test asserts `rowsFor(area).length >= 1` for a signed-in account with no capabilities |
| Flyout | closed | not in the DOM |
| Flyout | opening | 120ms intent delay elapsed, enter animation running |
| Flyout | open | visible, hovered area's rows |
| Flyout | closing | leave delay 180ms running; re-entry cancels |
| Flyout | suppressed | pinned at ≥840 — the flyout never mounts |

### 3.4 Unread count (the answer is: it is not a navigation state)

`DESIGN_SYSTEM.md:42` puts the bell in `TopUtilities`. This specification forbids
any count, dot or badge in the rail or the panel — including the case where the
count is large — because a second badge owner for the same account data is exactly
the duplication rule 7 forbids.

For completeness, the one owner's behaviour:

| Count | Renders | Source |
| --- | --- | --- |
| unknown (`null`, offline, fetch failed) | nothing | `TopUtilities.tsx:59-61` |
| 0 | nothing | `count > 0` guard |
| 1 | `1` | same |
| 9 | `9` | same |
| 99 | `99` | same |
| ≥100 | `99+` | same |
| Any | badge is `aria-hidden="true"` | **Recorded defect, not fixed here:** the bell's accessible name stays `Notifications`, so a screen-reader user never hears the count. Fixing it means `aria-label={count ? \`Notifications, ${count > 99 ? "99 or more" : count} unread\` : "Notifications"}` on the link. Out of scope for this document; must be decided before the notification surface is called accessible. |

---

## 4. Hover flyout

The flyout exists for one reason: at 72/80px the rail has no visible labels, and a
sighted pointer reader needs the name of the icon under the cursor plus a shortcut
to that area's pages — without the page moving.

### 4.1 Timing

| Event | Value | Reason |
| --- | --- | --- |
| Intent delay (pointer enters a rail row) | **120ms** | Long enough that sweeping the rail toward the content does not strobe, short enough to feel immediate. `motionDurations.fast` is 150ms; the *delay* is not an animation token and is fixed at 120ms. |
| Leave delay (pointer leaves rail **or** flyout) | **180ms** | Covers the 8px gap between rail and flyout and the pointer crossing a row boundary. |
| Open on keyboard focus | **yes, 0ms** | "How a rail is read without a mouse" (study §7.6). |
| Row-to-row move while open | 0ms, content swaps in place, no re-animation, no new delay | |
| Re-entry during the leave delay | cancels the close | |

### 4.2 Dismissal order (first match wins)

1. Pointer leaves rail **and** flyout for 180ms → close.
2. `Escape` → close immediately (0ms).
3. Any scroll of any ancestor scroller (`scroll`, capture, passive) → close.
4. `focusout` where `relatedTarget` is outside the rail → close.
5. Route change (`pathname`) → close.
6. `window` blur / `visibilitychange` to hidden → close.
7. `navRailExpanded` becomes `true` → close and suppress.

### 4.3 Relationship to the pinned panel

| Panel | Flyout |
| --- | --- |
| Collapsed (600–1199, or 840+ unpinned) | available |
| Pinned (840+) | **never mounted** — the labels are already on screen and a second copy would be noise |
| Toggle pressed during an open flyout | flyout closes in the same frame the panel expands |

### 4.4 Accessibility

The flyout is **decorative for assistive technology**:

- wrapper: `aria-hidden="true"`;
- every row: `tabindex="-1"` and `onMouseDown={(e) => e.preventDefault()}` so a
  click does not move focus into hidden content;
- rows remain clickable (pointer only), which is the whole point;
- the area title inside it is `aria-hidden` too (the rail row already carries the
  name via its `sr-only` span);
- no `role="tooltip"`, no `role="dialog"`, no focus scope, no trap.

The accessible path to every destination is the rail list itself: each row keeps
its `sr-only` label, `aria-current` and `href` at all widths. The flyout adds no
capability for AT, so hiding it loses nothing; showing it would duplicate four
links plus a page list inside a landmark that appears and disappears on focus.

Consequence, stated because it is a real limitation: **at 600–839 a sighted touch
reader sees icons only.** No hover, no toggle. Nothing is unreachable (tapping
navigates; AT has names), and both neighbouring bands name destinations (the pill
below 600, the panel from 840). The owner may raise the toggle breakpoint to 720px
or add micro-labels under the icons in that band; this specification does not,
because a 224px panel at 720px would leave 496px, below the 600px content floor.
Recorded again in §10 and in the decision log.

### 4.5 z-index

| Layer | z-index | Source |
| --- | --- | --- |
| Route sticky bars (Settings) | `20` | `settings.css:27` |
| **Flyout** | **`60`** | this spec |
| Task surfaces (dialogs, sheets) | `70 + depth*10` | `AdaptiveTaskSurface.tsx:25` |
| Media viewer | `100+` | `MediaViewer.tsx:123` |
| Tooltip (bottom pill) | `120` | `Shell.nav.css:102` |
| Skip link | `80` | this spec, §5.6 |

The flyout must never paint over a dialog. Above 70 it would; at 60 it cannot.

---

## 5. Keyboard

### 5.1 Tab order — rail layout (≥600)

```
1  Skip to content            (visually hidden until focused)
2  Expand/Collapse navigation (only >=840; absent 600-839)
3  Home
4  My Reports
5  Chats
6  Settings
7  Create report
8  ...first focusable control inside <main>
```

The nav precedes `<main>` in the DOM (`Shell.tsx:114-130`), so this order is the
document order — no `tabIndex` values are used to manufacture it.

### 5.2 Tab order — bottom layout (<600)

Unchanged, and deliberately *after* the content, because `<main>` precedes the pill
in the DOM (`Shell.tsx:117-133`):

```
1  Skip to content
2  ...content...
3  Home
4  My Reports
5  Chats
6  Settings
7  Create report
```

### 5.3 Roving tabindex: none

**Rule: no roving tabindex anywhere in the navigation.** The destinations and the
panel rows are ordinary links and stay in the document tab order.

Reason: roving tabindex exists for composite widgets (`tablist`, `menu`,
`listbox`) where arrow keys move a single tab stop. Applying it here would require
giving the list a widget role, which would remove the browser's own link
behaviour — Enter, middle-click, context menu, open-in-new-tab, long-press to
share — for four destinations. The APG's own navigation-landmark pattern uses plain
links for the same reason.

Arrow keys therefore do nothing in the nav (they scroll the page, as normal). This
is intentional and must not be "fixed" later.

### 5.4 ARIA contract

| Element | Attribute | Value |
| --- | --- | --- |
| `<nav>` | `aria-label` | `Primary` (unchanged, `Shell.tsx:285,304`) |
| `<nav>` | `data-layout` | `rail` \| `bottom` (existing) |
| `<nav>` | `data-expanded` | `true` \| `false`, rail only |
| Pin toggle | `aria-expanded` | `true` when pinned |
| Pin toggle | `aria-controls` | `fb-nav-panel` (the element exists, `hidden`, even when collapsed, so the reference always resolves) |
| Pin toggle | `aria-label` | `Expand navigation` / `Collapse navigation` |
| Destination link | `aria-current` | `page` — see the precedence rule below |
| Destination link | accessible name | the `sr-only` label span at 72/80px; the visible label at 224px |
| Page list | `aria-label` | `<area> pages`, e.g. `My Reports pages` |
| `<nav>` itself | `aria-expanded` | **never** (it is a landmark, not a disclosure) |

**`aria-current` precedence.** At most one element in the whole navigation carries
`aria-current="page"`:

1. if the panel is expanded and one of its rows resolves to the current path, that
   row carries it and no rail row does;
2. otherwise the rail row resolved by §1.5 carries it;
3. on `/report`, nothing carries it.

Two channels are therefore in play and must not be confused: the rail's *visual*
selection always shows the area (so a reader knows where they are), while
`aria-current` names the most specific row on screen.

### 5.5 Escape

| Focus / state | `Escape` does |
| --- | --- |
| Flyout open, opened by pointer | closes the flyout; focus is not moved (it was never in the flyout) |
| Flyout open, opened by keyboard focus | closes the flyout; focus stays on the rail link that opened it |
| Panel pinned | **nothing.** A pinned panel is stored layout, not a dismissible layer. Silently undoing a stored preference on Esc is worse than one deliberate click. |
| Nothing open, focus on a rail link | nothing (the nav does not consume Esc) |
| Inside a route's dialog/sheet/editor | owned by `AdaptiveTaskSurface` / that surface; the nav is not involved |

### 5.6 Focus trap: none

There is **no focus scope and no trap** in the rail, the panel or the flyout. A
`Tab` from `Create report` moves into `<main>`; a `Shift+Tab` from `Home` moves to
the toggle (or the skip link at 600–839). The only modal focus scopes in the app
are inside `AdaptiveTaskSurface`, the media viewer and the report editor, and they
own their own traps.

### 5.7 Focus restoration

| Event | Focus goes |
| --- | --- |
| Pin / unpin (toggle activated) | stays on the toggle — it is not remounted |
| Pin toggled while focus is inside the page list (only possible via AT virtual cursor, since rows are links) | that list disappears; focus goes to the rail row for the current area |
| Window crosses 840 → 839 while pinned and focus is on a page row (e.g. `Saved`) | the page list disappears; focus goes to the rail row for that area (`My Reports`), never to `<body>` |
| Layout flips rail ↔ bottom across 600 | existing behaviour, unchanged (`Shell.tsx:66-90`): the same destination is re-focused in the new layout |
| Navigation between destinations | the nav does not take focus; the route announces itself via its own heading focus (`SettingsPrimitives.tsx:44-55`, `SharedReport.tsx:15`, `Onboarding.tsx:84`) |

### 5.8 Skip link

| Property | Value |
| --- | --- |
| Label | `Skip to content` |
| Position | **first focusable element in the shell**, before the nav in DOM order |
| Hidden until focused | yes; visually hidden with the standard clip technique, not `display: none` |
| Visible geometry | `min-height: 44px`, `padding: 12px 16px`, `inset-block-start: calc(var(--safe-area-inset-top, 0px) + 8px)`, `inset-inline-start: 8px`, radius `12px`, background `--fb-surface-container-low`, 1px border, `z-index: 80` |
| Target | `<main id="fb-main" tabindex="-1">` |
| On activate | focus moves to `main` (no scroll jump beyond bringing the top of `main` into view) |
| Bottom layout | identical; it is the only way to reach content before the pill |

No skip link exists in the shell today (only `PublicWelcome.tsx:21` and
`Help.tsx:324` have their own). Adding it is part of this specification because a
rail before `<main>` adds five tab stops between the top of the page and the
content.

---

## 6. Motion

Tokens are `uiMotion.ts`. Nothing below hardcodes a duration that a token already
provides.

| # | Element | Property | Duration | Easing | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Rail enter/exit on route hide/show | `opacity` | `motionDurations.fast` = 0.15s | `motionEasings.out` `[0.2,0,0,1]` | existing, `Shell.tsx:288-292`, `fadeVariants` |
| 2 | Pin toggle: nav width 72/80 ↔ 224 | **none** | 0ms | — | one-frame change; `<main>` reflows in the same paint. Animating `width` is layout work per frame and violates `uiMotion.ts:21-29` |
| 3 | Label visibility on pin | `opacity` only | `0.15s` | `out` | labels occupy their final box immediately; no `width` transition, so the row does not slide |
| 4 | Create circle ↔ pill on pin | **none** | 0ms | — | part of #2 |
| 5 | Flyout enter | `opacity` 0→1 | `0.15s` | `out` | no translate: a sliding panel reads as swipeable and invites a gesture that does not exist |
| 6 | Flyout exit | `opacity` 1→0 | `motionDurations.instant` = 0.1s | `motionEasings.inOut` | exits faster than it enters |
| 7 | Flyout content swap between rows | **none** | 0ms | — | instant, no crossfade |
| 8 | Selected pill, destination change | layout transform | `motionSprings.snappy` (stiffness 420, damping 36) | spring | existing, `Shell.tsx:239-249` |
| 9 | Selected pill across a pin toggle | **none** | 0ms | — | remount with `initial={false}`; a 72→224px pill crawl reads as lag |
| 10 | Selected icon emphasis | `transform: scale(1.12)` | `0.15s` | `ease-out` (CSS) | existing, `Shell.nav.css:37-38` |
| 11 | Press feedback | `transform: scale(0.96)` | `motionDurations.instant` = 0.1s | default spring from `whileTap` | existing |
| 12 | Focus ring | **none** | 0ms | — | an indicator that fades in is a late indicator |
| 13 | Unread badge appearance / count change | **none** | 0ms | — | no number roll, no pop |
| 14 | Skip link reveal | **none** | 0ms | — | |
| 15 | Bottom pill label reveal (selected) | `opacity` + `width` | `0.15s` | default | existing, `Shell.tsx:261-273`; unchanged |
| 16 | Tooltip (bottom pill only) | `opacity` | `0.15s` after 350ms | default | existing, `Shell.tsx:277` |

**What does not animate, at all:** rail width, panel width, content column,
flyout position or size, page-list scroll, badge count, focus rings, group
headers, and any colour. Colour changes are instant token swaps.

**Reduced motion.** The effective preference (`resolveReduceMotion`,
`appearance.ts:210-224`) drives `MotionConfig` (`motionConfigValueFor`) and the
`html.fb-reduce-motion` class. Under reduced motion every row above resolves to
0ms and **the final state is painted on first paint** — the panel is already 224px
wide, labels are already visible, the flyout is already opaque. There is no
"appear then settle" and no delayed reveal. Raw CSS transitions honour the same
class (`Shell.nav.css:44-49`).

---

## 7. Persistence

### 7.1 Storage

| Property | Value |
| --- | --- |
| Key | `findback.appearance.v1` (`APPEARANCE_STORAGE_KEY`, `appearance.ts:41`) |
| Format | one JSON object holding all appearance settings |
| New field | `navRailExpanded: boolean` |
| Type | device-local only. Never written to the account, never synced, never in a migration payload |
| Default | `false` (`DEFAULT_APPEARANCE`) |
| Meaningful when | `resolveNavLayout(...) === "rail"` **and** viewport ≥840 |
| Event | `saveAppearance` dispatches `findback:appearance`; other mounts/tabs re-apply (`appearance.ts:187-196`, `329-351`) |

### 7.2 Migration

```ts
navRailExpanded: typeof parsed.navRailExpanded === "boolean"
  ? parsed.navRailExpanded
  : false,
```

Rules:

1. Absent → `false`. Never inferred from `navLayout`: choosing `"rail"` is a
   decision about *where* the navigation lives, not a request for a 224px panel.
2. A non-boolean (string, number, `null`) → `false`. Malformed fields never
   discard valid peers (`appearance.ts:158-175`).
3. JSON parse failure or missing key → `DEFAULT_APPEARANCE` (`appearance.ts:177-185`).
4. `navLayout` migration is unchanged: `"rail"` and `"bottom"` stay valid, anything
   else → `"bottom"`, and an existing stored `navLayout` still implies
   `navLayoutChosen: true` (`appearance.ts:169-173`).
5. **No storage version bump.** The key stays `findback.appearance.v1`; the field is
   additive and the migration is field-by-field. Bumping the version would discard
   every reader's accent, text scale and motion choice for one boolean.

### 7.3 Writers and the never-overwrite rule

Exactly three writers, all explicit user actions:

| Writer | Writes |
| --- | --- |
| Rail pin toggle (≥840) | `navRailExpanded` |
| Settings → Appearance → Navigation radios (`AppearanceSettings.tsx:109-135`) | `navLayout`, `navLayoutChosen: true` |
| First-wide-use card (`NavigationSetup.tsx:30-33`) | `navLayout`, `navLayoutChosen: true` |

**A stored choice is never overwritten by the system.** In particular:

- no effect may write on mount, on route change, on resize, on a breakpoint
  crossing, or on first paint;
- crossing 840 in either direction leaves `navRailExpanded` untouched (it may be
  `true` while the panel cannot be shown at 700px — that is correct: the value
  describes intent, the breakpoint describes what can be honoured);
- a stored `navLayout: "bottom"` is never changed by anything except the two
  writers above, including by Phase 3's changed default;
- unreadable storage means "run with the default for this session", not "write the
  default into storage" (`appearance.ts:188-192`).

---

## 8. Interaction with the content canvas

### 8.1 The flex contract

```
.fb-app-viewport  flex-row (rail)  |  flex-col (bottom)
  <nav>           flex: none       fixed 72 / 80 / 224
  <main>          flex: 1 1 0      min-width: 0
```

`<main>` always carries `min-w-0` in rail layout (`Shell.tsx:118`). The rail never
shrinks: `flex: none`.

### 8.2 When the routed content is wider than the remaining column

Rule: **the content column never scrolls horizontally and the rail never
compresses.** If a screen's content needs more width than it received, the screen's
own responsive fallback applies:

| Screen | Fallback |
| --- | --- |
| Home feed | masonry column count comes from the measured canvas (`useContentWidth`, `responsive.ts:285-307`), floor 1 column, min card 260px |
| Settings | `SplitView` drops to one pane when the detail pane would fall below `DETAIL_PANE_MIN_PX = 320` (`SplitView.tsx:21-23,58-64`) |
| Chats | its list/detail split uses the same `SplitView` contract |
| Everything else | the readable column (`max-w-[44rem]`) simply narrows; text reflows |

Acceptance for all of it: `document.documentElement.scrollWidth ===
document.documentElement.clientWidth` at every width ≥600 with the panel pinned.

### 8.3 Nav-hidden routes

`HIDE_NAV` today removes the nav on `/help`, `/posts/`, `/ai-connection`,
`/connections/`, `/chats/` (and the chat thread below 840) — `Shell.tsx:36,53-54`.

**Rule:** in rail layout at ≥600px the nav stays mounted on all of those routes.
A reader who opens a report by direct link on a desktop must not lose the only
cross-area escape; that is the defect the study found in its own audit
(`NAVIGATION_STUDY.md` §5).

The nav is still hidden, at every width, when:

| Condition | Reason |
| --- | --- |
| `document.fullscreenElement` | the app is not the visible surface (`Shell.tsx:208`) |
| `body:has(#report-editor-overlay)` | the report editor is a body-level task surface; leaving nav tab stops behind it is an extra-tab-stop defect (`Shell.nav.css:106-109`) |
| The bottom bar and the on-screen keyboard is open | unchanged (`Shell.tsx:204-208`); the rail is never hidden for the keyboard — it is a column beside the content |

### 8.4 Settings split-view at 840 and 1024

`listReserved = max(pane.maxWidth, pane.collapsedWidth)` or `22rem × rootFont`
(`SplitView.tsx:57-61`). `wide = width >= 840 && (width - listReserved) >= 320`.

| Viewport | Panel | Content column | `22rem` at 16px | Detail width | Result |
| --- | --- | --- | --- | --- | --- |
| 840 | pinned (224) | 616 | 352 | 264 | **one pane** (< 320) |
| 840 | collapsed (72) | 768 | 352 | 416 | two panes |
| 1024 | pinned (224) | 800 | 352 | 448 | two panes |
| 1024 | pinned (224), 125% text | 800 | 440 | 360 | two panes |
| 840 | pinned (224), 125% text | 616 | 440 | 176 | one pane |

One pane is acceptable and is already the designed fallback (`SplitView.tsx:27`).
Requirements: the split must not remount drafts on the fallback, focus inside the
hidden pane moves to the visible one (`SplitView.tsx:131-137`), and a detail page
keeps its own back control (`SettingsPage backTo="/settings"`).

### 8.5 Scroll position

| Transition | Rule |
| --- | --- |
| Nav push to a destination | `<main>` scroll resets to `0` before paint (layout effect keyed on `pathname`) |
| History pop (back/forward) | the offset stored for that history entry is restored |
| Routes that own an internal scroller | Home, Search, Chats, Settings, Help and Connections scroll inside themselves (`Shell.tsx:57-58`); their offsets are theirs and are not touched by the rule above |
| Pin / unpin | scroll position is **never** reset. The width changes; the reading position does not |
| Flyout open/close | no scroll effect in either direction |

### 8.6 Focus on navigation

A nav-initiated navigation does **not** move focus into the content itself; the
route announces itself (its `h1` takes focus with `tabindex="-1"`, e.g.
`SettingsPrimitives.tsx:44-55`). The rail updates `aria-current` and nothing else.
The existing layout-flip restore (`Shell.tsx:66-90`) is preserved and extended in
§5.7.

---

## 9. Public and auth surfaces

**The rule, stated once:** a surface renders the primary navigation **only if it
is inside the authenticated `Shell` route** (`App.tsx:224-230`, wrapped in
`RequireAuth`). The rail is rendered by `Shell`; a surface outside `Shell` cannot
inherit it, and must not render it directly "because the window is wide".

| Surface | Route(s) | Chrome |
| --- | --- | --- |
| Splash | `/splash` | none |
| Onboarding | `/onboarding` | own header: brand link to `/` (`Onboarding.tsx:78`), "Skip to sign in", legal nav |
| Auth | `/auth`, `/signin`, `/register`, `/verify`, `/forgot`, `/recovery`, `/create-password` | `AuthShell` (`AuthShell.tsx:33,37`) |
| Profile completion | `/complete-profile` | `AuthShell` |
| Public landing | `/` when signed out | `PublicWelcome` own nav + footer |
| Shared report | `/shared/:id` | own brand link in every state (`SharedReport.tsx:44`) |
| Legal documents | `/privacy`, `/terms`, `/community-guidelines` | `nf-public-document` + document chrome, **`utilities={false}`** so no search/bell |
| Authenticated app | everything under `Shell` | rail / pill, per this document |

Two consequences that are contracts, not suggestions:

1. The rail never appears above `booting`, `needsProfile`, `needsPasswordSetup` —
   those states render `Splash` or a `Navigate` (`App.tsx:91-101,156-161`), so the
   rule holds structurally.
2. A public screen must never be given a "collapsed rail" as a way of offering
   navigation. Its two controls are the brand link and its own menu.

---

## 10. Edge cases

| Case | Required behaviour |
| --- | --- |
| **Offline** | The nav renders identically: it is static markup with a route-derived selection. No skeleton, no spinner, no "unavailable" state. The only network-dependent affordance is the unread count, which renders nothing while unknown (`TopUtilities.tsx:39`). Nothing in the nav is disabled offline. |
| **Reconnecting** | No nav change. The unread count may appear; the badge does not animate (§6 #13). |
| **Unread 99+** | Nothing appears in the rail or panel (§3.4). The bell caps at `99+` (`TopUtilities.tsx:61`). |
| **A destination unavailable to the account** | The row is **omitted**, never disabled and never shown-then-refused. Today no rail row is capability-gated; if one ever is, an area with zero visible rows removes its rail row entirely and the route redirects to Home, rather than leaving a dead tab stop. Staff surfaces stay inside Settings (`Settings.tsx:355-381`). |
| **Long translated labels** | Wrap, never truncate. Panel rows have `176px` (page) / `144px` (area) of text width and grow in height. No `text-overflow: ellipsis`, no `white-space: nowrap` on a panel label. The header area name wraps too. |
| **RTL** | Logical properties only: `border-inline-end` (nav edge), `inset-inline-start` (flyout), `margin-inline` (create), `padding-inline`. The nav is always on the inline-start edge, so in RTL it is on the right and the flyout opens to its inline-end (left). Icon order inside a row is unchanged (icon then label, i.e. icon on the start side). No mirrored iconography beyond `PanelLeft*`, which is replaced by a direction-aware chevron pair in RTL. |
| **200% text** | §2.6. Panel stays 224px; rows grow; the flyout scrolls inside `min(420px, 100dvh − 16px)`. Nothing truncates. |
| **High contrast** | `forced-colors: active`: the 1px edge keeps painting (system colours remap it), and the current row must not rely on `--fb-primary-container` alone — add `outline: 2px solid Highlight; outline-offset: -2px` on `[aria-current="page"]`. The focus ring already survives as a 2px outline. |
| **True black** | `--fb-surface` is `#000` in the amoled palette. The rail's 1px `--fb-outline-variant` edge and the flyout's 1px border are what separate surfaces; `--shadow-md` is invisible on black and must not be the only separation. |
| **Landscape phone with a 224px panel** | 844×390 is ≥840 wide, so the toggle exists. Content = 620×~330 after chrome. Header (44) + 4 rows (176) + page list (88) + create (44) needs ~390, so the panel body scrolls while the header stays fixed. Accepted: the create action may require one scroll at 390px height, and it is also reachable from Home. No two-column content at that height. |
| **Window resize across a breakpoint while pinned** | 840→839: panel collapses to the 72px rail in one frame, no animation, `navRailExpanded` stays `true` in storage, focus moves per §5.7. 839→840: the panel reappears at 224px, the pill paints at the new geometry without animating, the page list re-renders with the current area. No write to storage in either direction. |
| **Resize 599↔600** | Layout flip rail ↔ bottom pill; existing remount-and-restore behaviour (`Shell.tsx:66-90`, `:104-116`). No write. |
| **Resize 1199↔1200** | Rail width 72↔80, one frame, no animation. Content column shifts 8px. |
| **Browser zoom 200%** | CSS width halves, so a 1440px window becomes 720 CSS px and lands in the 600–839 band: rail collapsed, flyout only. This is correct behaviour, not a bug — the band is defined on CSS pixels, like every other layout decision in the app. |
| **Storage unavailable (private mode)** | The toggle works for the session and does not persist; no error is shown. |
| **Focused row disappears (row removed while focused)** | Not possible today (the four destinations are static). If a row is ever capability-filtered, focus moves to the nearest remaining row, then to the toggle, then to `main`. Never `<body>`. |

---

## 11. Copy deck

Every visible string the navigation can render. All of it is author-written; none
is user-generated. Sentence case throughout; no trailing periods in labels.

### 11.1 Rail (collapsed, 72/80px)

| String | Where | Visible? |
| --- | --- | --- |
| `Home` | destination 1 accessible name | no (`sr-only`) |
| `My Reports` | destination 2 accessible name | no (`sr-only`) |
| `Chats` | destination 3 accessible name | no (`sr-only`) |
| `Settings` | destination 4 accessible name | no (`sr-only`) |
| `Create report` | create action accessible name | no (icon only) |

### 11.2 Rail (pinned, 224px)

| String | Where |
| --- | --- |
| `Home` / `My Reports` / `Chats` / `Settings` | destination labels — identical to the accessible names, so one string serves both |
| `Create report` | create pill label |
| `Expand navigation` | toggle accessible name, collapsed |
| `Collapse navigation` | toggle accessible name, pinned |

### 11.3 Panel

| String | Where |
| --- | --- |
| `Home` | header for the Home area |
| `Home` | page row (`/`) |
| `My Reports` | header for the My Reports area |
| `My reports` | page row (`/my`) · lower-case "r" distinguishes the page from the area |
| `Saved` | page row (`/saved`) |
| `Chats` | header |
| `Conversations` | page row (`/chats`) |
| `Settings` | header |
| `All settings` | page row (`/settings`) |
| `Your profile` | page row (`/profile`) |

### 11.4 Flyout

Identical strings to §11.3 (same component), plus nothing else. No "Quick links",
no "Navigation", no helper sentence.

### 11.5 Shell

| String | Where |
| --- | --- |
| `Skip to content` | skip link |
| `Primary` | `<nav aria-label>` |
| `<area> pages` | page-list `aria-label`, e.g. `My Reports pages` (not visible) |

### 11.6 Not rendered by the navigation

| String | Owner | Note |
| --- | --- | --- |
| `Notifications`, `Notifications, N unread` | `TopUtilities` | see §3.4 for the recorded gap |
| `Search` | `TopUtilities` | |
| `Back`, `Back to …` | `BackButton` | nav never renders a back control |
| `99+` | `TopUtilities` badge | |

**Copy rules.** No sentence in the nav may exceed 24 characters at 100% text; the
longest is `My Reports`/`My reports` at 10. No string may be title-cased beyond its
first word except proper nouns (`Norfold`, never used here). Nothing in the nav
describes an implementation ("rail", "sidebar", "panel", "collapsed", "pinned") —
those words appear only in accessible names where they are the action's outcome
("Expand navigation"), never as a noun on screen.

---

## 12. Acceptance table

Every row is a measurement, not an impression. "Theme" and "text" columns are the
minimum set to check for that row; light is the default and dark/true-black are
checked wherever a row names a surface that changes colour.

| # | Surface | State | Pass criterion (measurable) | Width(s) | Theme | Text |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Bottom pill | default | 4 links + 1 create; each link `min-width ≥44`, `min-height ≥48`; selected `flex-grow = 2`, others `1` | 320, 390 | light/dark | 100% |
| 2 | Bottom pill | narrow container | at row width ≤24rem the selected label is clipped to `1px` and not painted; no link below `44px` | 320 | light | 125% |
| 3 | Bottom pill | keyboard open | nav is absent from the DOM while an editable is focused (Android) or the visual viewport shrinks >120px | 390 | light | 100% |
| 4 | Rail | collapsed geometry | nav `offsetWidth === 72`; `main.offsetWidth === width − 72` | 600, 839, 840, 1199 | light/dark | 100% |
| 5 | Rail | collapsed geometry, wide | nav `offsetWidth === 80` | 1200, 1440 | light | 100% |
| 6 | Rail | no toggle in the medium band | `querySelectorAll('[aria-controls="fb-nav-panel"]').length === 0` | 600, 839 | light | 100% |
| 7 | Rail | toggle present | one button, `offsetWidth × offsetHeight === 44 × 44`, `aria-expanded` reflects state | 840 | light | 100% |
| 8 | Panel | pinned | nav `offsetWidth === 224`; `main.offsetWidth === width − 224`; `data-expanded="true"` | 840, 1024, 1200, 1440 | light/dark/amoled | 100% |
| 9 | Panel | rows | every row `offsetHeight ≥ 44`; no row paints `text-overflow` ellipsis | 840, 1440 | light | 100% |
| 10 | Panel | row text, tightest | `My Reports` occupies ≥2 lines and the row grows; nav width still `224` | 840 | light | 200% |
| 11 | Panel | no horizontal overflow | `document.documentElement.scrollWidth === clientWidth` | 600…1440 | any | 100%/200% |
| 12 | Panel | scroll | page list scrolls, header does not move; `overscroll-behavior` contains the scroll (page behind does not move) | 390-tall landscape | light | 100% |
| 13 | Flyout | open | after 120ms hover one `[data-nav-flyout]` exists at `left === navWidth + 8`, `width === 224` | 600, 900 | light/dark | 100% |
| 14 | Flyout | no reflow | `main.getBoundingClientRect()` captured before hover and 300ms after is **identical** (x, y, width, height) | 600, 900, 1199 | any | 100% |
| 15 | Flyout | focus open | focusing a rail link with the keyboard opens it within one frame (no 120ms delay) | 600 | light | 100% |
| 16 | Flyout | leave delay | pointer leaving rail and flyout closes after ≥180ms; re-entering within 120ms keeps it open and does not re-animate | 600 | light | 100% |
| 17 | Flyout | Escape | one `Escape` removes the node in the next frame; `document.activeElement` is unchanged | 600 | light | 100% |
| 18 | Flyout | scroll dismissal | any scroll on `main` removes the node | 600, 900 | light | 100% |
| 19 | Flyout | pinned suppression | with `navRailExpanded`, hovering every row 500ms produces zero `[data-nav-flyout]` | 900 | light | 100% |
| 20 | Flyout | AT exclusion | wrapper `aria-hidden="true"`; no descendant is in the tab order; after clicking a row `document.activeElement` is not inside it | 600 | light | 100% |
| 21 | Keyboard | skip link | first Tab reveals `Skip to content`; Enter moves focus to `#fb-main` | 840 | light | 100% |
| 22 | Keyboard | order | Tab sequence from the top is skip → toggle → Home → My Reports → Chats → Settings → Create report → first control in `main` | 840 | light | 100% |
| 23 | Keyboard | no trap | N Tabs from `Create report` reaches content and never cycles | 840 | light | 100% |
| 24 | Keyboard | `aria-current` | exactly one `[aria-current="page"]` in the nav on each of `/`, `/saved`, `/my/:id/edit`, `/chats/:id`, `/settings/account`, `/profile/edit`; zero on `/report` | 840, 1440 | light | 100% |
| 25 | Keyboard | `aria-controls` | the referenced id exists while collapsed (`hidden`) and while pinned | 840 | light | 100% |
| 26 | Keyboard | focus after pin | activating the toggle leaves focus on the toggle; the pill does not animate | 840 | light | 100% |
| 27 | Keyboard | collapse under focus | with focus on the `Saved` page row, resize to 839: focus lands on the `My Reports` rail row | 840→839 | light | 100% |
| 28 | Persistence | write | toggle → `JSON.parse(localStorage['findback.appearance.v1']).navRailExpanded === true`; reload restores the panel | 840 | any | 100% |
| 29 | Persistence | no write on resize | crossing 840→700→840 leaves the stored value byte-identical apart from no change at all | 840↔700 | any | 100% |
| 30 | Persistence | migrating | a stored object without the field loads as `false` and is not rewritten until a writer runs; a stored `navLayout:"bottom"` stays `"bottom"` | any | any | 100% |
| 31 | Motion | no width tween | `getComputedStyle(nav).transitionProperty` does not include `width`; a toggle frame shows the final geometry | 840 | any | 100% |
| 32 | Motion | reduced | with reduced motion: flyout opacity change is 0ms, panel is already 224 on first paint, pill does not travel | 840 | any | reduced |
| 33 | Content | nav-hidden route | `/posts/:id` direct load shows the rail at ≥600 and no rail at 599 | 599, 900 | light | 100% |
| 34 | Content | Settings split | 840 pinned → one pane; 1024 pinned → two panes; 1024 pinned @125% → two panes; no draft remount on the fallback | 840, 1024 | light | 100%/125% |
| 35 | Content | scroll | push to a destination lands at `scrollTop === 0`; back restores the previous offset; pin/unpin never resets it | 840 | light | 100% |
| 36 | Surface | public legal | `/privacy`, `/terms`, `/community-guidelines` render no nav and no search/bell utilities; the back control reaches the public page | 900 | light/dark | 100% |
| 37 | Surface | auth | `/auth`, `/signin`, `/complete-profile` render no nav; the brand link exists and is ≥44px tall | 900 | light | 100% |
| 38 | Edge | RTL | nav on the inline-start edge (right in RTL); flyout opens left of the rail; `border-inline-end` on the correct side; no icon mirrored except the toggle | 840 | light | 100% |
| 39 | Edge | forced colours | current row distinguishable without colour alone (outline present); focus ring visible | 840 | forced | 100% |
| 40 | Edge | true black | rail edge and flyout border visible against `#000`; flyout is not separated by shadow alone | 840 | amoled | 100% |
| 41 | Edge | offline | nav renders with no skeleton and no badge; no disabled state; nothing retries | 840 | any | 100% |
| 42 | Edge | unread | no badge anywhere in the nav for counts 0, 1, 9, 99, 150 | 840 | any | 100% |

Rows the reviewer must also capture (rendered review, not a measurement): the
collapsed rail with a non-first destination selected at 600; the pinned panel with
`Chats` selected at 1440 (the thinnest panel); the flyout over the Home feed at 900.

---

## Appendix A — DOM contract

```
<div class="fb-app-viewport" data-nav-layout="rail">
  <a class="fb-skip" href="#fb-main">Skip to content</a>
  <nav aria-label="Primary" data-layout="rail" data-expanded="false|true" class="fb-nav-rail">
    <div class="fb-nav-rail-head">                     (+ only at >=840)
      <button type="button" class="fb-nav-rail-toggle"
              aria-label="Expand navigation|Collapse navigation"
              aria-expanded="false|true"
              aria-controls="fb-nav-panel">…</button>
      <span class="fb-nav-rail-area" aria-hidden="true">My Reports</span>
    </div>
    <ul class="fb-nav-rail-list">
      <li><a href="/my" aria-current="page"><svg aria-hidden/><span class="fb-nav-label">My Reports</span></a></li>
      … x4
    </ul>
    <div id="fb-nav-panel" hidden>
      <ul aria-label="My Reports pages">
        <li><a href="/saved" aria-current="page">Saved</a></li>
      </ul>
    </div>
    <a href="/report" class="fb-nav-create" aria-label="Create report">…</a>
  </nav>
  <main id="fb-main" tabindex="-1" class="min-w-0 flex-1">…</main>
</div>
```

Portal (only while open, never inside the nav):

```
<div class="fb-nav-flyout" data-nav-flyout aria-hidden="true"
     style="position:fixed; inset-inline-start:80px; top:120px; width:224px">
  <p class="fb-nav-flyout-title" aria-hidden="true">My Reports</p>
  <ul>
    <li><a href="/saved" tabindex="-1">Saved</a></li>
  </ul>
</div>
```

## Appendix B — decisions this brief did not cover

| # | Decision | Reason |
| --- | --- | --- |
| 1 | No header slot below 840. | A reserved 44px slot would push four destinations 52px down in the band with the least vertical room (a 390px-tall landscape phone). The cost is a 52px shift when a window crosses 839↔840 — a deliberate resize, not a scroll. |
| 2 | Panel row sets: Home 1, My Reports 2, Chats 1, Settings 2. | Only real routes, only where the canvas does not already name the page on every screen. `/saved` otherwise resolves to no rail row; `/profile` is already mapped to the Settings area but unnamed. The panels are thin because the app is thin; padding them would be the cosplay the study rejected. |
| 3 | `/saved` belongs to My Reports. | It is the reader's own report collection, and it currently selects nothing in the rail. |
| 4 | The flyout carries the hovered area's pages, not the current area's. | That is the only reading of "labels + the section's panel list" that earns the overlay: one hover plus one click reaches `Saved` instead of area → settings → profile → saved. |
| 5 | The flyout is `aria-hidden`, non-tabbable and not a landmark. | It duplicates the rail's own names and links. Exposing it would add a landmark that appears and disappears as focus moves through four links. The rail's `sr-only` labels already give AT everything. |
| 6 | The skip link is added and is the first focusable element. | The rail inserts five stops before `<main>`; there is no shell-level skip link today (only `PublicWelcome` and `Help` have their own). |
| 7 | Flyout z-index 60. | Above route sticky bars (20), below task surfaces (70+), the media viewer (100+) and tooltips (120). A flyout must never cover a dialog. |
| 8 | Group headers specified, zero rendered. | Every panel has one group. The style exists so a second group cannot invent one later, and the rendered state is stated as `0`, not "TBD". |
| 9 | The Settings catalogue is not mirrored in the panel. | At 840px pinned, the content column is 616px and the Settings list is a `SplitView` pane. A second settings list inside the nav would put two lists side by side and duplicate a canonical owner. |
| 10 | Roving tabindex is refused. | It would require a widget role for four links, removing Enter/middle-click/context-menu/open-in-new-tab. Arrow keys therefore do nothing in the nav. |
| 11 | Fixed `px` widths, including at 200% text. | A `rem` rail is 144px at a 32px root and a `rem` panel 448px — half a 600px screen for four icons. Labels wrap and rows grow instead. Icons stay at 22/20px because they are decorative `aria-hidden` glyphs and scaling them grows every row without adding legibility. |
| 12 | Records, not fixes: the 600–839 touch band has no visible labels, and the bell's `aria-label` omits the unread count. | Both are real limitations. The first is bounded by the content floor (a 224px panel at 720px leaves 496px); the second belongs to `TopUtilities`, not the navigation, and needs its own decision before the notification surface is called accessible. |
| 13 | No storage version bump for `navRailExpanded`. | Bumping `findback.appearance.v1` would discard every reader's accent, text scale and motion choice for one boolean. The field is additive and migrates field-by-field. |
