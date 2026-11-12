# Chat media: stickers and GIFs

Status: proposal. Prototype: [`nav/prototype.html`](nav/prototype.html) (chat composer).
No product source in this note has changed yet.

The binding contract for Klipy — device-only, no server involvement — is
[`KLIPY-CLIENT.md`](KLIPY-CLIENT.md). This note only covers how a Klipy pick reaches
a chat message.

## What exists today

Klipy is wired into **comments only**. Comments are a markdown body plus attachment
metadata, so a picked GIF is stored as a provider URL, not as bytes.

| Layer | File | What it does |
| --- | --- | --- |
| Adapter | `apps/mobile/src/services/klipy.ts` | Build-flag gated (`isKlipyEnabled` :80), `content_filter=high` (:41), provider-host allowlist (`isKlipyMediaUrl` :157), search state machine (:409), share tracking (:347). Absent key ⇒ the control is hidden, not disabled. |
| Composer | `apps/mobile/src/components/CommentComposer.tsx` | GIF / Sticker menu entries (:583-585), panel with search, tabs, skeletons, error+retry, empty state (:757-889), `Powered by KLIPY` (:887-891). |
| Attachment model | `apps/mobile/src/services/commentAttachments.ts` | `createKlipyAttachment` (:224) returns `kind:"gif"` (:235), `status:"uploaded"`, and keeps `remoteUrl` + `klipySlug` (:240-241). |
| Body emission | `apps/mobile/src/services/commentBodyMedia.ts` | `commentMediaProvenance` allowlists klipy/supabase hosts (:55); `appendBodyMedia` writes `![gif](url)` (:130-141). |
| Share tracking | `apps/mobile/src/components/CommentComposer.tsx:552` | Fires `trackKlipyShare` only after the comment posts. |

Chat is a different model. A message is text, and media is **verified bytes**, not a URL:

- `MessageType = "TEXT" | "MEDIA" | "LOCATION" | "VOICE"` — `services/messaging/history.ts:12`
- `MediaMetadata` carries sha256, MIME, byte size and pixel dimensions only, no URL —
  `services/messaging/media.ts:67`
- bytes live in a separate store behind `MediaBytesPort` — `history.ts:118`
- inbound bytes are re-verified at one enforcement point —
  `history.ts:342` (`persistVerifiedMediaAndAck`), outgoing at `history.ts:320`

## Why a Klipy GIF cannot be uploaded

Animated GIF is blocked at eight independent layers. Widening only some of them
produces a message that uploads and then fails to be stored or read back.

| # | Gate | Evidence |
| --- | --- | --- |
| 1 | Client MIME allowlist excludes `image/gif` | `messaging/media.ts:25` (`MEDIA_MIME_TYPES`), `isImageMime` :113 |
| 2 | Photo preparation flattens animation to a still frame | `messaging/preparePhoto.ts:56` (`animation: "still"`) |
| 3 | Byte sniffing has no GIF branch | `messaging/validation.ts:224-235` |
| 4 | Three SQL `CHECK`s allow only jpeg/png/webp | `supabase/migrations/20261028010000_chat_media_authorization.sql:16,210,270` |
| 5 | Gateway `Mime` union has no GIF | `supabase/functions/_shared/chatMediaGateway.ts:5` |
| 6 | Gateway `image()` sniffer cannot measure GIF frames | `chatMediaGateway.ts:20-52` |
| 7 | Upload handler rejects `image/gif` before the gateway | `supabase/functions/chat-media/handler.ts:36` |
| 8 | Evidence copy carries the same MIME union | `supabase/functions/_shared/chatEvidenceCopy.ts:16,49` |

These gates are correct and stay. They exist to guarantee that chat media is bytes
we verified. A GIF has no business passing them.

The earlier idea of uploading a **static** PNG/WebP sticker as chat media would
have cleared every gate — and is now rejected, because downloading Klipy bytes and
re-uploading them to our storage is exactly the re-hosting the owner forbade and
Klipy's own terms prohibit. See `KLIPY-CLIENT.md`.

## The model instead: a validated provider reference

A chat GIF or sticker is **not** media. It is a small, validated pointer to Klipy
that each device resolves itself on render. Nothing is uploaded, nothing is hashed,
nothing is re-hosted.

```
message.klipy = {
  kind:  "gifs" | "stickers",
  slug:  string,   // ^[A-Za-z0-9_-]{1,128}$
  url:   string,   // exactly as Klipy returned it
  previewUrl?: string,
}
```

Why this is the right shape:

- It matches what comments already do (`createKlipyAttachment`, `remoteUrl` +
  `klipySlug`) instead of inventing a second Klipy model.
- It leaves `MessageType` (`history.ts:12`), `MediaMetadata` (`media.ts:67`) and all
  eight gates untouched. A reference message is a TEXT message with one extra
  validated field, so the upload/verification path is never entered.
- It keeps Klipy's bytes and our storage apart, which is what Klipy's own terms
  require (see `KLIPY-CLIENT.md`).

Validation on write **and** on every read: https only, host restricted to
`klipy.com` / `*.klipy.com` (`klipy.ts:157`), `kind` in `('gifs','stickers')`, slug
regex as in `20261011020000_comment_attachments_relation.sql:113`. A stored
reference is untrusted input — the sender's device wrote it.

### Required schema change — named, not written, not applied

```
supabase/migrations/<pending>_chat_message_klipy_reference.sql
```

Adds the reference with the `kind` CHECK, slug regex, https-only and provider-host
CHECKs, mirroring `20261011020000_comment_attachments_relation.sql:39-52` and the
provider CHECK at `20261012020000_comment_attachments_parity.sql:74`. It does **not**
exist yet. Until it lands and is accepted, chat cannot carry a Klipy reference; per
the repository's migration rule the whole change stays local until then.

### What this costs

- **URL rot is permanent.** Klipy forbids rewriting returned URLs, so an expired URL
  cannot be repaired. Render a calm "no longer available" tile, never a broken image.
- **No integrity check.** A reference cannot be hashed or length-checked like
  uploaded media. "Verified bytes" now describes user-uploaded chat media only, and
  the UI/privacy copy must not imply otherwise.
- **The recipient contacts Klipy.** Their IP reaches Klipy on render. Disclose it.
- **Online only,** softened — not solved — by opt-in preview caching.
- **Klipy removal wins.** Content disappears when Klipy removes it. Correct by design.

## Constraints that must not move

- **No chat video.** `MessageType` has no video member (`history.ts:12`), the
  gateway `Mime` union has no video (`chatMediaGateway.ts:5`), the SQL checks
  exclude it, and `chatEvidenceCopy.ts:16` excludes it. Comments have a video
  affordance (`commentAttachments.ts:49-51`); chat deliberately does not.
- **No chat documents.** There is no document MIME, no document attachment kind,
  and no file picker in the composer (`PeerChatComposer.tsx:35` — "no file/emoji
  button").
- **No provider URL inside the media model.** `MediaMetadata` stays URL-free
  (`media.ts:67`) and `MediaBytesPort` stays the only byte source (`history.ts:118`).
  The Klipy reference is a separate, non-media field precisely so that uploading a
  URL-shaped object cannot satisfy the media checks.
- **No new media pipeline.** One photo pipeline
  (`preparePhoto` → `mediaBytes` → `mediaTransport`) stays the only byte path.
- **No byte fallback.** Never download a Klipy GIF and upload it as chat media to
  work around the gates. That is re-hosting.

## Safety

- Klipy content is untrusted third-party content. Render only through `<img>` with a
  URL that passed the allowlist; never inject provider HTML.
- Keep `content_filter=high` (`klipy.ts:41`) and keep the host allowlist (`:157`).
  A malformed response must not inject an arbitrary URL.
- Keep `Powered by KLIPY` visible whenever Klipy results are on screen
  (`klipy.ts:37`, `CommentComposer.tsx:887-891`) — required by the API Terms, even
  though `docs.klipy.com/attribution` marks it optional.
- Never ship-log a Klipy API URL: the key is a path segment (`klipy.ts:293`, `:338`).
  The key itself is a public, rate-limited identifier compiled into the bundle by
  design (`scripts/check-klipy-config.mjs:110-111`); it is not a secret, and the
  absence of a key must still hide the control rather than fail open (`klipy.ts:80`).
- Share tracking stays post-only (`klipy.ts:27`). Never on search, preview or pick.
- Report-in-place: Klipy ships a report endpoint with a fixed reason enum. A Klipy
  tile should offer it. This does not exist yet.
- The prototype's tiles are inline SVG placeholders. The real picker must render
  provider media only, never a locally invented asset that looks like a provider
  result.

## Out of scope

- Chat video and chat documents (above).
- Klipy "Avatars" / avatar-sticker tab. The prototype ships **two** tabs
  (Stickers, GIF) and omits a third: there is no Norfold avatar-sticker system to
  populate it, and a permanently dead tab is worse than a missing one.
- The emoji panel in the prototype is a proposal used to prove mutual exclusion
  with the sticker panel. The shipped chat composer has no emoji control
  (`PeerChatComposer.tsx:35`); adding one is a separate decision.
- Animated WebP and APNG.
- Custom sticker packs, uploads of user-made stickers, or sticker authoring.
- Any server-side fetch, proxy, mirror or cache of Klipy content.
- The photo viewer's hard-coded "View photo" label (`Messaging.tsx:294`) when the
  media is a sticker; cosmetic, tracked separately.
