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
  center: { lat: number; lng: number };
  private readonly idleHandlers = new Set<() => void>();

  constructor(element: HTMLElement, options: Record<string, unknown>) {
    this.element = element;
    this.options = options;
    const center = options.center as { lat: number; lng: number } | undefined;
    this.center = center ?? { lat: 0, lng: 0 };
    FakeMap.instances.push(this);
  }

  setOptions(): void {}

  addListener(event: string, handler: () => void): { remove: () => void } | undefined {
    if (event !== "idle") return undefined;
    this.idleHandlers.add(handler);
    return { remove: () => this.idleHandlers.delete(handler) };
  }

  getCenter(): { lat: () => number; lng: () => number } {
    return { lat: () => this.center.lat, lng: () => this.center.lng };
  }

  setCenter(center: { lat: number; lng: number }): void {
    this.center = center;
  }

  /** Test helper: the user finished moving the map to `center`. */
  settleAt(center: { lat: number; lng: number }): void {
    this.center = center;
    for (const handler of this.idleHandlers) handler();
  }

  /** Test helper: an idle with no user move — e.g. the opening view. */
  emitIdle(): void {
    for (const handler of this.idleHandlers) handler();
  }
}

class FakeMarker {
  static instances: FakeMarker[] = [];
  readonly options: Record<string, unknown>;
  position: { lat: number; lng: number } | null;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    const position = options.position as { lat: number; lng: number } | undefined;
    this.position = position ?? null;
    FakeMarker.instances.push(this);
  }

  setMap(): void {}

  setPosition(position: { lat: number; lng: number }): void {
    this.position = position;
  }
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

  it("keeps preview gestures off and never reports a centre", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    const onCenterChange = vi.fn();
    render(
      <GoogleMapCanvas latitude={23.81} longitude={90.41} onCenterChange={onCenterChange} />,
    );

    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const map = FakeMap.instances[0];
    expect(map?.options.gestureHandling).toBe("none");
    // A preview subscribes to nothing, so a move can never be reported.
    act(() => map?.settleAt({ lat: 22.35, lng: 91.78 }));
    expect(onCenterChange).not.toHaveBeenCalled();
  });

  it("rebuilds the preview map when the coordinate changes", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    const { rerender } = render(<GoogleMapCanvas latitude={23.81} longitude={90.41} />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));

    rerender(<GoogleMapCanvas latitude={22.35} longitude={91.78} />);
    await waitFor(() => expect(FakeMap.instances).toHaveLength(2));
  });

  it("enables plain drag gestures in picking mode", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    render(<GoogleMapCanvas latitude={23.81} longitude={90.41} picking onCenterChange={vi.fn()} />);

    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    const options = FakeMap.instances[0]?.options ?? {};
    // `greedy` is the plain drag/pan mode; `cooperative` would need ctrl.
    expect(options.gestureHandling).toBe("greedy");
    // The API's own chrome stays off in a picker as well.
    expect(options.disableDefaultUI).toBe(true);
  });

  it("reports the centre the user settles on and moves the marker with it", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    const onCenterChange = vi.fn();
    render(
      <GoogleMapCanvas latitude={23.81} longitude={90.41} picking onCenterChange={onCenterChange} />,
    );

    await waitFor(() => expect(FakeMarker.instances).toHaveLength(1));
    act(() => FakeMap.instances[0]?.settleAt({ lat: 22.3569, lng: 91.7832 }));

    expect(onCenterChange).toHaveBeenCalledTimes(1);
    expect(onCenterChange).toHaveBeenCalledWith({ lat: 22.3569, lng: 91.7832 });
    // The pin marks the chosen point, not the centre the map started at.
    expect(FakeMarker.instances[0]?.position).toEqual({ lat: 22.3569, lng: 91.7832 });
  });

  it("never reports the opening view in picking mode", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    const onCenterChange = vi.fn();
    render(
      <GoogleMapCanvas latitude={23.81} longitude={90.41} picking onCenterChange={onCenterChange} />,
    );

    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));
    act(() => FakeMap.instances[0]?.emitIdle());
    expect(onCenterChange).not.toHaveBeenCalled();
  });

  it("follows a caller recentre in picking mode without rebuilding the map", async () => {
    loadGoogleMapsMock.mockResolvedValue(API);
    const onCenterChange = vi.fn();
    const { rerender } = render(
      <GoogleMapCanvas
        latitude={23.81}
        longitude={90.41}
        picking
        onCenterChange={onCenterChange}
      />,
    );
    await waitFor(() => expect(FakeMap.instances).toHaveLength(1));

    rerender(
      <GoogleMapCanvas
        latitude={22.35}
        longitude={91.78}
        picking
        onCenterChange={onCenterChange}
      />,
    );

    expect(FakeMap.instances).toHaveLength(1);
    expect(FakeMap.instances[0]?.center).toEqual({ lat: 22.35, lng: 91.78 });
    expect(FakeMarker.instances[0]?.position).toEqual({ lat: 22.35, lng: 91.78 });
    expect(onCenterChange).not.toHaveBeenCalled();
  });
});
