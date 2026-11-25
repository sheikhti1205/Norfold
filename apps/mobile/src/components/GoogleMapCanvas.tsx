import { useEffect, useRef, useState } from "react";
import {
  GoogleMapsLoadError,
  googleMapsKey,
  loadGoogleMaps,
  type GoogleMapsAuthFailureReason,
  type GoogleMapsMap,
  type GoogleMapsMarker,
} from "../services/location/googleMapsLoader";

/** A plain centre literal — what a picker reports and re-applies. */
interface MapCenter {
  lat: number;
  lng: number;
}

/**
 * The loader models only the two constructors this app draws with. Picking
 * also needs the event and centre members, so they are widened here rather
 * than in the loader, whose narrow types every preview relies on.
 */
interface PickableMap extends GoogleMapsMap {
  addListener?: (event: string, handler: () => void) => { remove?: () => void } | undefined;
  getCenter?: () => { lat: () => number; lng: () => number } | null | undefined;
  setCenter?: (center: MapCenter) => void;
}

interface PickableMarker extends GoogleMapsMarker {
  setPosition?: (position: MapCenter) => void;
}

interface GoogleMapCanvasProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  className?: string;
  /** Accessible name for the region; callers pass the place label. */
  label?: string;
  /** `false` (default) is a preview: gestures stay off. */
  interactive?: boolean;
  /**
   * Opt-in picking: plain drag/pan (no ctrl or two-finger requirement), the
   * API's own UI stays off, and the marker follows the centre the user
   * settles on. `false` (default) keeps the preview behaviour above.
   */
  picking?: boolean;
  /**
   * Picking only: fires when the user finishes moving the map, with the centre
   * under the pin. The opening view is never reported, and a preview never
   * calls it.
   */
  onCenterChange?: (center: MapCenter) => void;
  onFailure?: (reason: GoogleMapsAuthFailureReason) => void;
}

const DEFAULT_ZOOM = 15;
const DEFAULT_LABEL = "Map preview";

/**
 * Google Maps surface for the web build.
 *
 * A preview by default (`interactive` only allows cooperative gestures); the
 * caller sizes the host and owns the fallback surface. `picking` makes the
 * same primitive a location picker: plain drag/pan, no API chrome, and the
 * marker moves with the centre the user settles on. Any failure path (missing
 * key, rejected key, timeout, blocked script, missing marker constructor)
 * reports once through `onFailure` and renders nothing at all — never a blank
 * grey box with no signal.
 */
export function GoogleMapCanvas({
  latitude,
  longitude,
  zoom = DEFAULT_ZOOM,
  className,
  label,
  interactive = false,
  picking = false,
  onCenterChange,
  onFailure,
}: GoogleMapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onFailureRef = useRef(onFailure);
  const onCenterChangeRef = useRef(onCenterChange);
  const mapRef = useRef<PickableMap | null>(null);
  const markerRef = useRef<PickableMarker | null>(null);
  // The centre this canvas last put the pin on. A picker compares the map's
  // own centre against it, so a user move is told apart from our own recentre.
  const pinnedRef = useRef<MapCenter | null>(null);
  const [failed, setFailed] = useState(false);
  // Part of the effect's identity: a rebuilt bundle with a different key must
  // not keep a map created for the old one.
  const key = googleMapsKey();
  // Creation reads the view through a ref: in picking mode the caller adopts
  // each reported centre, and a rebuild per adopted centre would flash the map
  // and drop the gesture mid-flight.
  const viewRef = useRef({ latitude, longitude, zoom });
  viewRef.current = { latitude, longitude, zoom };
  // Preview keeps today's rule — a coordinate or zoom change builds a fresh
  // map. Picking creates the map once, so only the mode itself is a creation
  // input; `picking` in the list re-creates on a mode change.
  const previewView = picking ? "" : `${latitude}:${longitude}:${zoom}`;

  useEffect(() => {
    onFailureRef.current = onFailure;
    onCenterChangeRef.current = onCenterChange;
  });

  useEffect(() => {
    if (failed) return;
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let marker: PickableMarker | null = null;
    let idleListener: { remove?: () => void } | undefined;

    const fail = (reason: GoogleMapsAuthFailureReason) => {
      if (cancelled) return;
      cancelled = true;
      setFailed(true);
      onFailureRef.current?.(reason);
    };

    void loadGoogleMaps()
      .then((api) => {
        if (cancelled) return;
        const view = viewRef.current;
        const options: Record<string, unknown> = {
          center: { lat: view.latitude, lng: view.longitude },
          zoom: view.zoom,
          // Preview chrome stays off; gestures only when the caller opts in.
          disableDefaultUI: true,
          zoomControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          // Picking is plain drag/pan. `cooperative` would demand ctrl-drag or
          // two fingers, which is wrong for a picker.
          gestureHandling: picking ? "greedy" : interactive ? "cooperative" : "none",
        };
        let instance: PickableMap;
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
        marker = new Marker({ map: instance, position: { lat: view.latitude, lng: view.longitude } });
        mapRef.current = instance;
        markerRef.current = marker;
        pinnedRef.current = { lat: view.latitude, lng: view.longitude };
        if (!picking) return;
        // `idle` is the only event that fires once a pan OR a pinch settles, so
        // the pin lands on the centre the user actually stopped at. The
        // opening idle carries the centre just created, so it reports nothing:
        // a picker never fabricates a pin for a view nobody moved.
        idleListener = instance.addListener?.("idle", () => {
          const center = instance.getCenter?.();
          if (!center) return;
          const next = { lat: center.lat(), lng: center.lng() };
          const pinned = pinnedRef.current;
          if (pinned && pinned.lat === next.lat && pinned.lng === next.lng) return;
          pinnedRef.current = next;
          marker?.setPosition?.(next);
          onCenterChangeRef.current?.(next);
        });
      })
      .catch((error: unknown) => {
        fail(error instanceof GoogleMapsLoadError ? error.reason : "load-error");
      });

    return () => {
      cancelled = true;
      idleListener?.remove?.();
      idleListener = undefined;
      marker?.setMap?.(null);
      marker = null;
      mapRef.current = null;
      markerRef.current = null;
      pinnedRef.current = null;
      // The Maps API exposes no destroy(): clearing the host and dropping the
      // marker reference is the supported release.
      host.replaceChildren();
    };
  }, [failed, key, previewView, picking, interactive]);

  // Picking: adopt a caller-side recentre (a search result, a GPS snap) on the
  // map that already exists, and never echo a centre this canvas reported.
  // Zoom is deliberately not re-applied — a pinch must survive a recentre.
  useEffect(() => {
    if (!picking) return;
    const map = mapRef.current;
    if (!map) return;
    const pinned = pinnedRef.current;
    if (pinned && pinned.lat === latitude && pinned.lng === longitude) return;
    const next = { lat: latitude, lng: longitude };
    pinnedRef.current = next;
    map.setCenter?.(next);
    markerRef.current?.setPosition?.(next);
  }, [picking, latitude, longitude]);

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
