// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapPickerSheet } from "./MapPickerSheet";
import type { LocationValue } from "./LocationPicker";
import type { LocationAdapter } from "../services/locationAdapter";
import type { MapPickerInput, MapPickerResult } from "../native/mapLibreMaps";
import type { PlaceResult } from "../services/location/nominatimSearch";

vi.mock("./LiveRegion", () => ({ announce: vi.fn() }));

// Provider + platform are module-level build/runtime facts; the tests move
// them per case without rebuilding the sheet.
const providerState = vi.hoisted(() => ({ provider: "osm" as "google" | "osm" }));
const platformState = vi.hoisted(() => ({ native: false }));
const canvasState = vi.hoisted(() => ({
  props: [] as { picking?: boolean; latitude?: number; longitude?: number; zoom?: number }[],
  center: null as ((center: { lat: number; lng: number }) => void) | null,
  zoomChange: null as ((zoom: number) => void) | null,
  failure: null as ((reason: string) => void) | null,
}));

vi.mock("../services/location/mapProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/location/mapProvider")>();
  return { ...actual, resolveMapProvider: () => providerState.provider };
});

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => platformState.native,
      getPlatform: () => (platformState.native ? "android" : "web"),
    },
  };
});

// The canvas has its own suite; here it is the seam the sheet wires a drag and
// a load failure through.
vi.mock("./GoogleMapCanvas", async () => {
  const { createElement } = await import("react");
  return {
    GoogleMapCanvas: (props: {
      latitude: number;
      longitude: number;
      label?: string;
      picking?: boolean;
      onCenterChange?: (center: { lat: number; lng: number }) => void;
      onZoomChange?: (zoom: number) => void;
      onFailure?: (reason: string) => void;
    }) => {
      canvasState.props.push(props);
      canvasState.center = props.onCenterChange ?? null;
      canvasState.zoomChange = props.onZoomChange ?? null;
      canvasState.failure = props.onFailure ?? null;
      return createElement("div", {
        "data-testid": "google-map-canvas",
        role: "region",
        "aria-label": props.label,
      });
    },
  };
});

// Test map behavior, not Motion's global RAF/exit scheduler. Keep real sheet
// semantics, refs and handlers, but mount/unmount motion DOM synchronously.
vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  const motionProps = new Set([
    "initial", "animate", "exit", "transition", "whileTap", "whileHover",
    "layout", "drag", "dragListener", "dragControls", "dragConstraints",
    "dragElastic", "dragSnapToOrigin", "onDragEnd",
  ]);
  const staticElement = (tag: string) => (props: Record<string, unknown>) =>
    createElement(tag, Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key))));
  return {
    motion: { div: staticElement("div"), button: staticElement("button"), span: staticElement("span") },
    AnimatePresence: ({ children }: { children: import("react").ReactNode }) => children,
    useDragControls: () => ({ start: vi.fn() }),
  };
});

const searchState = vi.hoisted(() => ({
  places: [] as PlaceResult[],
  error: null as unknown,
  calls: [] as string[],
}));

vi.mock("../services/location/placesSearch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/location/placesSearch")>();
  return {
    ...actual,
    searchPlacesUnified: async (query: string) => {
      searchState.calls.push(query);
      if (searchState.error) throw searchState.error;
      return { places: searchState.places, source: "nominatim" as const };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  searchState.places = [];
  searchState.error = null;
  searchState.calls = [];
  providerState.provider = "osm";
  platformState.native = false;
  canvasState.props = [];
  canvasState.center = null;
  canvasState.zoomChange = null;
  canvasState.failure = null;
});

const EMPTY_VALUE: LocationValue = {
  label: "",
  latitude: null,
  longitude: null,
  precision: "APPROXIMATE",
  preciseLatitude: null,
  preciseLongitude: null,
};

const PINNED_VALUE: LocationValue = {
  label: "Dhaka",
  latitude: 23.81,
  longitude: 90.412,
  precision: "APPROXIMATE",
  preciseLatitude: 23.8103,
  preciseLongitude: 90.4125,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof MapPickerSheet>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <MapPickerSheet
      open
      onClose={onClose}
      value={EMPTY_VALUE}
      onConfirm={onConfirm}
      nativePicker={null}
      {...overrides}
    />,
  );
  return { onConfirm, onClose, ...utils };
}

describe("MapPickerSheet (native picker path)", () => {
  it("commits the native confirm through the approximate-by-default path", async () => {
    const calls: MapPickerInput[] = [];
    const nativePicker = vi.fn(async (options: MapPickerInput): Promise<MapPickerResult> => {
      calls.push(options);
      return { cancelled: false, latitude: 22.35694, longitude: 91.78324, zoom: 15 };
    });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <MapPickerSheet
        open
        onClose={onClose}
        value={EMPTY_VALUE}
        onConfirm={onConfirm}
        nativePicker={nativePicker}
      />,
    );
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    const committed = onConfirm.mock.calls[0]?.[0] as LocationValue;
    // Approximate-by-default: rounded to ~100 m with the precise fix retained.
    expect(committed.latitude).toBe(22.357);
    expect(committed.longitude).toBe(91.783);
    expect(committed.precision).toBe("APPROXIMATE");
    expect(committed.preciseLatitude).toBe(22.35694);
    expect(committed.preciseLongitude).toBe(91.78324);
    expect(committed.label).toBe("Pinned location");
  });

  it("omits coordinates on a neutral start so no pin is fabricated", async () => {
    const calls: MapPickerInput[] = [];
    const nativePicker = vi.fn(async (options: MapPickerInput): Promise<MapPickerResult> => {
      calls.push(options);
      return { cancelled: true };
    });
    const onClose = vi.fn();
    render(
      <MapPickerSheet
        open
        onClose={onClose}
        value={EMPTY_VALUE}
        onConfirm={vi.fn()}
        nativePicker={nativePicker}
      />,
    );
    await waitFor(() => expect(nativePicker).toHaveBeenCalledTimes(1));
    // Neutral world view: display-only camera, null native draft — (0,0)
    // must never cross the bridge as if it were a pin.
    expect(calls[0]?.latitude).toBeUndefined();
    expect(calls[0]?.longitude).toBeUndefined();
    expect(calls[0]?.zoom).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("launches the native picker once even when the value changes mid-flight", async () => {
    const gate = deferred<MapPickerResult>();
    const nativePicker = vi.fn(() => gate.promise);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <MapPickerSheet open onClose={onClose} value={EMPTY_VALUE} onConfirm={onConfirm} nativePicker={nativePicker} />,
    );
    rerender(
      <MapPickerSheet open onClose={onClose} value={PINNED_VALUE} onConfirm={onConfirm} nativePicker={nativePicker} />,
    );
    expect(nativePicker).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ cancelled: false, latitude: 22.35, longitude: 91.78, zoom: 15 });
      await gate.promise;
    });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts the native camera at the existing report pin first", async () => {
    const calls: MapPickerInput[] = [];
    const nativePicker = vi.fn(async (options: MapPickerInput): Promise<MapPickerResult> => {
      calls.push(options);
      return { cancelled: true };
    });
    render(
      <MapPickerSheet
        open
        onClose={vi.fn()}
        value={PINNED_VALUE}
        onConfirm={vi.fn()}
        nativePicker={nativePicker}
      />,
    );
    await waitFor(() => expect(nativePicker).toHaveBeenCalledTimes(1));
    expect(calls[0]?.latitude).toBe(23.81);
    expect(calls[0]?.longitude).toBe(90.412);
  });

  it("starts the native camera at a prior search result when there is no pin", async () => {
    const calls: MapPickerInput[] = [];
    const nativePicker = vi.fn(async (options: MapPickerInput): Promise<MapPickerResult> => {
      calls.push(options);
      return { cancelled: true };
    });
    render(
      <MapPickerSheet
        open
        onClose={vi.fn()}
        value={EMPTY_VALUE}
        onConfirm={vi.fn()}
        nativePicker={nativePicker}
        initialSearchResult={{ lat: 22.3569, lng: 91.7832, label: "Chattogram" }}
      />,
    );
    await waitFor(() => expect(nativePicker).toHaveBeenCalledTimes(1));
    expect(calls[0]?.latitude).toBe(22.3569);
    expect(calls[0]?.longitude).toBe(91.7832);
    expect(calls[0]?.label).toBe("Chattogram");
  });

  it("cancel closes with no mutation", async () => {
    const nativePicker = vi.fn(async (): Promise<MapPickerResult> => ({ cancelled: true }));
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <MapPickerSheet open onClose={onClose} value={PINNED_VALUE} onConfirm={onConfirm} nativePicker={nativePicker} />,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a rejected bridge stays open with an in-place fallback and no mutation", async () => {
    const nativePicker = vi.fn(async (): Promise<MapPickerResult> => {
      throw new Error("MAP_UNAVAILABLE");
    });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <MapPickerSheet open onClose={onClose} value={PINNED_VALUE} onConfirm={onConfirm} nativePicker={nativePicker} />,
    );
    // The sheet stays open: no close, no commit, fallback notice shown.
    await screen.findByText("Map view isn't available right now. You can still choose the location below.");
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    // Draft/value survives: the pinned draft is confirmable in fallback.
    expect(screen.getByTestId("map-picker-map")).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", false);
  });

  it("fallback after rejection keeps raster map, search, location, and manual confirm usable", async () => {
    const nativePicker = vi.fn(async (): Promise<MapPickerResult> => {
      throw new Error("MAP_UNAVAILABLE");
    });
    const adapter: LocationAdapter = {
      getCurrentPosition: async () => ({ latitude: 22.3569, longitude: 91.7832, accuracyMeters: 25 }),
      getPermission: async () => "granted",
    };
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    searchState.places = [{ displayName: "Mirpur, Dhaka", latitude: 23.8103, longitude: 90.4125 }];
    render(
      <MapPickerSheet
        open
        onClose={onClose}
        value={EMPTY_VALUE}
        onConfirm={onConfirm}
        nativePicker={nativePicker}
        locationAdapter={adapter}
      />,
    );
    await screen.findByText("Map view isn't available right now. You can still choose the location below.");
    // Raster map present; neutral start has no draft until the user acts.
    expect(screen.getByTestId("map-picker-map")).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", true);
    // Search works in fallback.
    fireEvent.change(screen.getByLabelText("Search for a place"), { target: { value: "mirpur" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(searchState.calls).toEqual(["mirpur"]));
    fireEvent.click(await screen.findByText("Mirpur, Dhaka"));
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", false);
    // Current-location preview works in fallback.
    fireEvent.click(screen.getByRole("button", { name: "Use my location once" }));
    await screen.findByText(/Preview centered on your location/);
    // Manual confirm commits without closing early.
    fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale native response after unmount", async () => {
    const gate = deferred<MapPickerResult>();
    const nativePicker = vi.fn(() => gate.promise);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(
      <MapPickerSheet open onClose={onClose} value={EMPTY_VALUE} onConfirm={onConfirm} nativePicker={nativePicker} />,
    );
    unmount();
    await act(async () => {
      gate.resolve({ cancelled: false, latitude: 22.35, longitude: 91.78, zoom: 15 });
      await gate.promise.catch(() => undefined);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing while the native picker owns the interaction", () => {
    const gate = deferred<MapPickerResult>();
    const { container } = render(
      <MapPickerSheet
        open
        onClose={vi.fn()}
        value={EMPTY_VALUE}
        onConfirm={vi.fn()}
        nativePicker={() => gate.promise}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("MapPickerSheet (keyless fallback path)", () => {
  it("searches Nominatim on submit and confirms the picked result", async () => {
    searchState.places = [{ displayName: "Mirpur, Dhaka", latitude: 23.8103, longitude: 90.4125 }];
    const { onConfirm, onClose } = renderSheet();
    expect(screen.getByTestId("map-picker-map")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search for a place"), { target: { value: "mirpur" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(searchState.calls).toEqual(["mirpur"]));
    fireEvent.click(await screen.findByText("Mirpur, Dhaka"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const committed = onConfirm.mock.calls[0]?.[0] as LocationValue;
    expect(committed.label).toBe("Mirpur, Dhaka");
    expect(committed.latitude).toBe(23.81);
    expect(committed.longitude).toBe(90.413);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Confirm disabled with no draft and enables it after nudging", async () => {
    const { onConfirm } = renderSheet();
    expect(screen.getByText("No location yet — search or move the pin to place it.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Move pin north" }));
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("commits EXACT only through the explicit opt-in", async () => {
    const { onConfirm } = renderSheet({ value: PINNED_VALUE });
    fireEvent.click(screen.getByRole("button", { name: "Use exact pin" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));
    const committed = onConfirm.mock.calls[0]?.[0] as LocationValue;
    expect(committed.precision).toBe("EXACT");
    expect(committed.latitude).toBe(23.81);
  });

  it("previews a one-shot GPS fix without committing it", async () => {
    const adapter: LocationAdapter = {
      getCurrentPosition: async () => ({ latitude: 22.3569, longitude: 91.7832, accuracyMeters: 25 }),
      getPermission: async () => "granted",
    };
    const { onConfirm } = renderSheet({ locationAdapter: adapter });
    fireEvent.click(screen.getByRole("button", { name: "Use my location once" }));
    await screen.findByText(/Preview centered on your location/);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows Nominatim attribution only when results exist", async () => {
    renderSheet();
    expect(screen.queryByText(/Place results:/)).toBeNull();
    searchState.places = [{ displayName: "Dhaka", latitude: 23.8, longitude: 90.4 }];
    fireEvent.change(screen.getByLabelText("Search for a place"), { target: { value: "dhaka" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText(/Place results:.*OpenStreetMap/);
  });

  it("draws the picker map as one continuous tile mosaic under the pin", () => {
    renderSheet();
    const region = screen.getByTestId("map-picker-map");
    const mosaic = screen.getByTestId("raster-tile-mosaic");
    expect(region.contains(mosaic)).toBe(true);
    const images = Array.from(mosaic.querySelectorAll("img"));
    expect(images).toHaveLength(9);
    for (const image of images) expect(image.parentElement).toBe(mosaic);
    // Move and zoom controls stay outside the imagery layer, so they can
    // never be scaled or clipped with a tile row.
    expect(mosaic.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Move pin north" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDefined();
  });
});

describe("MapPickerSheet (Google web picker path)", () => {
  it("renders the interactive canvas and no OSM raster or attribution", () => {
    providerState.provider = "google";
    renderSheet();

    expect(screen.getByTestId("google-map-canvas")).toBeDefined();
    expect(screen.queryByTestId("map-picker-map")).toBeNull();
    expect(screen.queryByTestId("raster-tile-mosaic")).toBeNull();
    expect(screen.queryByText("© OpenStreetMap contributors")).toBeNull();
    // The sheet asks for picking, not a preview.
    expect(canvasState.props[canvasState.props.length - 1]?.picking).toBe(true);
  });

  it("offers the same move and zoom controls as the raster picker", () => {
    providerState.provider = "google";
    renderSheet();

    // A keyboard or screen-reader user needs the pad, not only the drag.
    expect(screen.getByTestId("google-map-canvas")).toBeDefined();
    expect(screen.getByRole("button", { name: "Move pin north" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDefined();
  });

  it("places a draft with the move buttons on the Google path", () => {
    providerState.provider = "google";
    renderSheet();
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Move pin north" }));

    // The nudge is the pin: the draft exists and the readout follows it.
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", false);
    expect(screen.getByText("85.036, 0.000")).toBeDefined();
  });

  it("steps the canvas zoom from the zoom buttons", () => {
    providerState.provider = "google";
    // A real pin starts the camera at PIN_ZOOM, the value the buttons step from.
    renderSheet({ value: PINNED_VALUE });
    expect(canvasState.props[canvasState.props.length - 1]?.zoom).toBe(15);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(canvasState.props[canvasState.props.length - 1]?.zoom).toBe(16);
  });

  it("steps from the zoom a pinch reported instead of the opening value", () => {
    providerState.provider = "google";
    renderSheet({ value: PINNED_VALUE });

    act(() => canvasState.zoomChange?.(17));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    // A pinch to 17 makes "+" reach 18, not restart from the opening 15.
    expect(canvasState.props[canvasState.props.length - 1]?.zoom).toBe(18);
  });

  it("adopts the dragged centre as the picked location", () => {
    providerState.provider = "google";
    const { onConfirm } = renderSheet();
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", true);

    act(() => canvasState.center?.({ lat: 22.3569, lng: 91.7832 }));

    // The drag is the pin: the draft exists and the readout follows it.
    expect(screen.getByRole("button", { name: "Confirm location" })).toHaveProperty("disabled", false);
    expect(screen.getByText("22.357, 91.783")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirm location" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const committed = onConfirm.mock.calls[0]?.[0] as LocationValue;
    expect(committed.latitude).toBe(22.357);
    expect(committed.longitude).toBe(91.783);
    expect(committed.precision).toBe("APPROXIMATE");
  });

  it("surfaces the provider fallback notice when Google fails to load", () => {
    providerState.provider = "google";
    renderSheet();
    act(() => canvasState.failure?.("auth-failure"));

    expect(
      screen.getByText(
        "Map preview unavailable — the map key was rejected. The location still saves normally.",
      ),
    ).toBeDefined();
    // The notice stands in for the map instead of a blank box.
    expect(screen.queryByTestId("google-map-canvas")).toBeNull();
    // The rest of the sheet stays usable.
    expect(screen.getByLabelText("Search for a place")).toBeDefined();
  });

  it("keeps the raster picker on the OSM provider", () => {
    renderSheet();

    expect(screen.getByTestId("map-picker-map")).toBeDefined();
    expect(screen.queryByTestId("google-map-canvas")).toBeNull();
    expect(screen.getByText("© OpenStreetMap contributors")).toBeDefined();
  });

  it("never boots the Google JS API in the native webview", () => {
    providerState.provider = "google";
    platformState.native = true;
    renderSheet();

    // Native owns the map: the in-place fallback stays keyless and never
    // constructs the web Google canvas.
    expect(screen.queryByTestId("google-map-canvas")).toBeNull();
    expect(screen.getByTestId("map-picker-map")).toBeDefined();
  });
});
