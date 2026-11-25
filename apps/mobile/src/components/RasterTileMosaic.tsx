import { useLayoutEffect, useRef, useState } from "react";
import type { RasterTile } from "../services/location/rasterTiles";

/**
 * Side used until the frame reports a size: a container that is not laid out
 * yet (closed sheet) or an engine with no layout pass. It only has to be big
 * enough to cover a preview, because an oversized square is clipped and the
 * frame is measured again before the first visible paint.
 */
const UNMEASURED_FRAME_SIDE_PX = 768;

interface RasterTileMosaicProps {
  tiles: RasterTile[];
}

/**
 * One continuous 3x3 raster mosaic under a centre pin.
 *
 * The tile square is sized to the container's longest edge and centred on it,
 * so it always covers the box while every cell stays square. Square cells keep
 * all nine tiles at one uniform scale and leave `object-cover` nothing to crop:
 * adjacent rows join, and the middle tile stays under the centre pin. Laying
 * the tiles out on the container's own rectangle instead would scale each tile
 * to its cell's shorter axis and crop the remainder per row, tearing the map
 * into disconnected horizontal bands.
 *
 * The frame clips the square, so the mosaic never paints outside the map area.
 */
export function RasterTileMosaic({ tiles }: RasterTileMosaicProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState(UNMEASURED_FRAME_SIDE_PX);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = (width: number, height: number) => {
      const next = Math.ceil(Math.max(width, height));
      if (next <= 0) return;
      setSide((current) => (current === next ? current : next));
    };
    const measureFrame = () => measure(frame.clientWidth, frame.clientHeight);
    measureFrame();
    const Observer = typeof ResizeObserver === "function" ? ResizeObserver : null;
    const observer = Observer
      ? new Observer((entries) => {
          const entry = entries[0];
          // A reporter that carries no entry still means "size changed":
          // re-read the frame rather than trusting a stale square.
          if (!entry) {
            measureFrame();
            return;
          }
          measure(entry.contentRect.width, entry.contentRect.height);
        })
      : null;
    observer?.observe(frame);
    window.addEventListener("resize", measureFrame);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureFrame);
    };
  }, []);

  return (
    <div ref={frameRef} className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        data-testid="raster-tile-mosaic"
        className="absolute left-1/2 top-1/2 grid grid-cols-3 grid-rows-3 -translate-x-1/2 -translate-y-1/2"
        style={{ width: side, height: side }}
      >
        {tiles.map((tile, index) => (
          <img
            // Grid position disambiguates: at minimum zoom the 3x3 window
            // wraps/clamps into repeated z/x/y coordinates, so tile
            // coordinates alone are NOT unique React keys (duplicate keys
            // corrupt reconciliation). Repeated tile URLs are fine; repeated
            // identities are not.
            key={`${tile.z}/${tile.x}/${tile.y}#${index}`}
            src={tile.url}
            alt=""
            draggable={false}
            loading="lazy"
            className="h-full w-full object-cover"
            // A failed tile (offline/blocked) hides itself instead of showing
            // a broken-image glyph over the pin area.
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ))}
      </div>
    </div>
  );
}
