// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleMapsLoadError,
  loadGoogleMaps,
  type GoogleMapsApi,
} from "../services/location/googleMapsLoader";
import { GoogleMapCanvas } from "./GoogleMapCanvas";

vi.mock("../services/location/googleMapsLoader", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/location/googleMapsLoader")>(),
  loadGoogleMaps: vi.fn(),
}));

const loadGoogleMapsMock = vi.mocked(loadGoogleMaps);

class FakeMap {
  static instances: FakeMap[] = [];
  readonly element: HTMLElement;
  readonly options: Record<string, unknown>;

  constructor(element: HTMLElement, options: Record<string, unknown>) {
    this.element = element;
    this.options = options;
    FakeMap.instances.push(this);
  }

  setOptions(): void {}
}

class FakeMarker {
  static instances: FakeMarker[] = [];
  readonly options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeMarker.instances.push(this);
  }

  setMap(): void {}
}

const API: GoogleMapsApi = { maps: { Map: FakeMap, Marker: FakeMarker } };

beforeEach(() => {
  FakeMap.instances = [];
  FakeMarker.instances = [];
  loadGoogleMapsMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GoogleMapCanvas", () => {
  it("renders nothing and reports the missing key", async () => {
    loadGoogleMapsMock.mockRejectedValue(new GoogleMapsLoadError("no-key"));
    const onFailure = vi.fn();
    const { container } = render(
      <GoogleMapCanvas latitude={23.81} longitude={90.41} onFailure={onFailure} />,
    );

    await waitFor(() => expect(onFailure).toHaveBeenCalledWith("no-key"));
    expect(onFailure).toHaveBeenCalledTimes(1);
    // The caller owns the fallback surface; a bare host would be a grey box.
    expect(container.childElementCount).toBe(0);
  });

  it("renders the region host with the accessible name once the API loads", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    render(
      <GoogleMapCanvas
        latitude={23.81}
        longitude={90.41}
        label="Riverside Park"
        className="h-40 w-full"
      />,
    );

    const region = screen.getByRole("region", { name: "Riverside Park" });
    expect(region.className).toContain("h-40");
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    expect(FakeMap.instances[0]?.element).toBe(region);
  });

  it("constructs the preview map once with no mapId and no styles", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    render(<GoogleMapCanvas latitude={23.81} longitude={90.41} zoom={12} />);

    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const options = FakeMap.instances[0]?.options ?? {};
    expect(options).toMatchObject({
      center: { lat: 23.81, lng: 90.41 },
      zoom: 12,
      disableDefaultUI: true,
      zoomControl: false,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      gestureHandling: "none",
    });
    // A map ID is deliberately forbidden (cost), and styles belong to the
    // OSM/native path, not this preview.
    expect(options).not.toHaveProperty("mapId");
    expect(options).not.toHaveProperty("styles");
  });

  it("enables cooperative gestures only for an interactive canvas", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    render(<GoogleMapCanvas latitude={23.81} longitude={90.41} interactive />);

    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    expect(FakeMap.instances[0]?.options.gestureHandling).toBe("cooperative");
  });

  it("places exactly one marker at the coordinate", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    render(<GoogleMapCanvas latitude={23.81} longitude={90.41} />);

    await waitFor(() => expect(FakeMarker.instances).toHaveLength(1));
    expect(FakeMarker.instances[0]?.options.position).toEqual({ lat: 23.81, lng: 90.41 });
    expect(FakeMarker.instances[0]?.options.map).toBe(FakeMap.instances[0]);
  });

  it("reports a load error and renders no map when the marker constructor is missing", async () => {
    loadGoogleMapsMock.mockResolvedValue({ maps: { Map: FakeMap } });
    const onFailure = vi.fn();
    const { container } = render(
      <GoogleMapCanvas latitude={23.81} longitude={90.41} onFailure={onFailure} />,
    );

    await waitFor(() => expect(onFailure).toHaveBeenCalledWith("load-error"));
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
  });

  it("ignores a load that resolves after unmount", async () => {
    let resolveLoad: ((api: GoogleMapsApi) => void) | undefined;
    loadGoogleMapsMock.mockReturnValue(
      new Promise<GoogleMapsApi>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const onFailure = vi.fn();
    const { unmount } = render(
      <GoogleMapCanvas latitude={23.81} longitude={90.41} onFailure={onFailure} />,
    );

    unmount();
    await act(async () => {
      resolveLoad?.(API);
    });

    expect(FakeMap.instances).toHaveLength(0);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
