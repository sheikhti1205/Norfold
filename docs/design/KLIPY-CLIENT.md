# Klipy is a client-only dependency

Status: design contract, agreed 2026-11-12. This note is normative for anything
that touches Klipy. It supersedes the "upload static stickers as chat media"
recommendation previously in [`CHAT-MEDIA.md`](CHAT-MEDIA.md).

## The rule

**Klipy content is fetched by the user's device, from Klipy, and is never loaded,
proxied, transformed, cached, re-hosted or stored by our servers.**

Concretely, Norfold's backend must never:

- call `api.klipy.com` (no search, trending, categories, recent, share, report);
- fetch a Klipy media URL to inspect, transcode, thumbnail or re-sign it;
- re-host Klipy bytes in Supabase Storage or any other bucket;
- store a Klipy media file, a base64 copy, or Klipy's raw API response;
- sit between the device and Klipy as a proxy or CDN.

The device holds the API key, the device makes the request, the device renders
the media. If our server cannot see it, our server cannot leak it, cache it
wrongly, or serve stale content after Klipy removes it.

## Current state — the rule already holds

Client path, verified:

| Concern | Evidence |
| --- | --- |
| Direct device fetch, no proxy | `apps/mobile/src/services/klipy.ts:294-297` (`impl(url, { signal })`) |
| "no proxy, no base64" stated in the contract | `klipy.ts:24-26` |
| Provider host allowlist, https only | `klipy.ts:157-167` (`klipy.com`, `*.klipy.com`); enforced at intake `:207`, `:213` |
| Key is build config, not a secret store | `klipy.ts:43` (`VITE_KLIPY_API_KEY`), read at `:65-78`; blank ⇒ disabled `:80-82` |
| Key travels in the request **path** | `klipy.ts:293`, `:338` |
| Key is compiled into the shipped bundle | `scripts/check-klipy-config.mjs:110-111` asserts the emitted JS and the APK contain it |

Server path, verified absent:

- `supabase/functions/` holds 12 functions (`reply-comment`, `chat-media`,
  `delete-account`, `push-dispatch`, `copy-chat-evidence`, `cleanup-report-media`,
  `device-enroll`, `telegram-auth-webhook`, `cleanup-comment-media`,
  `trust-maintenance`, `cleanup-chat-media`, `chat-wake`). None references Klipy.
- `grep -i klipy` across `supabase/` matches only migrations and tests — no
  `api.klipy.com`, no fetch, no proxy.

Because the key travels in the URL path, a server-side relay would additionally
put the key into server access logs. That is a second, independent reason the
request stays on the device.

## Message shape: a provider reference, never bytes

When a user sends a Klipy sticker or GIF in chat, the message carries **a pointer
to Klipy**, not a copy of the media.

Shape (proposed):

```
message.klipy = {
  kind:        "gifs" | "stickers",
  slug:        string,        // Klipy's stable id
  url:         string,        // the media URL exactly as Klipy returned it
  previewUrl?: string,        // the preview URL exactly as Klipy returned it
}
```

Rules for that record:

- `url` and `previewUrl` are stored **verbatim**. Klipy requires us to preserve
  the returned URLs and delivery data and not rewrite, re-sign or strip
  parameters.
- Both are re-validated against the same allowlist on read
  (`klipy.ts:157`), at the DB, and on the recipient. A reference is untrusted
  input, exactly like a comment body link.
- `kind` is checked against `('gifs','stickers')`.
- `slug` must match `^[A-Za-z0-9_-]{1,128}$` — the shape already enforced for
  comments at `20261011020000_comment_attachments_relation.sql:113`.
- No bytes, no base64, no hash, no byte size, no dimensions. `MediaMetadata` stays
  URL-free (`apps/mobile/src/services/messaging/media.ts:67-90`) and untouched.

This deliberately leaves `MessageType` (`services/messaging/history.ts:12`) and
every chat media gate alone. A reference message is a TEXT message with an extra
validated field, so the eight upload/verification gates never come into play.

### The migration this needs — named, not written, not applied

A schema change is required and **has not been written or applied**:

```
supabase/migrations/<pending>_chat_message_klipy_reference.sql
```

It must add to the chat message record a nullable Klipy reference (or a sibling
table) with: the `kind` CHECK, the slug regex CHECK, an https-only CHECK, and a
host CHECK restricted to `klipy.com` / `*.klipy.com` — mirroring the comment-side
columns at `20261011020000_comment_attachments_relation.sql:39-52` and the
provider CHECK at `20261012020000_comment_attachments_parity.sql:74`.

Until that migration is accepted, chat cannot carry a Klipy reference at all. Per
the repository rule on migration-bearing work, the whole backend-dependent change
stays local until migration plus dependent code pass.

Trade-offs, stated plainly:

- **URL rot is unrecoverable by design.** We are forbidden to rewrite URLs, so
  when Klipy retires a URL the message cannot be repaired. The renderer must
  degrade to a neutral "GIF no longer available" state rather than a broken image.
- **No integrity guarantee.** A reference cannot be hashed and length-checked the
  way uploaded media is. The existing "verified bytes" guarantee now applies to
  user-uploaded chat media only; it can no longer be stated as a property of *all*
  chat media.
- **The recipient's device talks to Klipy.** The recipient's IP reaches Klipy on
  render. That is inherent to the model and should be reflected in the privacy
  note.
- **Online only.** A reference message has nothing to show offline; caching
  previews (below) softens but does not remove this.
- **Provider removal wins.** If Klipy removes content, our copy disappears with
  it. That is correct behaviour, and it is why we do not mirror.

## Rights and provider terms

Klipy's public requirements (`https://docs.klipy.com/integration-requirements.md`)
match our rule almost verbatim:

- *"Send requests from the end-user client"* — requests and media loads must
  originate from the user's app; *"Do not route requests through partner-operated
  servers, proxies, CDNs, or other intermediaries."*
- *"Load KLIPY media directly"* — *"Do not store, mirror, re-host, rewrite, or
  retain copies of KLIPY media unless KLIPY has approved a different delivery
  method in writing."*
- *"Preserve KLIPY URLs and delivery data"* — do not alter or reconstruct URL
  parameters or identifiers.
- *"Preserve Search and Trending results"* — no independent reorder, insert,
  remove, suppress or replace. Term blocking is done in the Klipy Partner Panel
  (`https://partner.klipy.com/manage-content`), not in our client.
- *"Keep content sources separate"* — Klipy results get their own tab; never blend
  them into one grid with other providers.

Attribution obligations (`https://klipy.com/support/api-terms`, last updated
2026-06-23):

- §4: *"You must (i) visibly include KLIPY brand attribution within your
  Application, and (ii) follow any brand usage guidelines we provide."*
- §5: *"Where attribution details (such as username or content source) are
  provided by KLIPY, you must display them clearly in your Application."*

Note a real tension in Klipy's own documentation:
`https://docs.klipy.com/attribution.md` calls the search placeholder *"Search
KLIPY"* **required**, and the watermark and "Powered by KLIPY" **optional** —
while the API Terms §4 states brand attribution is mandatory. We already satisfy
the stricter reading: `KLIPY_ATTRIBUTION = "Powered by KLIPY"` (`klipy.ts:37`) is
rendered at `apps/mobile/src/components/CommentComposer.tsx:887-891`, and the
search field uses `KLIPY_SEARCH_PLACEHOLDER = "Search KLIPY"` (`klipy.ts:40`).
Keep both. Do not downgrade to the looser document.

Removal and reporting obligations:

- Klipy may remove, block or disable content at any time. A reference model
  honours that automatically; this is a feature, not a limitation.
- Klipy exposes a report endpoint with a fixed reason enum (`nudity`, `violence`,
  `hate_speech`, `harassment`, `spam`, `misinformation`, `copyright`,
  `offensive`, `illegal`, `broken`, `low_quality`, `not_relevant`,
  `impersonation`, `other`) — see `https://docs.klipy.com/llms.txt`. Every Klipy
  surface should be able to report a result in place. **Gap:** today there is no
  report affordance on a Klipy tile.
- Never strip or obscure Klipy branding from the media or the UI. The ToS forbids
  removing proprietary notices.

## Caching: opt-in, device-local, thumbnails only

The owner's direction — *"if caching is allowed ... enable users the ability to
cache"* — is exactly the condition that governs this section, because Klipy's
position is restrictive.

What Klipy actually permits:

- API Terms §1 (`https://klipy.com/support/api-terms`): *"You may not cache or
  store KLIPY Content [other than the search results thumbnails stored within a
  user's copy of your Application.]"* It then forbids using Klipy content to
  *"compile, build, or expand any database, directory, or collection of
  content"*, and forbids combining Klipy results with other sources without
  written consent.
- Integration requirements: *"Standard integrations must load KLIPY media
  directly and must not create a partner-operated media cache."* Approval *"must
  be obtained before the caching layer is developed or deployed"*, and
  *"Partners must not implement KLIPY media caching independently."*

Read together — **and this reconciliation is inference, not a quote** — the only
narrowly permitted cache is: search-result **thumbnails**, held **inside the
user's own copy of the app**, i.e. on the device, not on our infrastructure. That
is not a "partner-operated" cache, and it is the one case the API Terms carve out
by name.

Therefore:

| Decision | Value |
| --- | --- |
| What may be cached | Picker/preview thumbnails only (`previewUrl`) |
| What may never be cached | Full media (`url`), API JSON responses, any derived library |
| Where | On the device, in that user's app storage |
| Default | **Off** |
| Scope | Per user, cleared on sign-out and account switch |
| Approval required before shipping | **Yes** — written confirmation from Klipy if this is ever treated as more than a thumbnail cache |

Design:

- **Setting.** Add a switch to the existing Settings → Media screen
  (`apps/mobile/src/screens/MediaSettings.tsx:9-41`, using the existing
  `PreferenceSwitchRow`) labelled as keeping GIF previews on the device. Off by
  default. There is no Settings → Data screen; do not invent one for this.
- **Storage.** Cache Storage, one named cache (for example `klipy-previews-v1`),
  keys are the provider preview URL verbatim. Keys are never rewritten, which
  also keeps us compliant with the URL-preservation rule. Only responses fetched
  by the user's own rendering are stored; nothing is fetched in order to fill the
  cache.
- **No prefetch, no warm-up, no background fill.** Caching a preview the user is
  already looking at is permitted; speculatively downloading a catalogue is not,
  and it also runs into the ToS prohibition on *"unreasonable load"*.
- **Caps and eviction.** Start at 40 MiB or 400 entries, whichever binds first,
  with LRU eviction by last access. These are starting budgets, not measured
  values.
- **Visibility.** Show "Used X MB" and a **Clear cached previews** action. A cache
  the user cannot inspect or clear is not user-controlled.
- **Lifecycle.** Clear on sign-out (`services/auth.ts:295-299`) and on account
  switch through the existing scoped-storage boundary
  (`services/accountScopedAuthStorage.ts:34-36`). Never let one account's previews
  serve another account.
- **Honesty about what it buys.** This reduces image re-downloads and makes the
  picker feel instant on a second visit. It does **not** reduce API request
  volume — search results are never cached, so the 100 requests/hour testing-key
  cap (`https://docs.klipy.com/getting-started.md`) is unaffected.

Native caveat to settle before building: Cache Storage behaviour inside the
Capacitor WebView on a real device (persistence across app restarts, eviction
under storage pressure, whether it survives an APK update) is **unverified**
here. If it proves unreliable, the fallback is an explicit on-disk blob store via
the Filesystem plugin — still device-local, still thumbnails only. Do not assume
either works without a device check.

## Privacy

- **Set `referrerPolicy="no-referrer"` on Klipy media images.** The picker renders
  `src={item.previewUrl}` at `CommentComposer.tsx:874-879` with no referrer
  policy, and a grep finds zero `referrerPolicy` occurrences anywhere in
  `apps/mobile/src`. Today every thumbnail request discloses our app origin to
  `static.klipy.com`.
- **Never log a Klipy API URL.** The key is a path segment (`klipy.ts:293`,
  `:338`), so a logged request URL is a leaked key.
- **The API key is a public identifier, not a secret.** It is compiled into the JS
  bundle and the APK by design (`scripts/check-klipy-config.mjs:110-111`). Treat
  it as rate-limited, not confidential: anyone can extract it, and the 100
  req/hour testing cap is the only brake. Request production access through the
  Partner Panel so that abuse does not starve real users.
- **`raw` is preserved but never rendered and must never be persisted** —
  `klipy.ts:61-62`. It is the full provider payload; storing it server-side would
  be closest to the "collection of content" the API Terms forbid.
- The recipient of a reference message contacts Klipy when the message renders.
  Disclose that in the privacy copy; do not describe GIF messages as
  end-to-end private in the sense that uploaded media is.

## Safety

- Klipy content is untrusted third-party content. Render it only through `<img>` /
  `<video>` with a provider URL that passed the allowlist (`klipy.ts:157`). Never
  inject provider HTML, never `dangerouslySetInnerHTML` with provider data.
  (Klipy's `ad-*` fields are HTML meant for a WebView; we run no ads, so they
  never apply and must never be rendered.)
- Keep `content_filter=high` on every search (`klipy.ts:41`). If a term must be
  blocked, block it in the Partner Panel — do not filter client-side, because
  independent filtering of results is prohibited.
- Keep the provider allowlist and re-check it on every read path, not just on
  intake. A stored reference is input from an untrusted device.
- Report-in-place: wire Klipy's report reason enum to a control on the tile, so a
  user can flag content to Klipy without leaving the app.
- Share tracking stays post-only (`klipy.ts:27-29`, fired at `:347-361`). Never
  on search, preview, scroll or select.
- Attribution stays visible on every surface that shows Klipy content.
- When a reference can no longer be loaded, show a calm "no longer available"
  state. Never substitute a cached or invented asset that looks like the
  provider's.

## Out of scope

- Any server-side Klipy call, proxy, transform, mirror or re-host. Permanently.
- Proxying Klipy media to make it look same-origin, to bypass CORS, or to hide
  the recipient's IP.
- Caching full GIFs, videos or Clips on the device, or shipping a pre-seeded
  catalogue of Klipy media.
- Blending Klipy results with other providers in one grid.
- Matching Klipy search reordering, dedupe or suppression logic of our own.
- Klipy "Avatars" or a third picker tab with no Norfold avatar system behind it.
- Server-side storage of the raw Klipy payload.

## Unverified

- Whether an ordinary WebView HTTP cache (honouring `Cache-Control`) counts as a
  permitted thumbnail cache under the API Terms carve-out. It is not a
  partner-operated cache, but this has not been confirmed in writing.
- Cache Storage persistence and eviction inside the Capacitor WebView on a
  physical device.
- Whether Klipy's API payload carries creator/username attribution that API Terms
  §5 requires us to display. `normalizeKlipyItem` extracts only
  kind/slug/title/urls/dimensions (`klipy.ts:214-223`), so if it does, we are
  currently not displaying it. Needs a live-response check.
- Long-term URL stability of `static.klipy.com` media paths.
- Whether written approval is needed for a thumbnail-only device cache in
  Norfold's specific case. The two Klipy documents are reconcilable on a narrow
  reading; get it confirmed if the cache ever matters commercially.
