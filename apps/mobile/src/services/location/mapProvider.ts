/**
 * Which map preview a surface should use.
 *
 * Two conditions must both hold for Google: a public key was built in, and the
 * app is running on the web. The key is restricted to
 * `https://findbackapp.social/*`, and the Android webview sends no such
 * referrer, so the JavaScript API can never authorise inside the APK — trying
 * it there would only produce a rejected map. Native keeps the keyless OSM
 * raster until the APK gets a native Google map.
 */

import { Capacitor } from "@capacitor/core";
import {
  isGoogleMapsConfigured,
  type GoogleMapsAuthFailureReason,
} from "./googleMapsLoader";

export type MapProvider = "google" | "osm";

/**
 * `google` only when a public key was built in and this is not the native
 * shell; `osm` otherwise.
 */
export function resolveMapProvider(): MapProvider {
  return isGoogleMapsConfigured() && !Capacitor.isNativePlatform() ? "google" : "osm";
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
