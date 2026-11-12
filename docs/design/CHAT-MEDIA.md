# Chat media: stickers and GIFs

Status: proposal. Prototype: [`nav/prototype.html`](nav/prototype.html) (chat composer).
No product source in this note has changed yet.

## What exists today

Klipy is wired into **comments only**. Comments are a markdown body plus attachment
metadata, so a picked GIF is stored as a provider URL, not as bytes.

| Layer | File | What it does |
| --- | --- | --- |
| Adapter | `apps/mobile/src/services/klipy.ts` | Build-flag gated (`isKlipyEnabled` :80), `content_filter=high` (:41), provider-host allowlist (`isKlipyMediaUrl` :157), search state machine (:409), share tracking (:347). Absent key ⇒ the control is hidden, not disabled. |
| Composer | `apps/mobile/src/components/CommentComposer.tsx` | GIF / Sticker menu entries (:583-585), panel with search, tabs, skeletons, error+retry, empty state (:757-889), `Powered by KLIPY` (:889). |
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

So the comment path cannot be reused by passing a Klipy URL through. Chat must
download or generate bytes, hash them, upload them, and satisfy the same checks as a photo.

## What a GIF in chat requires

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

Static stickers (PNG/WebP) already pass every gate with **no backend change** —
they are ordinary photos: `media.ts:25`, the SQL checks, the sniffers and the
handler all accept PNG and WebP. Rendering already animates whatever bytes it is
given (`URL.createObjectURL(new Blob(..., {type}))` in `screens/Messaging.tsx:281`).

Recommended order:

1. **Still stickers first.** Pick a still PNG/WebP variant, run it through
   `preparePhoto`, upload as media. No migration, no gateway change. Verify that
   Klipy's image hosts allow a browser fetch (CORS) before shipping; that is
   currently unverified.
2. **Animated GIF only as a deliberate, migration-bearing decision.** It needs all
   eight gates plus a frame-count/size policy (`MAX_BYTES` is 20 MB at
   `chatMediaGateway.ts:1` / `media.ts:15`) and a decision on autoplay in a thread.
   Treat it as a new media type with its own review, not a flag flip.

Known gap even on the recommended path: a chat message has no field to carry the
Klipy slug (`media.ts:67`), so `trackKlipyShare` (`klipy.ts:347`) can only fire
in-session after a successful admission — not after restart or retry.

## Constraints that must not move

- **No chat video.** `MessageType` has no video member (`history.ts:12`), the
  gateway `Mime` union has no video (`chatMediaGateway.ts:5`), the SQL checks
  exclude it, and `chatEvidenceCopy.ts:16` excludes it. Comments have a video
  affordance (`commentAttachments.ts:49-51`); chat deliberately does not.
- **No chat documents.** There is no document MIME, no document attachment kind,
  and no file picker in the composer (`PeerChatComposer.tsx:35` — "no file/emoji
  button").
- **No provider URL in the chat media model.** Chat stores verified bytes; adding
  a `remoteUrl` field would bypass hashing, size and MIME checks.
- **No new media pipeline.** One photo pipeline
  (`preparePhoto` → `mediaBytes` → `mediaTransport`) stays the only byte path.

## Safety

- Keep `content_filter=high` on every search (`klipy.ts:41`) and keep the provider
  host allowlist (`isKlipyMediaUrl`, :157). A malformed response must not inject an
  arbitrary URL.
- Keep `Powered by KLIPY` visible whenever Klipy results are on screen
  (`klipy.ts:37`, rendered at `CommentComposer.tsx:889`).
- Never ship `VITE_KLIPY_API_KEY`. Absent key must hide the control, not fail open
  (`klipy.ts:80`).
- Share tracking stays post-only (`klipy.ts:27`). Never on search, preview or pick.
- Reuse the existing byte verification for anything chat accepts: SHA-256, exact
  length, MIME sniff, immutable identity (`history.ts:342`). A GIF must not skip
  verification because it is "just a sticker".
- Do not normalise a GIF into a "safe" still silently. If a still is chosen, say so
  in the UI copy.
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
- Persisting Klipy share attribution across app restarts (needs a message field).
- The photo viewer's hard-coded "View photo" label (`Messaging.tsx:294`) when the
  media is a sticker; cosmetic, tracked separately.
