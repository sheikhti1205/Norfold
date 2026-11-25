// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

const platform = vi.hoisted(() => ({ native: false }));
const rasterTiles = vi.hoisted(() => ({ forCenter: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native },
  registerPlugin: () => ({}),
}));

vi.mock("../services/location/rasterTiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/location/rasterTiles")>();
  rasterTiles.forCenter.mockImplementation(actual.rasterTilesForCenter);
  return { ...actual, rasterTilesForCenter: rasterTiles.forCenter };
});

vi.mock("../services/location/googleMapsLoader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/location/googleMapsLoader")>()),
  loadGoogleMaps: vi.fn(),
}));

import { MapEmbed } from "./MapEmbed";
import {
  GoogleMapsLoadError,
  loadGoogleMaps,
  type GoogleMapsApi,
} from "../services/location/googleMapsLoader";

const loadGoogleMapsMock = vi.mocked(loadGoogleMaps);
const KEY = "test-browser-key";

const API: GoogleMapsApi = {
  maps: {
    Map: class {
      constructor(_element: HTMLElement, _options: Record<string, unknown>) {}
    },
    Marker: class {
      constructor(_options: Record<string, unknown>) {}
      setMap(): void {}
    },
  },
};

beforeEach(() => {
  platform.native = false;
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
  rasterTiles.forCenter.mockClear();
  loadGoogleMapsMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  platform.native = false;
});

describe("MapEmbed", () => {
  it("renders coordinates as one continuous tile mosaic", () => {
    render(<MapEmbed lat={23.81} lng={90.412} label="Dhaka" />);
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    const images = Array.from(mosaic.querySelectorAll("img"));
    expect(images).toHaveLength(9);
    // One grid for all nine tiles: rows are never laid out or cropped apart.
    for (const image of images) expect(image.parentElement).toBe(mosaic);
    expect(screen.getByText("Dhaka")).toBeDefined();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeDefined();
    expect(rasterTiles.forCenter).toHaveBeenCalledTimes(1);
  });

  it("keeps the neutral placeholder without coordinates", () => {
    render(<MapEmbed label="Dhaka" />);
    expect(screen.queryByTestId("raster-tile-mosaic")).toBeNull();
    expect(screen.getByText(/No location yet/)).toBeDefined();
  });

  it("keeps the OSM raster inside the native shell even when a key is configured", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    platform.native = true;
    render(<MapEmbed lat={23.81} lng={90.412} label="Dhaka" />);
    expect(screen.getByTestId("raster-tile-mosaic")).toBeDefined();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Dhaka" })).toBeNull();
    expect(rasterTiles.forCenter).toHaveBeenCalledTimes(1);
    expect(loadGoogleMapsMock).not.toHaveBeenCalled();
  });

  it("renders the Google preview without OSM tiles or attribution", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    loadGoogleMapsMock.mockResolvedValue(API);
    render(<MapEmbed lat={23.81} lng={90.412} label="Dhaka" />);
    expect(screen.getByTestId("map-embed-frame")).toBeDefined();
    const canvas = screen.getByRole("region", { name: "Dhaka" });
    // The reserved h-48 host is filled by the canvas, not collapsed to zero.
    expect(canvas.className).toContain("h-full");
    expect(screen.queryByTestId("raster-tile-mosaic")).toBeNull();
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
    // The OSM tile request is the cost this branch must never pay.
    expect(rasterTiles.forCenter).not.toHaveBeenCalled();
    expect(loadGoogleMapsMock).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback notice in the frame when the Google preview fails", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    loadGoogleMapsMock.mockRejectedValue(new GoogleMapsLoadError("auth-failure"));
    render(<MapEmbed lat={23.81} lng={90.412} label="Dhaka" />);
    const frame = screen.getByTestId("map-embed-frame");
    await waitFor(() =>
      expect(within(frame).getByText(/the map key was rejected/)).toBeDefined(),
    );
    expect(screen.queryByRole("region", { name: "Dhaka" })).toBeNull();
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
    expect(rasterTiles.forCenter).not.toHaveBeenCalled();
  });

  it("keeps the neutral placeholder when the Google provider has no coordinates", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", KEY);
    render(<MapEmbed label="Dhaka" />);
    expect(screen.queryByTestId("raster-tile-mosaic")).toBeNull();
    expect(screen.getByText(/No location yet/)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Map preview" })).toBeNull();
    expect(loadGoogleMapsMock).not.toHaveBeenCalled();
    expect(rasterTiles.forCenter).not.toHaveBeenCalled();
  });
});
