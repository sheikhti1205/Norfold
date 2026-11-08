# Development guide

Norfold is a monorepo with a React/Capacitor client, a shared package and one
Supabase backend. This page is the practical setup and check reference; the design is
in [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- Node.js 24.5+ and npm for development and the full test suite. Messaging tests
  use native `navigator.locks` / `node:worker_threads.locks`; Node 22 remains the
  public-preview Azure runtime baseline but cannot run those lock-dependent tests.
- A Supabase project (or the local Supabase CLI stack) for anything that touches the
  backend
- For Android builds: JDK 21, Android SDK with the pinned NDK, and a signed release
  keystore only when producing release artifacts

## Setup

```bash
git clone https://github.com/sheikhti1205/Norfold.git
cd Norfold
npm install
```

`npm install` builds `packages/shared` through the `prepare` script.

Copy `.env.example` to `.env` and fill in your own values. `.env` files are ignored;
`.env.example` files must contain names only, never values.

## Run

```bash
npm run dev:mobile   # client dev server (web shell)
```

The Android app is the same web build wrapped by Capacitor. `npm run apk --
--variant signeddev` (or `--variant release`) is the device-bound build; it requires
the canonical signing environment and fails closed after packaging when the APK is
not signed by the findback-release certificate. Plain `npm run apk` is the debug
variant: it installs, but it is **not** the certificate registered with Google
OAuth or the deployed App Links association, so it is never device-acceptance
evidence.

Every variant requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to
be present and non-empty, and refuses to build a bundle with a missing URL. Never
use a `sb_secret_*` or service-role key in a client build.

Packaged builds keep Capacitor bridge logging off (`loggingBehavior: "none"`).
That switch mirrors every plugin parameter and result into logcat — including
OAuth tokens, SQL text and message bodies — so it must never be re-enabled. Use
the enabled DevTools attach point or Sentry for release diagnostics.

## Checks

```bash
npm run typecheck    # shared build + mobile typecheck
npm run lint         # eslint over the repo
npm test             # shared build + mobile and retained shared/SQL contract tests
npm run scan:secrets # repository secret scan
```

Additional gates used in CI and before a release:

```bash
node scripts/completion-gate.mjs         # ledger integrity + debt/skip policy
node scripts/check-security-baseline.mjs # dependency CVE tripwire
node scripts/check-map-provider.mjs      # keyless map provider policy
node scripts/check-version-sync.mjs      # root and mobile versions agree
node --test scripts/*.test.mjs           # release-infra and config script tests
```

SQL behaviour suites need a real PostgreSQL instance; CI provides one. See
`supabase/tests/` and `scripts/sql-behavior.mjs`.

## Repository layout

```
apps/mobile/          React + Capacitor client (Android primary)
apps/share-preview/   read-only same-domain Azure share HTML/JSON renderer
packages/shared/      shared schemas, validation, constants
supabase/migrations/  applied SQL migrations (immutable once applied)
supabase/functions/   Deno Edge Functions
scripts/              build, verification and release tooling
docs/                 product, architecture, history and acceptance docs
```

## Database changes

- Add a new timestamped migration; never edit an applied one.
- Applied migration bytes are part of the release record and are verified against the
  hosted migration head.
- A migration-bearing change stays local until its gates pass, then is pushed and
  immediately read back from the live project.

## Tests

- Mobile and shared code: Vitest, colocated `*.test.ts(x)` files.
- Unique shared validation and static SQL regression contracts formerly under the
  retired API: `apps/mobile/src/contracts/`, included in the mobile Vitest lane.
- SQL behaviour: real PostgreSQL probes in `supabase/tests/`.
- Edge Functions: Deno tests under `supabase/functions/**`.

Device-only checks (camera, push, TalkBack, IME, real two-device chat) cannot run in
CI; they are tracked as external gates and are never claimed from a host test.

## Documentation

- Product/status: [README](../README.md), [ROADMAP](../ROADMAP.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Version history: [history/VERSION_HISTORY.md](history/VERSION_HISTORY.md)
- Legacy API retirement: [LEGACY_API_RETIREMENT.md](LEGACY_API_RETIREMENT.md)
- Course-era material: [course/](course/)
