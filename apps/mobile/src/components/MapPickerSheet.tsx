import { useEffect, useRef, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  ExternalLink,
  MapPin,
  Minus,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { motion } from "framer-motion";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { GoogleMapCanvas } from "./GoogleMapCanvas";
import { RasterTileMosaic } from "./RasterTileMosaic";
import { announce } from "./LiveRegion";
import type { LocationValue } from "./LocationPicker";
import {
  formatAccuracy,
  isLowAccuracy,
  locationFailureMessage,
} from "./locationPermission";
import {
  createProductionLocationAdapter,
  requestFixWithGeneration,
  type FixState,
  type LocationAdapter,
} from "../services/locationAdapter";
import {
  isNativeLocationServicesAvailable,
  requestEnableDeviceLocation,
} from "../services/locationServices";
import { openInMaps } from "../utils/location";
import {
  isNativeMapPickerAvailable,
  openMapPickerNative,
  type MapPickerInput,
  type MapPickerResult,
} from "../native/mapLibreMaps";
import {
  RASTER_ATTRIBUTION,
  clampRasterZoom,
  nudgeCenter,
  rasterTilesForCenter,
} from "../services/location/rasterTiles";
import {
  mapProviderFallbackNotice,
  resolveMapProvider,
} from "../services/location/mapProvider";
import type { GoogleMapsAuthFailureReason } from "../services/location/googleMapsLoader";
import {
  NominatimRateLimitError,
  sharedNominatimThrottler,
  type NominatimSearchOverride,
  type PlaceResult,
} from "../services/location/nominatimSearch";
import {
  attributionForSource,
  searchPlacesUnified,
} from "../services/location/placesSearch";
import { recordOperation } from "../services/monitoring/operations";
import {
  PIN_ZOOM,
  commitCenterAsLocation,
  formatCoordinateReadout,
  isValidCenter,
  resolveInitialView,
  type InitialViewSource,
  type MapCenter,
} from "../services/location/mapPickerState";
import { motionDurations, motionEasings } from "./uiMotion";

export interface MapPickerSearchResult {
  lat: number;
  lng: number;
  label: string;
}

export interface MapPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Existing report pin — start-order #1 (camera only until Confirm). */
  value: LocationValue;
  onConfirm: (next: LocationValue) => void;
  /** Chosen search result from a previous session — start-order #2. */
  initialSearchResult?: MapPickerSearchResult | null;
  /** Search-endpoint seam for Nominatim (the future controlled proxy plugs in here). */
  nominatimOverride?: NominatimSearchOverride;
  /**
   * Native picker seam. `undefined` (default) auto-detects the FindbackMap
   * bridge on-device; `null` forces the keyless fallback (web/dev/tests).
   */
  nativePicker?: ((options: MapPickerInput) => Promise<MapPickerResult>) | null;
  locationAdapter?: LocationAdapter;
  /** Conversation pins may carry the fix accuracy; public pins never do. */
  visibility?: "public" | "conversation";
}

/** Collapses accidental double-taps on the Search button into one request. */
const SUBMIT_DEBOUNCE_MS = 600;

interface PickerRasterMapProps {
  center: MapCenter;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onNudge: (dxTiles: number, dyTiles: number) => void;
}

interface PickerControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onNudge: (dxTiles: number, dyTiles: number) => void;
  /**
   * Position classes for the cluster: the move pad sits on the left and the
   * zoom pair on the right. The wrapper ignores pointer events so a drag
   * between the two groups still reaches the map underneath.
   */
  className?: string;
}

/**
 * Move pad + zoom pair shared by both picking surfaces, so the keyless raster
 * map and the Google map offer the same keyboard and screen-reader controls.
 */
function PickerControls({ onZoomIn, onZoomOut, onNudge, className }: PickerControlsProps) {
  return (
    <div className={`pointer-events-none flex justify-between ${className ?? ""}`}>
      <div className="pointer-events-auto">
        <div role="group" aria-label="Move pin" className="grid grid-cols-3 gap-0.5">
          <span />
          <button
            type="button"
            aria-label="Move pin north"
            onClick={() => onNudge(0, -1)}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm border border-outline bg-surface text-on-surface"
          >
            <ChevronUp size={16} aria-hidden />
          </button>
          <span />
          <button
            type="button"
            aria-label="Move pin west"
            onClick={() => onNudge(-1, 0)}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm border border-outline bg-surface text-on-surface"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Move pin south"
            onClick={() => onNudge(0, 1)}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm border border-outline bg-surface text-on-surface"
          >
            <ChevronDown size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Move pin east"
            onClick={() => onNudge(1, 0)}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm border border-outline bg-surface text-on-surface"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div className="pointer-events-auto">
        <div role="group" aria-label="Map zoom" className="flex gap-1">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={onZoomIn}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm border border-outline bg-surface px-2 text-on-surface"
          >
            <Plus size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={onZoomOut}
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-m3-sm border border-outline bg-surface px-2 text-on-surface"
          >
            <Minus size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Dependency-free keyless map: a plain-<img> 3x3 OSM tile grid under a fixed
 * center pin, with zoom and nudge controls. The draft lives outside the tile
 * layer, so search, GPS preview, nudge, and Confirm all keep working —
 * including offline, where the grid simply shows no tiles.
 */
function PickerRasterMap({ center, zoom, onZoomIn, onZoomOut, onNudge }: PickerRasterMapProps) {
  const tiles = rasterTilesForCenter(center, zoom);
  return (
    <div
      data-testid="map-picker-map"
      role="region"
      aria-label="Map. Use the move and zoom buttons to position the pin."
      className="absolute inset-0"
    >
      <RasterTileMosaic tiles={tiles} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: motionDurations.instant, ease: motionEasings.out }}
        >
          <MapPin size={32} className="text-on-surface drop-shadow" />
        </motion.div>
      </div>
      <PickerControls
        className="absolute inset-x-2 bottom-2 items-end"
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onNudge={onNudge}
      />
    </div>
  );
}

/**
 * Interactive location picker.
 *
 * On Android the native MapLibre picker owns the interaction: this component
 * renders nothing and forwards Confirm/Cancel from the Activity. Confirm
 * commits through the same approximate-by-default path as LocationPicker
 * (exact opt-in is this sheet's own toggle). Cancel never mutates the draft.
 *
 * On web/dev (or when the bridge is missing) a fallback sheet applies: the
 * interactive Google map when a public key is built in (web only), otherwise
 * keyless raster tiles under a fixed center pin — plus explicit-submit
 * Nominatim search, one-shot GPS preview, and manual nudge. Nothing is saved
 * until Confirm in either path.
 */
export function MapPickerSheet({
  open,
  onClose,
  value,
  onConfirm,
  initialSearchResult,
  nominatimOverride,
  nativePicker,
  locationAdapter,
  visibility = "public",
}: MapPickerSheetProps) {
  const [defaultAdapter] = useState(createProductionLocationAdapter);
  const adapter = locationAdapter ?? defaultAdapter;
  const fixGeneration = useRef(0);
  useEffect(() => () => { fixGeneration.current += 1; }, []);
  // Process-wide throttle (MAP-3): the shared provider-level gate, so
  // reopening the sheet cannot mint a fresh limiter. Explicit-submit only.
  const searchThrottlerRef = useRef(sharedNominatimThrottler);
  const lastSubmitRef = useRef(0);

  // `undefined` auto-detects the on-device bridge; an explicit `null` (or a
  // test double) overrides it. useState keeps the resolution stable per mount
  // so a mid-flight bridge change cannot double-launch the picker.
  const [resolvedPicker] = useState(
    () => nativePicker !== undefined ? nativePicker : (isNativeMapPickerAvailable() ? openMapPickerNative : null),
  );
  // A rejected native picker falls back in place (stays open): the raster
  // map + search + current-location + manual confirm remain usable below a
  // truthful notice. The draft/value survives the transition.
  const [nativeUnavailable, setNativeUnavailable] = useState(false);
  const nativeActive = open && resolvedPicker != null && !nativeUnavailable;

  const [fallbackCenter, setFallbackCenter] = useState<MapCenter>({ lat: 0, lng: 0 });
  const [fallbackZoom, setFallbackZoom] = useState(PIN_ZOOM);
  const [viewSource, setViewSource] = useState<InitialViewSource>("neutral-world");
  const [draft, setDraft] = useState<MapCenter | null>(null);
  const [draftLabel, setDraftLabel] = useState("Pinned location");
  const [exact, setExact] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [gpsPreview, setGpsPreview] = useState<MapCenter | null>(null);
  // A coarse fix too imprecise to snap to — held for an explicit opt-in.
  const [pendingFix, setPendingFix] = useState<MapCenter | null>(null);
  const [pendingAccuracy, setPendingAccuracy] = useState<number | null>(null);
  // Accuracy of the previewed fix, carried into a conversation pin only. It is
  // dropped as soon as the pin moves for any other reason.
  const [fixAccuracy, setFixAccuracy] = useState<number | null>(null);
  // Which failure the message describes; services-off alone offers the native
  // enable-location action (never for other failures).
  const [geoErrorKind, setGeoErrorKind] = useState<FixState["kind"] | null>(null);
  const [enablingServices, setEnablingServices] = useState(false);
  // Provider and platform are fixed for the life of the mount: a build-time
  // key cannot change under a session, and the Google JS API is web-only.
  const [mapProvider] = useState(resolveMapProvider);
  // Google on the web path only: Android keeps the native picker (a native
  // Google MapView replaces it later), so the webview never boots the JS API.
  const googleWebPicker = mapProvider === "google" && !Capacitor.isNativePlatform();
  const [mapFailure, setMapFailure] = useState<GoogleMapsAuthFailureReason | null>(null);

  // Native path: forward to the Activity; Cancel closes with no mutation.
  // `launchedRef` makes the launch once-per-open: a mid-flight value change
  // must not fire a second Activity (which would reject BUSY and spuriously
  // close the sheet while the first Activity still owns the interaction).
  // `launchStateRef` freezes the launch inputs: the in-flight result is
  // honored with the open-time value/label/callbacks, so a mid-flight change
  // can neither relaunch nor orphan the pending Activity result. (Reading
  // props through a ref keeps this effect subscribed only to open/picker.)
  const launchedRef = useRef(false);
  const launchStateRef = useRef({ value, initialSearchResult, onConfirm, onClose });
  launchStateRef.current = { value, initialSearchResult, onConfirm, onClose };
  useEffect(() => {
    if (!open) {
      launchedRef.current = false;
      setNativeUnavailable(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open || resolvedPicker == null || launchedRef.current) return;
    launchedRef.current = true;
    let stale = false;
    const {
      value: launchValue,
      initialSearchResult: launchSearch,
      onConfirm: confirm,
      onClose: close,
    } = launchStateRef.current;
    const reportPin =
      launchValue.latitude != null && launchValue.longitude != null
        ? { lat: launchValue.latitude, lng: launchValue.longitude }
        : null;
    const searchStart =
      launchSearch != null
        ? { lat: launchSearch.lat, lng: launchSearch.lng }
        : null;
    const initial = resolveInitialView({
      reportPin: isValidCenter(reportPin) ? reportPin : null,
      searchResult: isValidCenter(searchStart) ? searchStart : null,
      gpsPreview: null,
    });
    const label =
      launchSearch?.label.trim() || launchValue.label.trim() || "Pinned location";
    // Neutral-world start sends NO camera seed: the native side shows its
    // display-only default with a null draft (Confirm disabled) instead of a
    // fabricated pin at (0,0) — which would pass validation and look real.
    // The seed zoom is omitted too so a world-zoom value cannot override the
    // native neutral framing.
    const seed =
      initial.source === "neutral-world"
        ? {}
        : { latitude: initial.center.lat, longitude: initial.center.lng, zoom: initial.zoom };
    void resolvedPicker({ ...seed, label }).then(
      (result) => {
        if (stale) return;
        if (!result.cancelled) {
          // Approximate-by-default, identical to every other entry path;
          // exact opt-in is the fallback sheet's own toggle.
          confirm(
            commitCenterAsLocation(
              label,
              { lat: result.latitude, lng: result.longitude },
              "APPROXIMATE",
            ),
          );
          announce("Approximate location selected (~100 m).");
        }
        close();
      },
      () => {
        if (stale) return;
        // Native rejection (MAP_UNAVAILABLE / launch failure) stays open:
        // seed the in-place raster/manual fallback from the open-time
        // value so the draft survives, then show the truthful notice.
        // Cancel still closes with no mutation via the fallback sheet.
        setViewSource(initial.source);
        setDraft(initial.source === "neutral-world" ? null : initial.center);
        setFallbackCenter(initial.center);
        setFallbackZoom(initial.zoom);
        setDraftLabel(label);
        // Keep an exact pin exact when the native picker hands over: reopening
        // must not silently downgrade it on the next Confirm.
        setExact(initial.source === "report-pin" && launchValue.precision === "EXACT");
        setSearchInput("");
        setSearchError(null);
        setResults([]);
        setLocating(false);
        setGeoError(null);
        setPendingFix(null);
        setPendingAccuracy(null);
        setFixAccuracy(null);
        setGeoErrorKind(null);
        setEnablingServices(false);
        setGpsPreview(null);
        setNativeUnavailable(true);
      },
    );
    return () => {
      stale = true;
    };
  }, [open, resolvedPicker]);

  // Fallback path: reset the sheet draft whenever it opens.
  useEffect(() => {
    if (!open || resolvedPicker != null) return;
    const reportPin =
      value.latitude != null && value.longitude != null
        ? { lat: value.latitude, lng: value.longitude }
        : null;
    const searchStart =
      initialSearchResult != null
        ? { lat: initialSearchResult.lat, lng: initialSearchResult.lng }
        : null;
    const initial = resolveInitialView({
      reportPin: isValidCenter(reportPin) ? reportPin : null,
      searchResult: isValidCenter(searchStart) ? searchStart : null,
      gpsPreview: null,
    });
    setViewSource(initial.source);
    setDraft(initial.source === "neutral-world" ? null : initial.center);
    setFallbackCenter(initial.center);
    setFallbackZoom(initial.zoom);
    setDraftLabel(
      initialSearchResult?.label.trim() || value.label.trim() || "Pinned location",
    );
    // Seed the toggle from the value being edited: an existing EXACT pin opens
    // in exact mode (warning shown) so re-confirming is a no-op, not a silent
    // downgrade. A cleared or approximate value stays approximate.
    setExact(initial.source === "report-pin" && value.precision === "EXACT");
    setSearchInput("");
    setSearchError(null);
    setResults([]);
    setLocating(false);
    setGeoError(null);
    setPendingFix(null);
    setPendingAccuracy(null);
    setFixAccuracy(null);
    setGeoErrorKind(null);
    setEnablingServices(false);
    setGpsPreview(null);
    setMapFailure(null);
  }, [open, resolvedPicker, value.latitude, value.longitude, value.label, value.precision, initialSearchResult]);

  /** Moves the fallback camera (the draft is updated by the caller). */
  function recenterCamera(center: MapCenter): void {
    setFallbackCenter(center);
  }

  /** Nudge-pad pan (also the offline manual path). */
  function nudgeFallback(dxTiles: number, dyTiles: number): void {
    const nextCenter = nudgeCenter(fallbackCenter, fallbackZoom, dxTiles, dyTiles);
    fixGeneration.current += 1;
    setLocating(false);
    setFixAccuracy(null);
    setFallbackCenter(nextCenter);
    setDraft(nextCenter);
  }

  /**
   * Google picker drag: the map centre is the pin. Same effect as a nudge —
   * the draft moves, nothing is committed, and an in-flight fix is dropped.
   */
  function handleMapCenterChange(center: MapCenter): void {
    fixGeneration.current += 1;
    setLocating(false);
    setFixAccuracy(null);
    setFallbackCenter(center);
    setDraft(center);
  }

  /** Snaps the preview to a fix. Never confirms — the user still confirms. */
  function snapPreviewTo(fix: MapCenter, accuracy: number | null): void {
    setGpsPreview(fix);
    setPendingFix(null);
    setPendingAccuracy(null);
    setFixAccuracy(accuracy);
    setDraft(fix);
    setFallbackCenter(fix);
    announce("Preview recentered on your location. Confirm to use it.");
  }

  /**
   * Explicit, one-shot, coarse request. Concurrent taps collapse into one
   * platform prompt; a fix coarser than the ~100 m pin is held for opt-in.
   */
  function useCurrentLocation(): void {
    setLocating(true);
    setGeoError(null);
    setGeoErrorKind(null);
    setPendingFix(null);
    setPendingAccuracy(null);
    void requestFixWithGeneration(adapter, { generation: fixGeneration }).then((outcome) => {
      if (outcome.kind === "idle") return;
      setLocating(false);
      if (outcome.kind !== "fix") {
        if (outcome.kind !== "locating" && outcome.kind !== "requesting-permission") {
          setGeoError(locationFailureMessage(outcome.kind === "services-off" ? "disabled" : outcome.kind));
          setGeoErrorKind(outcome.kind);
        }
        return;
      }
      // A conversation pin carries the fix estimate, so a fix without a
      // usable accuracy is not a shareable pin. Unusable numbers are
      // rejected here, never turned into a fabricated estimate.
      const unusableAccuracy =
        (visibility === "conversation" && outcome.accuracy === null) ||
        (outcome.accuracy !== null &&
          (!Number.isFinite(outcome.accuracy) ||
            outcome.accuracy <= 0 ||
            outcome.accuracy > 100_000));
      if (unusableAccuracy) {
        setGeoError(locationFailureMessage("unavailable"));
        setGeoErrorKind("unavailable");
        return;
      }
      const fix: MapCenter = { lat: outcome.lat, lng: outcome.lng };
      if (isLowAccuracy(outcome.accuracy)) {
        setPendingFix(fix);
        setPendingAccuracy(outcome.accuracy);
        return;
      }
      snapPreviewTo(fix, outcome.accuracy);
    });
  }

  function acceptPendingFix(): void {
    if (!pendingFix) return;
    snapPreviewTo(pendingFix, pendingAccuracy);
  }

  /**
   * User-controlled enable-location flow: presents Android's own dialog and
   * retries the fix only when the switch is actually on. Dismissal keeps the
   * map/search/manual path — nothing is force-enabled.
   */
  async function enableServicesAndRetry(): Promise<void> {
    if (enablingServices) return;
    setEnablingServices(true);
    try {
      const enabled = await requestEnableDeviceLocation();
      if (enabled) useCurrentLocation();
    } finally {
      setEnablingServices(false);
    }
  }

  async function handleSearchSubmit(event?: FormEvent): Promise<void> {
    // No nested <form> exists anymore (see below), but stop propagation
    // defensively: this sheet renders inside the Report <form>, and a submit
    // event reaching it would publish the report.
    event?.preventDefault();
    event?.stopPropagation();
    const now = Date.now();
    if (now - lastSubmitRef.current < SUBMIT_DEBOUNCE_MS) return;
    lastSubmitRef.current = now;
    const query = searchInput.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      // Nominatim explicit-submit ONLY (no keystroke autocomplete, per the
      // search-usage policy).
      const { places } = await searchPlacesUnified(query, {
        nominatimOverride,
        throttler: searchThrottlerRef.current ?? undefined,
        now,
      });
      setResults(places);
      // Seam: result-class + source only — never the query or coordinates.
      recordOperation({
        name: "map.search",
        fields: {
          resultClass: places.length === 0 ? "zero" : places.length <= 3 ? "few" : "many",
          rateLimited: false,
          source: "unified",
        },
      });
      if (places.length === 0) {
        setSearchError("No places found — pan the map and confirm the pin instead.");
      }
    } catch (err) {
      if (err instanceof NominatimRateLimitError) {
        // Seam: rate-limit flag only — never the query or coordinates.
        recordOperation({
          name: "map.search",
          fields: { resultClass: "zero", rateLimited: true, source: "unified" },
        });
        setSearchError("Please wait a moment and try the search again.");
      } else {
        // Seam: failure class only — never the query, coordinates, or message.
        recordOperation({
          name: "map.search",
          fields: { resultClass: "zero", rateLimited: false, source: "unified" },
        });
        setSearchError(
          err instanceof Error
            ? err.message
            : "Place search failed — pan the map and confirm the pin instead.",
        );
      }
    } finally {
      setSearching(false);
    }
  }

  function pickResult(place: PlaceResult): void {
    fixGeneration.current += 1;
    setLocating(false);
    setFixAccuracy(null);
    const center: MapCenter = { lat: place.latitude, lng: place.longitude };
    setDraft(center);
    setDraftLabel(place.displayName);
    recenterCamera(center);
  }

  function handleConfirm(): void {
    if (!draft) return;
    const label = draftLabel.trim() || "Pinned location";
    const committed = commitCenterAsLocation(label, draft, exact ? "EXACT" : "APPROXIMATE");
    // Only a conversation pin carries the fix estimate, and only while the
    // confirmed pin is still the one the fix produced.
    onConfirm(
      fixAccuracy != null && visibility === "conversation"
        ? { ...committed, accuracy: fixAccuracy }
        : committed,
    );
    announce(
      exact ? "Exact pin selected." : "Approximate location selected (~100 m).",
    );
    onClose();
  }

  // The native Activity owns the whole interaction — render nothing.
  if (nativeActive) return null;

  const pending = draft
    ? commitCenterAsLocation(
        draftLabel.trim() || "Pinned location",
        draft,
        exact ? "EXACT" : "APPROXIMATE",
      )
    : null;
  const readout = pending ? formatCoordinateReadout(pending) : null;
  // One short, prospective sentence: the consequence is announced once, and
  // the explicit Use approximate action below is the remedy.
  const exactWarning = visibility === "conversation"
    ? "Exact pin will be shared in this chat"
    : "Exact pin will be public";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Choose location"
      description="Use search or the move buttons to place the pin, or use your location. Nothing is saved until you confirm."
      height="large"
    >
      <div className="flex flex-col gap-3">
        {nativeUnavailable ? (
          <p role="alert" className="text-sm text-on-surface">
            Map view isn&apos;t available right now. You can still choose the location below.
          </p>
        ) : null}
        <div className="relative h-64 w-full overflow-hidden rounded-m3-md border border-outline-variant bg-surface-container">
          {googleWebPicker ? (
            mapFailure ? (
              <p
                role="alert"
                className="flex h-full items-center justify-center px-4 text-center text-sm text-on-surface-variant"
              >
                {mapProviderFallbackNotice(mapFailure)}
              </p>
            ) : (
              <>
                <GoogleMapCanvas
                  latitude={fallbackCenter.lat}
                  longitude={fallbackCenter.lng}
                  zoom={fallbackZoom}
                  className="absolute inset-0"
                  label="Map. Drag, or use the move and zoom buttons, to position the pin."
                  picking
                  onCenterChange={handleMapCenterChange}
                  onZoomChange={(zoom) => setFallbackZoom(clampRasterZoom(zoom))}
                  onFailure={(reason) => setMapFailure(reason)}
                />
                {/* Google draws its logo bottom-left and its attribution
                  bottom-right, so the shared controls sit at the top and never
                  cover either. */}
                <PickerControls
                  className="absolute inset-x-2 top-2 z-10 items-start"
                  onZoomIn={() => setFallbackZoom((zoom) => clampRasterZoom(zoom + 1))}
                  onZoomOut={() => setFallbackZoom((zoom) => clampRasterZoom(zoom - 1))}
                  onNudge={nudgeFallback}
                />
              </>
            )
          ) : (
            <PickerRasterMap
              center={fallbackCenter}
              zoom={fallbackZoom}
              onZoomIn={() => setFallbackZoom((zoom) => clampRasterZoom(zoom + 1))}
              onZoomOut={() => setFallbackZoom((zoom) => clampRasterZoom(zoom - 1))}
              onNudge={nudgeFallback}
            />
          )}
        </div>
        {/* The API draws its own attribution on the Google path; the OSM
          notice must not be stacked over it. */}
        {googleWebPicker ? null : (
          <p className="text-xs text-on-surface-variant">{RASTER_ATTRIBUTION}</p>
        )}

        {/* Deliberately NOT a <form>: this sheet renders inside the Report
          <form> (BottomSheet mounts in the component tree, not a portal), and
          an inner submit would propagate to it and could publish the report.
          Enter searches via the input key handler instead. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-[10rem] flex-1">
            <span className="sr-only">Search for a place</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSearchSubmit(event);
              }}
              placeholder="Search for a place"
              aria-label="Search for a place"
              maxLength={120}
              className="w-full rounded-m3-sm border border-outline-variant bg-surface px-3.5 py-3 text-base placeholder:text-on-surface-variant focus:border-on-surface focus:outline-none"
            />
          </label>
          <Button type="button" variant="outline" size="md" loading={searching} onClick={() => void handleSearchSubmit()}>
            Search
          </Button>
        </div>
        {results.length > 0 ? (
          <p className="text-xs text-on-surface-variant">
            Place results: {attributionForSource()}
          </p>
        ) : null}
        {searchError ? (
          <p role="alert" className="text-xs text-error">
            {searchError}
          </p>
        ) : null}
        {results.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {results.map((place) => (
              <li key={`${place.latitude},${place.longitude}`}>
                <button
                  type="button"
                  onClick={() => pickResult(place)}
                  className="w-full rounded-m3-sm px-3 py-3 text-left text-sm text-on-surface hover:bg-surface-container"
                >
                  <span className="block break-words">{place.displayName}</span>
                  <span className="block text-xs text-on-surface-variant">
                    {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            loading={locating}
            onClick={useCurrentLocation}
          >
            <Crosshair size={16} aria-hidden />
            Use my location once
          </Button>
          {readout ? (
            <span className="flex items-center gap-1 text-xs text-on-surface-variant">
              <MapPin size={13} aria-hidden />
              {readout}
            </span>
          ) : (
            <span className="text-xs text-on-surface-variant">
              {viewSource === "neutral-world"
                ? "No location yet — search or move the pin to place it."
                : "Use search or the move buttons to adjust the pin."}
            </span>
          )}
        </div>
        {pendingFix ? (
          <div
            data-testid="low-accuracy-notice"
            className="flex flex-wrap items-center gap-2 rounded-m3-sm border border-outline-variant bg-surface-container px-3 py-2"
          >
            <p className="text-xs text-on-surface-variant">
              This location is only accurate to about{" "}
              {pendingAccuracy != null ? formatAccuracy(pendingAccuracy) : "a few km"}.
              Nothing was saved — confirm if you still want to use it.
            </p>
            <Button type="button" variant="outline" size="md" onClick={acceptPendingFix}>
              Use this location anyway
            </Button>
          </div>
        ) : null}
        {geoError ? <p role="alert" className="text-xs text-error">{geoError}</p> : null}
        {geoErrorKind === "services-off" && isNativeLocationServicesAvailable() ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="md"
              loading={enablingServices}
              onClick={() => void enableServicesAndRetry()}
            >
              Turn on location
            </Button>
          </div>
        ) : null}
        {gpsPreview ? (
          <p className="text-xs text-on-surface-variant">
            Preview centered on your location — confirm to use it. Your location
            is never saved on its own.
          </p>
        ) : null}

        {draft && exact ? (
          <div className="flex flex-wrap items-center gap-2 rounded-m3-sm border border-error px-3 py-2">
            <p className="flex min-w-[8rem] flex-1 items-start gap-1.5 text-xs font-medium text-error">
              <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
              <span>{exactWarning}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setExact(false)}
            >
              Use approximate
            </Button>
          </div>
        ) : null}
        {draft && !exact ? (
          <div className="flex flex-wrap items-center gap-2 rounded-m3-sm bg-surface-container px-3 py-2">
            <p className="text-xs text-on-surface-variant">
              Pin rounded to ~100 m precision.
            </p>
            <Button type="button" variant="text" size="md" onClick={() => setExact(true)}>
              Use exact pin
            </Button>
          </div>
        ) : null}

        <div className="flex items-stretch gap-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!draft}
            onClick={handleConfirm}
          >
            Confirm location
          </Button>
          {draft ? (
            <button
              type="button"
              aria-label="Open in Maps"
              onClick={() => openInMaps(draft.lat, draft.lng, draftLabel.trim() || "Pinned location")}
              className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-m3-md border border-outline text-on-surface focus:outline-none"
            >
              <ExternalLink size={18} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </BottomSheet>
  );
}
