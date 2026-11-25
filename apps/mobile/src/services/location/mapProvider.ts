/**
 * Which map preview a surface should use.
 *
 * The rule is dormant until a build ships a Google key: with no key the app
 * keeps the keyless OSM raster surface, and a Google key switches the preview
 * over. Nothing calls this yet — it exists so the switch has one home when the
 * preview surface starts choosing a provider.
 */

import {
  isGoogleMapsConfigured,
  type GoogleMapsAuthFailureReason,
} from "./googleMapsLoader";

export type MapProvider = "google" | "osm";

/** `google` only when a public key was built in; `osm` otherwise. */
export function resolveMapProvider(): MapProvider {
  return isGoogleMapsConfigured() ? "google" : "osm";
}

/** Consumer-safe copy per failure — never carries key material. */
const FALLBACK_NOTICES: Record<GoogleMapsAuthFailureReason, string> = {
  "no-key": "Map preview unavailable. The location still saves normally.",
  "auth-failure":
    "Map preview unavailable — the map key was rejected. The location still saves normally.",
  "load-timeout": "Map preview took too long to load. The location still saves normally.",
  "load-error": "Map preview could not load. The location still saves normally.",
};

export function mapProviderFallbackNotice(reason: GoogleMapsAuthFailureReason): string {
  return FALLBACK_NOTICES[reason];
}
