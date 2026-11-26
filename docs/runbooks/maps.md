# Maps runbook

Norfold splits its map surfaces across renderers on purpose:

- the **Google Maps SDK for Android** for the native picker and viewer,
- the **Google Maps JavaScript API** for web pickers and previews when a key
  was built in,
- the **keyless OpenStreetMap raster grid** wherever a Google key is absent or
  unusable,
- **MapLibre Native** for the post-detail and shared-location snapshot bitmaps
  only.

`scripts/check-map-provider.mjs` is the release gate for this arrangement. It
does not ban Google Maps; it bans literal keys, the Places SDK, the
`@capacitor/google-maps` plugin and its bridge, and it asserts that the keys
arrive through build config.

## What renders where

| Surface | Android APK | Web, key built in | Web, no key |
|---|---|---|---|
| Report → Choose on map | `FindbackMapActivity` picker: Google Maps `MapView`, fixed centre pin | `GoogleMapCanvas` in picking mode | OSM 3×3 raster grid with move/zoom controls |
| Report form location row (`location-row`) → picker sheet | No in-form map: the row opens `FindbackMapActivity` | The same row opens the sheet's `GoogleMapCanvas` picking surface, with search, one-shot GPS, the exact toggle and Open in Maps | The same row opens the sheet's OSM 3×3 raster grid, with the same sheet controls |
| Post detail / shared location (`InteractiveLocationMap`) | MapLibre snapshot bitmap; tap opens the native viewer | Google preview | OSM 3×3 raster grid |
| Post/shared-location viewer | `FindbackMapActivity` viewer: Google Maps `MapView`, read-only | — | — |

The picker is a separate Activity, never a map embedded under the WebView, so
there is no transparency or z-order contract with the web layer. The native
viewer is the same Activity in viewer mode: no search row, no Confirm, no
location button.

If the native picker cannot be launched (the bridge is missing, or the
Activity launch rejects), the picker sheet stays open and falls back to the
raster grid, Nominatim search and manual confirm. A *blank Android key* is
different: the Activity launches and shows its own failure surface (see below).

On the web, a Google failure replaces the map with a short notice; it does not
draw raster tiles. The raster grid is used only when no Google provider was
resolved.

## How the key arrives

### Android

`GOOGLE_MAPS_ANDROID_API_KEY` is read from the environment by
`apps/mobile/android/app/build.gradle` and reaches the app twice:

- `buildConfigField "String", "GOOGLE_MAPS_ANDROID_API_KEY"` — the Activity
  refuses to create a map when it is blank,
- `manifestPlaceholders [findbackMapsApiKey: …]` — the manifest declares
  `com.google.android.geo.API_KEY` with the value `${findbackMapsApiKey}`,
  never a literal.

CI supplies the key from the `GOOGLE_MAPS_ANDROID_API_KEY` secret. The key is
restricted to the app's package and release SHA-1. It is compiled into the APK,
so it must never be committed.

### Web

`VITE_GOOGLE_MAPS_API_KEY` is read by `apps/mobile/vite.config.ts` and defined
into the bundle. Each of the four build workflows (`ci.yml`, `web.yml`,
`android-builds.yml`, `release.yml`) exports it from the
`GOOGLE_MAPS_WEB_API_KEY` secret. The web key is referrer-restricted to the
production origin.

On the web, `googleMapsLoader.ts` injects one Maps JavaScript API script tag at
runtime, shares that load across callers, gives up after 10 s, and treats a
rejected key as terminal. It never logs or renders the key.

### Never a literal

No build file, manifest or workflow may contain a literal `AIza…` key. The
gate scans them for that pattern and fails on a hit.

## Why the APK's WebView does not use the web key

The web key is restricted to the production site, and the Android WebView sends
no such referrer, so the JavaScript API cannot authorise inside the APK. Trying
it there would only produce a rejected map. Native therefore uses the Android
SDK with its own key, and the picker sheet never asks the JavaScript API to draw
inside the APK: on device it hands off to the native Activity, and its in-place
fallback (bridge missing or launch rejected) is the keyless raster grid.
`mapProvider.ts` encodes this rule: Google only when a key was
built in *and* the platform is not native.

## Search policy

Place search is Nominatim on the public endpoint
`https://nominatim.openstreetmap.org/search`, with these rules enforced in code,
not just documented:

- **Explicit submit only.** A Search button or Enter submits; there is no
  per-keystroke autocomplete path, because the Nominatim policy forbids it.
- **≤ 1 request/second.** Native `NominatimGate` and web `NominatimThrottler`
  both use a 1100 ms floor and are shared rather than recreated per sheet or
  Activity, so reopening the picker cannot mint a fresh limiter. Both honour a
  429 `Retry-After`.
- **≤ 5 results.** Each result is sanitised to a display name plus finite,
  in-range coordinates.
- **Identifying contact.** Native requests send
  `User-Agent: Norfold/<version> (Android; contact: <contact>)`. The web
  WebView cannot set `User-Agent` (a forbidden header), so browser requests
  identify by origin/Referer.
- **No commit on search.** A result recenters the camera and updates the
  draft; only Confirm commits.

Endpoint override: `VITE_NOMINATIM_SEARCH_URL`, read by both the web layer and
Gradle (`BuildConfig.MAP_SEARCH_URL`). It is public, non-secret config, and
must be HTTPS; a malformed custom value fails the build-time config check, and
the runtime validators fall back to the default if a bad value ever reaches
them.

Web result lists print `© OpenStreetMap contributors (Nominatim, ODbL)`.

## Native picker and viewer

- **Picker:** the map moves underneath a fixed centre pin. A camera idle after
  a user gesture updates the draft and enables Confirm; nothing is written to
  the report before Confirm. Cancel and system Back return `CANCELED` with no
  mutation.
- **No fabricated start pin:** without a valid initial coordinate the map shows
  a display-only neutral camera; the draft stays null and Confirm stays
  disabled until the user moves the map or picks a result.
- **Viewer:** read-only camera on a committed coordinate.
- **One-shot location:** the fused provider returns a single fix under a 15 s
  budget; permission denial leaves the map fully usable, and every prompt is
  user-triggered.
- **Load budget:** 20 s for the SDK handshake and first render. A timeout shows
  the failure surface with Retry; Confirm stays available when a valid draft
  exists.
- **Blank key fails closed:** the `MapView` is never initialised, so no empty
  map frame appears.
- **Appearance:** the map follows the system light/dark scheme. The SDK draws
  the Google logo and legal notices, so the bottom readout strip is excluded
  from the map's padding area to keep them visible.

## Post-detail and shared-location snapshots (MapLibre)

`MapSnapshotService` renders these previews with MapLibre Native's
`MapSnapshotter`. It is the only remaining MapLibre renderer.

- The MapLibre AAR is pinned once as `mapLibreVersion` in
  `apps/mobile/android/variables.gradle`; `app/build.gradle` references
  `$mapLibreVersion` and `FindbackMapPlugin` reports the same value as
  `RENDERER_VERSION`. The gate asserts the dependency uses that pin and that
  the reported renderer version matches it.
- The snapshotter renders the style in `BuildConfig.MAP_STYLE_URL`, sourced
  from `FINDBACK_MAP_STYLE_URL` (default
  `https://tiles.openfreemap.org/styles/liberty`). It is public, non-secret
  config: HTTPS, non-empty and non-placeholder, otherwise the built-in default
  applies. It affects **snapshots only**; the picker and viewer do not render
  it.
- Snapshots are requested at 640×360 and clamped to at most 1024 px per side,
  with the pixel ratio clamped to 1–2 (the current request sends none, so 1×)
  and the Norfold pin drawn over the centre.
- Results are PNGs cached in the app cache directory with a 24 MB
  LRU-by-mtime budget. The native budget is 20 s; the WebView gives up at 8 s
  and shows the raster fallback with an "Open map" action.

## Attribution

Keep every attribution visible:

- The native Google map draws the Google logo and legal notices; do not overlay
  the map's bottom-left corner.
- The web Google canvas draws its own logo inside the map; controls are placed
  or padded so they do not cover it.
- Raster surfaces print `© OpenStreetMap contributors`.
- Web result lists print the Nominatim attribution above.

## The provider gate

Files:

- gate: `scripts/check-map-provider.mjs`
- tests: `scripts/check-map-provider.test.mjs`

Commands, from the repository root:

```sh
node scripts/check-map-provider.mjs
node --test scripts/check-map-provider.test.mjs
```

CI runs the gate directly and the test with the other release-infra script
tests.

The gate fails when a production dependency graph or source contains:

- `@capacitor/google-maps` (npm dependency or lockfile entry),
- the Google Places Android SDK (`com.google.android.libraries.places`),
- `FindbackPlaces` or `Places.initialize` bridge remnants,
- a literal `AIza…` Google API key in a build or CI file.

It requires:

- `app/build.gradle` to read `GOOGLE_MAPS_ANDROID_API_KEY` from the
  environment, expose it as a BuildConfig field and as the
  `findbackMapsApiKey` manifest placeholder,
- the manifest to reference the key as a placeholder,
- `vite.config.ts` to read `VITE_GOOGLE_MAPS_API_KEY` and `.env.example` to
  document both names,
- every build workflow to export `VITE_GOOGLE_MAPS_API_KEY` from
  `secrets.GOOGLE_MAPS_WEB_API_KEY` — and not to export the bare secret name,
  which no build reads,
- the MapLibre pin, the matching `RENDERER_VERSION`, and the `MAP_STYLE_URL`
  BuildConfig wiring with an HTTPS default.

The invariant is key plumbing, not key absence: **no literal keys, no Places
SDK, no `@capacitor/google-maps`, no `FindbackPlaces` bridge, and every key
entering through build config.** The Maps SDK and the Maps JavaScript API
loader are sanctioned; do not delete them as if they were legacy remnants.
`GOOGLE_WEB_CLIENT_ID` (Google sign-in), Firebase/FCM,
`play-services-location`, `@capacitor/geolocation`, and Google Maps URL
parsing / Open in Maps are unrelated and stay.

## Troubleshooting

| Symptom | Cause → action |
|---|---|
| Native picker shows the map-failure surface with Retry | The build carried no Android key (fails closed), or the SDK could not render within 20 s. Retry; Confirm stays usable with an existing draft. A keyless build must be rebuilt with the key. |
| Web preview says "Map preview unavailable. The location still saves normally." | No web key (`no-key`), a rejected key (`auth-failure`), a 10 s timeout, or a blocked script. The location still saves; fix the key or restriction for a map preview. |
| Search finds nothing | Check the connection; the throttler returns "wait a moment" inside 1 req/s. Panning and confirming the pin always works. |
| "Use my location once" denied | The map stays usable; permission is one-shot, never background. |
| Post-detail preview shows fallback tiles | The snapshot failed, was cancelled, or exceeded the WebView's 8 s wait. "Open map" still opens the native viewer. |
| Release gate `check-map-provider` fails | Read the listed hits. A banned dependency or bridge returned, a literal key appeared, a workflow stopped exporting the Vite name, or the MapLibre pin / style wiring drifted. Fix the hit; do not remove the check. |

## Manual check template

```text
commit: <sha>  build: debug/signeddev  device: <model>  Android: <version>  ABI: <abi>
provider: google-android | google-web | osm
picker opens: PASS  search: PASS  current location: PASS/NOT TESTED (reason)
confirm: PASS  cancel: PASS  snapshot: PASS  viewer: PASS  key absent: PASS/NOT TESTED
```

A release that changes either map dependency (the Google Maps SDK or the
MapLibre pin) should record its APK/AAB size delta, because release APKs are
split per ABI and both SDKs ship in them.
