import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ native: false }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));

import { mapProviderFallbackNotice, resolveMapProvider } from "./mapProvider";
import type { GoogleMapsAuthFailureReason } from "./googleMapsLoader";

const KEY = "test-browser-key";
const REASONS: GoogleMapsAuthFailureReason[] = [
  "no-key",
  "auth-failure",
  "load-timeout",
  "load-error",
];

beforeEach(() => {
  platform.native = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  platform.native = false;
});

describe("mapProvider", () => {
  it("keeps the keyless OSM surface when no Google key is configured", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    expect(resolveMapProvider()).toBe("osm");
  });

  it("resolves the Google provider when a key is configured on the web", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    expect(resolveMapProvider()).toBe("google");
  });

  it("keeps OSM inside the native shell even when a key is configured", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    platform.native = true;
    expect(resolveMapProvider()).toBe("osm");
  });

  it("returns distinct consumer-safe copy for every failure reason", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    const notices = REASONS.map((reason) => mapProviderFallbackNotice(reason));
    for (const notice of notices) {
      expect(notice.trim()).not.toBe("");
      expect(notice).not.toContain(KEY);
      expect(notice).not.toContain("!");
    }
    expect(new Set(notices).size).toBe(REASONS.length);
  });
});
