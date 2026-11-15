import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Supabase Auth/Data/Realtime/Storage/Functions are called directly from the
// app with the publishable key only. The secret key must never reach the mobile
// bundle. No API base URL is needed.
export function resolveSupabaseBuildEnv(
  mode: string,
  // FINDBACK_ENV_DIR isolates the env-file root for hermetic tests (CI-local
  // .env files must never satisfy a test that asserts scrubbed-env failure).
  // Production/CI never set it, so the repo root stays the single live root.
  envDir = process.env.FINDBACK_ENV_DIR || resolve(import.meta.dirname, "../.."),
) {
  const env = loadEnv(mode, envDir, "");
  return {
    publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.SUPABASE_PUBLISHABLE_KEY || "",
    url: env.VITE_SUPABASE_URL?.trim() || env.SUPABASE_URL || "",
  };
}

// FBX-027 maps-config region (keyless MAP pivot): the single build-time source
// for map provider config is the repo-root env, owned by
// scripts/check-map-config.mjs. This resolver mirrors the owner's names and
// defaults so the web bundle receives the SAME effective values the native
// side compiles into BuildConfig (MAP_STYLE_URL / MAP_SEARCH_CONTACT) —
// absent custom values resolve to the owner-decided defaults on both sides,
// never a silent divergence. The Nominatim search-endpoint override
// (VITE_NOMINATIM_SEARCH_URL → BuildConfig.MAP_SEARCH_URL) is the third owned
// knob alongside style/contact; it is consumed today by
// src/services/location/nominatimSearch.ts, while the style/contact defines
// are the build-time contract the map lane adopts at runtime.
export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const DEFAULT_MAP_CONTACT = "https://findbackapp.social";
/** Public Nominatim `/search` endpoint (explicit-submit only, no secret). */
export const DEFAULT_NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

export function resolveMapBuildEnv(
  mode: string,
  // Same FINDBACK_ENV_DIR hermeticity rule as resolveSupabaseBuildEnv above.
  envDir = process.env.FINDBACK_ENV_DIR || resolve(import.meta.dirname, "../.."),
) {
  const env = loadEnv(mode, envDir, "");
  const style = env.FINDBACK_MAP_STYLE_URL?.trim() || "";
  const contact = env.FINDBACK_MAP_CONTACT?.trim() || "";
  const search = env.VITE_NOMINATIM_SEARCH_URL?.trim() || "";
  return {
    styleUrl: style || DEFAULT_MAP_STYLE_URL,
    contact: contact || DEFAULT_MAP_CONTACT,
    styleSource: (style ? "custom" : "default") as "custom" | "default",
    contactSource: (contact ? "custom" : "default") as "custom" | "default",
    nominatimSearchUrl: search || DEFAULT_NOMINATIM_SEARCH_URL,
    searchSource: (search ? "custom" : "default") as "custom" | "default",
  };
}

/**
 * S3 — sourcemap mode (sourcemap settings ONLY; S1/S2 own the rest of this file's contract).
 *
 * Local builds emit NO source maps: there is nothing to leak, package, or upload.
 * Only a release build that explicitly opts in with SENTRY_UPLOAD_SOURCEMAPS=true
 * emits maps, as `hidden` (files on disk, but no sourceMappingURL comment in the
 * bundle), so they exist solely to be uploaded to Sentry and then stripped before
 * Capacitor sync. Pure and unit-tested (see src/vite.sourcemaps.test.ts).
 *
 * FINDBACK_BUILD_SOURCEMAPS=true is the diagnostic twin: same `hidden` output,
 * no SentryUpload assumption, for investigating production-only failures (for
 * example a background push handled by the app) on a local build. It is not a
 * release switch — see docs/BUILD_PERFORMANCE.md.
 */
export function resolveSourcemapMode(env: {
  SENTRY_UPLOAD_SOURCEMAPS?: string | undefined;
  FINDBACK_BUILD_SOURCEMAPS?: string | undefined;
}): "hidden" | false {
  return env.SENTRY_UPLOAD_SOURCEMAPS === "true" || env.FINDBACK_BUILD_SOURCEMAPS === "true"
    ? "hidden"
    : false;
}

/**
 * Initial-payload budget. `scripts/check-build-budget.mjs` fails the build when
 * any chunk reachable from index.html is larger than this, so a regression
 * cannot be silenced with chunkSizeWarningLimit. Unit-tested against the script.
 */
export const INITIAL_CHUNK_CEILING_BYTES = 1200 * 1024;

/** One Rolldown code-splitting group. `test` matches bundled module ids. */
export interface ChunkGroupRule {
  name: string;
  test: RegExp;
  priority: number;
  /** Bytes at which Rolldown splits the group into several equal chunks. */
  maxSize?: number;
}

/**
 * Chunk policy for the production build.
 *
 * WHY: with one entry (main → dynamic startApp) plus a second dynamic entry
 * (main → fixture preview), Rolldown's default partitioning produced two
 * multi-megabyte chunks — `AppBar` (2,231 kB / 644 kB gzip) and `startApp`
 * (989 kB / 295 kB gzip). AppBar's name was incidental; it held React,
 * react-dom, react-router, react-aria, zod, framer-motion, tiptap, the
 * markdown stack and most of the app code. Every boot paid for the whole set
 * at once and every release invalidated it.
 *
 * These groups pin vendor boundaries by package, so a vendor upgrade only
 * invalidates the chunk it touches and no single file becomes the dumping
 * ground. Order is significant: the first matching group wins, so the specific
 * package rules must precede `vendor-misc`.
 *
 * `[\\/]` is deliberate — module ids use backslashes on Windows.
 */
export function resolveChunkGroups(): ChunkGroupRule[] {
  return [
    { name: "vendor-react", test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 30 },
    { name: "vendor-router", test: /node_modules[\\/](?:react-router|@remix-run)[\\/]/, priority: 30 },
    {
      name: "vendor-aria",
      test: /node_modules[\\/](?:react-aria|react-aria-components|react-stately|@react-aria|@react-stately|@react-types|@internationalized)[\\/]/,
      priority: 30,
    },
    { name: "vendor-motion", test: /node_modules[\\/](?:framer-motion|motion-dom|motion-utils)[\\/]/, priority: 30 },
    {
      name: "vendor-editor",
      // The tiptap/ProseMirror stack is only reachable from the report and
      // comment composers; keeping it in one named chunk makes that cost visible.
      test: /node_modules[\\/](?:@tiptap|prosemirror-[^\\/]+|@floating-ui|linkifyjs)[\\/]/,
      priority: 25,
    },
    {
      name: "vendor-markdown",
      test: /node_modules[\\/](?:react-markdown|remark-[^\\/]+|rehype-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|hast-[^\\/]+|unist-[^\\/]+|unified|vfile[^\\/]*|property-information|space-separated-tokens|comma-separated-tokens|trim-lines|character-entities[^\\/]*|decode-named-character-reference|html-url-attributes|markdown-table|longest-streak|ccount|zwitch|bail|trough|devlop|is-plain-obj|escape-string-regexp)[\\/]/,
      priority: 25,
    },
    { name: "vendor-media", test: /node_modules[\\/]yet-another-react-lightbox[\\/]/, priority: 25 },
    { name: "vendor-icons", test: /node_modules[\\/]lucide-react[\\/]/, priority: 25 },
    { name: "vendor-validation", test: /node_modules[\\/]zod[\\/]/, priority: 25 },
    {
      name: "vendor-supabase",
      test: /node_modules[\\/](?:@supabase|phoenix|iceberg-js)[\\/]/,
      priority: 20,
    },
    // App subsystem: the local messaging/history/backup layer is the single
    // largest application group and changes independently of the UI, so it gets
    // its own content-addressed chunk. Nothing under services/messaging imports
    // a component or a screen, so this boundary adds no chunk cycle.
    { name: "app-messaging", test: /src[\\/]services[\\/]messaging[\\/]/, priority: 10 },
    // NO catch-all group on purpose. Grouping every remaining package (or all
    // of @sentry) merges chunks that are otherwise only reached through a
    // dynamic import into one eagerly-loaded file: measured, an `@sentry` group
    // moved 487 kB of replay/feedback code into the preloaded graph. Anything
    // not named above keeps Rolldown's automatic, laziness-aware chunking.
  ];
}

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    // Direct `vite build` must not bypass the same fail-closed gate used by
    // npm scripts, CI, and Gradle. Tests and `vite dev` remain DSN-free.
    const preflight = spawnSync(process.execPath,
      [resolve(import.meta.dirname, "../../scripts/check-mobile-build-config.mjs"), "--preflight"],
      { stdio: "inherit", env: process.env });
    if (preflight.status !== 0) throw new Error("Supabase build configuration preflight failed");
  }
  const { publishableKey, url } = resolveSupabaseBuildEnv(mode);
  const shareOrigin = loadEnv(mode, process.env.FINDBACK_ENV_DIR || resolve(import.meta.dirname, "../.."), "").VITE_PUBLIC_SHARE_ORIGIN?.trim() || "";
  const mapEnv = resolveMapBuildEnv(mode);
  // Drive backup authorization is a web public client id. It may be the same
  // OAuth client as sign-in (the client is not an identity), but the backup
  // flow requests only `drive.appdata` and never exchanges its token for a
  // Norfold session.
  const buildEnv = loadEnv(mode, process.env.FINDBACK_ENV_DIR || resolve(import.meta.dirname, "../.."), "");
  const driveClientId = buildEnv.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim()
    || buildEnv.GOOGLE_WEB_CLIENT_ID?.trim() || "";
  if (command === "build") {
    // FBX-027 maps truth: the node owner validates the effective map config
    // (malformed custom values fail closed). Running it here means a direct
    // `vite build` can never bake a web map truth that disagrees with the
    // native BuildConfig truth — the same check the signeddev Gradle path
    // runs through verifySigneddevConfig. Logs carry presence only.
    const mapCheck = spawnSync(process.execPath,
      [resolve(import.meta.dirname, "../../scripts/check-map-config.mjs")],
      { stdio: "inherit", env: process.env });
    if (mapCheck.status !== 0) throw new Error("Map build configuration check failed");
  }
  if (command === "build") {
    // Derive the VITE_* names in the build environment from the canonical
    // local SUPABASE_* values; import.meta.env and define then agree.
    process.env.VITE_SUPABASE_URL = url;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  }
  const sourcemap = resolveSourcemapMode(process.env);
  // Explicit local behavior (S3): say which mode we are in so a missing upload
  // token can never be mistaken for an upload — maps simply do not exist.
  console.info(
    `[findback] sourcemaps ${sourcemap
      ? `ENABLED (hidden, ${process.env.SENTRY_UPLOAD_SOURCEMAPS === "true" ? "Sentry upload then strip" : "diagnostic only — do not package dist"})`
      : "DISABLED (local build: no .map files emitted)"}`,
  );
  return {
    plugins: [react(), tailwindcss()],
    // Vitest only (ignored by `vite build`). Full-suite worker load can push
    // the async photo/publish flows used by the CreateReport suites past
    // vitest's 5s default test timeout (the suite's own explicit gates already
    // allow 5s for the same reason), which flaked CI and the release gate.
    // Raise the ceiling and give testing-library queries matching headroom
    // rather than weakening any assertion.
    test: {
      testTimeout: 20_000,
      hookTimeout: 20_000,
      setupFiles: ["./src/test-setup.ts"],
      // Vendored upstream sources (llama.cpp, needle engines) ship their own
      // web/UI tests for reference; they are not part of this workspace's
      // suite and their frameworks are not installed here.
      exclude: ["**/node_modules/**", "**/dist/**", "android/app/src/main/cpp/third_party/**"],
    },
    server: {
      port: 5173,
      host: true,
    },
    build: {
      // S3: sourcemaps exist ONLY to be uploaded to Sentry, then stripped.
      // Local builds (no opt-in) emit no maps at all: nothing to leak or
      // package. The release job sets SENTRY_UPLOAD_SOURCEMAPS=true, uploads
      // with SENTRY_AUTH_TOKEN (a CI secret — never a VITE_* variable), and
      // deletes every *.map before Capacitor sync (verified by a workflow step).
      // `hidden` omits the sourceMappingURL comment so that even a failed strip
      // can never leave the shipped bundle pointing at map files.
      sourcemap,
      // Explicit chunk boundaries instead of one incidental mega-chunk; see
      // resolveChunkGroups for the measured reason. The budget script
      // (scripts/check-build-budget.mjs) enforces the ceiling afterwards.
      rolldownOptions: {
        output: {
          codeSplitting: { groups: resolveChunkGroups() },
        },
      },
    },
    define: {
      // The dev server applies `import.meta.env.*` defines but not bare
      // identifiers, so both spellings are emitted from one source of truth.
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publishableKey),
      "import.meta.env.VITE_PUBLIC_SHARE_ORIGIN": JSON.stringify(shareOrigin),
      "import.meta.env.VITE_MAP_STYLE_URL": JSON.stringify(mapEnv.styleUrl),
      "import.meta.env.VITE_MAP_SEARCH_CONTACT": JSON.stringify(mapEnv.contact),
      "import.meta.env.VITE_NOMINATIM_SEARCH_URL": JSON.stringify(mapEnv.nominatimSearchUrl),
      "import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID": JSON.stringify(driveClientId),
      __SUPABASE_URL__: JSON.stringify(url),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
    },
  };
});
