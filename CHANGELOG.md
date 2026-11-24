# Changelog

Norfold is **beta / pre-public**. Versions below are the derived pre-1.0 line
described in [docs/history/VERSION_HISTORY.md](docs/history/VERSION_HISTORY.md). They
track real evolution and do not imply a stable release. The per-commit mapping is in
[docs/history/VERSION_HISTORY.csv](docs/history/VERSION_HISTORY.csv).

## 0.16.0-beta.3

- Chat opens in a compact window that floats over the page you were on. Start
  from the chat button, pick a recent conversation or search for someone, then
  minimize the window to its header, restore it, or open the full Chats screen.
  A minimized window keeps its draft, staged photos and recording.
- The recorder, the preview and the sent note draw the same voice wave, with one
  bar thickness and a visible gap on a narrow phone. The recording clock is a
  single rule that fills over a minute and restarts, and a small mark fills in
  for each minute recorded.

## 0.16.0-beta.2

- Report cards show the status beside the title, and category and location
  appear as icons with the author. Hover, focus or tap an icon for its label.
- A report's page puts its type and recovery state in badges under the title,
  so both are read at a glance instead of as notes in the heading.
- On a computer, resting on a name or avatar opens a short public profile
  preview. Clicking still opens the profile page; touch is unchanged.
- Appearance offers Automatic, bottom bar and side rail navigation, and
  adaptive, colorful or monochrome reactions, with a report preview.
- Menus, popovers and toasts share one lifted surface style; a toast clears the
  phone's home indicator.

## 0.16.0-beta.1

- On-device chat and photo analysis have been removed. AI chat uses your own
  provider key; the local search helper and sentence model remain. Files from
  older downloaded models are found on upgrade and offered for removal.
- Downloaded models now offer Try again when the device cannot be checked;
  unsupported devices are told the helper needs a 64-bit ARM device.
- Rate Norfold once per account and edit your rating later. The average is
  calculated by the server; ratings of reports remain read-only.
- Feed updates no longer identify posts on the shared channel, and individual
  post updates are available only to people who can see that post.
- AI chat distinguishes invalid keys, blocked accounts, exhausted quotas and
  rate limits. Interrupted answers are marked incomplete, and refusals are
  shown without being saved as replies.
- Message order stays stable after reopening or restoring a device backup.
  When the backup limit is reached, the app asks you to remove an old backup.
- Search retries the failed operation, describes empty places more accurately,
  announces which filter a chip clears and keeps distance changes while locating.
- Photo privacy now clears all stripped WebP metadata flags. Animated GIFs keep
  their animation without embedded metadata; oversized GIFs become a still with
  a disclosure that only sampled frames are seen.
- Screen readers announce reaction counts only after your own action changes
  them, without a visible count-update toast.
- Shared-report links work with uppercase letters, and Android update versions
  are ordered correctly for prereleases.
- Web deployment and signed APK builds wait for a successful CI run.

## 0.15.0-beta.2 - APK version bump

- Bump the source version for the next APK; publication and device acceptance
  are not implied.

## 0.15.0-beta.1 — chat finishing

- Replies jump: tapping a reply's quoted reference scrolls to the original and
  rings it visibly, including a quote that names a photo hidden inside an
  album. Reduced motion keeps a static ring instead of animating.
- Photos from one send render as one bubble using the standard 2 / 3 / 4+
  grids. Cells share the canonical photo control and viewer, opening at the
  tapped photo; the first photo owns the caption and the last owns the time
  and receipts.
- Pinned messages: up to three per connected conversation, shared across both
  participants' devices. A compact strip below the chat header jumps to a
  pinned message, Pin/Unpin lives in the existing long-press menu, and an
  unsent message is removed from the pins by the server.
- An unsent message keeps one hidden local copy for 24 hours so it can still
  be reported to staff; it is never rendered, synced or included in backups,
  keeps the body or caption rather than photo/voice bytes, and is deleted when
  the window ends. A reported copy is purged once the server confirms.
- Reporting a person sends the five most recent messages by default, whether
  text, photo, voice or location, and the reporter can select fewer or up to
  twenty. Staff see only the selected excerpts, labelled as not the whole chat;
  the copy is built server-side from the message rows.
- The sender's composition time travels with a send, so both participants
  group the same photo batch and show its clock identically instead of
  measuring upload latency.
- Google sign-in no longer dead-ends when Credential Manager has no usable
  credential: the same Supabase Google provider completes in the system
  browser and returns through the verified `/auth/callback` App Link.
- Device-bound builds (`signeddev` / `release`) now fail closed when the APK is
  not signed by the canonical findback-release certificate, so a debug-signed
  APK can no longer masquerade as an acceptance build.
- Published as the `v0.15.0-beta.1` GitHub prerelease with signed APKs built
  from HEAD `340e201e`; still not a stable public release, domain migration or
  device acceptance. Phone/browser acceptance with real accounts is recorded
  separately.

## 0.14.0-beta.1 — Norfold rebrand

- The consumer product is now **Norfold**; the bird/leaf logo and the current
  production site (`findbackapp.social`) are unchanged. No replacement domain
  was purchased or announced.
- Consumer name, app label, metadata, auth/help/legal/About copy, share
  previews and the README now say Norfold. The accent previously named
  "FindBack Blue" is now "Blue".
- Workspace packages moved to `@norfold/*`; technical identifiers (Android
  application id, Supabase project, `findback_*` SQL, storage buckets,
  migrations) were intentionally kept.
- Published later as the `v0.14.0-beta.1` GitHub prerelease; not device
  acceptance or domain migration.

## 0.13.0-beta.1 — product fit reset (beta checkpoint)

- Relevance-aware server candidate retrieval before the bounded pool; retained
  local Needle/USE ranking and useful web matching.
- Canonical colour roles, Blue default, graphite/light/AMOLED surfaces,
  optional Android12+ System colours and per-device wide navigation choice.
- Truthful recovery journey, sanitized same-domain anonymous report previews,
  explicit privileged role acceptance and launch-gated one-time local reset.
- Retired the unused legacy Node API/reference containers; optional BYOK Chat
  and the existing recovery/private-messaging owners remain.
- Authorized live reset removed10Auth accounts,83product rows,18Storage objects
  and3old sign-in flows;53public tables/four buckets/configuration preserved.
  Only intended2bootstrap email offers and1pending invitation were retained.
- Beta/source checkpoint, not a GitHub Release or native/account acceptance.

## 0.12.0-beta.1 — product coherence (historical source checkpoint)

- Unified phone/desktop navigation, adaptive split views, anchored actions,
  task/confirmation surfaces and a shared zoomable photo viewer.
- Compact reports/comments, contextual desktop report details, shared Create/Edit
  editor, clearer matching/recovery and Settings/Profile organization.
- Reports/People discovery, notification quick view, canonical Chats with request
  flows, mute, personal Archive, report context and explicit static location.
- Removed retired local-generative runtime/lab tooling while retaining on-device
  Smart Search, Needle/USE matching, upgrade cleanup and separate optional cloud Chat.
- Repaired content erasure/exact replay, report-preview revocation, account-bound
  publication and stale editor continuations. Ambiguous already-erased legacy
  send identities fail closed rather than falsely acknowledging changed content.
- Local source/fixture acceptance only. The four migrations were subsequently
  observed hosted at the Product Fit Reset baseline; the old LIVE-PENDING label
  is superseded. No release was created by that version change. Real-account/browser,
  physical Android, Sentry and owner phone-photo corpus acceptance remain unpassed.

## 0.11.0-beta.2 — functional freeze

- Functional freeze recorded: frozen source, test totals, live migration head,
  deployed function inventory and the named external gates that remain.
- Matching/recovery, private chat R4, trust/staff flows and consumer/native truth
  closed in the preceding interval; this interval reconciles the integrated gates
  and records the freeze.

## 0.11.0-beta.1 — product breadth

- Largest feature interval: matching and recovery, private chat, trust and
  moderation, native integration and backend function work, with a long tail of
  fixes across client and server.
- Cloud functions and runtime deployment sets brought in line with the source.

## 0.10.0-beta.1 — pre-1.0 line correction

- Release bookkeeping, tooling instructions and map/capability work.
- The earlier `1.0.0` label claimed a stable release that never shipped; the project
  stays on the pre-1.0 beta line. Nothing was removed — this period's work is kept
  under the corrected version.

## 0.9.0-beta.1 — assistant landing

- Assistant landing, neutral palette and a security hardening pass.

## 0.8.0-beta.2 — release bookkeeping and dependency reconciliation

- Completion-record reconciliation to the beta.2 bump, non-breaking dependency
  audit fixes, and release/documentation corrections.

## 0.7.0-beta.2 / 0.7.0-beta.1 — capability truth

- Assistant mode unified under account-scoped preferences; user-facing AI and cloud
  connection claims corrected on client and server.

## 0.6.0-beta.1 — account-scoped AI preferences

- AI preferences persisted per account, Help converged onto the intent router and a
  grounded help operation.

## 0.5.0-beta.1 — on-device photo engine

- On-device SmolVLM2 became the default report-photo engine; release-gate tests made
  environment- and timing-independent.

## 0.4.0-beta.3 / .2 / .1 — native release pipeline and design system

- Signed per-ABI Android builds, pinned NDK provisioning and exact per-ABI asset
  checks; settings and appearance design system with contrast and AMOLED handling.

## 0.3.0-beta.1 — AI orchestrator

- Typed-proposal orchestrator contract and the first substantial on-device AI release.

## 0.2.0-beta.3 / .2 / .1 — feed, sharing and report redesign

- Home feed cards and filters, nearby discovery, report redesign with photo-viewer
  fixes, canonical report sharing and App Links.

## 0.1.0-beta.1 — first declared beta

- Signed beta pipeline, strict release preflight, manual backend deploy and the
  first beta release notes.

## 0.1.0-alpha.1 — early app

- Recognizable app: feature screens and routing, feed and comments, API and database
  work, with rapid architectural change.

## 0.0.1-dev.1 — scaffold

- Monorepo scaffold with the local Node API and SQLite store; no usable consumer
  flow yet.

---

Older generated changelog text that attributed later work to earlier intervals, or
listed unimplemented behaviour, is withdrawn rather than silently carried forward.
The original text remains recoverable in Git history.
