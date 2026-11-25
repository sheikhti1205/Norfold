import { useEffect, useRef, useState } from "react";
import {
  GoogleMapsLoadError,
  googleMapsKey,
  loadGoogleMaps,
  type GoogleMapsAuthFailureReason,
  type GoogleMapsMap,
  type GoogleMapsMarker,
} from "../services/location/googleMapsLoader";

interface GoogleMapCanvasProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  className?: string;
  /** Accessible name for the region; callers pass the place label. */
  label?: string;
  /** `false` (default) is a preview: gestures stay off. */
  interactive?: boolean;
  onFailure?: (reason: GoogleMapsAuthFailureReason) => void;
}

const DEFAULT_ZOOM = 15;
const DEFAULT_LABEL = "Map preview";

/**
 * Google Maps preview surface for the web build.
 *
 * A preview, not a picker: the caller sizes the host and owns the fallback
 * surface. Any failure path (missing key, rejected key, timeout, blocked
 * script, missing marker constructor) reports once through `onFailure` and
 * renders nothing at all — never a blank grey box with no signal.
 */
export function GoogleMapCanvas({
  latitude,
  longitude,
  zoom = DEFAULT_ZOOM,
  className,
  label,
  interactive = false,
  onFailure,
}: GoogleMapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onFailureRef = useRef(onFailure);
  const [failed, setFailed] = useState(false);
  // Part of the effect's identity: a rebuilt bundle with a different key must
  // not keep a map created for the old one.
  const key = googleMapsKey();

  useEffect(() => {
    onFailureRef.current = onFailure;
  });

  useEffect(() => {
    if (failed) return;
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let marker: GoogleMapsMarker | null = null;

    const fail = (reason: GoogleMapsAuthFailureReason) => {
      if (cancelled) return;
      cancelled = true;
      setFailed(true);
      onFailureRef.current?.(reason);
    };

    void loadGoogleMaps()
      .then((api) => {
        if (cancelled) return;
        const options: Record<string, unknown> = {
          center: { lat: latitude, lng: longitude },
          zoom,
          // Preview chrome stays off; gestures only when the caller opts in.
          disableDefaultUI: true,
          zoomControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          gestureHandling: interactive ? "cooperative" : "none",
        };
        let instance: GoogleMapsMap;
        try {
          // Dark mode without a map ID is UNVERIFIED: `colorScheme` is
          // documented for vector maps, which this build deliberately does not
          // use (no `mapId`, for cost reasons). Pass it as a best-effort hint
          // and fall back to the default scheme if the constructor rejects it.
          instance = new api.maps.Map(host, { ...options, colorScheme: "FOLLOW_SYSTEM" });
        } catch {
          instance = new api.maps.Map(host, options);
        }
        const Marker = api.maps.Marker;
        if (!Marker) {
          // AdvancedMarkerElement needs a map ID, so a missing plain Marker is
          // a hard failure rather than a silently pin-less map.
          fail("load-error");
          return;
        }
        marker = new Marker({ map: instance, position: { lat: latitude, lng: longitude } });
      })
      .catch((error: unknown) => {
        fail(error instanceof GoogleMapsLoadError ? error.reason : "load-error");
      });

    return () => {
      cancelled = true;
      marker?.setMap?.(null);
      marker = null;
      // The Maps API exposes no destroy(): clearing the host and dropping the
      // marker reference is the supported release.
      host.replaceChildren();
    };
  }, [failed, key, latitude, longitude, zoom, interactive]);

  if (failed) return null;

  // No attribution text of our own: the API draws the Google logo inside the
  // map, so the container must never overlay its bottom-left corner.
  return (
    <div
      ref={hostRef}
      role="region"
      aria-label={label?.trim() || DEFAULT_LABEL}
      className={className}
    />
  );
}
