import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkBannedHits,
  checkGoogleKeyPlumbing,
  checkMapLibrePin,
  checkMapProvider,
  checkWorkflowMapKeyExport,
  findLiteralApiKeys,
  readPin,
} from "./check-map-provider.mjs";

/** Fake FS matched by path suffix (the gate resolves files against repo root). */
function reader(files) {
  return (path) => {
    const key = Object.keys(files).find((suffix) => path.endsWith(suffix));
    if (!key) throw new Error(`unreadable: ${path}`);
    return files[key];
  };
}

const REL = {
  variables: "apps/mobile/android/variables.gradle",
  buildGradle: "apps/mobile/android/app/build.gradle",
  plugin: "apps/mobile/android/app/src/main/java/com/findback/app/map/FindbackMapPlugin.kt",
};

const WEB_KEY = "${{ secrets.GOOGLE_MAPS_WEB_API_KEY }}";

function baseFiles() {
  return {
    [REL.variables]: "mapLibreVersion = '13.6.1'",
    [REL.buildGradle]: [
      'implementation "org.maplibre.gl:android-sdk-opengl:$mapLibreVersion"',
      'buildConfigField "String", "MAP_STYLE_URL"',
      'System.getenv("FINDBACK_MAP_STYLE_URL") ?: "https://tiles.openfreemap.org/styles/liberty"',
    ].join("\n"),
    [REL.plugin]: 'const val RENDERER_VERSION = "13.6.1"',
  };
}

function workflowFiles() {
  const block = (indent) => `${indent}env:\n${indent}  VITE_GOOGLE_MAPS_API_KEY: ${WEB_KEY}\n`;
  return {
    ".github/workflows/ci.yml": block("      "),
    ".github/workflows/web.yml": block("      "),
    ".github/workflows/release.yml": block("      "),
    ".github/workflows/android-builds.yml": block("  "),
  };
}

test("flags banned hits per file and pattern", () => {
  const read = reader({
    "pkg.json": `{"dependencies": {"@capacitor/google-maps": "^8.0.1"}}`,
    "places.gradle": `implementation "com.google.android.libraries.places:places:3.5.0"`,
    "clean.gradle": `implementation "org.maplibre.gl:android-sdk-opengl:$mapLibreVersion"`,
  });
  assert.deepEqual(checkBannedHits(["pkg.json"], ["@capacitor/google-maps"], read), [
    "pkg.json: @capacitor/google-maps",
  ]);
  assert.deepEqual(
    checkBannedHits(["places.gradle"], ["com.google.android.libraries.places"], read),
    ["places.gradle: com.google.android.libraries.places"],
  );
  assert.deepEqual(checkBannedHits(["clean.gradle"], ["@capacitor/google-maps"], read), []);
  assert.deepEqual(checkBannedHits(["missing.gradle"], ["@capacitor/google-maps"], read), []);
});

test("reads the version pin", () => {
  assert.equal(readPin("mapLibreVersion = '13.6.1'"), "13.6.1");
  assert.equal(readPin("no pin here"), null);
});

test("rejects a drifted renderer version or missing style wiring", () => {
  assert.equal(checkMapLibrePin(reader(baseFiles())).ok, true);

  const drifted = baseFiles();
  drifted[REL.plugin] = 'const val RENDERER_VERSION = "9.9.9"';
  const result = checkMapLibrePin(reader(drifted));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /RENDERER_VERSION/);

  const unpinned = baseFiles();
  unpinned[REL.variables] = "no pin";
  assert.equal(checkMapLibrePin(reader(unpinned)).ok, false);

  const floating = baseFiles();
  floating[REL.buildGradle] = floating[REL.buildGradle].replace("$mapLibreVersion", "13.+");
  assert.match(checkMapLibrePin(reader(floating)).errors.join("\n"), /single version source/);
});

test("flags a literal Google API key in a build file", () => {
  const literal = `AIza${"A".repeat(35)}`;
  const read = reader({
    "dirty.gradle": `manifestPlaceholders = [findbackMapsApiKey: "${literal}"]`,
    "clean.gradle": 'manifestPlaceholders = [findbackMapsApiKey: "${findbackMapsApiKey}"]',
  });
  assert.deepEqual(findLiteralApiKeys(["dirty.gradle"], read), [
    "dirty.gradle: literal Google API key",
  ]);
  assert.deepEqual(findLiteralApiKeys(["clean.gradle"], read), []);
  assert.deepEqual(findLiteralApiKeys(["missing.gradle"], read), []);
});

test("rejects a literal Maps key in the manifest instead of a placeholder", () => {
  const read = reader({
    "app/build.gradle": [
      'def googleMapsApiKey = System.getenv("GOOGLE_MAPS_ANDROID_API_KEY") ?: ""',
      "manifestPlaceholders = [findbackShareHost: shareLinkHostname(), findbackMapsApiKey: googleMapsApiKey]",
      'buildConfigField "String", "GOOGLE_MAPS_ANDROID_API_KEY", "\\"${googleMapsApiKey}\\""',
    ].join("\n"),
    "AndroidManifest.xml": [
      "<meta-data",
      '    android:name="com.google.android.geo.API_KEY"',
      '    android:value="literal-key-not-a-placeholder" />',
    ].join("\n"),
    "vite.config.ts": 'const googleKey = env.VITE_GOOGLE_MAPS_API_KEY?.trim() || "";',
    ".env.example": "GOOGLE_MAPS_ANDROID_API_KEY=\nVITE_GOOGLE_MAPS_API_KEY=\n",
  });
  const result = checkGoogleKeyPlumbing(read);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /manifest placeholder/);
});

test("accepts workflows that export the web key under the build name", () => {
  const result = checkWorkflowMapKeyExport(reader(workflowFiles()));
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("rejects a workflow that drops the build name or the secret source", () => {
  const files = workflowFiles();
  files[".github/workflows/release.yml"] =
    "    env:\n      GOOGLE_MAPS_WEB_API_KEY: ${{ secrets.GOOGLE_MAPS_WEB_API_KEY }}\n";
  files[".github/workflows/ci.yml"] =
    "    env:\n      VITE_GOOGLE_MAPS_API_KEY: ${{ vars.VITE_GOOGLE_MAPS_API_KEY }}\n";
  delete files[".github/workflows/web.yml"];
  const result = checkWorkflowMapKeyExport(reader(files));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /release\.yml must export VITE_GOOGLE_MAPS_API_KEY/);
  assert.match(result.errors.join("\n"), /release\.yml must not export the dead/);
  assert.match(result.errors.join("\n"), /ci\.yml must export VITE_GOOGLE_MAPS_API_KEY/);
  assert.match(result.errors.join("\n"), /web\.yml unreadable/);
});

test("live repo tree passes the provider gate", () => {
  const result = checkMapProvider();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
