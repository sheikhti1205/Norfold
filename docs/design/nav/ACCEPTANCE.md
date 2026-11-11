# Navigation acceptance matrix

Acceptance contract for the expandable rail. Written 12 November 2026 against
source at `main` before the rail implementation exists, so the test anchors in
§0.3 are part of the deliverable: an implementer must provide them, and a
reviewer must not invent selectors of their own.

The design being accepted (do not redesign it here):

- Collapsed in-flow rail from 600px: 72px at 600–1199, 80px at ≥1200, icons only.
- Hover **or** keyboard focus opens a floating flyout with labels and the
  section's list. It never reflows the content column.
- A toggle, present only at ≥840px, pins a 224px in-flow labelled panel; the
  choice persists per device as `navRailExpanded`.
- Below 600px the existing bottom pill is unchanged. No drawer.

Where this document and `docs/design/NAVIGATION-STUDY.md` disagree, this one
wins: §7.3 rejects hover-expansion entirely and the decided design includes it.
Everything else in §7 still binds (44px targets, no width tween, no focus trap,
create-action order, tooltip suppression while pinned).

## What must be true for this to ship

1. At every width from 320 to 1440 the navigation resolves to exactly one of
   three states — absent, 72/80px rail, 224px pinned panel — with no fourth
   state, no overlap and no horizontal scroll.
2. The content column's measured width changes only on an explicit pin/unpin
   or a breakpoint crossing, never on hover, focus, flyout open or flyout close.
3. Every destination is reachable by pointer, by keyboard and by screen reader
   at every width, in one tab order, with no focus trap.
4. The phone pill's geometry and targets are byte-for-byte what ships today.
5. The flyout and the panel are legible and operable at 200% text in all three
   themes without truncation, overflow or badge collision.
6. Contrast meets WCAG 2.2 AA against measured tokens, not against intent.
7. Reduced motion renders the final state on first paint with zero transition
   frames.
8. Four public escape hatches reach `/` and render the public page — never
   `/auth` — with a saved account and a pending shared-report intent present.
9. Offline, reconnecting, 99+ unread, empty inbox, empty chats and a forbidden
   destination all leave the navigation intact and operable.
10. Every row below is executed and its evidence recorded; anything unrun is
    reported as unrun, never as passed.

## 0. How to execute this matrix

### 0.1 Lanes

| Lane | What it proves | How to run |
| --- | --- | --- |
| **V** — vitest/jsdom | Resolver, persistence, migration, conditional rendering, keyboard handlers, DOM contract | `heavy-run npm run test -w apps/mobile -- <file>` |
| **P** — Playwright, rendered | Geometry, widths, contrast, text scale, motion sampling, screenshots | A `capture-accept.mjs`-shaped harness (§0.4) against a preview server |
| **S** — static/AST | Selector and route inventory only; never a substitute for V or W | `grep`/`tsc` |

Every `npm`/`npx`/`vitest`/Playwright invocation goes through
`~/.config/opencode/bin/heavy-run` (project rule 9). One heavy command at a
time machine-wide.

### 0.2 Preconditions

| ID | Precondition | Exact setup |
| --- | --- | --- |
| PRE1 | Preview server | `heavy-run npm run build -w packages/shared && heavy-run npm run build -w apps/mobile`, then `heavy-run npm run preview -w apps/mobile`; `CAPTURE_BASE` points at it. Build env must carry non-empty `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_PUBLIC_SHARE_ORIGIN` (project rule 2). |
| PRE2 | Signed-in session | Local Supabase stack (`npx supabase start`) with one confirmed, profile-complete user. Sign in once through `/auth`, save `storageState`, reuse for every shell row. Real accounts are out of scope (see Known gaps). |
| PRE3 | Appearance seed | Before first paint: `localStorage["findback.appearance.v1"] = JSON.stringify({ accent:"blue", textScale:"standard", reduceMotion:"system", highQualityPhoto:false, navLayout:"rail", navLayoutChosen:true, navRailExpanded:false })`. Rows that test another value say so. |
| PRE4 | Theme seed | `localStorage["findback.theme"] = JSON.stringify({ theme:"light"\|"dark", trueBlackDark:false\|true })`, applied before navigation. |
| PRE5 | Text scale 200% | `document.documentElement.style.fontSize = "32px"` after load, then wait 400ms. Pass only if `getComputedStyle(document.documentElement).fontSize === "32px"`. |
| PRE6 | Network stubs | `page.route("**/rest/v1/rpc/findback_notification_count_client", …)` for unread counts; `page.route("**/api/share/*", …)` for shared previews; `context.setOffline(true)` for offline rows. |

### 0.3 Test anchors the implementation must provide

The matrix depends on these and only these. Existing selectors are reused where
they already exist.

| Anchor | Element | Notes |
| --- | --- | --- |
| `nav[aria-label="Primary"]` | the one primary nav | exists (`Shell.tsx:285`, `:304`) |
| `[data-layout="rail"\|"bottom"]` | nav variant | exists |
| `[data-nav-toggle]` | pin toggle, **only** rendered at ≥840 | new; `aria-expanded`, `aria-controls="nf-rail-list"`, 44×44 min |
| `#nf-rail-list` | destination list inside the rail | new; toggle's `aria-controls` target |
| `[data-nav-flyout]` | floating label overlay | new; **absent from the DOM when closed**, no `hidden` attribute state to interpret |
| `[data-nav-expanded="true"\|"false"]` | on the rail element | new |
| `main#nf-main` | content column, skip-link target | new `id`; `tabIndex="-1"` |
| `[data-nav-skip]` | skip link, first focusable in the shell | new |
| `.fb-split-view`, `.fb-split-wide`, `.fb-split-list[hidden]`, `.fb-split-detail[hidden]` | Settings split | exist |
| `[data-testid="notifications-unread-badge"]` | unread badge | exists |
| `a[href="/"], a[href="/my"], a[href="/chats"], a[href="/settings"]` | destinations | exist |

### 0.4 Measurement vocabulary

Same names and shapes as
`%TEMP%\opencode\onboarding-audit\capture-accept.mjs`, so one `metrics.json`
holds both campaigns.

| Metric | Definition |
| --- | --- |
| `rect(el)` | `getBoundingClientRect()` rounded, `y` includes `scrollY`; `null` when the element is missing |
| `cs(el)` | `getComputedStyle(el)` |
| `identity(t)` | `t === "none" \|\| t === "matrix(1, 0, 0, 1, 0, 0)"` |
| `mainW()` / `mainX()` | `main#nf-main` width / left edge |
| `railW()` | `nav[aria-label="Primary"]` width |
| `overflowProbe` | `body *` with `scrollWidth > clientWidth + 2` whose `overflow-x` is neither `auto` nor `scroll`, sliced to 8 |
| `horizontalOverflow` | `documentElement.scrollWidth > clientWidth + 1` |
| `under44` | visible `a,button,summary` with `w < 44 \|\| h < 44` |
| `motionSettled` | every sampled `[style*=opacity],[style*=transform]` has `identity(transform)` and `opacity > 0.98` |
| `motionUnsettled` | the first 8 elements failing the above |
| `errors` | `pageerror` strings + console `type=error`, sliced to 8 |
| `firstPaint` | `MEASURE` captured before any settle wait or scroll |
| `frames(selector, ms)` | `{t, transform, opacity}` sampled every `requestAnimationFrame` (the harness's `drawTimeline`) |
| `contrast(a, b)` | WCAG 2.x relative-luminance ratio computed in-page from two `rgb()` strings |

Geometry tolerance is **±0.5px** for every width/height assertion; anything
larger is a failure, not rounding.

Style codes used in the tables: **L** light, **D** dark, **B** true black
(`trueBlackDark:true`); **1x** root 16px, **2x** root 32px; **full** /
**reduce** motion. Rows headed "L/D/B" are executed three times with the same
assertions; "1x/2x" twice.

---

## 1. Breakpoints

Route `/` (Home, wide canvas, `main` is `w-full` so `mainW()` is the true
available column). Baseline: PRE2+PRE3+PRE4, motion **full**, text **1x**, theme **L**.
Expected rail width and `mainW()` are exact; `mainX()` equals the rail width.

| ID | Viewport (w×h) | Expected rail | Toggle | `mainW()` collapsed | `mainW()` pinned | Pass criterion | Measure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | 320×568 | absent | none | 320 | n/a | `rail() === null`; pill present; no `position:fixed` element contains a `nav[aria-label="Primary"]` or a destination link; `horizontalOverflow === false` | `railW() === null`; `document.querySelectorAll('nav[aria-label="Primary"] a[href]').length === 4`; for each `a[href]` walk ancestors for `cs(el).position === "fixed"` — none |
| B2 | 411×823 | absent | none | 411 | n/a | same as B1 | same |
| B3 | 599×800 | absent | none | 599 | n/a | same as B1, and with `navRailExpanded:true` stored the rail still does not render | seed PRE3 `navRailExpanded:true`, `rail() === null`, `mainW() === 599 ±0.5` |
| B4 | 600×800 | 72 | none | 528 | n/a | `railW() === 72`; `mainW() === 528`; `mainX() === 72`; `toggle() === null`; `horizontalOverflow === false` | `railW()`, `mainW()`, `mainX()`, `overflowProbe` empty |
| B5 | 767×800 | 72 | none | 695 | n/a | `railW() === 72`; `mainW() === 695`; `mainX() === 72`; `toggle() === null` | as B4 |
| B6 | 768×1024 | 72 | none | 696 | n/a | `railW() === 72`; `mainW() === 696`; `toggle() === null` (768 is below the pin gate) | as B4 |
| B7 | 839×1024 | 72 | none | 767 | n/a | `railW() === 72`; `mainW() === 767`; `toggle() === null` | as B4 |
| B8 | 840×1024 | 72 | present | 768 | 616 | `railW() === 72`; `mainW() === 768`; `toggle()` present and `aria-expanded === "false"`; after pin `railW() === 224`, `mainW() === 616` | pin via `toggle().click()`, `waitForTimeout(250)`, re-measure |
| B9 | 1023×768 | 72 | present | 951 | 799 | `railW() === 72`; `mainW() === 951`; toggle present | as B8 |
| B10 | 1024×768 | 72 | present | 952 | 800 | `railW() === 72`; `mainW() === 952`; after pin 224 / 800 | as B8 |
| B11 | 1199×800 | 72 | present | 1127 | 975 | `railW() === 72` (1199 is still the 72px band); after pin 224 / 975 | as B8 |
| B12 | 1200×800 | 80 | present | 1120 | 976 | `railW() === 80`; `mainW() === 1120`; after pin 224 / 976 | as B8 |
| B13 | 1440×900 | 80 | present | 1360 | 1216 | `railW() === 80`; `mainW() === 1360`; after pin 224 / 1216; rail height `=== 900 ±0.5` | as B8 plus `rail().getBoundingClientRect().height` |
| B14 | 600×800, fresh profile | 72 | none | 528 | n/a | With `findback.appearance.v1` **absent**, `/` renders the rail, not the pill: `railW() === 72`, pill absent. This is the decided default (Phase 3), not an opt-in | clear storage, no PRE3 seed, `railW()`, `document.querySelectorAll('[data-layout="bottom"]').length === 0` |
| B15 | 599×800, fresh profile | absent | none | 599 | n/a | Same fresh profile renders the pill: `rail() === null`, `[data-layout="bottom"]` count 1 | as B14 |
| B16 | 1440×900, stored `navLayout:"bottom"` | pill | none | 1360 | n/a | A stored `"bottom"` is never overwritten: `rail() === null`, `[data-layout="bottom"]` count 1, `mainW() === 1440` | seed PRE3 with `navLayout:"bottom"`, measure |

Rows **B1–B16**: theme L, text 1x, motion full. B3, B8–B13 additionally repeat`n  in dark (**D**) and true-black (**B**) (a rail that only reads in light mode is a failure).

**No horizontal scroll is a standing criterion for every row in this document**
unless the row says otherwise: `horizontalOverflow === false` and
`overflowProbe === []`.

---

## 2. The flyout

Route `/` at 1024×768 (rail 72, toggle present but unpinned) unless stated.
Baseline: PRE2+PRE3 (`navRailExpanded:false`)+PRE4, theme L, text 1x, motion full.

| ID | State / action | Pass criterion | Measure |
| --- | --- | --- | --- |
| F1 | Pointer enters a rail row, sample at **100ms** | Flyout **not** open: `flyout() === null` | `page.mouse.move(rowCentre.x - 20, rowCentre.y)` then `page.mouse.move(rowCentre)`, `waitForTimeout(100)`, assert absent |
| F2 | Same pointer, sample at **400ms** | Flyout **open**: `flyout() !== null`, and it contains a link whose `textContent.trim()` equals the hovered destination's label | `waitForTimeout(300)` after F1, then `flyout().querySelectorAll('a[href]')` labels |
| F3 | Pointer passes through the rail in **<150ms** to the content | Flyout never opens; content does not move | `mouse.move(rail, …)` then immediately `mouse.move(mainCentre)` with ≤150ms between; assert `flyout() === null` at 50ms and at 400ms |
| F4 | Pointer leaves rail **into the flyout** and stays 1000ms | Flyout stays open for the whole second; no close-then-reopen flicker | park pointer on the flyout's centre, sample `flyout() !== null` at 100ms intervals ×10 |
| F5 | Pointer leaves the rail **and** the flyout | Flyout closes within 300ms and stays closed | park pointer at `mainX()+40`, sample at 150ms and 400ms; both absent |
| F6 | Hover-out grace | The interval in which the flyout survives outside both surfaces is **≤200ms**: at 210ms after leaving both, `flyout() === null` | single sample at 210ms |
| F7 | `Escape` pressed while the flyout is open | Flyout closes within one frame (`flyout() === null` before the next `requestAnimationFrame` resolves); focus stays on the rail link that had it (`document.activeElement.getAttribute('href')` unchanged) | `keyboard.press("Escape")`, read `document.activeElement` |
| F8 | Keyboard focus reaches a rail destination | Flyout opens with **no** intent delay: `flyout() !== null` in the same task as the `focusin` | `page.evaluate(() => link.focus())`, assert immediately |
| F9 | Content scroller scrolled while the flyout is open | Flyout closes within 100ms; the scroll itself is not blocked (`scrollTop` reached the requested value) | set `main`'s scroller `scrollTop = 200`, dispatch, wait 100ms |
| F10 | Focus moves from the rail into the content (`Tab`) | Flyout closes; focus is on a `main` descendant | press `Tab` until `main.contains(document.activeElement)`, assert `flyout() === null` |
| F11 | `navRailExpanded:true` at 1024 (pinned) | **Suppressed:** hovering each of the four rows for 600ms never creates `[data-nav-flyout]`, and no `[role="tooltip"]` appears | loop 4 rows × 600ms |
| F12 | **No layout shift**: sample `mainW()` and `mainX()` before, during and after | All three samples identical ±0.5px; `main`'s inner scroller `scrollTop` unchanged | sample 1 before entry, 2 at F2 (open), 3 at 400ms after F5 (closed) |
| F13 | Flyout never covers the content it is anchored to | `flyout().getBoundingClientRect().left >= railW() - 1` and the flyout's computed `position` is `absolute` or `fixed` | `cs(flyout()).position` |
| F14 | Flyout is not a second navigation level | The flyout's links are exactly the four destination hrefs plus, at most, the create action — no nested section tree, no group of sub-pages (§7.7) | set of `flyout().querySelectorAll('a[href]')` hrefs ⊆ `{"/","/my","/chats","/settings","/report"}` |
| F15 | Flyout content is not focus-trapped and not modal | `flyout()` has no `role="dialog"`, no `aria-modal`; `Tab` from the last flyout link reaches content | attribute read + Tab walk |

Same rows re-run at **600×800** (no toggle) and **1440×900** (80px rail) for
F1, F2, F5, F7, F12 — a pass requires all three viewports.
Theme L, text 1x, motion full.

---

## 3. The pinned panel

Route `/`. Baseline: PRE2+PRE4, theme L, text 1x, motion full, `navRailExpanded`
as stated per row.

| ID | Viewport | State / action | Pass criterion | Measure |
| --- | --- | --- | --- | --- |
| P1 | 839×1024 | unpinned | `toggle() === null` — the control does not exist one pixel below the gate | `document.querySelectorAll("[data-nav-toggle]").length === 0` |
| P2 | 840×1024 | unpinned | `toggle()` exists, `rect(toggle()).w >= 44 && h >= 44`, `aria-expanded === "false"`, `aria-controls` resolves | `document.getElementById(toggle().getAttribute("aria-controls")) !== null` |
| P3 | 840×1024 | click toggle | `railW() === 224`; `mainW() === 616`; `aria-expanded === "true"`; toggle stays focused (`document.activeElement === toggle()`) | `rect`, attribute read |
| P4 | 840×1024 | reload after P3 | Still pinned: `railW() === 224`, `aria-expanded === "true"`, and `JSON.parse(localStorage["findback.appearance.v1"]).navRailExpanded === true` | `page.reload({waitUntil:"networkidle"})` |
| P5 | 840×1024 | second click (unpin) | `railW() === 72`; `mainW() === 768`; `navRailExpanded === false`; focus on the toggle | as P3 |
| P6 | 840×1024 | repin after unpin | `mainW() === 616` again — the 616 figure must be restored exactly, not approximated | as P3 |
| P7 | 1024×768 | pin | `railW() === 224`; `mainW() === 800`; no horizontal scroll | `railW()`, `mainW()`, `overflowProbe` |
| P8 | 1440×900 | pin | `railW() === 224`; `mainW() === 1216` | as P7 |
| P9 | 840×600, text **2x** | pin, rail overflow | The rail is the only nav scroller (`overflowProbe === []`, `rail.scrollHeight > rail.clientHeight` allowed). After `rail.scrollTop = rail.scrollHeight`, the last destination is fully inside the rail's client box, and the toggle is still fully visible (undo must never scroll away) | `rect(lastLink).bottom <= rect(rail).bottom + 0.5`; `rect(toggle).top >= rect(rail).top - 0.5` |
| P10 | 840×600, text **2x** | labels in the pinned panel | Every destination label wraps, never truncates: for each label `scrollWidth <= clientWidth + 1`, `cs(label).textOverflow !== "ellipsis"`, and `textContent.trim()` is the exact label | per-label read |
| P11 | 840×1024 | persistent label list | All four destination labels are visible in the panel (not `sr-only`): each label `rect().w > 0 && rect().h > 0` and not clipped by `clip-path` | `cs(label).clipPath === "none"` and `position !== "absolute"` |
| P12 | 840×1024 | tooltip suppression | With the panel pinned, no `[role="tooltip"]` is created for any destination on hover or focus | hover each row 600ms; `document.querySelectorAll('[role="tooltip"]').length === 0` |
| P13 | 840×1024 | create action | `Create report` is a full-width pill with the plus icon **and** the label, and it appears **after** the destinations in DOM order | `createAction.getBoundingClientRect().width >= 200`; `compareDocumentPosition` puts the last destination before it; label text present |
| P14 | 1024×768 | persistence is per device, not per account | Sign out, sign in as a different seeded user on the same profile: `navRailExpanded` is still `true` | re-run P4 after account switch in the same `storageState` |
| P15 | any | migration | A stored appearance blob with `navRailExpanded` missing loads `false`; `"true"` (string) loads `false`; valid boolean preserved with every other field intact | Lane V: `migrateAppearance` unit test |
| P16 | any | width is never animated | `frames('nav[aria-label="Primary"]', 400)` during a pin shows a single distinct width value (one frame), not a ramp | sample `rail.getBoundingClientRect().width` every rAF; distinct values === 1 |
| P17 | any | selected pill does not crawl across the width change | During a pin, `frames('.fb-nav-active-bg', 400)` returns an identity transform on every sample *or* no transform at all; there is no interpolating `x/width` | `motionSettled` at 0ms; `getAnimations()` on the pill has length 0 |

---

## 4. The phone pill

No rail, no toggle, no flyout below 600. Baseline: PRE2+PRE3, theme L, text 1x,
motion full, viewport 411×823 unless stated.

| ID | State / action | Pass criterion | Measure |
| --- | --- | --- | --- |
| M1 | geometry at 411×823 | `pillHeight === 58 ±0.5`; create button `52×52 ±0.5`; slot bottom edge `=== 823 - safeAreaBottom` | `rect(".fb-nav-pill")`, `rect(".fb-nav-create")`, `rect(".fb-nav-slot")` |
| M2 | targets | Every pill link `w >= 44 && h >= 48`; `under44 === []` | the harness's `under44` |
| M3 | selection geometry | Exactly one link has `aria-current="page"`, and at 480×900 (labels shown, see M5) the selected link's width is at least 1.8× the narrowest unselected link | `rect` per link at 480 |
| M4 | label hiding at 320 | Container (`.fb-nav-row`, inline-size) is 288px < 24rem at 1x → the selected label is clipped: `cs(label).position === "absolute"` and `clipPath !== "none"` | `cs` on `.fb-nav-pill .fb-nav-label`, plus `rect(".fb-nav-row").w` |
| M5 | label threshold at 1x | At 411 the row container is `411 − 32 = 379 < 384` → label **hidden**; at 480 it is `480 − 32 = 448 > 384` → label **shown** and unclipped (`scrollWidth <= clientWidth + 1`) | same measurement at both widths |
| M6 | label at 2x | Root 32px makes `24rem = 768px`, so at 480 the container (448) is still below it → label hidden and targets stay ≥44×48 | PRE5 then M2 at 480 |
| M7 | safe area | With `--safe-area-inset-bottom:34px` injected on `documentElement`, the create button's `bottom <= innerHeight - 34 + 0.5` and the pill's height is unchanged | set the CSS var before paint, measure |
| M8 | keyboard/IME (host) | With a focused `<textarea>` and `visualViewport.height` mocked 200px below `innerHeight`, the pill is **not rendered** (`[data-layout="bottom"]` absent); with no shrinkage it **is** rendered | Lane V unit test: mock `visualViewport`, focus a field, assert `PrimaryNav` returns `null` |
| M9 | keyboard/IME (host, negative) | With a focused field and **no** viewport shrink on a non-Android platform, the pill stays rendered | same test, unshrunk `visualViewport` |
| M10 | no drawer, no overlay nav | Below 600, no element with `position:fixed` carries a destination link, and there is no `[data-drawer]`, `[data-nav-flyout]` or `role="dialog"` owned by navigation | scan `nav` ancestors and `position` |
| M11 | fullscreen editor | With `#report-editor-overlay` present, both pill and rail are `display:none` (existing rule must not be lost) | `cs(".fb-nav-slot").display === "none"` |
| M12 | route hide/show unchanged | Navigating `/` → `/help` removes the pill and does not animate layout: `mainW()` is 411 before and after; no intermediate width in `frames("main", 300)` | sample `mainW()` each rAF |

---

## 5. Keyboard and screen reader

Route `/` at 840×1024, theme L, text 1x, motion full, unpinned, unless stated.
"Accessibility tree" = Playwright role queries, which read the computed
name/role/state — not a substitute for a real screen reader (see Known gaps).

| ID | State / action | Pass criterion | Measure |
| --- | --- | --- | --- |
| K1 | first `Tab` after load | Focus lands on `[data-nav-skip]`, which is visually revealed (`rect().h > 0`, not `clip-path: inset(50%)`) | `keyboard.press("Tab")`, read `activeElement`, `cs` |
| K2 | skip link activated | `Enter` moves focus to `main#nf-main` (`document.activeElement === main`), and `main` is scrolled into view | `activeElement` identity |
| K3 | tab order, collapsed rail | Exact order: skip → toggle → `/` → `/my` → `/chats` → `/settings` → create → content. Assert by 8 successive `Tab` presses collecting `activeElement` | array of `href`/`data-*` per press |
| K4 | tab order, phone pill | Exact order: skip → `/` → `/my` → `/chats` → `/settings` → create → content (create is **after** destinations in both layouts) | same, at 411×823 |
| K5 | focus is visible | Each focused rail control matches `:focus-visible` and its outline is `>= 2px` at `>= 3:1` against both the control and its background | `cs(el).outlineWidth`, `contrast()` (see §6) |
| K6 | no focus trap in the rail | 20 consecutive `Tab` presses produce at least one focused element inside `main`, and the focused set is not a permutation of only rail elements | collect 20 `activeElement`s, assert `main.contains` for ≥1 |
| K7 | `aria-expanded` lives on the toggle only | `toggle().getAttribute("aria-expanded")` ∈ `{"true","false"}`; `nav[aria-label="Primary"].hasAttribute("aria-expanded") === false` | attribute read |
| K8 | `aria-controls` resolves | `document.getElementById(toggle().getAttribute("aria-controls"))` is the element containing the four destination links | identity check |
| K9 | accessible names | `getByRole("navigation", {name:"Primary"})` resolves to exactly 1; `getByRole("link", {name:"Home"/"My Reports"/"Chats"/"Settings"})` each resolve to exactly 1 in **both** collapsed and pinned states | role queries |
| K10 | `aria-current` | Exactly one `[aria-current="page"]` exists; for `/settings/account` it is the `/settings` link; for `/chats/x` it is `/chats`; for `/profile` it is `/settings`; for `/search` it is `/` | navigate then query |
| K11 | collapsed rail is still named | In the collapsed rail each destination link's computed accessible name is the label (via `sr-only` or `aria-label`), not empty and not the icon's `aria-hidden` text | `getByRole("link", {name:label}).count() === 1` |
| K12 | `Escape` returns focus | Open the flyout from a focused `/my` link, press `Escape`: `activeElement.getAttribute("href") === "/my"` | as F7 |
| K13 | route change keeps nav focus semantics | Activating `/chats` from the rail moves focus into `main` (route heading), and the rail link is `aria-current="page"` | `activeElement` inside `main`; `[aria-current]` href |
| K14 | panel and flyout are not modal | Neither carries `aria-modal`, `role="dialog"`, or `inert` on `main` | attribute scan on `main` and both layers |
| K15 | focusable inventory | Exactly one of each: at ≥840 (pinned or unpinned) the rail holds 1 toggle + 4 links + 1 create = 6 focusables; at 600–839 it holds 4 links + create = 5. No duplicate or kept-alive pill contributes extra destinations | `nav[aria-label="Primary"] a[href], nav[aria-label="Primary"] button` count per state |
| K16 | reduced focus-loss protection across a layout flip | At 600/599 boundary flip, if focus was on a destination it lands on the same `href` in the new layout rather than `<body>` | focus `/my`, resize 600→599→600, read `activeElement` |

---

## 6. Themes and contrast

Thresholds are WCAG 2.2 AA: **4.5:1** for text (1.4.3), **3:1** for icons,
borders, focus indicators and other graphical objects (1.4.11, 2.4.11).
Ratios below are computed from the canonical tokens in
`design/colorSystem.ts`; the row passes when the measured ratio is
`>= threshold` **and** within ±0.05 of the expected value (a mismatch means the
wrong token was used).

Flyout surface: `--fb-surface-container-low` (#ffffff L, #202124 D/B).
Content surface behind it: `--fb-surface` (#f8f9fa L, #18191b D, #000000 B).

| ID | Pair (component vs background) | Threshold | L | D | B | Measure |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Rail icon default: `--fb-on-surface-variant` on `--fb-surface` | 4.5 (the icon is the only visible name when collapsed) | 7.76 | 9.13 | 10.90 | `contrast(cs(icon).color, cs(rail).backgroundColor)` |
| C2 | Rail icon on hover layer (`--fb-primary-hover-layer` over surface) | 3.0 | 6.48 | 7.36 | 9.56 | move pointer over the row, then read both colours |
| C3 | Active row: `--fb-on-primary-container` on `--fb-primary-container` | 3.0 icon, 4.5 label | 11.87 | 7.23 | 7.23 | navigate to `/my`, read both |
| C4 | Flyout body text: `--fb-on-surface` on flyout surface | 4.5 | 15.42 | 14.47 | 14.47 | `contrast` |
| C5 | Flyout group/section label: `--fb-on-surface-variant` on flyout surface | 4.5 | 8.18 | 8.35 | 8.35 | `contrast` |
| C6 | Flyout boundary: `--fb-outline` vs flyout surface | 3.0 | 4.45 | 5.02 | 5.48 | `contrast(cs(flyout).borderTopColor, cs(flyout).backgroundColor)` |
| C7 | Flyout boundary: `--fb-outline` vs the content surface immediately outside | 3.0 | 4.69 | 5.48 | 6.54 | `contrast(borderColor, cs(content surface).backgroundColor)` |
| C8 | Focus ring: `--fb-primary` vs the surface it sits on | 3.0 | 5.07 | 10.38 | 12.39 | read `outlineColor` while `:focus-visible` |
| C9 | Unread badge: `--fb-on-error` on `--fb-error` | 4.5 | ≥4.5 by token contract | ≥4.5 | ≥4.5 | read the badge's own colours with a stubbed 99+ count |
| C10 | Active-row contrast holds for **all eight accents** (blue, indigo, violet, emerald, teal, rose, orange, mono) | 3.0 icon / 4.5 label | worst recorded | worst recorded | worst recorded | loop accents via PRE3, record minimum; a failure names the accent |
| C11 | True-black surfaces: rail and flyout paint the amoled tokens, not the dark ones | binary | n/a | n/a | `cs(rail).backgroundColor === "rgb(0, 0, 0)"` **and** `cs(flyout).backgroundColor === "rgb(32, 33, 36)"` | computed colours |
| C12 | No semantic status colour leaks into navigation: no nav descendant resolves to a `--fb-lost-*`, `--fb-found-*` or `--fb-status-*` value | binary | binary | binary | `cs(el).color` of every nav descendant is compared against the functional-palette hex list; intersection must be empty |

C1–C12 run at 1024×768, text 1x, motion full. C1, C4, C6 re-run at 840×1024
pinned (the 224px panel must not change the token pairs).

---

## 7. Text scale (200%)

Root font 32px (PRE5) at every breakpoint. The rail width stays **72/80px** and
the panel stays **224px** — the rail is sized in px by design; only text grows.

| ID | Breakpoint | Failure mode under test | Pass criterion | Measure |
| --- | --- | --- | --- | --- |
| T1 | 600×800 | Collapsed rail icon-only ambiguity | All four links still resolve by accessible name; icon `rect().w === 22 ±0.5` (not scaled, not clipped) | role query + icon rect |
| T2 | 840×1024 | Label truncation in the pinned panel | Every label `scrollWidth <= clientWidth + 1`, `textOverflow !== "ellipsis"`, full text present (P10) | per-label read |
| T3 | 840×1024 | Row height growth | Every destination row `h >= 44`; rows grow rather than clip: `labelRect.h >= 1.15 * fontSize` for a single-line label and `>= 2 * lineHeight` if it wraps | rect + `cs().lineHeight` |
| T4 | 840×1024 | Panel/rail overflow | `overflowProbe === []`; `horizontalOverflow === false`; the rail's own scroller is the only overflow | harness metrics |
| T5 | 840×600 | Panel scroll (P9) | Last destination reachable; toggle still visible (P9) | as P9 |
| T6 | 840×1024 | Badge collision | Stub unread = 120 → badge text is `99+`; `badgeRect` does not intersect the search utility's rect and does not intersect any rail icon rect; `badgeRect.right <= innerWidth` | rect intersection === 0 |
| T7 | 600×800 | Flyout label overflow | Flyout labels satisfy T2's per-label rule; flyout width `>= 224` and `<= 320`; `overflowProbe === []` within the flyout | per-label + rect |
| T8 | 320×568 | Phone pill at 200% | Labels hidden (M4 rule), targets `>= 44×48`, `under44 === []`, no row wrap | M2 at 2x |
| T9 | 1440×900 | No reflow at scale | `railW()` still 72/80 and `mainW()` still 1360/1216 at 2x — text scale must not change rail width | `railW`, `mainW` |
| T10 | 840×1024 | Create action at 2x | Create pill label does not truncate (`scrollWidth <= clientWidth + 1`) and its height `>= 44` | per-element read |

T1–T10: theme L, motion full. T2, T6, T7 re-run in **B** (true black) — a
contrast failure that only appears at scale is still a failure.

---

## 8. Routes

Baseline: PRE2+PRE3+PRE4, theme L, text 1x, motion full.

| ID | Route · viewport | State / action | Pass criterion | Measure |
| --- | --- | --- | --- | --- |
| R1 | `/posts/:id` · 600×800 | direct load | Rail present: `railW() === 72`, `mainW() === 528`; the report is readable in 528px with no horizontal scroll | `railW`, `mainW`, `overflowProbe` |
| R2 | `/posts/:id` · 599×800 | direct load | No rail and no pill (current nav-hidden behaviour below 600): `document.querySelectorAll('nav[aria-label="Primary"]').length === 0`; the back affordance exists | nav count + `getByRole("button", {name:/back/i})` |
| R3 | `/posts/:id` · 1024×768 | pinned | `mainW() === 800`; the post's media does not overflow | `mainW`, `overflowProbe` |
| R4 | `/help` · 1024×768 | direct load | No primary nav at any width (`/help` owns its composer chrome): nav count 0; its own "Skip to composer" link is the first tab stop | `querySelectorAll` + Tab |
| R5 | `/chats/:id` · 600×800 | thread open | No nav (existing `<840` rule preserved); does not regress to a rail | nav count 0 |
| R6 | `/chats/:id` · 840×1024 | thread open | Rail present, 72px; `mainW() === 768` | `railW`, `mainW` |
| R7 | `/settings` · 840×1024, **pinned** | split view | Falls back to one pane: `.fb-split-wide` absent, `.fb-split-detail[hidden]` present (`.fb-split-list` visible) | class/attribute read |
| R8 | `/settings` · 840×1024, unpinned | split view | Two panes: `.fb-split-wide` present, `.fb-split-detail:not([hidden])` | class/attribute read |
| R9 | `/settings` · 1024×768, **pinned** | split view | Two panes still: content 800 − 352 = 448 ≥ 320, so `.fb-split-wide` present | class/attribute read |
| R10 | `/settings/account` · 1024×768 | draft survival across a pin | Type into the display-name field, pin the rail (800px content), unpin: the field's `value` is unchanged and focus is not moved out of the form | `inputValue()` before/after; `activeElement` |
| R11 | `/` · 1024×768 | scroll restoration | Scroll the feed to `scrollTop = 400`, navigate to `/my`, press back: `scrollTop` is `400 ±2` | scroller read |
| R12 | `/` · 1024×768 | pin does not reset scroll | With `scrollTop = 400`, pin the rail: `scrollTop` stays `400 ±2`; unpin: stays `400 ±2` | read before/during/after |
| R13 | `/settings` · 1024×768 | focus restoration | Focus a Settings row, navigate to `/settings/account`, press back: focus returns to that row (or the heading, if the row is no longer rendered) and is never `<body>` | `activeElement` |
| R14 | any · layout flip | focus restoration across a breakpoint | 1024→839 with focus on `/chats`: `activeElement.getAttribute("href") === "/chats"` | resize, read |
| R15 | `/` · 1440×900 | masonry column count reflects the reduced canvas | With the rail pinned, the feed measures its own canvas: card width `>= 260` (the `masonryColumns` floor) at every column | `rect` of first card in each column |
| R16 | `/search`, `/`, `/chats`, `/my` · 1440×900 pinned | wide-canvas routes still fill | `mainW() === 1216` for each of the four wide-canvas routes | loop routes |

---

## 9. Escape hatches

Every row: a **saved account** exists
(`localStorage["findback.rememberedAccounts"] = {"version":1,"accounts":[{"id":"u1","username":"tester","displayName":"Test User","loginEmail":"t@example.com","lastUsedAt":<now>}]}`)
**and** a **pending shared-report intent** exists
(`sessionStorage["findback.pendingReportLink"] = {"url":"<VITE_PUBLIC_SHARE_ORIGIN>/r/<uuid-v4>","expiresAt":<now+3600000>}`),
with **no** signed-in session and `history.length === 1` (cold direct load).
This is the exact state in which a bare `navigate("/")` lands on `/auth`.

**Universal pass test for every row:** activating the named control once results
in `location.pathname === "/"` **and** `document.querySelector(".nf-public") !== null`
**and** `location.pathname !== "/auth"`. `EmailField`/`Sign in` present is a fail.

| ID | Route | Response stub | Control | Pass criterion | Measure |
| --- | --- | --- | --- | --- | --- |
| E1 | `/privacy` | none | `[aria-label="Back to Norfold"]` | universal test, **and** the sticky header contains a link to `/` carrying `showPublic` (`a[href="/"]` count ≥ 1) | click back, read URL + `.nf-public`; then count header links |
| E2 | `/terms` | none | `[aria-label="Back to Norfold"]` | E1's two assertions | as E1 |
| E3 | `/community-guidelines` | none | `[aria-label="Back to Norfold"]` | E1's two assertions | as E1 |
| E4 | `/shared/:id` — **loading** (`**/api/share/*` delayed **5000ms**) | delayed 5000 | brand link "Norfold" | universal test, and the link is present **before** the preview resolves (not only on failure) | `page.route` with a 5000ms delay (inside the service's 8s abort), click immediately |
| E5 | `/shared/:id` — **ready** (`**/api/share/*` → 200 with the exact allowlisted JSON body) | 200 | brand link | universal test | fulfil with a valid preview object; click brand |
| E6 | `/shared/:id` — **unavailable** (`**/api/share/*` → 404) | 404 | brand link | universal test | fulfil 404 |
| E7 | `/shared/:id` — **error** (`**/api/share/*` → 500) | 500 | brand link | universal test | fulfil 500 |
| E8 | `/shared/:id` — invalid id | none | "Back to Norfold" | universal test | load `/shared/not-a-uuid` |
| E9 | `/privacy` | none | public document chrome | No `[aria-label="Search"]` and no `[aria-label="Notifications"]` on the page (`utilities={false}`), and no primary nav | element counts |
| E10 | `/terms`, `/community-guidelines` | none | same | same as E9 | counts |
| E11 | `/shared/:id` loading | delayed | brand | The brand is a link, not a `<p>`: `getByRole("link", {name:"Norfold"})` resolves in this state | role query |
| E12 | `/privacy` | none | one action only | The control that reaches `/` is a single activation — no intermediate chooser, no second "continue" step | count activations in the script |
| E13 | `/privacy` **without** saved accounts | none | back control | Still reaches `/` and `.nf-public`, proving `showPublic` (not luck) is doing the work | clear `rememberedAccounts`, re-run E1 |
| E14 | any of E1–E3, 320×568 | none | back control | Universal test at phone width; control `>= 44×44` | same + `rect` |
| E15 | any of E1–E3, 1440×900 | none | back control | Universal test at desktop; no nav rail on a public document | same + nav count 0 |
| E16 | `/onboarding` | none | brand link | Reaches `/` and `.nf-public` in one activation | click, read |

E1–E16: theme L, text 1x, motion full. E1/E4/E6/E7 re-run in **D**. E4–E7
additionally assert `errors` contains **no** `pageerror` (a rejected fetch is
allowed; an uncaught exception is not).

---

## 10. Failure states

Baseline: PRE2+PRE3+PRE4, theme L, text 1x, motion full, 1024×768 pinned unless stated.

| ID | Condition | Pass criterion | Measure |
| --- | --- | --- | --- |
| X1 | Offline transition (`setOffline(true)` after load, pinned at 1024) | The rail stays mounted at 224 with all four destinations; navigating `/chats` still changes the URL and shows the route's own offline state; `railW()`/`mainW()` unchanged | widths before/after + URL + `pageerror` count 0 |
| X1b | Cold load while offline | No white screen and no crash: `main` exists and `pageerror` count is 0, whichever screen the guard resolves (shell or auth). This row certifies "does not white-screen", not "renders the rail" | `document.querySelector("main") !== null`; `errors` filtered to `pageerror` |
| X2 | Offline, destination activation | Clicking `/my` changes route and shows the route's own error/empty state; the rail stays mounted and `aria-current` moves to `/my` | URL + `[aria-current]` |
| X3 | Reconnecting (`setOffline(false)` after X1, then refocus) | The current route re-renders its data without a reload; the rail stays mounted with `mainW()` unchanged; `pageerror` count 0 | counts + widths + `errors` |
| X4 | Unread 99+ | Badge text `99+`; badge does not overflow its trigger; `aria-label` on the bell still names the count or states "unread notifications ≥ 99" | `textContent`, `rect`, accessible name |
| X5 | Unread 0 | No badge node (`[data-testid="notifications-unread-badge"]` count 0); no empty circle | node count |
| X6 | Empty chats (`/chats`) | Empty state renders inside `main`; `mainW()` unchanged; no rail shift; the rail's `aria-current` is `/chats` | text presence + widths |
| X7 | Empty notifications (`/notifications`) | Empty state renders; the rail is not the scroll container; back returns to `/` | text presence, `activeElement` |
| X8 | Destination the account cannot use (`/settings/team` as non-admin) | Direct load does not crash: the guard renders its refusal and the rail still selects `/settings`; no admin rows are exposed | guard text + `[aria-current]` href |
| X9 | Data failure inside a destination (`/settings` REST 500) | Route shows its error state; rail remains operable (all four links still clickable and navigate) | click each link, assert URL changes |
| X10 | Session expiry mid-session | After the redirect, `nav[aria-label="Primary"]` count is 0, `document.activeElement` is not a detached nav node, and `pageerror` count is 0 | nav count + `activeElement.isConnected` + `errors` filtered |
| X11 | Storage unavailable (`localStorage.setItem` throws) | The rail still renders and the toggle still works for the session; no uncaught exception | override `setItem` to throw, click toggle, assert `railW() === 224` |
| X12 | Malformed appearance blob (`"{not-json"`) | Falls back to defaults: rail at 600+ with `navRailExpanded:false`, no crash | seed invalid JSON, measure |

---

## 11. Reduced motion

Motion override `reduce` seeded in PRE3 (`reduceMotion:"reduce"`), so
`html.fb-reduce-motion` is present and `MotionConfig` is `always`. Verified
against *effective* preference, not OS only.

| ID | State / action | Pass criterion | Measure |
| --- | --- | --- | --- |
| N1 | Load at 1024×768 | `document.documentElement.classList.contains("fb-reduce-motion") === true` and `dataset.reduceMotionOverride === "reduce"` | attribute read |
| N2 | Flyout open: **first paint** | `firstPaint` measurement taken at 0ms after `focusin` already shows `opacity === "1"` and `identity(transform)` | `page.evaluate` in the same task as the focus call |
| N3 | Flyout open: 0ms vs 100ms | The two `{transform, opacity}` samples are byte-identical; `getAnimations().length === 0` on the flyout | `frames("[data-nav-flyout]", 120)` has 1 distinct value pair |
| N4 | Pin/unpin at 840 | Rail width is final in the first frame: distinct width values in `frames(rail, 400)` === 1; labels `opacity === "1"` immediately | as P16 |
| N5 | Route change | No `pageVariants` travel: `frames("main", 400)` transform is identity on every sample | harness `drawTimeline` |
| N6 | Selected pill | No interpolation: `getAnimations()` on `.fb-nav-active-bg` length 0; transform identity at 0ms | as P17 |
| N7 | Hover/focus flyout with OS reduced motion but override `system` | Same as N2–N3 (the OS preference must drive it, not only the override) | `reducedMotion:"reduce"` context + `reduceMotion:"system"` |
| N8 | Override `full` while OS is reduced | Motion is **allowed**: the flyout may fade, and `html.fb-reduce-motion` is absent — the persisted override wins | context `reducedMotion:"reduce"`, seed `reduceMotion:"full"` |
| N9 | Reduced motion must not disable function | Every gesture/pointer interaction still works: hover opens the flyout, click pins, `Escape` closes | re-run F2, P3, F7 |

---

## 12. Known gaps — what this matrix cannot prove

| Gap | Why the matrix cannot prove it | Who signs it off |
| --- | --- | --- |
| **Feel** — whether 224px "feels right", whether the flyout delay reads as intent rather than lag | Timing bands (F1/F2/F6) constrain the number, not the impression. Perception is not binary. | Owner, on rendered review at 600 collapsed and 840 pinned with 200% text (the study's own gate, §8) |
| **Physical-device reach** — thumb travel to the rail on a tablet, hover on a trackpad, 44px targets under a finger | Requires hardware and owner consent (device rule 2026-11-04). Host measurement cannot certify it. | Owner, device pass |
| **Android IME** — the pill yielding to the keyboard | Only M8/M9 are host-provable (mocked `visualViewport`). Real keyboard behaviour is device-only. | Owner, device pass |
| **Real screen readers** — VoiceOver/TalkBack reading order and announcement of `aria-expanded` | Role queries prove the accessibility tree, not the announcement. | Owner or accessibility reviewer, device pass |
| **Real-account behaviour** — persistence and permissions against live data | Every row runs against a local seeded account (PRE2). Live RLS, live session expiry and multi-device sync are unverified here. | Owner, real-account pass |
| **Served deployment** — that the accepted build is the build users get | This matrix runs a local preview (PRE1). Exact-SHA CI and served deployment are separate statuses. | Release owner |
| **Colour discrimination** — deuteranopia/protanopia legibility of the active row | Contrast ratios do not model colour-vision deficiency; the active row is also distinguished by weight/scale, but that is an argument, not a measurement. | Owner / accessibility reviewer |
| **Cross-browser** — Safari/Firefox layout and `container-type` behaviour | The harness is Chromium-only. The product ships WebView/Chromium. | Release owner decides whether the target set widens |

### Open wording that needs one decision

- **"Unpin restores 616px at 840."** 616 is the *pinned* content width
  (840 − 224). Unpinning demonstrably restores 768 (840 − 72). Rows **P5/P6**
  encode both numbers: unpin → 768, repin → 616. If the intent was instead that
  unpinning must restore 616, the design is different and these two rows are
  wrong — confirm before running P5/P6.
- **"the section's panel list."** Norfold has four destinations and no
  sub-pages, and NAVIGATION-STUDY §7.7 forbids a second navigation level. This
  matrix reads the flyout's list as *the four destinations, labelled* (F14).
  If a real sub-navigation is intended, F14 must be replaced and §7.7 retired.

### Row counts

| Group | Rows |
| --- | --- |
| 0. Preconditions (setup, not acceptance) | 6 |
| 1. Breakpoints | 16 |
| 2. Flyout | 15 |
| 3. Pinned panel | 17 |
| 4. Phone pill | 12 |
| 5. Keyboard and screen reader | 16 |
| 6. Themes and contrast | 12 |
| 7. Text scale | 10 |
| 8. Routes | 16 |
| 9. Escape hatches | 16 |
| 10. Failure states | 13 |
| 11. Reduced motion | 9 |
| **Acceptance rows** | **152** |
| **Total including preconditions** | **158** |

### Criteria that are not binary, and why

None. Every pass criterion above resolves to a boolean over a measurement. Two
deliberate softenings are recorded rather than hidden:

1. **F6 / F2 use time bands, not exact values** (open between 150–400ms, close
   within 300ms). The exact intent delay is an implementation choice; the band
   is what a reviewer can adjudicate. A row cannot be passed with "it felt
   snappy".
2. **C9's badge contrast is asserted through the token contract** rather than a
   pre-computed ratio, because the badge pairs `--fb-on-error`/`--fb-error`,
   whose values differ per theme and are already pinned by the existing contrast
   tests. The row still fails if the measured ratio is `< 4.5`.
