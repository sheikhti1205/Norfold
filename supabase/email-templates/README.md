# Norfold Supabase auth email templates

Ready-to-paste HTML for the Supabase **Authentication → Emails** (Email
Templates) page, plus the exact Subject lines and variables each template needs.

These are source files only. Nothing here was applied to the hosted project, and
no dashboard setting is described as changed. Copy/paste is an owner action.

Supabase does not read this directory. The dashboard "Source" view takes the
whole HTML file; `supabase/config.toml` does not exist in this repository, so
there is no CLI template wiring to update either.

## Files and where each one goes

| File | Dashboard template (Authentication → Emails) | Subject line to paste |
| --- | --- | --- |
| `reset-password.html` | Reset Password | `Your Norfold reset code` |
| `confirm-signup.html` | Confirm Signup | `Confirm your Norfold email` |
| `magic-link.html` | Magic Link | `Your Norfold sign-in code` |
| `invite.html` | Invite User | `You’re invited to Norfold` |
| `change-email.html` | Change Email Address | `Confirm your new Norfold email` |
| `reauthentication.html` | Reauthentication | `Your Norfold verification code` |

Paste the subject exactly as written above, including the typographic
apostrophe in the invite subject. Subjects are short on purpose: phone inboxes
truncate long ones, and the sender name already carries "Norfold".

## Template variables each file requires

| File | Variables used | Notes |
| --- | --- | --- |
| `reset-password.html` | `{{ .Token }}`, `{{ .Email }}` | No link. See "Reset is code-only" below. |
| `confirm-signup.html` | `{{ .Token }}`, `{{ .ConfirmationURL }}`, `{{ .Email }}` | Code first, link as the one-tap alternative. |
| `magic-link.html` | `{{ .Token }}`, `{{ .Email }}` | Code only; no `{{ .ConfirmationURL }}`. |
| `invite.html` | `{{ .ConfirmationURL }}`, `{{ .Email }}` | No code. See "Invite has no code" below. |
| `change-email.html` | `{{ .Token }}`, `{{ .ConfirmationURL }}`, `{{ .NewEmail }}` | `{{ .NewEmail }}` is only supported in this template. |
| `reauthentication.html` | `{{ .Token }}`, `{{ .Email }}` | Matches Supabase's own reauthentication default (code only). |

Do not add `{{ .TokenHash }}`, `{{ .RedirectTo }}` or `{{ .Data }}` back in
without re-checking the rendered output: an unknown or empty variable prints
nothing and leaves a hole in the sentence.

## Reset is code-only (deliberate)

`reset-password.html` renders `{{ .Token }}` and contains no
`{{ .ConfirmationURL }}` at all. Three reasons, in order of weight:

1. The owner's requirement for this work is an OTP reset flow.
2. Link prefetching. Microsoft Defender Safe Links and similar scanners open
   links on delivery, which burns the one-time token before the user clicks
   (Supabase documents this under "Email prefetching"). A code cannot be
   prefetched.
3. The app already verifies the code (`verifyOtp({ type: "recovery" })`,
   `apps/mobile/src/services/auth.ts:388`) and asks for six digits
   (`apps/mobile/src/screens/Recovery.tsx:72`). The link was the fallback, not
   the main path.

**Consistency note.** `docs/auth/owner-setup.md` step 4 (`:24-30`) points
owners at `supabase/email-templates/reset-password.html` — the file in this
directory — as the canonical reset template, and describes it as containing
`{{ .Token }}` with no reset link. The canonical reset source lives here.

`docs/auth/reset-password-otp.html` is no longer a template: it is a pointer
page. It contains no `{{ .ConfirmationURL }}` and no recovery link at all; it
only directs readers to this directory's `reset-password.html` and to
`owner-setup.md`. `ConfirmationURL` has zero hits anywhere under `docs/auth/`,
so the docs and this template now agree.

## Invite has no code

Supabase can put `{{ .Token }}` in the invite template, but nothing in this app
consumes an invite code: the only `verifyOtp` types in the source are `"email"`
(signup), `"recovery"` and `"phone_change"`. An invite ends in "choose a
password", which is the link flow. The template therefore leads with the link.
If an invite OTP screen is ever added, add the code block from
`confirm-signup.html` above the button.

## Redirect allow-list implication

The visible links are `{{ .ConfirmationURL }}`, which lands on the project's
Site URL / `redirect_to` and then on the allow-list. Confirm in
**Authentication → URL Configuration**:

- Site URL: `https://findbackapp.social` (`apps/mobile/src/brand.ts:17`).
- Redirect URLs include `https://findbackapp.social/recovery`
  (`apps/mobile/src/services/auth.ts:295`) and the existing Google callback
  `https://findbackapp.social/auth/callback`
  (`docs/auth/owner-setup.md:31-34`).
- Keep whatever native/App-Links entries already exist. Do not add a domain for
  this work.

Because the reset email no longer contains a URL, the reset flow does not depend
on the allow-list. Keep `/recovery` allow-listed anyway: the app still sends it
as `redirectTo`, and the link fallback still exists in code.

Also confirm in **Authentication → Emails / SMTP Settings** that provider-side
click tracking and link rewriting are off. Rewritten auth URLs fail, and a
rewritten auth URL is exactly what `{{ .ConfirmationURL }}` must not become.

## OTP settings to confirm (not changed here)

- **Email OTP length: 6.** Required by the code cell (six monospace digits) and
  by the app's `/^\d{6}$/` check (`docs/auth/owner-setup.md:15`,
  `apps/mobile/src/screens/Recovery.tsx:72`). A different length will wrap and
  will fail the client-side check.
- **Email OTP expiry:** whatever the project uses today. The templates never
  state a number — they say "expires soon" — so changing expiry needs no
  template edit. Default is one hour; confirm the live value rather than trusting
  it.
- **Confirm email: on** for signup (`docs/auth/owner-setup.md:14-15`).
- **Custom SMTP with a sender you control**, SPF/DKIM verified. The built-in
  service is testing-only.

## Design tokens used (audit trail)

Every value comes from the product's own palette or type scale.

| Role | Light | Dark | Source |
| --- | --- | --- | --- |
| Page background | `#e9ecef` | `#18191b` | `apps/mobile/src/design/colorSystem.ts:256` (container) / `:264` (surface) |
| Card background | `#ffffff` | `#202124` | `colorSystem.ts:256` (low) / `:264` (low) |
| Card border | `#dee2e6` | `#34363b` | `colorSystem.ts:256` (high) / `:265` (divider) |
| Divider rule | `#ced4da` | `#34363b` | `colorSystem.ts:257` / `:265` |
| Heading text | `#212529` | `#f1f3f5` | `colorSystem.ts:257` (ink) / `:265` (ink) |
| Body text | `#495057` | `#b7bbc2` | `colorSystem.ts:257` (secondary) / `:265` (secondary) |
| Wordmark | `#0a5a4c` | `#7bd8d8` | `colorSystem.ts:63` (brand.text) / `:64` (brand.text) |
| Code cell fill | `#d8efeb` | `#153c3c` | `colorSystem.ts:63` (brand.bg) / `:64` (brand.bg) |
| Code cell border + digits | `#073e35` on `#d8efeb` | `#8fe3e3` on `#153c3c` | `colorSystem.ts:63` (brand.ink) / `:64` (brand.ink) |
| Button fill | `#0a5a4c` | `#8fe3e3` | `colorSystem.ts:63` (brand.text) / `:64` (brand.ink) |
| Button label | `#ffffff` | `#073e35` | `colorSystem.ts:285` (`content.onMedia`) / `:63` (brand.ink) |

Other tokens:

- **Font stack** — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
  'Helvetica Neue', Arial, sans-serif`. Derived from
  `apps/mobile/src/index.css:68-74`, ordered for email clients: iOS resolves
  `-apple-system` (San Francisco), Android resolves Roboto, Windows resolves
  Segoe UI. No web font is loaded.
- **Monospace stack** — `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo,
  monospace`, matching the app's `ui-monospace, monospace`
  (`apps/mobile/src/index.css:234`) with fallbacks email clients actually have.
- **Radius** — 12px card, 10px code cell, 8px button. From the M3 scale in
  `apps/mobile/src/index.css:30-34` (`sm` 8px, `md` 12px).
- **Type scale** — wordmark 19px/600, H1 23px/600, body 16px/26px, fine print
  15px/24px, code 30px/38px/700 with `0.2em` letter-spacing.
- **Layout** — 600px max width, 16px page gutters, 24px card padding, button
  50px tall.

The accent choice needs one note. The app's *default user accent* is blue
`#3568d4` (`colorSystem.ts:225`), but accents are user-selectable and are not
the brand. These emails use the brand family — the deep green-teal ramp at
`colorSystem.ts:63-64`, documented there as "principal brand marks and primary
identity" — so the mail reads as Norfold regardless of a user's accent choice.

## Contrast, stated per pair

Measured with the WCAG 2.1 relative-luminance formula against the actual pair
each element sits on.

| Pair | Ratio | Requirement |
| --- | --- | --- |
| `#212529` on `#ffffff` (H1) | 15.4:1 | AA/AAA body |
| `#495057` on `#ffffff` (body, footer) | 8.2:1 | AAA body |
| `#073e35` on `#d8efeb` (code digits) | 10.0:1 | AAA body |
| `#ffffff` on `#0a5a4c` (button label) | 8.1:1 | AAA body |
| `#0a5a4c` on `#ffffff` (wordmark) | 8.1:1 | AAA body |
| `#f1f3f5` on `#202124` (dark H1) | 14.7:1 | AAA body |
| `#b7bbc2` on `#202124` (dark body) | 8.5:1 | AAA body |
| `#8fe3e3` on `#153c3c` (dark code digits) | 7.3:1 | AAA body |
| `#073e35` on `#8fe3e3` (dark button label) | 8.2:1 | AAA body |
| `#7bd8d8` on `#202124` (dark wordmark) | 9.8:1 | AAA body |

No pure `#000`/`#fff` pairing anywhere. Dark surfaces are `#18191b`/`#202124`,
not true black, so text does not collapse into a pure-black background on
clients that force-invert.

## Engineering rules honoured

- Table layout only, single column, no flexbox, no grid, no floats.
- All layout and colour inline. The single `<style>` block contains nothing but
  the `prefers-color-scheme: dark` overrides (with `!important`, because inline
  styles otherwise win). Strip the block and the light design is unchanged.
- No external CSS, no web fonts, no JavaScript, no tracking pixel, no forms.
- No images at all — not even a hosted logo. The wordmark is live text in the
  brand colour, so nothing breaks with images disabled, and no remote asset is
  needed (also avoids the tracking-pixel smell called out at
  `BRANDING.md:83-86`). If the emblem is ever wanted, it would be an `<img>` to
  the current hosted PNG under `/icons/`; that path is **UNVERIFIED** and the
  layout must still read without it.
- `lang="en"`, `dir="ltr"`, one `<h1>`, `role="presentation"` on every layout
  table, no decorative images to give alt text to.
- The OTP is selectable text: a real 6-digit string in a monospace cell, so it
  survives CSS stripping, images-off, and a client's plain-text rendering. It is
  never an image and never drawn with background tricks.
- Every template carries a plain "if you didn't…" sentence. No marketing footer,
  no unsubscribe block, no promo. Footer is one line: recipient + product +
  address.
- Tap targets: the only interactive elements are buttons at 50px tall,
  full width of the card.

## Voice

Taken from real consumer copy, not invented: "Lost something? Norfold helps it
find its way back to you." (`apps/mobile/src/components/auth/AuthShell.tsx:44`),
"Enter the six-digit recovery code from your email."
(`apps/mobile/src/screens/Recovery.tsx:72`), "Send recovery code"
(`apps/mobile/src/screens/ForgotPassword.tsx:74`). Short sentences, no
exclamation marks, no "we're thrilled", no schema or capability jargon, "code"
not "OTP", "link" not "confirmation URL".

## Preview

`preview/` holds real renders, produced with the Chromium headless shell already
on this machine (no installs):

```sh
chrome-headless-shell --headless --screenshot=<file>.png --window-size=390,860 <file>.html
# dark mode: add --blink-settings=preferredColorScheme=0
```

Template variables were substituted with sample values (`482913`,
`sam@example.com`, `sam.new@example.com`) **in the preview copies only**; the
committed templates still contain the real variables. Previewed:
`reset-password` at 390px light + dark and 320px light, `confirm-signup` light +
dark, plus light renders of the other four. Not previewed: Outlook/Renderer
output, Gmail app forced-dark inversion, and Apple Mail — those need a real
inbox.

## Unverified

- Hosted-project state: current subject lines, expiry, OTP length, SMTP sender,
  link tracking. All are dashboard facts, not readable from this repository.
- Real delivery and rendering in any inbox or client.
- The `/icons/...png` URL above (never used by these templates).
- Whether the project sends any text/plain part. These templates need none: the
  content is plain text and degrades intact.
