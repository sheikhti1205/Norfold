import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { motionDurations, motionEasings } from "./uiMotion";
import { rasterTilesForCenter, RASTER_ATTRIBUTION } from "../services/location/rasterTiles";
import { PIN_ZOOM } from "../services/location/mapPickerState";
import { RasterTileMosaic } from "./RasterTileMosaic";
import { GoogleMapCanvas } from "./GoogleMapCanvas";
import { mapProviderFallbackNotice, resolveMapProvider } from "../services/location/mapProvider";
import type { GoogleMapsAuthFailureReason } from "../services/location/googleMapsLoader";

interface MapEmbedProps {
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
}

/** Empty-state <-> map crossfade; both panes are absolutely stacked (no reflow). */
const embedTransition = {
  type: "tween",
  duration: motionDurations.standard,
  ease: motionEasings.out,
} as const;

function toCoords(lat?: number | null, lng?: number | null): { lat: number; lng: number } | null {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

/**
 * Location preview for a one-time approximate location.
 *
 * Web builds with a Google key render the Google preview; every other case
 * (no key, or the native shell where the webview sends no referrer for the
 * restricted key) keeps the keyless OSM raster grid with a center pin. The
 * grid crossfades in over the reserved 12rem area when coordinates appear —
 * the element is in the DOM from that commit, only its opacity animates. The
 * OSM tiles are never built for the Google path, so no OSM request is made
 * there, and a Google failure swaps to consumer-safe copy in the same area.
 * No geocoding is attempted, no coordinates fabricated.
 */
export function MapEmbed({ lat, lng, label }: MapEmbedProps) {
  const coords = toCoords(lat, lng);
  const provider = resolveMapProvider();
  const googleCoords = provider === "google" ? coords : null;
  const tiles = provider === "osm" && coords ? rasterTilesForCenter(coords, PIN_ZOOM) : [];
  const coordsKey = coords ? `${coords.lat},${coords.lng}` : "";
  const [failure, setFailure] = useState<{
    coordsKey: string;
    reason: GoogleMapsAuthFailureReason;
  } | null>(null);
  useEffect(() => {
    // A failure belongs to the coordinates it was reported for.
    setFailure(null);
  }, [coordsKey]);
  const failureReason = failure && failure.coordsKey === coordsKey ? failure.reason : null;

  return (
    <div className="overflow-hidden rounded-m3-md border border-outline-variant">
      <div className="relative h-48 w-full">
        <AnimatePresence initial={false}>
          {coords ? (
            <motion.div
              key="map"
              className="absolute inset-0 bg-surface-container"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={embedTransition}
              data-testid="map-embed-frame"
              role="region"
              aria-label="Location preview"
            >
              {googleCoords ? (
                failureReason ? (
                  <div className="flex h-full items-center justify-center px-6 text-center">
                    <p className="text-sm text-on-surface-variant">
                      {mapProviderFallbackNotice(failureReason)}
                    </p>
                  </div>
                ) : (
                  <GoogleMapCanvas
                    latitude={googleCoords.lat}
                    longitude={googleCoords.lng}
                    label={label ?? undefined}
                    className="h-full w-full"
                    onFailure={(reason) => setFailure({ coordsKey, reason })}
                  />
                )
              ) : (
                <>
                  <RasterTileMosaic tiles={tiles} />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  >
                    <MapPin size={24} className="text-on-surface drop-shadow" aria-hidden />
                  </div>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-container px-6 text-center"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={embedTransition}
            >
              <MapPin size={20} className="text-on-surface-variant" aria-hidden />
              <p className="text-sm text-on-surface-variant">
                No location yet — type a place or paste a Maps link to preview it here.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {label && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-on-surface-variant">
          <MapPin size={13} aria-hidden />
          <span className="truncate">{label}</span>
        </div>
      )}
      {coords && provider === "osm" && (
        <p className="px-3 pb-2 text-xs text-on-surface-variant">{RASTER_ATTRIBUTION}</p>
      )}
    </div>
  );
}
