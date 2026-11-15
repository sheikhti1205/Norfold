# cleanup-chat-files

Service-only sweep that removes private conversation-file objects no live
message references. Companion to the per-account 100 MB budget enforced by
`20261115140000_chat_file_budget.sql`.

## Why it exists

A file message carries its Storage object key inside the message body as
`norfold-file:v1:<base64url JSON>`. Deleting the message clears the body; it
never removed the object, and no worker swept the orphans. The client
`removeChatFile()` only cleans up a failed send. This worker is the only path
that removes bytes a deleted message left behind.

## Contract

- `POST` with an **empty body** only. The endpoint authenticates through
  `@supabase/server` `auth: "secret"` (server secret API key). Deploy with
  `--no-verify-jwt`. No anonymous, public or user route can list or delete.
- One sweep per endpoint/isolate; an overlapping call returns `503 {status:"retry"}`.
- Bounded work: 100 entries per page, at most 200 folder listings, at most 500
  objects, 50 keys per Storage delete, 80 s soft deadline inside a 90 s cap.
- Results contain counts only — never buckets, keys or raw SDK errors:
  `{ scanned, removed, kept, errors }`.

## Per-object protocol

1. List the bucket root, then `files`, then `files/<uid>`, then
   `files/<uid>/<conversation>` — the depth the client writes. Any object whose
   key does not start with `files/` is a deletion candidate once it is old.
2. Skip anything younger than 24 hours (`updated_at`); an entry with no
   parseable timestamp is treated as new.
3. Build the marker fragment for the object key and ask
   `public.findback_chat_file_marker_present(p_marker)`. A live message body
   keeps the object; nothing else does.
4. Delete unreferenced keys in batches through the Storage API.
5. `errors` counts objects Storage did not confirm as removed (and objects the
   worker could not build a trustworthy fragment for). They stay for the next
   run — never a partial delete of a *referenced* file.

## Why the fragment is built here

The marker payload is `base64url({"k":<key>,"n":...,"m":...,"s":...})`. A
base64url group is 4 characters for 3 bytes, so only a byte prefix whose length
is a multiple of 3 encodes to a prefix of the whole encoded string. The worker
encodes `JSON.stringify({ k: objectKey })`, drops the closing brace and truncates
to a multiple of 3. That fragment is a strict prefix of every real marker for the
object (proven against a real client marker in `handler_test.ts`), so one
language owns the encoding and the database only does a substring test.
`position()` is used in SQL rather than `LIKE` because base64url contains `_`,
which `LIKE` reads as a wildcard.

## Failure policy

- A reference-probe error stops the sweep and answers `500 {error:"Cleanup
  unavailable"}`. No deletion happens on uncertainty.
- A listing error does the same.
- A Storage delete that returns an error is counted in `errors` and retried next
  run.
- A request cancellation or an expired deadline answers `503` with the counts
  collected so far.

## Scheduling

`.github/workflows/chat-media-maintenance.yml` POSTs to this function after the
`cleanup-chat-media` step, with the same secret `apikey` header. It is not
registered in `pg_cron`: the file lane needs no per-minute latency and the
existing maintenance lane already runs every 15 minutes.

## Known bound

The sweep is bounded, not exhaustive. With more than 500 objects the tail in
name order is not examined in that run. That is a hygiene limit, not a security
one: the bucket is private and reads are participant-scoped. Raise the caps only
with a measured runtime.

## Verification performed

- Static: `supabase/tests/chat_file_budget_policy.test.mjs` (Node) pins the
  migration's functions, grants and policy, the marker prefix parity with the
  client, and the workflow wiring.
- Handler: `deno test supabase/functions/cleanup-chat-files/handler_test.ts`
  runs in CI only — this checkout has no Deno runtime.

## Not verified

Deployed function behaviour, hosted Storage `list` ordering and pagination
against a populated bucket, real delete semantics, and scheduler throughput. No
credentials were read.
