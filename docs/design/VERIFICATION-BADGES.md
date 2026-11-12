# Verification badges and the identity line

Status: design decided, not implemented. Owner reference 2026-11-12.

## 1. What the reference shows

- Two plain badges, one earned by verifying an email and one by verifying a
  phone number.
- A shinier, higher fidelity badge for people who verified both.
- The identity line reads `@handle` then a dot then the age of the post, so the
  reader knows who wrote it and when without opening it.

## 2. The data already exists

This is not a new product concept. `users.email_verified` and
`users.phone_verified` are integer flags
(`supabase/migrations/20260912000000_init.sql:16-17`), kept in sync with
`email_confirmed_at` when Supabase confirms an address
(`20260914120000_direct_auth_profiles.sql:59,79`), and the feed RPC already
returns them as `author_email_verified` and `author_phone_verified`
(`20260912181321_supabase_feed_and_report_rpcs.sql:52-53,74-75`).

So all three tiers are derivable from data on hand. Nothing is invented, and no
new column is required for the badge itself.

## 3. Tiers

| Tier | Condition | Badge |
| --- | --- | --- |
| none | neither flag | no badge, no placeholder |
| email | `email_verified` only | outline seal with a check |
| phone | `phone_verified` only | filled seal with a check |
| both | both flags | seal with a ring and a check, the higher fidelity treatment |

Only one badge renders at a time, always the highest tier reached. Three badges
in a row would say less than one.

## 4. Why the tiers are distinguishable without colour

The three treatment differs by material, not hue: outline, filled, filled plus a
ring. That survives greyscale, and it survives the three themes. Colour is not
the carrier of meaning.

The `both` badge is allowed a subtle sheen, and only that one. It stops
completely under `prefers-reduced-motion`, and the sheen is decorative: the ring
stays whether the animation runs or not.

## 5. Meaning, and the limit of it

- Email badge: this account confirmed its email address.
- Phone badge: this account confirmed a phone number.
- Both: it confirmed both.

Nothing more. The badge is not a claim about honesty, safety, or identity
documents, and no copy may imply that. The profile page states the meaning in one
line, and links to Settings, then Account and verification, where the reader can
earn their own.

## 6. The identity line

Current state, `apps/mobile/src/components/PostAnatomy.tsx:19-21`:

- the handle renders as `sr-only`, so a reader sees a display name and a time but
  never the handle;
- the time renders as a relative string with a full timestamp only in the `title`
  attribute.

Target state, one line, in this order:

1. Display name.
2. Badge, when earned, immediately after the name.
3. `@handle`, muted, on its own line under the name when the card is narrow, or
   inline after the name when it fits.
4. `·`, then the age of the post: `now`, `12m`, `3h`, `2d`, then a date after
   seven days.
5. The full timestamp stays in `title` and is rendered in full in the detail
   header.

That gives the contextual read the owner asked for: who wrote it, whether they
verified anything, and how long ago it was posted.

## 7. Placement

Shown:

- Feed cards, all layouts.
- Comment and reply rows.
- Report detail identity header.
- Public profile hero.
- The hover card, `docs/design/PROFILE-PREVIEW-SCOPE.md` §8.

Not shown:

- Chat, which has no per-message author chip and is strictly one to one.
- Activity rows, where the actor avatar is decorative.
- Mention autocomplete.
- The moderation sheet, where author fields are deliberately plain text.

## 8. Size and alignment

- 1em relative to the identity text, minimum 14px.
- Vertically aligned to the text baseline, not the line box.
- Never wraps onto its own line, never sits alone in the row.

## 9. Accessible names

- `Email verified`
- `Phone verified`
- `Email and phone verified`

The badge is `role="img"` with that label, or a decorative icon followed by
visually hidden text. The label is not "verified" alone, because the reader needs
to know what was verified.

## 10. Blocked dependency

Phone verification does not exist yet. The account is Google sign-in based, and
no phone confirmation flow was found. Tier 2 and tier 3 are therefore unreachable
until that flow ships. The badge component can be built and tested against
fixtures now; it must not render a tier the account cannot reach.

## 11. Open questions

1. Should an unverified account see an empty badge slot on its own posts?
   Recommendation: no badge at all. Nudge in Settings, never in public view.
2. Does the phone flow require a number on the account first? If so, the Settings
   page needs a phone field before the badge can appear.
3. Should the badge appear next to every comment, or only where the display name
   leads the line? Recommendation: every identity render of another person, for
   consistency.
4. Is the `both` sheen allowed by the palette freeze? Recommendation: it uses the
   existing accent tokens at lowered opacity, no new colour.
