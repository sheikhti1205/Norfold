import { useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { MapPickerSheet } from "./MapPickerSheet";
import {
  parseLocationInput,
  resolveShortLink,
  roundToApproximate,
} from "../utils/location";
import {
  createProductionLocationAdapter,
  type LocationAdapter,
} from "../services/locationAdapter";

export interface LocationValue {
  label: string;
  latitude: number | null;
  longitude: number | null;
  /** Whether the stored coordinates are rounded to ~100 m or exact. */
  precision?: "APPROXIMATE" | "EXACT";
  /**
   * Unrounded coordinates kept alongside the published ones so the user can
   * toggle approximate ↔ exact without losing the precise fix. Local draft only.
   */
  preciseLatitude?: number | null;
  preciseLongitude?: number | null;
  /** Real device estimate, if this selection came from a fix; never fabricated. */
  accuracy?: number | null;
}

interface LocationPickerProps {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  maxLength?: number;
  locationAdapter?: LocationAdapter;
  disabled?: boolean;
  visibility?: "public" | "conversation";
}

/**
 * One-time approximate location: a free-text place label, decimal
 * coordinates, or a Google Maps link, plus one row that opens the map picker
 * sheet for search, GPS preview and map selection. No tracking.
 */
export function LocationPicker({ value, onChange, maxLength, locationAdapter, disabled = false, visibility = "public" }: LocationPickerProps) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [defaultAdapter] = useState(createProductionLocationAdapter);
  const adapter = locationAdapter ?? defaultAdapter;
  const [parseError, setParseError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sourceText, setSourceText] = useState(value.label);
  // Guards a short-link A resolving after the user replaced it with link B.
  const resolveSeq = useRef(0);
  // The last value this picker emitted, so an external reset (discard draft)
  // can be told apart from the echo of our own onChange.
  const emittedRef = useRef(value);

  useEffect(() => {
    if (!disabled) return;
    resolveSeq.current += 1;
    setResolving(false);
    setMapOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (value === emittedRef.current) return;
    emittedRef.current = value;
    setSourceText(value.label);
    setParseError(null);
  }, [value]);

  useEffect(() => () => { resolveSeq.current += 1; }, []);

  function emit(next: LocationValue) {
    if (disabledRef.current) return;
    emittedRef.current = next;
    onChange(next);
  }

  function setCoords(
    label: string,
    lat: number | null,
    lng: number | null,
    precision: "APPROXIMATE" | "EXACT",
    accuracy?: number | null,
  ) {
    if (disabledRef.current) return;
    if (lat == null || lng == null) {
      emit({ label, latitude: lat, longitude: lng, precision: "APPROXIMATE", preciseLatitude: null, preciseLongitude: null });
      return;
    }
    if (precision === "EXACT") {
      emit({ label, latitude: lat, longitude: lng, precision: "EXACT", preciseLatitude: lat, preciseLongitude: lng,
        ...(visibility === "conversation" && accuracy !== undefined ? { accuracy } : {}) });
      return;
    }
    const rounded = roundToApproximate(lat, lng);
    emit({ label, latitude: rounded.lat, longitude: rounded.lng, precision: "APPROXIMATE", preciseLatitude: lat, preciseLongitude: lng,
      ...(visibility === "conversation" && accuracy !== undefined ? { accuracy } : {}) });
  }

  function handleInput(raw: string) {
    if (disabledRef.current) return;
    resolveSeq.current += 1;
    setResolving(false);
    setSourceText(raw);
    const parsed = parseLocationInput(raw);
    setParseError(parsed.error);
    if (parsed.needsResolve) {
      const seq = ++resolveSeq.current;
      setResolving(true);
      void resolveShortLink(raw)
        .then((finalUrl) => {
          if (seq !== resolveSeq.current || disabledRef.current) return;
          const resolved = parseLocationInput(finalUrl);
          setCoords(resolved.label, resolved.latitude, resolved.longitude, "APPROXIMATE");
          setParseError(resolved.error);
        })
        .catch((err: unknown) => {
          if (seq !== resolveSeq.current || disabledRef.current) return;
          setParseError(err instanceof Error ? err.message : "Could not resolve the map link.");
        })
        .finally(() => {
          if (seq === resolveSeq.current) setResolving(false);
        });
      return;
    }
    if (parsed.latitude != null && parsed.longitude != null) {
      setCoords(parsed.label, parsed.latitude, parsed.longitude, "APPROXIMATE");
      return;
    }
    emit({
      label: parsed.label,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      precision: "APPROXIMATE",
      preciseLatitude: null,
      preciseLongitude: null,
    });
  }

  function handleMapConfirm(next: LocationValue) {
    if (disabledRef.current) return;
    // The sheet already commits through the same approximate-by-default path;
    // re-enter via setCoords so approximate state stays in sync, and show the
    // confirmed label in the text field.
    setSourceText(next.label);
    setParseError(null);
    setCoords(
      next.label,
      next.preciseLatitude ?? next.latitude,
      next.preciseLongitude ?? next.longitude,
      next.precision ?? "APPROXIMATE",
      next.accuracy,
    );
  }

  function clearLocation() {
    if (disabledRef.current) return;
    resolveSeq.current += 1;
    setResolving(false);
    setSourceText("");
    setParseError(null);
    emit({
      label: "",
      latitude: null,
      longitude: null,
      precision: "APPROXIMATE",
      preciseLatitude: null,
      preciseLongitude: null,
    });
  }

  const hasCoords = value.latitude != null && value.longitude != null;
  const approx = value.precision !== "EXACT";
  const readout = hasCoords
    ? approx
      // The readout must not imply more precision than the mode holds:
      // approximate pins show the 3 decimals they were rounded to.
      ? `${value.latitude!.toFixed(3)}, ${value.longitude!.toFixed(3)}`
      : `${value.latitude}, ${value.longitude}`
    : null;
  const locationTitle = hasCoords ? value.label || "Pinned location" : "Choose on map";
  const locationDetail = hasCoords ? readout : "Set a location for this report";

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-on-surface">
          Approximate location
        </span>
        <input
          disabled={disabled}
          value={sourceText}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Place, decimal coords, or a Google Maps link"
          aria-busy={resolving || undefined}
          className="w-full rounded-m3-sm border border-outline-variant bg-surface px-3.5 py-3 text-base placeholder:text-on-surface-variant focus:border-on-surface focus:outline-none"
          maxLength={maxLength}
        />
        {value.label && value.label !== sourceText && (
          <p className="mt-1 text-xs text-on-surface-variant">Parsed: {value.label}</p>
        )}
      </label>

      <div className="flex w-full items-stretch gap-2">
        <button
          type="button"
          data-testid="location-row"
          onClick={() => setMapOpen(true)}
          disabled={disabled}
          aria-label={hasCoords
            ? `Choose on map. ${locationTitle}. ${readout}`
            : "Choose on map. Set a location for this report"}
          className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-m3-sm border border-outline-variant bg-surface px-3.5 py-1.5 text-left focus:border-on-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MapPin size={18} aria-hidden className="shrink-0 text-on-surface-variant" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-on-surface">{locationTitle}</span>
            <span className="block truncate text-xs text-on-surface-variant">{locationDetail}</span>
          </span>
        </button>
        {hasCoords && (
          <button
            type="button"
            aria-label="Clear location"
            onClick={clearLocation}
            disabled={disabled}
            className="inline-flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded-m3-sm border border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={18} aria-hidden />
          </button>
        )}
      </div>

      {hasCoords && !approx && (
        <p className="text-xs text-error">
          {visibility === "conversation" ? "Warning: this is an exact pin and will be shared in this chat. Prefer the approximate area."
            : "Warning: this is an exact pin and will be shown publicly. Prefer the approximate area."}
        </p>
      )}

      {resolving && (
        <p className="text-xs text-on-surface-variant">Resolving map link…</p>
      )}
      {parseError && (
        <p role="alert" className="text-xs text-error">{parseError}</p>
      )}
      <p className="text-xs text-on-surface-variant">
        Paste decimal coordinates or a Maps link, or choose the spot on the map.
      </p>

      <MapPickerSheet
        open={mapOpen && !disabled}
        onClose={() => setMapOpen(false)}
        value={value}
        onConfirm={handleMapConfirm}
        locationAdapter={adapter}
        visibility={visibility}
      />
    </div>
  );
}
