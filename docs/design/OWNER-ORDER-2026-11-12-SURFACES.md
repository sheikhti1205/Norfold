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

## Status

| ID | Item | Status |
| --- | --- | --- |
| R1 | One account control | pending |
| R2 | Nested preview popovers | pending |
| R3 | Floating account settings panel | pending |
| R4 | All-type attachments, safely | pending |
| R5 | Emoji, stickers, GIFs everywhere | pending |
| R6 | Composer focus and Enter | done |
| R7 | Collapsible sidebars | pending |

A row moves to `done` only with the acceptance check above observed. A row that
cannot complete moves to `blocked` with the blocker named, and the pass carries
on with the next row.
