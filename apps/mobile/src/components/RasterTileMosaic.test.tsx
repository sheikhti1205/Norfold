// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RasterTileMosaic } from "./RasterTileMosaic";
import { rasterTilesForCenter } from "../services/location/rasterTiles";

/**
 * jsdom has no layout pass and no ResizeObserver. This fake reports container
 * sizes the way the real observer does, so the sizing contract is exercised
 * instead of assumed.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly callback: ResizeObserverCallback;
  private target: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.target = target;
  }

  unobserve(): void {}

  disconnect(): void {}

  report(width: number, height: number): void {
    this.callback(
      [
        {
          target: this.target,
          contentRect: { width, height },
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

const TILES = rasterTilesForCenter({ lat: 23.81, lng: 90.412 }, 15);

function renderMosaic() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const utils = render(<RasterTileMosaic tiles={TILES} />);
  const observer = FakeResizeObserver.instances[0];
  if (!observer) throw new Error("the mosaic did not observe its frame");
  return { observer, ...utils };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RasterTileMosaic", () => {
  it("squares the tile area to the container's longest edge", () => {
    const { observer } = renderMosaic();
    act(() => observer.report(370, 228));
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    // Square: equal sides are what leave object-cover nothing to crop, so
    // every row of tiles is drawn at the same scale and neighbouring rows join.
    expect(mosaic.style.width).toBe("370px");
    expect(mosaic.style.height).toBe("370px");
  });

  it("follows a taller container so the tile area still covers the map", () => {
    const { observer } = renderMosaic();
    act(() => observer.report(300, 500));
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    expect(mosaic.style.width).toBe("500px");
    expect(mosaic.style.height).toBe("500px");
    // Covering both edges is the requirement; the larger edge is the side.
    expect(Number.parseFloat(mosaic.style.width)).toBeGreaterThanOrEqual(500);
    expect(Number.parseFloat(mosaic.style.height)).toBeGreaterThanOrEqual(300);
  });

  it("never rounds below either container edge", () => {
    const { observer } = renderMosaic();
    act(() => observer.report(370.4, 228.2));
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    const side = Number.parseFloat(mosaic.style.width);
    expect(side).toBeGreaterThanOrEqual(370.4);
    expect(side).toBeGreaterThanOrEqual(228.2);
    expect(mosaic.style.width).toBe(mosaic.style.height);
  });

  it("keeps the nine tiles in one mosaic, in grid order", () => {
    renderMosaic();
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    const images = Array.from(mosaic.querySelectorAll("img"));
    expect(images).toHaveLength(9);
    // One parent for all nine: no per-row container that could be scaled or
    // cropped independently.
    for (const image of images) expect(image.parentElement).toBe(mosaic);
    expect(images.map((image) => image.getAttribute("src"))).toEqual(
      TILES.map((tile) => tile.url),
    );
  });

  it("centres the square on the frame and clips the overflow", () => {
    renderMosaic();
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    const frame = mosaic.parentElement;
    // jsdom computes no transforms, so the centring contract is asserted on
    // the classes that encode it: absolutely positioned, centred on both axes,
    // and clipped by the frame.
    expect(frame?.className).toContain("absolute");
    expect(frame?.className).toContain("overflow-hidden");
    expect(mosaic.className).toContain("absolute");
    expect(mosaic.className).toContain("left-1/2");
    expect(mosaic.className).toContain("top-1/2");
    expect(mosaic.className).toContain("-translate-x-1/2");
    expect(mosaic.className).toContain("-translate-y-1/2");
  });

  it("still renders a square mosaic where ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<RasterTileMosaic tiles={TILES} />);
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    expect(mosaic.style.width).toBe(mosaic.style.height);
    expect(Number.parseFloat(mosaic.style.width)).toBeGreaterThan(0);
    expect(mosaic.querySelectorAll("img")).toHaveLength(9);
  });
});
