# Appearance choosers: preview tiles instead of buttons and ticks

Status: design decided, implementation not started. Owner direction 2026-11-12
with two references: OpenCode's `Interface layout` row, and its `Appearance`
mode picker.

## 1. What is wrong now

**First run.** `NavigationSetup.tsx` renders a banner above the content with a
heading, a paragraph, and three outlined buttons: `Side rail`, `Bottom
navigation`, `Use recommended`. It reads as a cookie banner, not as a product
surface, and it asks the reader to approve a layout they have never seen.

**Theme.** `ThemeCard` renders a 3rem by 2rem swatch, a label with a `Check`
glyph, and a description line. The selection is a tick inside the title, which is
the "holes to do a tickmark on" pattern the owner rejected.

Both choices are about layout, so both should be shown as a miniature of the
result, not described in words.

## 2. Decision log

| ID | Decision |
| --- | --- |
| D-A1 | A choice between visual layouts is shown as a preview tile, never as a text button or a row with a tick. |
| D-A2 | Selection is a 2px accent ring around the tile plus an accent label. No check glyph inside the label. |
| D-A3 | The tile preview is honest: it renders the real surface, outline and accent tokens for the option it offers. |
| D-A4 | Tiles are native radios inside a fieldset with a legend. Arrow keys move between them, the tile is the label, focus is visible on the tile. |
| D-A5 | One shared tile component serves the first-run navigation choice and the Appearance navigation group. |
| D-A6 | The first-run panel keeps asking, because the choice is real, but it stops looking like a consent banner. |
| D-A7 | Palette tokens stay frozen. No new colours, no gradients. |

## 3. Theme tiles

Three tiles in one row: `System`, `Light`, `Dark`. True black stays a separate
switch and is not a fourth tile, because it is a modifier on dark, not a mode.

Tile anatomy:

- Rounded rectangle, 1px `--fb-outline-variant` border, radius 0.75rem.
- Inside: a miniature app window. A top strip at 22% height with a small pill,
  then a body with a short bar, a longer bar, and one accent-filled block.
- `Light` renders the light surface tokens. `Dark` renders the dark surface
  tokens. `System` is split vertically: the left half renders the light window,
  the right half the dark one, matching the reference.
- Label centred under the tile, 0.875rem, `--fb-on-surface-variant` when
  unselected.
- Selected: `box-shadow: 0 0 0 2px var(--fb-primary)`, border transparent,
  label `--fb-primary` at weight 600.
- Focus: existing focus ring on the tile via `:has(input:focus-visible)`.

Sizing: `grid-template-columns: repeat(3, minmax(0, 1fr))`, gap 0.5rem. At 320px
each tile is about 88px wide, so the tile keeps a minimum height of 3.5rem and
the inner bars use percentage widths and 2px heights. Nothing inside the tile is
text.

Removed: the per-tile description line and the `Check` glyph. The group
description already explains the modes, and three description lines under three
narrow tiles is unreadable at 320px.

## 4. Navigation tiles

Two tiles side by side, 4 by 3 ratio: `Bottom bar` and `Side rail`.

- `Bottom bar` shows a frame with a content block and a bottom strip holding
  five dots.
- `Side rail` shows a frame with a left strip holding four dots and a wider
  content block.
- Same border, ring, label and focus rules as the theme tiles.
- Labels: `Bottom bar`, `Side rail`. No descriptions inside the tile. The group
  description carries the explanation.

Shared labels are the existing ones, so the vocabulary does not change:
`Bottom bar`, `Side rail`.

## 5. First-run panel

Keep the section, replace its contents.

- `region` label stays `Choose your navigation`.
- Heading: `Choose your navigation`. The current `Make room for what matters.`
  is marketing copy, and it does not say what is being asked.
- Paragraph: `You can change this later in Settings, under Appearance.`
- Two navigation tiles side by side.
- One recommendation line, no third button:
  - fine pointer: `Recommended: Side rail. Wide screens have room for a column.`
  - coarse pointer: `Recommended: Bottom bar. Every control stays within thumb
    reach.`
- Choosing a tile writes `navLayout` and `navLayoutChosen` exactly as today, and
  focus moves to the current page link in the new navigation, exactly as today.

Removed: the three buttons and the `Use recommended` action. A third control
that silently picks for the reader is the part that felt like a consent banner.

Panel styling: `--fb-surface-container-low`, top and bottom hairline, 1.25rem
padding, no shadow, no card-on-card. It should read as the first content of the
page, not as an overlay.

## 6. Appearance page navigation group

Same two tiles replace the `PreferenceRadioRow` pair. The group keeps its title
`Navigation` and its description about the phone caveat. The reader can now see
the difference instead of reading two sentences.

## 7. What does not change

- `resolveNavLayout` and every width rule in `navLayout.ts` and `responsive.ts`.
- The stored shape `{ navLayout, navLayoutChosen }` and the storage key.
- Accent swatches, the true-black switch, and the live preview block.
- The rail breakpoint gates that hide the first-run panel below `MEDIUM_MAX_PX`.
- All palette token values.

## 8. Code surface

| File | Change |
| --- | --- |
| `apps/mobile/src/components/settings/SettingsPrimitives.tsx` | `ThemeCard` becomes the tile; add `NavLayoutCard`; drop the tick |
| `apps/mobile/src/components/settings/index.ts` | export `NavLayoutCard` |
| `apps/mobile/src/components/settings/settings.css` | tile geometry, preview internals, ring and label states |
| `apps/mobile/src/components/NavigationSetup.tsx` | fieldset of two tiles, new copy, no buttons |
| `apps/mobile/src/components/NavigationSetup.css` | panel styling |
| `apps/mobile/src/screens/AppearanceSettings.tsx` | navigation group uses the tiles |
| tests | `NavigationSetup.test.tsx` switches from buttons to radios; `SettingsPrimitives.test.tsx` and `AppearanceSettings.test.tsx` assert tiles, the ring state and the absent tick |

## 9. Copy rules

- No em dashes, no exclamation marks, no marketing lines.
- Every sentence says what the control does or what happens next.
- The recommendation names the layout and the reason in one line.
- No invented numbers.

## 10. Verification

- 320, 360, 411, 768 and 1280 in light, dark and AMOLED. No horizontal overflow,
  no clipped label, no tile under 44px of touch target.
- 200% text: labels wrap to two lines and the tiles stay aligned.
- Keyboard: Tab into the group, arrow keys change the choice, the ring follows.
- Screen reader: the group announces its legend, each tile announces its label,
  the checked tile reports checked.
- Contrast: unselected label, selected label, tile border against the page, in
  all three themes.
- The first-run panel disappears after a choice and does not reappear on resize.
- Anti-slop gate before and after, with a PASS, FAIL or UNVERIFIED line per check.

## 11. Open questions

1. Should the first-run panel also appear on a tablet held in portrait where the
   rail cannot render? Today it hides below `MEDIUM_MAX_PX`, so the reader is
   never asked about a layout they cannot see. Recommendation: keep it that way.
2. Should `System` show the device's current resolved mode as a caption
   (`System: dark`)? Recommendation: not in the tile, because it duplicates the
   ring state; if wanted, put it in the group description.
3. Does the app need a `Compact` third navigation option later? Recommendation:
   no tile for a mode that does not exist.
