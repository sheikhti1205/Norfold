#!/usr/bin/env node
/**
 * Map provider gate (MAP migration): enforces that the sanctioned Google Maps
 * credential plumbing stays key-plumbed-never-key-literal, that no dead
 * Places/Google-maps-plugin bridge remnants return, and that the retained
 * MapLibre pin does not drift.
 *
 * Fails when any production dependency graph or source contains:
 * - `@capacitor/google-maps` (npm dep or lockfile entry)
 * - Google Places Android SDK (`com.google.android.libraries.places`)
 * - `FindbackPlaces` bridge remnants
 * - `Places.initialize` bridge remnants
 * - a literal Google API key (`AIza...`) in any build/CI file
 *
 * Confirms the Google Maps key arrives only through build-time plumbing:
 * the Android gradle reads `GOOGLE_MAPS_ANDROID_API_KEY` from the environment
 * and exposes it as a `findbackMapsApiKey` manifest placeholder and a
 * BuildConfig field; the manifest references it as a placeholder (never a
 * literal); the web build reads `VITE_GOOGLE_MAPS_API_KEY`; `.env.example`
 * documents both names.
 *
 * Confirms the retained MapLibre pin:
 * - `mapLibreVersion` pin exists in variables.gradle and is referenced as
 *   `$mapLibreVersion` by the MapLibre dependency in app/build.gradle
 * - `FindbackMapPlugin.kt` RENDERER_VERSION matches that pin (single source)
 * - MAP_STYLE_URL BuildConfig wiring exists with an https default
 *
 * Deliberately NOT banned: the Google Maps SDK and JS loader (now sanctioned),
 * Google Auth / Credential Manager, Firebase/FCM, `GOOGLE_WEB_CLIENT_ID`,
 * play-services-location, and external Google Maps URL parsing/handoff
 * (geo: URIs, maps.google.com links, Open-in-Maps).
 *
 * Pure Node builtins. Test suite: scripts/check-map-provider.test.mjs
 * Run: `node scripts/check-map-provider.mjs` from repo root.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BANNED_DEPENDENCY_PATTERNS = [
  "@capacitor/google-maps",
  "com.google.android.libraries.places",
];

const BANNED_SOURCE_PATTERNS = [
  "FindbackPlaces",
  "Places.initialize",
];

const DEPENDENCY_FILES = [
  "apps/mobile/package.json",
  "package-lock.json",
  "apps/mobile/android/app/build.gradle",
  "apps/mobile/android/capacitor.settings.gradle",
  "apps/mobile/android/app/capacitor.build.gradle",
];

const SOURCE_FILES = [
  "apps/mobile/android/app/build.gradle",
  "apps/mobile/android/app/src/main/AndroidManifest.xml",
  "apps/mobile/android/app/src/main/java/com/findback/app/MainActivity.java",
  "apps/mobile/vite.config.ts",
  ".env.example",
];

const LITERAL_KEY_FILES = [
  "apps/mobile/android/app/build.gradle",
  "apps/mobile/android/app/src/main/AndroidManifest.xml",
  "apps/mobile/vite.config.ts",
  ".env.example",
  ".github/workflows/ci.yml",
  ".github/workflows/web.yml",
  ".github/workflows/android-builds.yml",
  ".github/workflows/release.yml",
];

export function checkBannedHits(files, patterns, read = readFileSync) {
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = read(resolve(root, file), "utf8");
    } catch {
      continue;
    }
    for (const pattern of patterns) {
      if (text.includes(pattern)) hits.push(`${file}: ${pattern}`);
    }
  }
  return hits;
}

/** Flags any file carrying a literal Google API key (`AIza…`), never a placeholder. */
export function findLiteralApiKeys(files = LITERAL_KEY_FILES, read = readFileSync) {
  const hits = [];
  const literal = /\bAIza[0-9A-Za-z_-]{35}\b/;
  for (const file of files) {
    let text;
    try {
      text = read(resolve(root, file), "utf8");
    } catch {
      continue;
    }
    if (literal.test(text)) hits.push(`${file}: literal Google API key`);
  }
  return hits;
}

/** Validate the Google Maps key plumbing; returns { ok, errors[] }. */
export function checkGoogleKeyPlumbing(read = readFileSync) {
  const errors = [];
  let buildGradle;
  let manifest;
  let viteConfig;
  let envExample;
  try {
    buildGradle = read(resolve(root, "apps/mobile/android/app/build.gradle"), "utf8");
    manifest = read(
      resolve(root, "apps/mobile/android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    viteConfig = read(resolve(root, "apps/mobile/vite.config.ts"), "utf8");
    envExample = read(resolve(root, ".env.example"), "utf8");
  } catch {
    return { ok: false, errors: ["Google Maps key plumbing files unreadable"] };
  }
  if (!buildGradle.includes('System.getenv("GOOGLE_MAPS_ANDROID_API_KEY")')) {
    errors.push("app/build.gradle must read GOOGLE_MAPS_ANDROID_API_KEY from the environment");
  }
  if (!buildGradle.includes('buildConfigField "String", "GOOGLE_MAPS_ANDROID_API_KEY"')) {
    errors.push("app/build.gradle must expose GOOGLE_MAPS_ANDROID_API_KEY as a BuildConfig field");
  }
  if (!/manifestPlaceholders\s*=\s*\[[^\]]*findbackMapsApiKey/.test(buildGradle)) {
    errors.push("app/build.gradle must carry findbackMapsApiKey in its manifestPlaceholders");
  }
  if (
    !/android:name="com\.google\.android\.geo\.API_KEY"[\s\S]{0,80}?android:value="\$\{[A-Za-z0-9_]+\}"/.test(
      manifest,
    )
  ) {
    errors.push("Android manifest must reference the Maps key as a manifest placeholder");
  }
  if (!viteConfig.includes("VITE_GOOGLE_MAPS_API_KEY")) {
    errors.push("vite.config.ts must read VITE_GOOGLE_MAPS_API_KEY");
  }
  if (!envExample.includes("GOOGLE_MAPS_ANDROID_API_KEY")) {
    errors.push(".env.example must document GOOGLE_MAPS_ANDROID_API_KEY");
  }
  if (!envExample.includes("VITE_GOOGLE_MAPS_API_KEY")) {
    errors.push(".env.example must document VITE_GOOGLE_MAPS_API_KEY");
  }
  return { ok: errors.length === 0, errors };
}

// MapLibre is still shipped during the migration; these pin assertions are
// deleted in the same commit that deletes MapLibre.
export function readPin(text) {
  const match = /mapLibreVersion\s*=\s*'([^']+)'/.exec(text);
  return match ? match[1] : null;
}

/** Validate the MapLibre pin + style wiring; returns { ok, errors[] }. */
export function checkMapLibrePin(read = readFileSync) {
  const errors = [];
  let variables;
  let buildGradle;
  let plugin;
  try {
    variables = read(resolve(root, "apps/mobile/android/variables.gradle"), "utf8");
    buildGradle = read(resolve(root, "apps/mobile/android/app/build.gradle"), "utf8");
    plugin = read(
      resolve(root, "apps/mobile/android/app/src/main/java/com/findback/app/map/FindbackMapPlugin.kt"),
      "utf8",
    );
  } catch {
    return { ok: false, errors: ["map configuration files unreadable"] };
  }
  const pin = readPin(variables);
  if (!pin) {
    errors.push("mapLibreVersion pin missing in variables.gradle");
  } else {
    if (!buildGradle.includes("org.maplibre.gl:android-sdk-opengl:$mapLibreVersion")) {
      errors.push("MapLibre dependency must reference $mapLibreVersion (single version source)");
    }
    const renderer = /RENDERER_VERSION\s*=\s*"([^"]+)"/.exec(plugin)?.[1];
    if (renderer !== pin) {
      errors.push(`FindbackMapPlugin RENDERER_VERSION (${renderer ?? "missing"}) must match mapLibreVersion (${pin})`);
    }
  }
  if (!buildGradle.includes('buildConfigField "String", "MAP_STYLE_URL"')) {
    errors.push("MAP_STYLE_URL BuildConfig wiring missing in app/build.gradle");
  }
  const styleDefault = /FINDBACK_MAP_STYLE_URL"\) \?: "(https:\/\/[^"]+)"/.exec(buildGradle)?.[1];
  if (!styleDefault) {
    errors.push("MAP_STYLE_URL must carry an https default style URL");
  }
  return { ok: errors.length === 0, errors };
}

export function checkMapProvider(read = readFileSync) {
  const errors = [];
  for (const hit of checkBannedHits(DEPENDENCY_FILES, BANNED_DEPENDENCY_PATTERNS, read)) {
    errors.push(`banned map dependency: ${hit}`);
  }
  const sourceFiles = [...SOURCE_FILES, ...DEPENDENCY_FILES];
  for (const hit of checkBannedHits(sourceFiles, BANNED_SOURCE_PATTERNS, read)) {
    errors.push(`banned map reference: ${hit}`);
  }
  for (const hit of findLiteralApiKeys(LITERAL_KEY_FILES, read)) {
    errors.push(`literal Google API key: ${hit}`);
  }
  for (const error of checkGoogleKeyPlumbing(read).errors) errors.push(error);
  for (const error of checkMapLibrePin(read).errors) errors.push(error);
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkMapProvider();
  if (result.ok) {
    console.log(
      "check-map-provider: PASS (no literal map keys, sanctioned key plumbing intact, no Places/Google-maps plugin remnants, MapLibre pin intact)",
    );
  } else {
    console.error(`check-map-provider: ${result.errors.length} failure(s)\n${result.errors.join("\n")}`);
    process.exitCode = 1;
  }
}
