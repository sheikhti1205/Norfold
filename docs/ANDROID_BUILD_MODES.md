# Android build modes

One repository variable controls Android work. It is a **variable**, not a
secret, so it is readable and editable at any time:

> Settings → Secrets and variables → Actions → **Variables** → `ANDROID_BUILD_MODE`

| Value | On a successful push to `main` | On a manual run |
|---|---|---|
| `none` | Nothing runs | Nothing runs unless the run overrides the mode |
| `build` | Builds signed APKs, uploads a **7-day artifact**, never touches a release | Same |
| `publish` | Builds and publishes **only when this commit has something to publish** | Same |
| unset | Treated as `publish` (the historical behaviour) | Same |

The decision is made in `scripts/decide-android-build.mjs` and printed in the
guard job as `android-build: <decision> (<reason>)`, so a green workflow always
states which lever produced the outcome.

## Manual override

`workflow_dispatch` takes a `mode` input: `auto` (use the variable), `none`,
`build`, or `publish`. Choosing `publish` on a manual run is the only way to
publish from a dispatch; `build` never publishes.

## What "something to publish" means

Numbered releases are immutable — `v<app version>` is published once. The guard
skips the build when:

- this exact commit is already published, or
- the version tag points at a different commit (bump the app version), or
- an existing release targets a different commit.

Skipping is not a failure: it means there is nothing new to ship. A content
change that must ship needs a version bump.

## Cost

The repository is public, so standard GitHub-hosted runners bill **nothing**.
A build is ~15–25 minutes of wall clock and has no usage cost. A build-only run
still consumes concurrency in the `android-publish` queue, so a publish is never
interrupted mid-upload.

## Failure modes worth knowing

| Symptom | Cause |
|---|---|
| Workflow green, APK job `skipped`, `decision: skip` | Mode is `none`, upstream CI did not succeed, or the version is already published |
| `Refuse to build without the server URL and publishable key` | Missing `VITE_SUPABASE_URL` variable or `VITE_SUPABASE_PUBLISHABLE_KEY` secret |
| `Restore Firebase Android client configuration` fails | `GOOGLE_SERVICES_JSON_B64` secret missing or not decodable |
| Publish step says "already published; preserving its immutable assets" | Correct behaviour: numbered bytes never change |

The Firebase client config is a write-only secret. Its source of truth is the
Firebase console for project `findback-mobile-app`, Android app
`com.findback.app`. It cannot be read back from GitHub, only replaced.
