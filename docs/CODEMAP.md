# Code map

Norfold is a lost-and-found app: people report an item, find a possible match,
and coordinate its recovery. The TypeScript monorepo contains a React and Vite
client wrapped with Capacitor in `apps/mobile`, a Supabase backend, and shared
types, schemas and validation in `@norfold/shared` (`packages/shared`). This
map is a starting point, not a substitute for reading the implementation or
the repository rules in [AGENTS.md](../AGENTS.md).

## Directory map

Directories below are entry points. Read the named owner before following
imports; tests commonly sit next to the implementation they exercise.

### Applications and shared package

- `apps/mobile/`: client workspace; start with its `package.json` for scripts.
- `apps/mobile/src/`: app source; `main.tsx` and `App.tsx` are startup and routes.
- `apps/mobile/src/assets/`: client assets; inspect when changing bundled visuals.
- `apps/mobile/src/components/`: shared UI; look here before adding a viewer or composer.
- `apps/mobile/src/contracts/`: compatibility and migration contract tests.
- `apps/mobile/src/design/`: design primitives and ownership tests.
- `apps/mobile/src/fixture/`: fixture routes and sample data for isolated UI work.
- `apps/mobile/src/hooks/`: React hooks; check here for shared interaction and feed state.
- `apps/mobile/src/native/`: native bridge adapters, including Google auth and maps.
- `apps/mobile/src/plugins/`: client plugin interfaces, including short-link resolution.
- `apps/mobile/src/screens/`: route-level screens and their colocated tests/styles.
- `apps/mobile/src/services/`: data, platform and business services; start here for behavior.
- `apps/mobile/src/services/ai/`: AI preferences and application knowledge.
- `apps/mobile/src/services/auth/`: provider-specific authentication flows.
- `apps/mobile/src/services/location/`: location search and picker state.
- `apps/mobile/src/services/media/`: image import and media processing primitives.
- `apps/mobile/src/services/messaging/`: chat persistence, sync and backup.
- `apps/mobile/src/services/monitoring/`: monitoring and release integration.
- `apps/mobile/src/services/search/`: search filters and geographic scope.
- `apps/mobile/src/services/updates/`: update catalogue and availability logic.
- `apps/mobile/src/test-utils/`: helpers shared by client tests.
- `apps/mobile/src/utils/`: general utilities, including accessibility and auth redirects.
- `apps/mobile/android/`: Capacitor Android project; inspect for native integration.
- `apps/mobile/public/`: static public assets for the web build.
- `apps/share-preview/`: separate HTTP share renderer; inspect `handler.cjs` for requests.
- `apps/share-preview/share/`: share endpoint configuration; inspect with the handler.
- `apps/share-preview/android-updates/`: Android update endpoint configuration.
- `packages/shared/src/`: shared categories, constants, schemas and validation.

### Backend

- `supabase/migrations/`: ordered database changes, RPCs, grants and policies.
- `supabase/functions/`: Edge Function entry points and handlers.
- `supabase/functions/_shared/`: shared Edge gateway, authorization and CORS helpers.
- `supabase/functions/chat-media/`: authenticated chat media upload/download endpoint.
- `supabase/functions/chat-wake/`: chat wake endpoint.
- `supabase/functions/cleanup-chat-media/`: scheduled chat-media cleanup endpoint.
- `supabase/functions/cleanup-comment-media/`: comment-media cleanup endpoint.
- `supabase/functions/cleanup-report-media/`: report-media cleanup endpoint.
- `supabase/functions/copy-chat-evidence/`: chat evidence copy endpoint.
- `supabase/functions/delete-account/`: account deletion endpoint.
- `supabase/functions/device-enroll/`: device enrollment endpoint.
- `supabase/functions/push-dispatch/`: push delivery endpoint.
- `supabase/functions/reply-comment/`: comment reply endpoint.
- `supabase/functions/trust-maintenance/`: trust maintenance endpoint.
- `supabase/email-templates/`: authentication email templates.
- `supabase/tests/`: SQL, migration parity, concurrency and live-test harnesses.

### Tooling and documentation

- `scripts/`: build, configuration checks, deployment helpers and script tests.
- `scripts/device-harness/`: device capture and APK provenance helpers; observe device consent rules.
- `docs/`: architecture, operations and historical documents; check dates and source.
- `docs/acceptance/`: acceptance records and waivers.
- `docs/auth/`: auth setup and email templates.
- `docs/bench/`: matching evaluation datasets and policy.
- `docs/course/`: historical course implementation material.
- `docs/erd/`: database relationship documentation.
- `docs/evidence/`: recorded environment and service evidence; not current-state proof.
- `docs/history/`: dated historical reports and CI descriptions.
- `docs/plans/`: implementation plans; verify status before using one.
- `docs/release-notes/`: versioned release notes.
- `docs/releases/`: release and source-closure records.
- `docs/reporting/`: reporting documentation.
- `docs/runbooks/`: operational procedures and maintenance instructions.
- `docs/screenshots/`: screenshot files and their manifest.

## Ownership boundaries

These boundaries identify where to start; backend authority and client rendering
can have separate owners. Search callers and migrations before changing one.

### Reactions

- `packages/shared/src/schema.ts` and `packages/shared/src/constants.ts` define
  shared reaction shapes and kinds.
- `apps/mobile/src/services/reactions.ts` owns reaction presentation metadata
  and service operations; `feedReactions.ts` handles feed-facing operations.
- `apps/mobile/src/hooks/useFeedLove.tsx` integrates feed reaction state.
- `supabase/migrations/` owns database reaction authorization and projections;
  inspect the latest applicable definitions rather than copying a client check.

### Media and attachments

- `apps/mobile/src/services/media/` contains common image import/processing.
- `apps/mobile/src/services/image.ts`, `photo.ts` and `photoBytes.ts` provide
  client-side image and photo operations; follow their callers for each flow.
- `apps/mobile/src/services/postsUpload.ts` handles report uploads;
  `commentAttachments.ts` handles comment attachment references.
- `apps/mobile/src/services/messaging/` owns chat-specific media and storage.
- `supabase/functions/chat-media/handler.ts` gates chat-media transport.
- `supabase/functions/_shared/chatMediaGateway.ts` and `chatMediaDownload.ts`
  implement the corresponding Edge-side media paths.

### Auth and session

- `apps/mobile/src/auth.tsx` owns React auth integration.
- `apps/mobile/src/services/auth.ts` provides auth operations;
  `supabaseClient.ts` owns client construction.
- `apps/mobile/src/services/session.ts` holds the synchronous token cache;
  its comment states that the Supabase SDK owns session persistence.
- `accountScopedAuthStorage.ts` and `authSessionIdentity.ts` handle account
  identity boundaries; avoid independent session caches in a screen.

### Theme and appearance

- `apps/mobile/src/theme.tsx` provides theme integration.
- `apps/mobile/src/appearance.ts` and `apps/mobile/src/design/colorSystem.ts`
  hold appearance and color-system behavior.
- `apps/mobile/src/index.css` supplies global styling; use the existing system
  rather than inventing a separate per-screen theme.

### Photo viewer

- `apps/mobile/src/components/MediaViewer.tsx` and `MediaViewer.css` are the
  shared viewer; `photoPager.ts` supplies pager behavior.
- `FeedMediaCarousel.tsx` and `ReportPhotoCarousel.tsx` are contextual carousels,
  not replacements for the shared viewer.

### Privacy and blocking

- `apps/mobile/src/services/blocks.ts` is the client block service;
  `BlockControl.tsx` and `BlockedByViewerShield.tsx` provide related UI.
- `supabase/migrations/20261017070000_visibility_kernel_and_blocks.sql` sets
  out the visibility/block kernel; subsequent migrations can replace its rules.
- `supabase/migrations/20261023020000_trust_blocks_feedback_recovery.sql`
  implements directional block writes and describes their symmetric effect.
- Client shielding is not an authorization boundary: verify the applicable SQL
  and Edge handler whenever a read or mutation changes.

## Data and authority invariants

### Chat objects are not interchangeable

- Message bodies are durable chat content. Recovery validates immutable message
  identity and authority; see `docs/CHAT_HISTORY_RECOVERY.md` and
  `supabase/migrations/20261024090000_r3_chat_messages.sql`.
- Media bytes travel separately through `supabase/functions/chat-media/handler.ts`.
  The handler validates media type and bounds before gateway processing.
- Attachment metadata is a separate database record: the authorization and
  delivery migrations define attachment state, object references and expiry:
  `20261028010000_chat_media_authorization.sql` and
  `20261028020000_chat_media_delivery.sql`, both under `supabase/migrations/`.
- Backup manifests are indexes of sealed backup objects, not message bodies or
  authorization grants. `apps/mobile/src/services/messaging/backupDrive.ts`
  writes parts before the manifest and namespaces manifests by installation;
  `backupCrypto.ts` seals manifests and chunks with context-bound encryption.
- Recovering a parent message does not guarantee that its media bytes still
  exist. See `docs/CHAT_HISTORY_RECOVERY.md` and the media expiry checks.

### Ratings and retention

- Recovery feedback must derive the rated user from the other participant;
  the client cannot supply an arbitrary target. The writer and its explanatory
  comment are in `20261023020000_trust_blocks_feedback_recovery.sql`.
- Chat media is time-bounded, with state and expiry checks in
  `20261028010000_chat_media_authorization.sql`; cleanup is separately handled
  by `supabase/functions/cleanup-chat-media/` and later SQL changes.
- Do not assume a message retention period is the same as media retention or
  that a backup manifest extends server media eligibility.

### Server authority

- A device's local copy or a backup reference is not permission to fetch.
  `supabase/functions/chat-media/handler.ts` invokes
  `findback_chat_media_target_client` before downloading an object.
- Device admission and current server state matter to chat and backup;
  `20261104020000_norfold_backup_authority.sql` gates backup keys through
  device context, while `docs/CHAT_HISTORY_RECOVERY.md` describes history
  authority checks. Inspect later migrations before modifying either path.
- A successful client-side block guard or hidden control does not replace
  database authorization or storage access checks.

## Tests and checks

- Client Vitest tests are generally colocated as `*.test.ts` or `*.test.tsx`,
  for example `apps/mobile/src/services/reactions.test.ts` and
  `apps/mobile/src/components/MediaViewer.test.tsx`.
- Migration and compatibility tests also live in client service and contract
  directories; `supabase/tests/` contains SQL and integration-oriented tests.
- `scripts/*.test.mjs` and `scripts/*.test.py` test tooling; the root `test`
  script does not explicitly include these or `supabase/tests/`.
- Root `package.json` defines `npm test` as
  `npm run build -w packages/shared && npm run test -w apps/mobile`.
- `apps/mobile/package.json` defines its `test` script as `vitest run`.
- Root `npm run typecheck` builds shared then runs the mobile typecheck;
  root `npm run lint` invokes `eslint .`.
- Root `npm run build` builds shared and mobile; build configuration requirements
  and resource restrictions are in [AGENTS.md](../AGENTS.md).
- SQL/live scripts have separate prerequisites; read the individual harness
  before execution. A client test run is not live backend or device acceptance.

## Known traps

1. **Migration history is not current schema.** For example, the original
   rating schema is in `20260912000000_init.sql`, while the recovery feedback
   writer appears in `20261023020000_trust_blocks_feedback_recovery.sql`.
   Search later definitions and grants before drawing conclusions.
2. **Reaction names have historical meaning.** `reactions.ts` distinguishes
   current writes from historical read kinds; don't infer writable kinds solely
   from a displayed emoji or stored legacy value.
3. **A cached token is not session ownership.** `session.ts` calls its token an
   in-memory cache; SDK persistence and account transitions have separate owners.
4. **Manifest publication is ordered.** `backupDrive.ts` writes the manifest
   last; replacing it early can reference chunks that have not been committed.
5. **Media download is not a direct storage shortcut.** The Edge handler asks
   the database for a target and returns a failure when eligibility is absent.
6. **Historical evidence is not a live-state check.** `docs/history/` and
   `docs/evidence/` contain dated or recorded artifacts; verify current state
   independently before treating them as deployment evidence.
