/**
 * S3 sourcemap-mode tests (TDD red first).
 *
 * Contract: local builds emit NO source maps (nothing to leak or package);
 * only a release build that explicitly opts in with SENTRY_UPLOAD_SOURCEMAPS=true
 * emits maps, as `hidden` (no sourceMappingURL comment), so they exist solely
 * to be uploaded to Sentry and then stripped before Capacitor sync.
 */
import { describe, expect, it } from "vitest";
import { resolveSourcemapMode } from "../vite.config";

describe("resolveSourcemapMode", () => {
  it("defaults to false (local builds emit no maps)", () => {
    expect(resolveSourcemapMode({})).toBe(false);
  });

  it("emits hidden maps only on explicit opt-in", () => {
    expect(resolveSourcemapMode({ SENTRY_UPLOAD_SOURCEMAPS: "true" })).toBe(
      "hidden",
    );
  });

  it("treats any other value as off (fail closed)", () => {
    expect(resolveSourcemapMode({ SENTRY_UPLOAD_SOURCEMAPS: "" })).toBe(false);
    expect(resolveSourcemapMode({ SENTRY_UPLOAD_SOURCEMAPS: "1" })).toBe(false);
    expect(resolveSourcemapMode({ SENTRY_UPLOAD_SOURCEMAPS: "TRUE" })).toBe(false);
  });

  // Diagnostic builds (for example investigating a background push the app
  // handled) need maps without a Sentry upload, and must stay `hidden` so the
  // shipped bundle never points at a map file.
  it("emits hidden maps for a diagnostic opt-in too", () => {
    expect(resolveSourcemapMode({ FINDBACK_BUILD_SOURCEMAPS: "true" })).toBe("hidden");
  });

  it("keeps a partial or ambiguous diagnostic value off", () => {
    expect(resolveSourcemapMode({ FINDBACK_BUILD_SOURCEMAPS: "" })).toBe(false);
    expect(resolveSourcemapMode({ FINDBACK_BUILD_SOURCEMAPS: "yes" })).toBe(false);
    expect(resolveSourcemapMode({ FINDBACK_BUILD_SOURCEMAPS: "true " })).toBe(false);
  });
});
