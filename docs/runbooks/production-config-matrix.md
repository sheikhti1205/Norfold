# Production config matrix (SYNC-18)

Product Fit Reset note: the Node API/reference Docker runtime was retired.
Dockerfile source anchors below refer to that historical contract, not an active
build/deployment path. Current executable checks target Android, web and the
read-only same-domain preview renderer; see [architecture](../ARCHITECTURE.md)
and [development](../DEVELOPMENT.md). Line-number anchors are era-specific;
scripts/workflow source and fresh verification govern current acceptance.

Single document against config drift. Names + classification only — no values,
no placeholders that look like values. Presence/shapes only.

Legend — Class: `PUBLIC` | `SECRET` | `DERIVED`. Cell source vocabulary:
`shell` / `root .env` / `mobile .env` / `GH-var` (GitHub Actions variable) /
`GH-secret` (GitHub Actions secret) / `Supa-secret` (Supabase secret) /
`git-derived` / `default` / `n/a`. `→` = falls back to. Consumers:
`vite` (client bundle), `gradle` (BuildConfig / manifest), `sentry-cli`,
`supabase-cli`, `edge` (Edge Function), `node-gate` (preflight script).

| Variable | Class | Local dev | Local signeddev | CI | Release | Web | Edge | Consumer | Validator | Runtime effect | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `VITE_SUPABASE_URL` | PUBLIC | `shell` → `root .env` (`SUPABASE_URL`) | same as dev | `GH-var` | `GH-var` | `GH-var` | `n/a` | `vite` + `gradle` gate | `check-mobile-build-config.mjs` | Missing/placeholder/non-https fails build; baked into bundle | `.env.example:45`; `check-mobile-build-config.mjs:37`; `vite.config.ts:20`; `ci.yml:96`; `release.yml:99`; `web.yml:17`; `Dockerfile:31` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | PUBLIC | `shell` → `root .env` (`SUPABASE_PUBLISHABLE_KEY`) | same as dev | `GH-secret` | `GH-secret` | `GH-secret` | `n/a` | `vite` | `check-mobile-build-config.mjs` | Secret-shaped (`sb_secret_*`/service-role) refused; missing fails build | `.env.example:46`; `check-mobile-build-config.mjs:38`; `vite.config.ts:20`; `ci.yml:97`; `release.yml:100`; `web.yml:18`; `Dockerfile:32` |
| `VITE_PUBLIC_SHARE_ORIGIN` | PUBLIC | `root .env` / `shell` | same as dev | `GH-var` | `GH-var` | `GH-var` | `n/a` client; `PUBLIC_SHARE_ORIGIN` is `Supa-secret` in edge | `vite` + manifest host | `check-share-config.mjs` | Non-https/local/IP/path fails build; feeds App-Links host | `.env.example:48`; `check-share-config.mjs:20`; `vite.config.ts:85`; `ci.yml:3`; `release.yml:41`; `web.yml:16`; `Dockerfile:33` |
| `VITE_SENTRY_DSN` | PUBLIC | `shell` → `mobile .env` only; empty = inert | required, same sources | `GH-var` | `GH-var` | `GH-var` | `n/a` | `vite` | `check-sentry-config.mjs` | Installable build without real DSN fails closed | `.env.example:75`; `check-sentry-config.mjs:44`; `check-sentry-config.mjs:78`; `ci.yml:145`; `release.yml:202`; `web.yml:19`; `Dockerfile:34` |
| `VITE_SENTRY_ENVIRONMENT` | PUBLIC | `local-debug` (variant map) | `local-signeddev` | `ci` | `production` | `production-web` | `n/a` | `vite` → Sentry `environment` | `sentry.ts` read-through; lane sets value | Splits issues by lane; never defaults silently | `.env.example:77`; `build-apk.mjs:74`; `ci.yml:227`; `release.yml:203`; `web.yml:20`; `Dockerfile:35`; `sentry.ts:556` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | PUBLIC | `default` (`0.1`) unless `shell`/`mobile .env` | same as dev | `GH-var` → `default` | `GH-var` → `default` | `GH-var` → `default` | `n/a` | `vite` → traces sampler | `build-context.mjs` | NaN/out-of-range rejects; empty = `0.1`; `1.0` only via env/var | `.env.example:80`; `check-sentry-config.mjs:89`; `ci.yml:209`; `release.yml:206`; `web.yml:53`; `Dockerfile:36`; `build-context.mjs:147` |
| `VITE_SENTRY_RELEASE` | DERIVED | `git-derived` (`findback-mobile@version+short12`) | same as dev | `git-derived` (Compute step) | `git-derived` (S3 step) | `git-derived` (Compute step) | `n/a` | `vite` + `sentry-cli --release` (same string) | `build-context.mjs` + `release.ts` | Bundle/upload mismatch = unsymbolicated; malformed refused | `build-context.mjs:115`; `release.ts:84`; `build-apk.mjs:120`; `ci.yml:190`; `release.yml:255`; `web.yml:41`; `Dockerfile:37`; `.env.example:115` |
| `VITE_SENTRY_DIST` | DERIVED | `android-debug` (variant map) | `android-signeddev` | `android-debug` | `android-release` | `web-production` | `n/a` | `vite` + `sentry-cli --dist` | `build-context.mjs` | Wrong dist scopes symbols away from events | `build-context.mjs:134`; `build-apk.mjs:88`; `ci.yml:215`; `release.yml:207`; `web.yml:21`; `Dockerfile:38`; `build-context.mjs:38` |
| `SENTRY_ORG` | PUBLIC | `n/a` unless upload opt-in | `n/a` unless opt-in | `GH-var` | `GH-var` | `GH-var` | `n/a` | `sentry-cli` only, never bundle | upload-step presence check | Missing aborts upload, never ships blind | `.env.example:83`; `build-apk.mjs:93`; `ci.yml:230`; `release.yml:209`; `web.yml:22` |
| `SENTRY_PROJECT` | PUBLIC | `n/a` unless upload opt-in | `n/a` unless opt-in | `GH-var` | `GH-var` | `GH-var` | `n/a` | `sentry-cli` only, never bundle | upload-step presence check | Missing aborts upload, never ships blind | `.env.example:84`; `build-apk.mjs:93`; `ci.yml:231`; `release.yml:210`; `web.yml:23` |
| `SENTRY_AUTH_TOKEN` | SECRET | `n/a` unless `FINDBACK_SENTRY_UPLOAD=true` | same as dev | `GH-secret` (dispatch only) | `GH-secret` | `GH-secret` | `n/a` | `sentry-cli` only, never `VITE_*`/bundle | presence-only gate, names in logs | Missing fails upload visibly; never logged | `.env.example:82`; `build-apk.mjs:93`; `ci.yml:251`; `release.yml:307`; `web.yml:76` |
| `GOOGLE_WEB_CLIENT_ID` | PUBLIC | `shell` → `root .env`; missing = sign-in hidden | required (hard fail) | present, packaged assert | required (hard preflight + dex assert) | `n/a` (web lane) | `n/a` | `gradle` → `BuildConfig` | `check-google-config.mjs` + release gate | Malformed/secret-shaped refused; missing hides provider | `.env.example:58`; `check-google-config.mjs:28`; `check-google-config.mjs:36`; `check-release-config.mjs:82`; `build-apk.mjs:406`; `ci.yml:148`; `release.yml:233` |
| `GOOGLE_SERVICES_JSON_B64` | SECRET | `shell`; absent = FCM-disabled (debug only) | `shell` or validated file; else fail | `GH-secret` → materializer | `GH-secret` → materializer | `n/a` | `n/a` | materializer → `google-services.json` | `materialize-google-services.mjs` | Wrong project/package or service-account-shaped refused | `materialize-google-services.mjs:6`; `build-apk.mjs:264`; `ci.yml:172`; `release.yml:249` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | SECRET | `n/a` | `n/a` | `n/a` | `n/a` | `n/a` | `Supa-secret` (via sync) | `edge` push-dispatch | `sync-fcm-secrets.mjs` | Non-dedicated-sender refused; never in client | `push-dispatch/index.ts:16`; `push-dispatch/index.ts:387`; `sync-fcm-secrets.mjs:12`; `sync-fcm-secrets.yml:27` |
| `FCM_PROJECT_ID` | PUBLIC | `n/a` | `n/a` | `n/a` | `n/a` | `n/a` | `Supa-secret` (mirrored from sender) | `edge` push-dispatch | `sync-fcm-secrets.mjs` | Missing → dispatch `503`, stays pending | `push-dispatch/index.ts:17`; `push-dispatch/index.ts:385`; `sync-fcm-secrets.mjs:20` |
| `PUSH_DISPATCH_SECRET` | SECRET | `n/a` | `n/a` | `n/a` (scheduler caller) | `n/a` | `n/a` | `Supa-secret` (+ `GH-secret` caller) | `edge` auth header | `sync-fcm-secrets.mjs` + edge `401/503` | Missing/mismatch = no dispatch; short shape refused | `push-dispatch/index.ts:376`; `sync-fcm-secrets.mjs:25`; `sync-fcm-secrets.yml:28`; `push-dispatch.yml:31` |
| `ANDROID_KEYSTORE_BASE64` | SECRET | `n/a` | `n/a` (local uses `PATH` set) | `n/a` | `GH-secret` → temp jks | `n/a` | `n/a` | `gradle` signing | release workflow restore step | Missing stops signing before build | `release.yml:32`; `release.yml:346`; `build-apk.mjs:429` |
| `ANDROID_KEYSTORE_PATH` | SECRET | `n/a` | `shell` (required) | `n/a` | runner temp path | `n/a` | `n/a` | `gradle` signing | `build-apk.mjs` presence gate | Missing aborts signeddev/release packaging | `build-apk.mjs:434`; `release.yml:347`; `release.yml:351` |
| `ANDROID_KEYSTORE_PASSWORD` | SECRET | `n/a` | `shell` (required) | `n/a` | `GH-secret` | `n/a` | `n/a` | `gradle` signing | presence-only, never echoed | Missing aborts signing; values never logged | `build-apk.mjs:434`; `release.yml:352` |
| `ANDROID_KEY_ALIAS` | SECRET | `n/a` | `shell` (required) | `n/a` | `GH-secret` | `n/a` | `n/a` | `gradle` signing | presence-only, never echoed | Missing aborts signing | `build-apk.mjs:434`; `release.yml:353` |
| `ANDROID_KEY_PASSWORD` | SECRET | `n/a` | `shell` (required) | `n/a` | `GH-secret` | `n/a` | `n/a` | `gradle` signing | presence-only, never echoed | Missing aborts signing | `build-apk.mjs:434`; `release.yml:354` |
| `ANDROID_SIGNING_CERT_SHA256` | SECRET | `n/a` unless association check | verified when exported | exported for association | `GH-secret` (pin every variant + AAB) | `GH-secret` (association) | `n/a` | `verify-release-apks.sh` + web association | `verify-release-apks.sh` + `check-web-association.mjs` | Mismatch blocks publish; fingerprint never echoed | `release.yml:371`; `verify-release-apks.sh:95`; `check-web-association.mjs:95`; `check-signeddev-config.mjs:117`; `web.yml:99` |
| `GOOGLE_MAPS_ANDROID_API_KEY` | SECRET | `shell` only (Gradle reads the process env; `root .env` is not forwarded); absent = map Activity fails closed | same as dev | `GH-secret` | `GH-secret` | `GH-secret` (exported; no web consumer) | `n/a` | `gradle` → `BuildConfig` + `findbackMapsApiKey` manifest placeholder | `check-map-provider.mjs` | Compiled into the APK; blank leaves the native picker/viewer with no map; a literal `AIza…` fails the gate | `build.gradle:174`; `build.gradle:215`; `build.gradle:236`; `AndroidManifest.xml:115`; `check-map-provider.mjs:139`; `check-map-provider.mjs:145`; `.env.example:56`; `ci.yml:297`; `release.yml:664`; `web.yml:39`; `android-builds.yml:58` |
| `VITE_GOOGLE_MAPS_API_KEY` | SECRET | `shell`/`root .env` → absent = keyless raster grid | same as dev | `GH-secret` (`GOOGLE_MAPS_WEB_API_KEY`) | `GH-secret` (`GOOGLE_MAPS_WEB_API_KEY`) | `GH-secret` (`GOOGLE_MAPS_WEB_API_KEY`) | `n/a` | `vite` → `googleMapsLoader` | `check-map-provider.mjs` | Baked into the bundle; native ignores it (no referrer, so it cannot authorise); absent = raster grid, rejected key = notice | `vite.config.ts:50`; `vite.config.ts:256`; `googleMapsLoader.ts:92`; `mapProvider.ts:25`; `check-map-provider.mjs:155`; `check-map-provider.mjs:183`; `.env.example:57`; `ci.yml:298`; `release.yml:665`; `web.yml:40`; `android-builds.yml:59` |
| `FINDBACK_MAP_STYLE_URL` | PUBLIC | `shell`/`root .env` → `default` | same as dev | `default` (unset) | `default` (unset) | `default` (unset) | `n/a` | `vite` define + `gradle` `BuildConfig` | `check-map-config.mjs` | Malformed custom fails build; absent = built-in default both sides; feeds MapLibre snapshots only | `check-map-config.mjs:52`; `check-map-config.mjs:57`; `check-map-config.mjs:119`; `vite.config.ts:47`; `.env.example:47` |
| `FINDBACK_MAP_CONTACT` | PUBLIC | `shell`/`root .env` → `default` | same as dev | `default` (unset) | `default` (unset) | `default` (unset) | `n/a` | `vite` define + `gradle` `BuildConfig` | `check-map-config.mjs` | Malformed custom fails build; ships in User-Agent verbatim | `check-map-config.mjs:53`; `check-map-config.mjs:58`; `check-map-config.mjs:119`; `vite.config.ts:48`; `.env.example:51` |
| `VITE_NOMINATIM_SEARCH_URL` | PUBLIC | `shell`/`root .env` → `default` | same as dev | `default` (unset) | `default` (unset) | `default` (unset) | `n/a` | `vite` + native search endpoint | `check-map-config.mjs` | Non-https/malformed custom fails build; explicit-submit only | `check-map-config.mjs:55`; `check-map-config.mjs:59`; `check-map-config.mjs:101`; `vite.config.ts:49`; `nominatimSearch.ts:80` |
| `VITE_KLIPY_API_KEY` | SECRET | `mobile .env`/`shell`; blank = picker hidden | same as dev | `n/a` (unset) | baked if configured | baked if configured | `n/a` | `vite` → Klipy adapter | `klipy.ts` enable-gate | Blank disables GIF control gracefully; key in path, never logged; live contract validated 2026-10-13 (`data.data` + `file.<size>.<fmt>.url`, share POST 200) | `klipy.ts:43`; `klipy.ts:75`; `klipy.ts:80` |

Notes

- Root-`.env` `VITE_SENTRY_DSN` is never embedded; local installable builds read
  `shell` → `mobile .env` (`check-sentry-config.mjs:72`, `.env.example:92`).
- Local Supabase reads canonical `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` with
  `VITE_*` winning when non-blank (`check-mobile-build-config.mjs:37`,
  `vite.config.ts:20`).
- Canonical owners: release/dist/rate → `build-context.mjs:34,115,134,147`;
  Sentry shape → `release.ts:56,84`; Google → `check-google-config.mjs:28`;
  map style/contact/search → `check-map-config.mjs:119`; map key plumbing →
  `check-map-provider.mjs:239`; share → `check-share-config.mjs:20`.
- Map keys travel one way only: each build workflow exports the
  `GOOGLE_MAPS_WEB_API_KEY` secret as `VITE_GOOGLE_MAPS_API_KEY`, the name the
  Vite build reads (`check-map-provider.mjs:183`). Exporting the bare secret
  name is dead plumbing, since no build reads it, and the gate refuses it
  (`check-map-provider.mjs:187`). The Android key keeps its own name end to end
  (secret → `System.getenv` → `BuildConfig` → manifest placeholder).
- Map surfaces: the native picker and viewer use the Google Maps Android SDK,
  the web picker/preview/post map uses the Maps JavaScript API when a key was
  built in, the keyless OSM raster grid is the fallback, and MapLibre renders
  snapshots only (see [maps](maps.md)).
- Edge `PUBLIC_SHARE_ORIGIN` (no `VITE_` prefix) is derived from
  `VITE_PUBLIC_SHARE_ORIGIN` at sync time (`sync-fcm-secrets.mjs:21`).
