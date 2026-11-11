# Navigation study: an expandable rail, without the console

> **This study is superseded as an implementation contract by
> [`docs/design/nav/SPEC.md`](nav/SPEC.md).** It remains the research record: the
> video evidence, the reasoning that rejected hover-*reflow*, the audit of
> Norfold's real information architecture and the escape-hatch table are still the
> evidence behind the specification. Where this document states a number or a
> behaviour that the specification also states, the specification wins; where the
> two disagree, the specification is the later decision. Nothing here is a
> substitute for reading `SPEC.md` before implementation.

Research brief, 11 November 2026; corrected 12 November 2026. This is a
recommendation and a record, not an implementation. No product source was changed
for this document and nothing here is committed.

Evidence: the owner's 2m37s Supabase Studio recording, sampled at four-second
intervals into contact sheets plus six extracted frames (0:22, 1:53, 2:06, 2:16,
2:26, 2:32). Those images are session-local under `%TEMP%\opencode\video-study\`
and are not committed; the timestamps in this document are the citation.
Norfold evidence is source at HEAD `8e905b38`, plus an uncommitted working tree
that contains the onboarding rewrite **and** the Phase 1 route-home fixes
described in §6 — eighteen modified files at the time of writing
(`git status --short`). This file itself is untracked (`?? docs/design/NAVIGATION-STUDY.md`).
Citations to the working tree are marked as such; citations to HEAD are marked
`HEAD 8e905b38`.

## 1. Recommendation

Adopt the shape, not the console. Three layers, three behaviours:

- **Collapsed rail.** From 600px (`COMPACT_MAX_PX`) a 72px in-flow icon rail —
  80px at ≥1200px — sits as a `flex: none` sibling of `<main>`. Hover or keyboard
  focus opens a **floating flyout** overlay carrying the destination's name and
  that section's page list. The flyout is positioned over the content and never
  reflows the page.
- **Pinned panel.** An explicit click on the toggle — present only at ≥840px —
  expands the rail to a 224px in-flow labelled panel and remembers that choice
  per device. This is the Supabase look.
- **Phone.** Below 600px the bottom pill is unchanged. No drawer, no rail, no
  flyout.

Hover never expands the rail *in flow*. That distinction is the whole design: the
earlier draft of this study rejected hover-expansion because a 72→224px reflow
moves the reading column 152px under the pointer every time the pointer crosses
the rail on its way to the page. The rejection of hover-**reflow** stands; the
hover *pleasure* is kept as an overlay that covers content instead of displacing
it. 224px is derived, not chosen for looks: 840 − 224 = 616px, still above the
600px content floor, which is why the pin toggle does not exist below 840px.

The separate, urgent fix is not the sidebar at all — it is that public surfaces
have no deterministic way home (§6).

## 2. What the video actually demonstrates

Four-second sampling cannot establish timing. The sheets show *what* is on
screen, not how it got there; §3 is explicit about what that does and does not
support.

| Time | On screen |
| --- | --- |
| 0:22 | Workspace rail (icons only) plus a top-right account popover: name, Account, Feature previews, Theme radios, Upgrade, Sign out. |
| 1:16–1:23 | Narration begins; he points at the database area. Nothing in the chrome changes. |
| 1:53 | Database section. Icon rail (≈80px, one filled selection), a labelled panel about four times its width (four uppercase groups), content canvas reading "Loading tables". |
| 2:04–2:11 | "I'm not saying I'm going to add up this or this I'm saying much more to this to add up something like this." |
| 2:12–2:21 | "If you want to have a panel, if you want to have it collapse … bring your mouse over, things open." Narration only; no open or close is captured at these samples. |
| 2:23–2:30 | "Things are really fast here. Fast." At 2:26 the panel is unchanged and the pointer rests inside it. |
| 2:30–2:37 | "I like being able to do this." |

**Three layers, not one.** The captures at 1:53 and 2:06 show a persistent icon
rail, a persistent contextual panel, and a content canvas. The rail holds global
sections; the panel holds the pages of the *current* section (`Database` with
`DATABASE MANAGEMENT`, `ACCESS CONTROL`, `CONFIGURATION`, `PLATFORM`); the canvas
holds the work. The panel title matches the rail selection (`Database`) at both
samples — it is a section panel, not a second global menu.

**What is always visible.** The rail and its selection; the panel title and its
group labels; the content header (breadcrumb, `FREE`, branch, `Connect`). The
panel's width and position inside the app window are identical at 1:53, 2:06,
2:16 and 2:26 while the canvas goes from empty → "Loading tables" → populated.
Nothing in the chrome reflows when data arrives.

**What is revealed without navigating.** The account popover is open at 0:22
over the content and gone by 1:16 with the route unchanged. Rail-icon hover
labels are never captured in these frames, so the "mouse over, things open"
claim is the owner's narration, not an observed frame; treat the *details* of
hover-reveal (delay, whether it reflows, whether it is a tooltip or a panel) as
**not established** by the recording. The overlay design in `SPEC.md` is Norfold's
own decision, not a transcription.

**What stays anchored.** The rail's left edge, the panel's left edge, the panel
title and the content header. Selection moves; the frame does not.

**Not established by this recording:** animation duration or easing, hover
delay, whether panels are pre-mounted, whether the panel scrolls when its list
outgrows the window, and whether the rail itself expands or only shows a flyout.
Do not copy numbers from it.

## 3. Why it feels fast

Two different causes are being described as one, and only one of them is a
design choice Norfold can copy.

**Fast because nothing in the chrome is loading.** At 1:53 the panel is fully
drawn and the canvas says "Loading tables". At 2:06 the canvas is populated and
the panel has not moved a pixel. The navigation is static markup with a
selection; only the content is async. Norfold already has this property —
`Shell` mounts the nav as a sibling of the routed content and outside
`RouteTransition` (`apps/mobile/src/components/Shell.tsx:114-133`) — so the
"fast" feeling is not something a sidebar adds; it is something the shell must
not lose. It is why `SPEC.md` forbids a navigation skeleton in every state.

**Fast because the route does not reload.** Both apps are single-page; the
selection moves within a mounted shell. Nothing to build.

**Animation is not measurable here.** Four-second sampling cannot distinguish
"instant" from "180ms" from "600ms between frames". The panel is unchanged
across every sample that shows it, and the only loader in the recording is
inside the content. No duration in this document is derived from the video;
§7.5 and `SPEC.md` §6 use Norfold's own tokens.

**Hover latency is asserted, not measured.** The narration says things open
when the pointer arrives (2:12–2:21); the panel is already open at 2:16 and
2:26, and only at 2:26 does the pointer rest inside it. No sample captures the
pointer entering the rail, so a hover delay cannot be read from that.

## 4. What must not transfer

Supabase Studio is a developer console. The concept is "anchored chrome that
never leaves"; the following are console-specific and are rejected for Norfold:

- **A dozen destinations in one rail.** The rail at 1:53 carries roughly a
  dozen product sections — home, tables, SQL, database, auth, storage and more,
  all icon-only at this sample — where Norfold has four (`Shell.tsx:29-34`).
- **A second navigation level with ~20 rows in four groups** (1:53, 2:06). A
  four-destination consumer app has nothing to put there. `SPEC.md` §1 draws the
  line concretely: the most any Norfold panel holds is two rows, and the
  specification states that rather than filling the panel to look like the
  reference.
- **Org / project / branch switchers** in the header (2:06: `Norfold FREE`,
  org diamond, project, `main PRODUCTION`). Norfold has one account, no tenant.
- **Environment and release chrome**: the `PRODUCTION` chip, the `NEW` badge on
  Pipelines, the `Connect` button. Norfold's status vocabulary is Lost, Found,
  Matched, Recovered, Warning, Danger — semantic, never decorative
  (`docs/DESIGN_SYSTEM.md:8-13`).
- **A workspace canvas with a minimap and a schema legend** (2:06, 2:16). That
  is the product, not the shell.
- **A command palette and keyboard chord** (`Search… Ctrl K`, 2:06). Norfold
  has no command layer: `/search` is one route opened from the header utilities
  (`TopUtilities.tsx:64`), and there is nothing to palette over.
- **An account/theme flyout from the rail** (0:22). Norfold's account lives in
  Settings and its utilities live in the route header (`TopUtilities.tsx:63-69`).
- **The console's colour and type**: green primary, amber environment chip,
  uppercase monospaced group labels, dark code surface. Norfold is monochrome
  with hairlines, tight negative tracking and pill controls; the rail must use
  `--fb-*` tokens only (`apps/mobile/src/index.css:4-37`).

The transferable idea is narrow and worth stating plainly: **a stable column
that owns destinations, labels revealed on demand instead of permanently, and a
selection that never causes a page reload.** That is all.

## 5. Norfold's real information architecture today

**Four destinations and one action.** `Home`, `My Reports`, `Chats`, `Settings`,
plus `Create report` (`Shell.tsx:29-34`, `Shell.tsx:215-219`). `/search` is
reached from the header utilities (`TopUtilities.tsx:64`), not the primary nav;
`/profile` is reached through Settings (`docs/DESIGN_SYSTEM.md:42`).

**Two renderings of one component.** `PrimaryNav` renders either a bottom pill
or a side rail with the same destinations, selection and create action
(`Shell.tsx:147-162`, `Shell.tsx:282-320`). The rail is an in-flow flex sibling
of `<main>`, never fixed or overlay (`Shell.tsx:59-64`, `Shell.nav.css:81-88`).

**The bottom pill (phone).** Full-width row capped at 44rem, pill with a 1px
hairline, four links at ≥44px wide and 48px tall where the selected one takes
twice the share (`flex: 2 1 0`, `Shell.nav.css:30`), a 52px circular create
button, and the selected item's label revealed inline (`Shell.nav.css:3-30`,
`Shell.nav.css:64-69`). A container query at 24rem hides labels so narrow or
large-text screens spend their width on intact targets (`Shell.nav.css:54-63`).
That is one-handed use: thumb reach, bottom edge, no precision required.

**The rail (opt-in, ≥600px).** 72px wide, 80px at ≥1200px, icon-only, labels
`sr-only`, names on a 350ms tooltip that opens on hover and keyboard focus
(`Shell.nav.css:81-103`, `Shell.tsx:277-279`). The comment above the rule says
the width is in `rem` so text scale cannot clip destinations
(`Shell.nav.css:77-78`), but the rule itself is fixed pixels — `72px` at `:83`,
`80px` at `:103`. That mismatch is the safe direction, and `SPEC.md` §3 keeps
fixed pixels deliberately: a `rem` rail would be 144px at a 32px root and would
eat the column it exists to protect.

Two stale comments record the same drift and should be corrected when the rail
work lands, because they will mislead the next reader: `responsive.ts:273-275`
says the rail takes `6.5rem` out of the row (it is 72px / 4.5rem at the default
root), and `Shell.nav.css:77-78` says the width is in `rem` (it is `px`).

**How the preference resolves.** `navLayout` is device-local in
`findback.appearance.v1` (`appearance.ts:41`, `appearance.ts:121-140`,
`appearance.ts:177-185`). `resolveNavLayout` honours `"rail"` only when the
viewport is ≥600px, and falls back to `"bottom"` otherwise
(`navLayout.ts:18-30`, `responsive.ts:19-20`, `responsive.ts:174`). The default
is `"bottom"` for everyone (`appearance.ts:132-140`).

**Where the choice is made.** A first-wide-use card at ≥840px offers "Side rail" /
"Bottom navigation" and writes `navLayoutChosen` (`NavigationSetup.tsx:8-9`,
`NavigationSetup.tsx:34-44`); afterwards the same choice lives in Settings →
Appearance → Navigation (`App.tsx:258`, `AppearanceSettings.tsx:109-135`).

One small gap found while checking that citation: the Settings **catalogue**
entry for Appearance carries the keywords `theme, dark, amoled, accent, color,
personalization, display` (`services/destinations.ts`, `appearance` entry) and
no word for navigation, so typing "navigation" into Settings search does not
find the control that changes it. The earlier draft of this study cited
`services/destinations.ts:125-127` as if it owned the preference; it does not —
that line is the Accessibility entry. The preference is owned by
`appearance.ts`, and the missing keywords are a settings-search defect, not a
navigation one.

**What is not there.** No second navigation level anywhere except the Settings
list/detail split (`Settings.tsx:176-179`, `SplitView.tsx:42-64`) and the Chats
thread list. No brand mark in the rail — Home is destination one. And no
primary navigation at all outside `Shell`: `/onboarding`, `/auth`, `/shared/:id`
and the three legal documents are siblings of the Shell route
(`App.tsx:176-222` versus `App.tsx:224-295`). That last fact is the owner's
actual problem.

**One related observation, not a defect.** `HIDE_NAV` removes the primary nav on
`/help`, `/posts/`, `/ai-connection`, `/connections/` and `/chats/`, and for the
chat thread only below 840px (`Shell.tsx:36`, `Shell.tsx:53-54`). A desktop
reader who opens a report by direct link therefore loses the rail entirely and
keeps only a back arrow (`PostDetail.tsx:1066`). With a persistent rail this is
the one place that contradicts it; `SPEC.md` §8 resolves it by keeping the rail
on nav-hidden routes at ≥600px.

## 6. Escape-hatch audit

Column 4 reads "yes" only when a control on the surface lands on `/` and renders
the public page. A control that can land on the auth gateway or the remembered-
account chooser depending on session state is "state-dependent" and is treated
as a defect, because the label promises a destination the code does not
guarantee. Cells marked **fix in flight** describe work present in the working
tree and not yet verified by a run; they are not current-defect claims.

| # | Surface | Route | Link home? | Evidence | Minimum fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Standalone onboarding | `/onboarding` | **No at HEAD**; fixed in the working tree | HEAD `8e905b38` renders `<div className="fb-onboarding-brand">` (`git show HEAD:apps/mobile/src/screens/Onboarding.tsx`); working tree `Onboarding.tsx:78` is already `<Link className="fb-onboarding-brand-link" to="/" state={{ showPublic: true }} aria-label="Norfold home">` | Land the WIP and pin it with a route test that asserts the link and its state. |
| 2 | Auth entry, recovery, profile completion | `/auth`, `/signin`, `/register`, `/verify`, `/forgot`, `/recovery`, `/complete-profile` | Yes | `components/auth/AuthShell.tsx:33,37` (brand and "Back to Norfold", both with `showPublic`); `CompleteProfile.tsx:227` uses the same shell | None to the link. **Caveat:** `StartScreen` resolves `needsProfile` *before* `showPublic` (`App.tsx:92-99` — `if (user) return <Shell />; if (needsProfile) return <Navigate to="/complete-profile" replace />;`, and only then reads `showPublic`). So the link proves the destination, not that every profile-completion state reaches the public page: mid-completion, a tap on the brand goes to `/` and the guard immediately replaces it with `/complete-profile`. Whether that is correct is a product question (a half-finished profile probably should not be abandoned silently), but it means "Yes" is a claim about the link only. |
| 3 | Privacy policy | `/privacy` | **fix in flight — verify after land** | At HEAD: `App.tsx:177` renders it outside `Shell`; `Legal.tsx` passed `backTo="/"` with no state; `SettingsPrimitives.tsx` rendered `BackButton`; `BackButton.tsx:22-27` calls `navigate(fallbackTo, { replace: true })` **without state**; `StartScreen` then redirects to `/auth` when `authReturnTo` is set (`App.tsx:98-99`). Working tree: `Legal.tsx:28` passes `backState={{ showPublic: true }}` and `BackButton.tsx:9,26` threads it. | Run the row's acceptance after land: cold load of `/privacy` with a saved account **and** a pending report link, one action, public page renders. |
| 4 | Terms of use | `/terms` | **fix in flight — verify after land** | `Legal.tsx:27-28` (in the working tree: `backTo={publicView ? "/" : "/settings"}` and matching `backState`); same `BackButton` path | Same as row 3. |
| 5 | Community guidelines | `/community-guidelines` | **fix in flight — verify after land** | `Legal.tsx:218-221`; the working tree also links it from `Onboarding.tsx:121` and `PublicWelcome.tsx:44` | Same as row 3. |
| 6 | Public document chrome | `/privacy`, `/terms`, `/community-guidelines` | **The documents are public; their chrome carries two controls that eject a signed-out reader into auth** | These three are top-level public routes, siblings of the Shell route — `App.tsx:177-179`, e.g. `<Route path="/privacy" element={<main className="nf-public-document"><PrivacyPolicy publicView /></main>} />`. They are **not** inside `RequireAuth`. `App.tsx:231,240` are `/search` and `/notifications` *inside* the authenticated `Shell` (`App.tsx:224-230`), and those are exactly what `TopUtilities` links to (`SettingsPrimitives.tsx:60` renders `TopUtilities` by default; `TopUtilities.tsx:64,67` link to `/search` and `/notifications`). So a signed-out reader on a public document sees a magnifier and a bell that take them to `/auth`. | Pass `utilities={false}` for `publicView`. **fix in flight — verify after land:** `SettingsPrimitives.tsx:40,60` now has the prop and `Legal.tsx:29,109,220` passes `utilities={!publicView}`. |
| 7 | Shared report — invalid link | `/shared/:id` | Yes | `SharedReport.tsx:37` — `<Link to="/" state={{ showPublic: true }}>Back to Norfold</Link>` | None. |
| 8 | Shared report — loading / ready / unavailable / error | `/shared/:id` | **fix in flight — verify after land** | At HEAD the brand was a plain `<p>` and the only home link rendered when the status was neither `ready` nor `loading`. Working tree `SharedReport.tsx:44` makes the brand row `<Link to="/" state={{ showPublic: true }}>` in every state, and the retry link at `:59` is unchanged. | Verify a stalled preview and a successful preview both offer the brand link. |
| 9 | Signed-out root | `/` | Yes | HEAD `PublicWelcome.tsx:40,47,80`; working tree `:23` (brand with state), `:30` sign-in, `:44` legal | None. |
| 10 | Signed-out root with saved accounts | `/` → "Welcome back" | Yes, through the brand | `RememberedAccounts.tsx:33-34` → `AuthShell.tsx:33` | None. This row is why an unstated `to="/"` is not the public page on a device with saved accounts. |
| 11 | Nav-hidden authenticated routes | `/help`, `/posts/:id`, `/ai-connection`, `/chats/:id` (<840px) | **No — a history-aware back button, not a home link** | `Shell.tsx:36,53-54`; `PostDetail.tsx:1066`; `Help.tsx:327` (`fallbackTo="/profile"`, label "Back to profile"); `Messaging.tsx:1646` (`<Link to="/chats" aria-label="Back to chats">`). `BackButton.tsx:22-27` calls `navigate(-1)` whenever `historyDepth() > 0` and only uses the fallback when there is nothing to go back to; `BackButton.tsx:35` relabels the control "Back" in exactly that case. | None. Back is correct inside an authenticated app — but this row must not be read as "there is a way home". With history, it returns to wherever you came from, which may be another leaf page. |

The root cause is structural, not cosmetic: public surfaces sit outside `Shell`,
so they cannot inherit the rail even if the rail existed. Phase 1 is therefore a
route-home fix, not a navigation redesign.

**Target-size gap (being closed).** The escape controls that rows 1–11 depend on
were not all 44px: the public landing's brand and inline links had no minimum
height until the working tree added `min-height: 44px` / `min-width: 44px`
(`PublicWelcome.css:6,8,9`), and the onboarding brand link did the same
(`Onboarding.css:10`). `BackButton.tsx:42` has been 48×48 throughout. Treat the
target-size part of this table as **fix in flight — verify after land** rather
than as an open defect.

## 7. Specification

**The binding specification is [`docs/design/nav/SPEC.md`](nav/SPEC.md).** It
fixes every number, token, selector and rule. What follows is the shape this
study argued for, retained so the reasoning stays readable next to its evidence.

### 7.1 Phone, below 600px

Keep the bottom pill. Do not add a slide-over drawer. The five targets are
already at the thumb, always visible, and a drawer would duplicate them behind a
gesture that has to be discovered. The failing phone journeys in this study are
not "I cannot reach Settings"; they are "this page has no destination at all"
(§6, rows 1–8), which a drawer cannot fix. The keyboard still dismisses the
pill (`Shell.tsx:204-208`); that behaviour stays.

### 7.2 Rail, 600px and up

| Width | Navigation |
| --- | --- |
| <600px | Bottom pill, unchanged |
| 600–839px | Collapsed rail, 72px, labels in a hover/focus flyout |
| 840–1199px | Collapsed rail 72px **or** pinned panel 224px |
| ≥1200px | Collapsed rail 80px **or** pinned panel 224px |

The rail is a `flex: none` sibling of `<main>` and takes layout space; it is
never `fixed`, `absolute`, or an overlay (`Shell.nav.css:81-88` keeps this).
Pinning changes the row's width in one frame; `<main>` reflows in the same
paint, exactly as the existing layout flip does (`Shell.tsx:105-113`). No
content is ever covered *by the rail*. The flyout is the one deliberate
exception: it is an overlay by design, because covering content for the duration
of a hover is a smaller cost than moving the reading column.

600px is not a new number: it is `COMPACT_MAX_PX`, the single rail gate already
owned by `responsive.ts:19` and consumed by `navLayout.ts:9-12`. 48rem is *not*
adopted as a second breakpoint — at a 32px root it would move to 1536px and
drift from every other layout decision in the app.

### 7.3 Expansion, pinning and hover

- One control at the top of the rail, present only at ≥840px: 44×44px,
  `aria-expanded`, `aria-controls` pointing at the destination list, accessible
  name "Expand navigation" / "Collapse navigation", icon `PanelLeftOpen` /
  `PanelLeftClose` (the same icon family `NavigationSetup.tsx:39-40` already
  uses).
- Focus stays on the control after toggling. No focus trap: this is layout, not
  a modal.
- Expansion is a persisted per-device boolean alongside `navLayout`, default
  collapsed. It is only meaningful when the layout resolves to `"rail"`.
- Rows become icon + visible label, 44px minimum height, 12px gap, labels wrap
  rather than truncate.
- **Hover does not expand the rail in flow.** A 72→224px reflow triggered by
  pointer entry moves the content column under the cursor every time the pointer
  crosses the rail on its way to the page. Hover and keyboard focus open the
  floating flyout instead: 120ms intent delay, labels plus that section's page
  list, positioned over the content, dismissed on leave / `Escape` / scroll /
  blur. Fine pointer only; on keyboard focus it opens without a delay.
- **Esc does not collapse a pinned panel.** Esc dismisses the flyout. A pinned
  panel is saved layout, not a dismissible layer; silently undoing a stored
  preference on Esc is worse than one deliberate click.

`SPEC.md` adds the two rules this section leaves open: what fills the rail's
header slot between 600 and 839 (nothing — see §3 "header slot" there), and the
consequence that in that band a sighted touch reader sees icons only, because
hover does not exist on touch and the pin toggle does not exist yet.

### 7.4 Width and resizing

No drag-resizable rail. The app already has one resizable-pane contract
(`SplitView.tsx:107-168`) with a keyboard-operable separator, clamped bounds and
a per-device store (`panePreference.ts:46,72-80`); a second one for four icons
would be duplication with none of the benefit. The rail has exactly two widths,
72/80px collapsed and 224px expanded, both fixed in `px`. If a future phase
needs a third width, it reuses the `SplitView` separator contract rather than
inventing a new one.

224px is derived, not chosen for looks: 840 − 224 = 616px, still above the
600px content floor. The label budget is arithmetic, not a measurement:
224 − 24px horizontal padding − 20px icon − 12px gap leaves 168px for text
inside the row, and 144px after the row's own 12px insets. "My Reports" at 200%
text therefore has to fit in 144px, and that is the tightest case Phase 2 must
review.

### 7.5 Motion

- **Width: no tween.** Animating `width` is layout work on every frame and
  violates the transform/opacity-only policy (`uiMotion.ts:21-29`). The rail
  snaps in one frame; the content reflows in the same paint.
- **Labels: opacity only**, `motionDurations.fast` (150ms),
  `motionEasings.out` (`uiMotion.ts:38-53`, `uiMotion.ts:55-62`).
- **Reduced motion: instant.** Labels appear without a fade under the same
  effective preference that already drives `MotionConfig` and the nav's CSS
  transitions (`Shell.nav.css:39-49`).
- **The selected pill must not interpolate across the width change.** Its
  shared-layout spring (`motionSprings.snappy`, `Shell.tsx:239-249`) is for
  destination changes; a 72→224px pill crawl on every toggle would read as lag.
- **Flyout:** `fast` fade in, `instant` fade out, no travel.
- **Tooltips:** 350ms delay, `fast` fade, no travel; the delay lives at
  `Shell.tsx:277` (`<TooltipTrigger key={to} delay={350}>`), not in
  `Shell.nav.css`, which only paints the tooltip (`Shell.nav.css:102`). In the
  rail the tooltip is replaced by the flyout; the tooltip remains for the bottom
  pill.

### 7.6 Accessibility and text scale

- 44×44px minimum for every rail control, including the toggle.
- Keyboard order: toggle → destinations → create. The rail is a tab stop in the
  shell before `<main>` because it precedes it in the DOM; the existing
  focus-restore on layout flips stays (`Shell.tsx:66-90`).
- No `aria-expanded` on the `<nav>` itself; the `<nav aria-label="Primary">`
  name is unchanged (`Shell.tsx:285`, `Shell.tsx:304`), and `aria-current="page"`
  stays on the selected link (`Shell.tsx:228`).
- 200% text: labels wrap, rows grow, the panel width does not. Do not introduce
  a `rem` width rule for the expanded state — `4.5rem` at a 32px root is a
  tolerable 144px icon rail, but `14rem` would be 448px of a 600px screen.
- 320dp: the rail never renders there, so the phone layout is untouched. The
  bottom pill already hides labels under a 24rem container query
  (`Shell.nav.css:54-63`).
- Safe areas: the rail sits inside `.fb-app-viewport`, which is the only inset
  owner (`index.css:52-62`). It must not add `env()` of its own.

### 7.7 What the rail must not become

No second navigation level beyond the section's own pages. No section tree. No
badges other than an unread count, which belongs to `TopUtilities`, not the
destination list (`DESIGN_SYSTEM.md:42`). No org, workspace or account switcher.
No command palette. If a future surface needs a list of its own pages, it uses
the existing `SplitView` inside the content, as Settings already does
(`Settings.tsx:176-179`).

## 8. Phased plan

Phase 1 is the live defect and is independent of everything else. Phases 2 and 3
are separated so the rail can be reviewed while it is still opt-in, before it
becomes anyone's default.

**Status at the time of writing:** Phase 1 is in the working tree, unverified;
Phase 2 has not started; the binding contract for Phase 2 is `SPEC.md`.

| Phase | Owner files | Change | Acceptance |
| --- | --- | --- | --- |
| **1. One way home** | `components/BackButton.tsx`, `components/settings/SettingsPrimitives.tsx`, `screens/Legal.tsx`, `screens/SharedReport.tsx`, `screens/Onboarding.tsx` | Optional fallback state on `BackButton`; pass `showPublic` from public legal pages; `utilities={false}` for `publicView`; make the shared-report brand a link in every state; land the onboarding brand link | Cold direct load of `/privacy`, `/terms`, `/community-guidelines` on a device with a saved account **and** with a pending shared-report intent: one action reaches `/` and the public page renders, not `/auth`. No search/bell icons on a public document. From `/onboarding`, the brand reaches `/`. 320px and desktop. |
| **2. Rail, flyout and pin** | `components/Shell.tsx` (`PrimaryNav`), `components/Shell.nav.css`, `components/navLayout.ts`, `appearance.ts` | Pin toggle with `aria-expanded`; 224px labelled panel at ≥840px; persisted `navRailExpanded`; overlay flyout on hover/focus at ≥600px; labels wrap; create becomes a pill and moves after the destinations; keep the rail on nav-hidden routes at ≥600px | Every row of `SPEC.md` §12. Short form: 600/839/840/1199/1200/1440, light/dark/true-black, 100%/200% text, reduced motion, RTL. Content never overlapped except by the flyout; no horizontal scroll at any width ≥600; one tab order; the stored choice survives reload and a breakpoint crossing. |
| **3. Make it the default** | `appearance.ts`, `components/NavigationSetup.tsx` (+ CSS and tests), `docs/DESIGN_SYSTEM.md` | Default `navLayout` to `"rail"`; keep stored `"bottom"` untouched; retire the first-use card because its choice now lives in the rail and in Appearance | Fresh profile at 600/840/1440 lands in the rail; <600px lands on the pill; a stored `"bottom"` stays bottom; no setup card appears at any width; migration of existing stored values is unchanged. |

Do not begin Phase 3 until Phase 2 has rendered review at 600px (collapsed
rail + flyout), at 839px (the last width with no pin toggle) and at 840px with
200% text and the panel pinned — the third is where a 224px panel is most likely
to be refused.

## 9. Risks and recoil

**Hover-reflow punishes tremor and trackpad overshoot — rejected.** The pointer
crosses the rail on the way to the content many times per session; if that
reflows the page, every crossing is a layout event and a missed target. The
overlay flyout gives the same information without moving anything, so the risk
is avoided rather than mitigated. The flyout has its own failure mode — it
covers content while open — accepted because it closes on leave, scroll and
`Escape`, and because it is never open while the reader is reading.

**Resizable panels invite over-persistence and breakpoint bugs — rejected.** A
dragged rail persists into a narrower window, and the app already has one
resizable contract to keep correct. Two fixed widths cannot drift.

**A second navigation level on four destinations becomes ceremony — accepted as
a risk, refused as a design.** The pinned panel may be pinned once and never
touched again. That is acceptable because it is a preference, not a required
step, and because the app's four labels are the entire vocabulary. `SPEC.md` §1
refuses to pad the panel to look like the reference: the Chats panel holds one
row. The line is drawn at adding a section tree to the rail: that is where this
becomes Supabase cosplay.

**A rail by default may surprise a tablet reader who preferred the pill —
accepted with an escape.** The first wide use no longer asks, so the choice must
be visible where it is reversible: Appearance → Navigation
(`AppearanceSettings.tsx:109-135`), plus the rail's own toggle. Existing stored
choices are never overwritten (`appearance.ts:159-175`).

**Retiring the setup card removes the only explanation of the two layouts —
accepted.** The toggle is self-labelling, and the Appearance row still names
both. A card above the feed on every wide visit until answered is a worse cost
than one unlabelled icon. Note the settings-search gap in §5: a reader who
searches "navigation" in Settings will not find that row until its catalogue
keywords grow.

**The expanded panel steals width from the content at 840px — bounded.** 224 of
840 leaves 616px, still above the phone floor; below 840 the toggle does not
exist. Verify at 840 with 200% text, where the label column is tightest.

**Expanding the rail can collapse the Settings split.** `SplitView` already
falls back to one pane when the detail pane would fall below its minimum
(`SplitView.tsx:42-64`). At 840px with the panel pinned the content column is
616px, the reserved list column is 352px at the default root (22rem), 616 − 352
= 264 < `DETAIL_PANE_MIN_PX` (320), so Settings is one pane. At 1024px, 1024 −
224 = 800, 800 − 352 = 448 ≥ 320, so both panes survive. Acceptable, provided it
does not remount drafts and the fallback is reviewed at 1024, the narrowest
width where both a 224px rail and a two-pane Settings can compete.

**The rail is absent on public surfaces, so a "sidebar" cannot be the whole
answer.** This is why Phase 1 ships first and why §6 is a route table rather
than a navigation redesign. A persistent rail only helps readers who are
already inside the shell; the owner's report came from a page outside it.

## 10. Revision log (12 November 2026)

Corrections applied to this study after a read-only verification pass. Each was
checked against the file before editing.

1. **§6 row 6 was factually wrong.** It claimed the public legal routes sit
   inside `RequireAuth` at `App.tsx:231,240`. They do not: `App.tsx:177-179`
   renders `/privacy`, `/terms` and `/community-guidelines` as top-level public
   routes, and `App.tsx:231,240` are `/search` and `/notifications` inside the
   authenticated Shell — the routes `TopUtilities` links to
   (`SettingsPrimitives.tsx:60`, `TopUtilities.tsx:64,67`). The row now says
   what actually happens: the documents are public, and their chrome carries two
   controls that eject a signed-out reader into auth.
2. **Row 1 citation moved** from `Onboarding.tsx:77` to `:78`, which is the
   `<Link>` line.
3. **Row 11 is qualified.** A history-aware back button is not a home link:
   `BackButton.tsx:22-27` walks history when `historyDepth() > 0`, and
   `:35` relabels itself "Back". `Help.tsx:327` falls back to `/profile`,
   `Messaging.tsx:1646` links to `/chats`. The row now says so plainly.
4. **Tooltip timing** lives at `Shell.tsx:277` (`delay={350}`), not in
   `Shell.nav.css`, which only paints the tooltip (`:102`).
5. **Row 2 caveat added:** `StartScreen` resolves `needsProfile` before
   `showPublic` (`App.tsx:92-99`), so `AuthShell`'s home link alone does not
   prove every profile-completion state reaches the public page.
6. **Rows 3, 4, 5, 8 and the target-size gap** are marked "fix in flight —
   verify after land": the working tree already passes `backState` from
   `Legal.tsx:28,108,219`, threads it through `BackButton.tsx:9,26`, passes
   `utilities={!publicView}` (`Legal.tsx:29,109,220`) and links the
   shared-report brand in every state (`SharedReport.tsx:44`). None of it has
   been verified by a run.

Also corrected while checking the file: `navLayout.ts:17-29` → `:18-30`;
`AppearanceSettings.tsx:108-135` → `:109-135`; `Settings.tsx:175-179` →
`:176-179`; `SplitView.tsx:42-62` → `:42-64` and `:139-168` → `:107-168`;
`panePreference.ts:24-30,90-97` → `:46,72-80`; `uiMotion.ts:38-46` → `:38-53`;
the bogus `services/destinations.ts:125-127` citation replaced with the
settings-search finding in §5; §1 and §7.3 rewritten from "hover shows a
tooltip" to "hover opens an overlay flyout" so the recorded recommendation
matches the decision.
