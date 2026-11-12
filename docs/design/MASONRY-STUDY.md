# Masonry study: column policy, card sizing, and the full-image question

Research note, 12 November 2026. Source at `main` / `8bcdbbdf`, working tree clean
except `docs/design/nav/SPEC.md` and `docs/design/nav/prototype.html` (not touched
here) and an unrelated `docs/design/CHAT-MEDIA.md` that appeared from another
session. No product source was changed for this document. The companion lab is
[`docs/design/masonry-lab/index.html`](masonry-lab/index.html), one self-contained
file with no network access.

Citations are `file:line` against that commit. Numbers derived from typography or
from arithmetic on the code's own constants are marked **(estimate)**; numbers
produced by running the real formula are marked **(computed)**. Every computed
number below comes from the same arithmetic the app runs — the core of it is:

```
canvas    = min(viewport, MASONRY_CANVAS_MAX_PX)             responsive.ts:69,72
container = canvas - 2 * rootFontPx                          PostList.tsx:102 (px-4)
column    = (container - (n - 1) * 12) / n                   masonryLayout.ts:153-156
columns   = max(1, min(4, floor((max(0, width-40) + 12)/272))) responsive.ts:129-133
```

## 1. Current behaviour

### 1.1 Column count, gap, height

`masonryColumns()` is the only owner of the count (`responsive.ts:129-133`). It
subtracts a 40px budget for the feed's `px-4` gutter, adds one 12px gutter of
slack, and divides by `260 + 12`. The result is clamped to 1..4
(`MASONRY_MAX_COLUMNS`, `responsive.ts:53`).

The count is fed by the **measured canvas**, not the viewport: `Home` puts the
list in a `useContentWidth` box (`Home.tsx:80-81`) and passes
`masonryColumns(feedWidth)` (`Home.tsx:579`). The box is capped at 1152px
(`MASONRY_CANVAS_MAX_PX`, `responsive.ts:69`, class at `:72`).

Computed, at default text (root 16px, so `px-4` = 32px total):

| viewport | canvas | columns today | card width |
| --- | --- | --- | --- |
| 320 | 320 | **1** | 288.00 |
| 411 | 411 | **1** | 379.00 |
| 600 | 600 | **2** | 278.00 |
| 768 | 768 | **2** | 362.00 |
| 840 | 840 | **2** | 398.00 |
| 1024 | 1024 | **3** | 322.67 |
| 1116 | 1116 | **4** | 262.00 |
| 1280 | 1152 | **4** | 271.00 |
| 1440 | 1152 | **4** | 271.00 |
| 1920 | 1152 | **4** | 271.00 |

The column boundaries are `272n + 28`: **572 / 844 / 1116 / 1388 / 1660** for
2/3/4/5/6 columns. Two consequences the owner should see:

- 1280, 1440 and 1920 render **identically**, because the canvas stops at 1152.
  Widening the monitor buys nothing past 1152.
- 840–843 is a real seam: the band is already "expanded" (`widthBand`,
  `responsive.ts:26-30`) while three 260px cards still need 844, so that slice
  renders an expanded canvas with two columns. It is documented
  (`responsive.ts:123-127`) and pinned by a test (`responsive.test.ts:114-115`).

Gap is a **fixed 12 CSS px**, not a rem: `MASONRY_GUTTER_PX`
(`responsive.ts:51`) is passed straight through by `PostList.tsx:269` to
`FeedMasonry`'s `gap` prop (`FeedMasonry.tsx:55`). It does not grow with text
size; the container padding does.

Height is two-stage (`FeedMasonry.tsx:1-24`):

- **Before measurement**, `estimateMasonryCardHeight` = `columnWidth / ratio +
  112` (`masonryLayout.ts:83-89`). The 112px text block is a documented constant
  (`:80`). Ratio comes from the stored intrinsic size of the first image, or 4/3
  when unknown (`PostCardContent.tsx:49-54`, `masonryLayout.ts:61-70`).
- **After measurement**, a `ResizeObserver` measures each card and the grid
  re-packs (`FeedMasonry.tsx:108-118`, `:123-137`).

Placement is shortest-column-in-source-order, ties to the leftmost
(`masonryLayout.ts:107-126`). Cards keep **source order in the DOM** and are
absolutely placed by transform (`FeedMasonry.tsx:176-196`), so screen readers and
keyboard reach them in feed order and the container owns the height (`:174`).
Appends pass the previous column assignment back in (`FeedMasonry.tsx:139-141`,
`masonryLayout.ts:52-57`), so a new page never reshuffles what is on screen.

### 1.2 Can the reader choose masonry?

Yes, and it is not auto-only. Settings → Feed layout (`App.tsx:260`,
`FeedLayoutSettings.tsx`) offers four options (`:24-45`): **Auto** (default,
`feedLayoutPreference.ts:25`), **Feed**, **Compact**, **Masonry**.

`resolveFeedLayout` returns the explicit choice unconditionally (`responsive.ts:154`);
only `auto` reads the band, and only `expanded` (≥840) resolves to masonry
(`:155`). So a reader who picks Masonry on a 411px phone gets a one-column
"masonry", not a silently different layout — and a reader on a 1440px desktop who
picks Feed gets the single readable column (`Home.tsx:75`).

That design is right and should not change.

## 2. The column ceiling

### 2.1 What a card has to fit

The masonry card is not a thumbnail. In render order
(`PostCardContent.tsx:114-131`):

1. **identity row** — 28px avatar (`UserIdentityTrigger.tsx:46`), 8px gap,
   author name (14px, single line, `ellipsis`, `PostAnatomy.css:3-4`), relative
   time (12px, `nowrap`, `:5`), then the save/report menu at a **44px**
   minimum (`adaptiveFoundation.css:17-20`, `ActionMenu.tsx:39`) — the menu only
   renders for a signed-in reader (`SafetyActions.tsx:46`).
2. **status chip + type** (12px, `PostAnatomy.css:8`).
3. **title** — 15px semibold, clamped to 2 lines (`index.css:771-776`,
   `PostCardContent.tsx:113`).
4. **photo**.
5. **facts** — place and category, 12px, wrapping, with a 13px icon
   (`PostAnatomy.css:11-13`, `PostAnatomy.tsx:42-47`).
6. **actions** — **four** controls at **44px min-width each**: like and dislike
   (`HomeFeedReactionButtons.tsx:86-97`), comments and share
   (`PostActionRow.tsx:69-90`), in a `flex-nowrap` row with a 2px gap
   (`PostActionRow.tsx:69`, `gap-0.5`), i.e. **182px of hard floor**
   (`PostActionRow.css:15-23`). `slots.save` would make it five, but masonry
   does not pass it.

Two numbers fall out of that:

- **182px** is the width at which the card stops *breaking*. The row is
  `flex-nowrap` and every control keeps its 44px width, so below 182px the
  actions cannot fit and overflow the card instead of wrapping. The identity row
  has already wrapped by then (`PostAnatomy.css:23`).
- The identity row spends ~130px on fixed chrome at 100% text (28 avatar + 8 gap
  + 44 menu + 6 gap + ~44 for "3 w ago") **(estimate)** — and that 44px menu only
  renders for a signed-in reader (`SafetyActions.tsx:46`). So below ~200px the
  author name has almost no room, and the place label starts taking a second
  line.

Call **200px the readable floor** and **182px the structural floor**. The 182 is
arithmetic on the code's own constants; the 200 is an estimate from the CSS
above. The lab measures actual truncation per setting rather than trusting
either.

### 2.2 Card width, 2–6 columns, at the widths asked for

Computed with the app's formula:

| viewport → container | 2 col | 3 col | 4 col | 5 col | 6 col |
| --- | --- | --- | --- | --- | --- |
| 320 → 288 | 138.00 | 88.00 | 63.00 | 48.00 | 38.00 |
| 411 → 379 | 183.50 | 118.33 | 85.75 | 66.20 | 53.17 |
| 768 → 736 | 362.00 | 237.33 | 175.00 | 137.60 | 112.67 |
| 1024 → 992 | 490.00 | 322.67 | 239.00 | 188.80 | 155.33 |
| 1280 → 1152 → 1120 | 554.00 | 365.33 | 271.00 | 214.40 | 176.67 |
| 1440 → same canvas | 554.00 | 365.33 | 271.00 | 214.40 | 176.67 |

Three things are visible at once:

- **On a phone, masonry is wrong at any count above 1.** Two columns at 320 is
  138px — below even the 182px structural floor, so the action row overflows the
  card; the title clamps to roughly 17 characters per line **(estimate)** and the
  place wraps. The app already refuses this in `auto` (phones resolve to
  `feed`), and the manual "Masonry" choice degrades to 1 column because
  `masonryColumns(320) = 1`.
- **6 columns at the current 1152px cap is 176.67px**, which is narrower than
  today's *4* columns at 1024 (239px) and below the 182px structural floor. More
  columns on the same canvas makes every card worse — the cap, not the column
  count, is the binding constraint.
- **1440 and 1920 are the same picture.** Any argument for 5–6 columns has to be
  an argument about the cap.

### 2.3 Honest ceiling per width

With the code's own 260px floor, the ceiling is the boundary table from §1.1:

| viewport | highest honest count | card width over that range, default text |
| --- | --- | --- |
| ≤571 | 1 | 288–539 |
| 572–843 | 2 | 264.00–399.50 |
| 844–1115 | 3 | 262.67–353.00 |
| 1116–1387 | 4 | 262.00–329.75 |
| 1388–1659 | 5 | 261.60–315.80 |
| ≥1660 | 6 | 261.33+, grows with the canvas |

Computed at the band edges with `container = canvas − 32` (default text). Every
lower bound sits slightly above 260 because `masonryColumns` budgets a **40px**
inset, which is the `px-4` padding at the app's largest text scale (125%): at
that scale the 4-column card at 1116 is exactly 260.00. That budget is what makes
the 260px floor true at every text size, not only the default one.

Below 260 a card still renders and still works with a keyboard — it just stops
being a *report* card: the author name is gone and the place label wraps.

**So: 6 columns is not unreadable in principle. It is unreadable at the current
canvas cap.** 6 columns needs a **1660px canvas** to keep the existing 260px
floor. If the cap stays at 1152, 6 columns means 176.67px cards — under even the
182px structural floor — and the answer is no.

At the app's maximum text scale (125%, `appearance.ts:89-94`) the chrome grows
but the avatar and the 44px targets do not, so the 4-column card at the cap
(271px) keeps roughly 120px for the author name and ~14 characters per title
line **(estimate)**. That is survivable. 5 columns at the cap (214px) leaves
~65px for the name at 125% **(estimate)** — it holds, barely. 6 at the cap does
not.

### 2.4 Recommendation

Keep `MASONRY_MIN_CARD_PX = 260`. Do not lower it to buy columns — the floor is
what makes the card a report rather than a tile.

Change the *ceiling* to a parameter rather than the policy:

1. `masonryColumns(width, maxColumns = 4)` — `auto` keeps 4
   (`Home.tsx:579` unchanged), an explicit "Masonry" choice may pass 6.
2. Raise `MASONRY_CANVAS_MAX_PX` to **1660** only if 5–6 is wanted; at 1660 a
   four-column auto grid on a 1440 screen widens from 271px to 343px cards,
   which is a visible change to today's accepted composition. If that is
   unwanted, keep two caps: 1152 for `auto`, 1660 for an explicit 5–6.
3. Accept that the extra counts only exist on real desktops. On Android — the
   target platform (`masonryLayout.ts:12-14`) — landscape tablets reach 1024,
   which is 3 columns under this policy, and phones stay at 1.

The owner's instinct — 2–6 allowed, default no higher than 4 — is exactly
implementable. The only thing it needs is the canvas cap to move with the
explicit choice, otherwise 5 and 6 are numbers the arithmetic cannot honour.

## 3. Random card heights

### 3.1 Does the current code already vary height?

Yes, and it is not random. Height = photo ratio + text block. The photo ratio is
the stored intrinsic size (`PostCardContent.tsx:49-54`), falling back to 4/3 for
rows published before dimensions were recorded (`masonryLayout.ts:61-70`). The
fixture set shows the intended spread: 3:4, 4:3, 1:1, 9:16, 16:9, and one unknown
(`fixture/posts.ts:98-132`).

The **estimate** varies only with ratio: the 112px text block is constant
(`masonryLayout.ts:80-89`), so a one-line title and a two-line title reserve the
same space on first paint. The **measured** height varies with both. The gap
between them is at most one title line (~19px at 15px/1.25) plus a wrapped fact
line, which is why the first re-pack is small — but it is not zero, and it moves
every card below in that column.

Nothing in the source uses a random number for sizing. "Random" in the owner's
question is really "driven by the photo", and the code already does that.

### 3.2 Does variation help or hurt?

It helps **visual browsing**: the photo's shape is a recognition cue, and a
9:16 phone snapshot genuinely looks different from a 16:9 desk photo. The feed's
job is "do I recognise my thing", not "compare fields".

It hurts **scanning for an exact item** and any surface where the reader is
working through a set: rows line up, ragged cards do not, so the eye cannot run
down a column of titles. It also makes "how far down was it" unlearnable — the
same report sits at a different Y on every viewport.

### 3.3 Finding a card again

Two mechanisms already protect this, and both are id-based:

- Column assignment is carried on append (`FeedMasonry.tsx:139-141`), so
  pagination never moves a visible card.
- A refresh anchors on the row crossing the top of the viewport and corrects
  `scrollTop` by that row's id after the new data lands
  (`useFeed.ts:213-227`, applied at `:98-113`). Detail → Back restores
  `scrollTop` from the session cache (`useFeed.ts:155-162`).

The residual risk is specific and untested: the anchor correction runs in a
layout effect (`useFeed.ts:98`), while masonry heights are re-measured in a
passive effect on a `ResizeObserver` (`FeedMasonry.tsx:108-118`) that can change
the anchored row's position *after* the correction. **Unverified** — I did not
run the sequence; it needs a device/host reproduction before anyone calls it a
defect.

### 3.4 Recommendation

Keep ratio-driven variation. Do not randomise anything.

Two small hardening changes worth considering (both cheap, both optional):

- **Clamp the displayed ratio** to roughly 0.6–1.9 **(estimate)**. Today only
  invalid ratios are guarded (`masonryLayout.ts:64-70`); a 1:3 panorama or a
  3:1 strip becomes a card 3× the column width tall (or a letterbox sliver). A
  clamp costs a small `object-cover` crop on extreme photos and buys a
  predictable card height.
- **Raise the first-paint estimate** when the title is long enough to clamp, or
  accept the ~19px correction. Not worth a layout read.

Cost of the ratio clamp: one function, one test, and a slightly tighter crop on
unusual photos. That is the whole bill.

## 4. Full image view

### 4.1 What a crop actually hides

A uniform 4:3 tile with `object-cover` (`PostCardContent.tsx:70`) hides, by
shape **(estimate — plane geometry, not measured)**:

| photo shape | visible in a 4:3 tile | hidden |
| --- | --- | --- |
| 3:4 portrait | 56% of the height | **44%** |
| 9:16 phone photo | 42% of the height | **58%** |
| 1:1 square | 75% of the width | 25% |
| 16:9 landscape | 75% of the width | 25% |

For a lost-and-found card that is the wrong kind of loss. The photo is the
evidence: which corner is scuffed, whether the strap is attached, whether the
case is included. A 4:3 crop of a 9:16 phone photo throws away more than half of
it — and the reader cannot tell that it did, because the crop looks deliberate.

The product already preserves ratio in the grid: `aspectRatio` is set inline per
card (`PostCardContent.tsx:69`), the CSS comment says so explicitly
(`index.css:738-743`), and unknown sizes upgrade from 4/3 to the real ratio once
the image loads (`:72-75`).

### 4.2 The other three costs

- **Cost of opening every card.** A tile tap navigates to the report
  (`PostCardContent.tsx:66-68`, `:109-111`), and the report's hero opens the
  canonical `MediaViewer` (`PostDetail.tsx:1099`, `:1430-1434`). So the full
  image is two taps and a route change from the feed. That is fine for one card
  and hopeless for "which of these twelve is mine".
- **Layout stability.** A preserved-ratio box is stable before load, because the
  shape comes from stored dimensions rather than the decoded image. The one
  unstable case is unknown dimensions: those reserve 4/3 and change on load
  (`PostCardContent.tsx:72-75`), which re-packs the grid (`FeedMasonry.tsx:123-137`).
  A uniform tile is *more* stable only for the unknown-size rows, and it pays
  for that with a crop on every known-size row.
- **Data cost.** Column count and crop mode change **zero bytes**. There is one
  derived upload per photo — longest edge 1920, native derivative ceiling 2 MB
  (`mediaPolicy.ts:22,25`) — served through a one-hour signed URL with no
  transform parameters (`privateMedia.ts:21,89`). No thumbnail pipeline and no
  Storage image transformations exist in this repo. A 176px tile and a 554px
  card download the same file.

That last point is the owner's own concern answered: *"compact-sized image
would be required, ik."* It is not required for correctness, and it is the one
change that would actually make 5–6 columns cheaper. Today, pixels painted
change; bytes fetched do not. A second small derivative (≈320px longest edge)
generated at upload would be the real prerequisite for a dense grid — and it is
a media-pipeline change, not a layout change.

### 4.3 Recommendation

- **Preserved ratio, crop-to-fill inside the card's own shape.** That is what
  the code does; keep it. There is nothing to crop when the box matches the
  photo.
- **Do not add a lightbox to the masonry tile.** Two-stage media is an owner
  decision, documented at `PostCardContent.tsx:100-105`: feed media navigates,
  report media opens the viewer. Adding a second tap semantics to the tile
  breaks that contract and the shared-element transition with it.
- **Do not offer "uniform tiles" as a feed setting.** It belongs to a
  *compact/browsing* mode, where the reader is scanning rather than identifying.
  If it ships, it should be a different `density`, not a toggle on masonry.
- The real gap is not the viewer; it is **discoverability**. Nothing on a card
  says "the photo is cropped" — nothing needs to, while the ratio is preserved.

One inconsistency worth fixing in passing: `FeedMediaCarousel`'s doc comment
claims a tap "opens the canonical MediaViewer" (`FeedMediaCarousel.tsx:38-41`)
while the code calls `onOpenReport()`, which navigates to the detail route
(`:51`, wired at `PostCardContent.tsx:91`). The behaviour matches the two-stage
policy; the comment is stale. Comment-only fix, not a behaviour change.

## 5. Where else masonry could apply

| surface | renders today | masonry? | what breaks |
| --- | --- | --- | --- |
| **Home** | masonry, 1–4 cols (`Home.tsx:568-579`) | it is the reference | — |
| **My Posts** | `owner-feed`: image-left rows, 1/2/3 columns at 768/1200 (`MyPosts.tsx:84`, `:652-665`) | **no** | owner rows carry a lifecycle status pill, recovery actions and a filter (`:663`, `:666-672`). Ragged heights with per-row actions and a status filter is the worst case for scanning "which of my reports is still open". The existing multi-column *rows* already answer the desktop-width problem. |
| **Saved** | a `<ul>` of 60px rows, title + saved-at + remove (`SavedReports.tsx:256-298`) | **no** | no photos at all. There is nothing to masonry; the row is a title and a timestamp, and the remove button sits at the row end (`:310-317`). |
| **Search results** | `density="compact"` rows (`SearchScreen.tsx:725-737`) | **not yet** | results are ranked and compared ("this one, or that one"), and the screen is a place-driven two-pane layout with a floor on the list height (`:691-696`). Masonry destroys rank scanning. A *separate* "photos" view is defensible later; a replacement is not. |
| **Profile** | settings hub; no report list (`Profile.tsx:1-7`) | n/a | nothing to lay out. |
| **Public profile** | `SettingsRow` title + Lost/Found per report (`PublicProfile.tsx:211-226`) | **maybe, once** | this is the one other place the intent matches: "browse this person's reports". It currently shows **no photos at all**, so a grid would be a new capability rather than a re-layout. If it is done, use the `owner-feed` card grid (uniform, image-left, status visible) rather than masonry — the page is a settings column and a ragged grid inside it would fight the surrounding groups. |

Conclusion: **Home only.** The other four surfaces are either list-shaped by
function (Saved, Search, My Posts' status filter) or have no report list at all.
Public profile is the single candidate for a future photo grid, and it should not
be masonry.

## 6. Performance

What the code states, with no invented measurements:

- **Bytes**: one derivative per upload, longest edge 1920, native ceiling 2 MB
  (`mediaPolicy.ts:22,25`); served from the private bucket by a one-hour signed
  URL (`privateMedia.ts:21,89`), cached per key with one in-flight promise
  (`:13-15`). No transforms, no `srcset`, no second size.
- **Lazy loading**: `loading="lazy"` on the masonry `<img>`
  (`PostCardContent.tsx:70`). No `decoding="async"`, no `width`/`height`
  attributes — the box is reserved by `aspectRatio` instead (`:69`), which is
  enough to prevent a box jump for known-size photos.
- **Reflow on late images**: known sizes never reflow. Unknown sizes start at
  4/3 and switch to the natural ratio on load (`:72-75`); that changes the
  card's height, which the observer picks up and the grid re-packs
  (`FeedMasonry.tsx:108-118`, `:123-137`), moving everything below in that
  column. This is the only genuine layout-shift path in the grid.
- **Cost of 6 columns**: the card count does not change, and painted area at a
  fixed viewport is roughly constant, so this is **not** a decoding or paint
  problem. The placement pass is `O(items × columns)` (shortest-column scan,
  `masonryLayout.ts:92-98`) — trivial at 6. The honest costs are (a) more cards
  above the fold, so more lazy images and signed-URL resolves fire at once
  **(estimate: ~1.5× the initial image set at 6 vs 4 columns)**, and (b) every
  card is smaller, so the same 1920px derivative is downscaled further — bytes
  unchanged, legibility worse. No mid-range Android measurement was taken for
  this document; treat the 1.5× as an estimate and the rest as code reading.

What would actually make a dense grid cheap: a second ~320px derivative (or
Storage image transformations) so a 176px tile does not fetch a 1920px JPEG.
That is a media-pipeline change with migration and cost implications, and it is
the real prerequisite for 5–6 columns — not a layout tweak.

## 7. Decisions

| # | Question | Recommendation | Cost |
| --- | --- | --- | --- |
| 1 | Column range | Keep **1–4** for `auto`. Allow **5–6** only for an explicit Masonry choice *and* only from a 1388/1660px canvas. | `masonryColumns(width, max)` + one cap decision; ~10 lines + tests. |
| 2 | Canvas cap | 1152 keeps today's composition. 1660 unlocks 5–6 but widens 4-column cards on 1440+ (271 → 343). Keeping two caps avoids that. | 1 constant + 2 lines in `Home`. |
| 3 | Card sizing | **Preserved ratio**, crop-to-fill, no randomisation; optionally clamp displayed ratio to 0.6–1.9. | 1 function + test. |
| 4 | Full image | Keep two-stage: tile → report → viewer. No tile lightbox, no uniform-tile toggle on masonry. | 0 (comment fix only). |
| 5 | Other surfaces | Home only. Public profile is a *future* candidate, using `owner-feed`, not masonry. | 0 now. |
| 6 | Dense-grid prerequisite | A small derivative per upload before 5–6 columns ship. | Media pipeline + backfill. |

The lab at [`masonry-lab/index.html`](masonry-lab/index.html) renders 2–6 columns
at 320/411/768/1024/1280/1440 with preserved vs uniform tiles, crop vs contain,
light/dark, 100%/200% text, a full-image overlay, a live column-width readout and
a **measured** truncation count (titles clamped, place labels wrapped). The 200%
text setting is a stress view: the app's own maximum is 125%
(`appearance.ts:89-94`).
