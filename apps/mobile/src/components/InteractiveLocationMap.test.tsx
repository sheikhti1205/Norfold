// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InteractiveLocationMap } from "./InteractiveLocationMap";
import type { MapSnapshotInput, MapSnapshotResult, MapViewerInput } from "../native/mapLibreMaps";
import { resolveMapProvider } from "../services/location/mapProvider";
import {
  GoogleMapsLoadError,
  loadGoogleMaps,
  type GoogleMapsApi,
} from "../services/location/googleMapsLoader";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
    convertFileSrc: (uri: string) => `converted:${uri}`,
  },
}));

vi.mock("../services/location/rasterTiles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/location/rasterTiles")>();
  // A short stall budget keeps the timeout test fast; all tile math stays real.
  return { ...actual, MAP_LOAD_TIMEOUT_MS: 300 };
});

// The provider picks the branch; the failure copy under test stays real.
vi.mock("../services/location/mapProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/location/mapProvider")>(),
  resolveMapProvider: vi.fn(() => "osm"),
}));

// The Google canvas is exercised for real; only the SDK bootstrap is stubbed.
vi.mock("../services/location/googleMapsLoader", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/location/googleMapsLoader")>(),
  loadGoogleMaps: vi.fn(),
}));

const resolveMapProviderMock = vi.mocked(resolveMapProvider);
const loadGoogleMapsMock = vi.mocked(loadGoogleMaps);

class FakeGoogleMap {
  static instances: FakeGoogleMap[] = [];
  readonly element: HTMLElement;
  readonly options: Record<string, unknown>;

  constructor(element: HTMLElement, options: Record<string, unknown>) {
    this.element = element;
    this.options = options;
    FakeGoogleMap.instances.push(this);
  }

  setOptions(): void {}
}

class FakeGoogleMarker {
  static instances: FakeGoogleMarker[] = [];
  readonly options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeGoogleMarker.instances.push(this);
  }

  setMap(): void {}
}

const GOOGLE_API: GoogleMapsApi = { maps: { Map: FakeGoogleMap, Marker: FakeGoogleMarker } };

beforeEach(() => {
  resolveMapProviderMock.mockReturnValue("osm");
  loadGoogleMapsMock.mockReset();
  FakeGoogleMap.instances = [];
  FakeGoogleMarker.instances = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SNAPSHOT: MapSnapshotResult = {
  uri: "file:///cache/snap.png",
  width: 640,
  height: 360,
  cacheKey: "key-1",
};

function renderMap(overrides: Partial<React.ComponentProps<typeof InteractiveLocationMap>> = {}) {
  const viewer = vi.fn(async (_input: MapViewerInput) => ({ closed: true }));
  const utils = render(
    <InteractiveLocationMap lat={23.8} lng={90.4} label="Dhaka" snapshotter={null} viewer={viewer} {...overrides} />,
  );
  return { viewer, ...utils };
}

describe("InteractiveLocationMap", () => {
  it("renders the keyless raster fallback when the bridge is missing", () => {
    const snapshotter = vi.fn();
    renderMap({ snapshotter: null });
    expect(screen.getByTestId("interactive-fallback-map")).toBeDefined();
    expect(snapshotter).not.toHaveBeenCalled();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeDefined();
  });

  it("renders a read-only Google preview and no OSM credit when the provider is Google", async () => {
    resolveMapProviderMock.mockReturnValue("google");
    loadGoogleMapsMock.mockResolvedValue(GOOGLE_API);
    renderMap();

    await waitFor(() => expect(FakeGoogleMap.instances).toHaveLength(1));
    expect(FakeGoogleMap.instances[0]?.options).toMatchObject({
      center: { lat: 23.8, lng: 90.4 },
      zoom: 15,
      gestureHandling: "none",
    });
    expect(FakeGoogleMarker.instances[0]?.options.position).toEqual({ lat: 23.8, lng: 90.4 });
    expect(screen.getByRole("region", { name: "Map preview" })).toBeDefined();
    // The raster surface is not mounted at all: no OSM tiles, no OSM credit.
    expect(screen.queryByTestId("interactive-fallback-map")).toBeNull();
    expect(screen.queryByTestId("raster-tile-mosaic")).toBeNull();
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
  });

  it("keeps the OSM raster grid and its attribution when the provider is OSM", () => {
    resolveMapProviderMock.mockReturnValue("osm");
    renderMap();
    expect(screen.getByTestId("interactive-fallback-map")).toBeDefined();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeDefined();
    expect(loadGoogleMapsMock).not.toHaveBeenCalled();
  });

  it("shows the provider fallback notice in the map area when Google fails", async () => {
    resolveMapProviderMock.mockReturnValue("google");
    loadGoogleMapsMock.mockRejectedValue(new GoogleMapsLoadError("auth-failure"));
    renderMap();

    const notice = await screen.findByTestId("interactive-google-notice");
    expect(notice.textContent).toContain("the map key was rejected");
    // Same reserved map area, so the card keeps its height on failure.
    expect(notice.className).toContain("inset-0");
    expect(notice.parentElement?.className).toContain("h-48");
    expect(screen.queryByRole("region", { name: "Map preview" })).toBeNull();
    expect(screen.queryByTestId("interactive-fallback-map")).toBeNull();
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
  });

  it("draws the fallback as one continuous tile mosaic", () => {
    renderMap({ snapshotter: null });
    const region = screen.getByTestId("interactive-fallback-map");
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    expect(region.contains(mosaic)).toBe(true);
    const images = Array.from(mosaic.querySelectorAll("img"));
    expect(images).toHaveLength(9);
    // All nine tiles share one grid: a per-row layer would crop rows
    // independently and tear the map into disconnected bands.
    for (const image of images) expect(image.parentElement).toBe(mosaic);
  });

  it("requests a snapshot on-device and renders the preview", async () => {
    const snapshotter = vi.fn(async (_input: MapSnapshotInput) => SNAPSHOT);
    const viewer = vi.fn(async (_input: MapViewerInput) => ({ closed: true }));
    render(
      <InteractiveLocationMap lat={23.8} lng={90.4} label="Dhaka" snapshotter={snapshotter} viewer={viewer} />,
    );
    expect(screen.getByText("Loading map preview…")).toBeDefined();
    // Nothing on screen is OSM output yet, so OSM gets no credit.
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
    await waitFor(() => expect(snapshotter).toHaveBeenCalledTimes(1));
    expect(snapshotter).toHaveBeenCalledWith({
      latitude: 23.8,
      longitude: 90.4,
      zoom: 15,
      width: 640,
      height: 360,
    });
    const preview = await screen.findByTestId("interactive-snapshot");
    expect(preview).toBeDefined();
    const img = preview.querySelector("img");
    expect(img?.getAttribute("src")).toBe("converted:file:///cache/snap.png");
    // The bitmap's own renderer supplies the credit, not an OSM line.
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
  });

  it("taps the preview to open the native viewer", async () => {
    const snapshotter = vi.fn(async (_input: MapSnapshotInput) => SNAPSHOT);
    const viewer = vi.fn(async (_input: MapViewerInput) => ({ closed: true }));
    render(
      <InteractiveLocationMap lat={23.8} lng={90.4} label="Dhaka" snapshotter={snapshotter} viewer={viewer} />,
    );
    fireEvent.click(await screen.findByTestId("interactive-snapshot"));
    await waitFor(() => expect(viewer).toHaveBeenCalledTimes(1));
    expect(viewer).toHaveBeenCalledWith({ latitude: 23.8, longitude: 90.4, zoom: 15, label: "Dhaka" });
  });

  it("falls back truthfully when the snapshot fails, keeping Open map", async () => {
    const snapshotter = vi.fn(async (_input: MapSnapshotInput): Promise<MapSnapshotResult> => {
      throw new Error("MAP_SNAPSHOT_FAILED");
    });
    const viewer = vi.fn(async (_input: MapViewerInput) => ({ closed: true }));
    render(
      <InteractiveLocationMap lat={23.8} lng={90.4} label="Dhaka" snapshotter={snapshotter} viewer={viewer} />,
    );
    await screen.findByTestId("interactive-fallback-map");
    expect(screen.getByText(/preview failed/)).toBeDefined();
    // OSM raster is what is actually displayed again, so it is credited.
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open map" }));
    await waitFor(() => expect(viewer).toHaveBeenCalledTimes(1));
  });

  it("never fabricates a map without coordinates and never requests one", () => {
    const snapshotter = vi.fn();
    render(
      <InteractiveLocationMap lat={null} lng={null} label="Somewhere" snapshotter={snapshotter} viewer={vi.fn()} />,
    );
    expect(screen.getByText("Somewhere")).toBeDefined();
    expect(screen.queryByTestId("interactive-fallback-map")).toBeNull();
    expect(screen.queryByTestId("interactive-snapshot")).toBeNull();
    expect(snapshotter).not.toHaveBeenCalled();
  });

  it("ignores a stale snapshot response after unmount", async () => {
    let resolveSnapshot!: (value: MapSnapshotResult) => void;
    const snapshotter = vi.fn(
      (_input: MapSnapshotInput) =>
        new Promise<MapSnapshotResult>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const { unmount } = render(
      <InteractiveLocationMap lat={23.8} lng={90.4} snapshotter={snapshotter} viewer={vi.fn()} />,
    );
    await waitFor(() => expect(snapshotter).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveSnapshot(SNAPSHOT);
      await Promise.resolve();
    });
    // No crash, no post-unmount state write — the test passing IS the assert.
  });

  it("zooms the fallback grid without a snapshot", () => {
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByTestId("interactive-fallback-map")).toBeDefined();
  });
});
