// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocationPicker, type LocationValue } from "./LocationPicker";

// The sheet can never be mistaken for a form control: the picker's own form
// shows one field and one row, and the sheet is a separate surface.
vi.mock("./LiveRegion", () => ({ announce: vi.fn() }));

// Stub the sheet: its internals (map start-order, submit-only search,
// WebGL fallbacks, GPS preview, exact opt-in) are covered in
// MapPickerSheet.test.tsx. Here the picker boundary is under test — open
// state, value handoff, confirm handling, clear.
vi.mock("./MapPickerSheet", () => ({
  MapPickerSheet: ({
    open,
    onClose,
    value,
    onConfirm,
  }: {
    open: boolean;
    onClose: () => void;
    value: LocationValue;
    onConfirm: (next: LocationValue) => void;
  }) => {
    return open ? (
      <div data-testid="map-picker-stub">
        <span data-testid="stub-value">
          {String(value.latitude)},{String(value.longitude)}
        </span>
        <button
          type="button"
          onClick={() =>
            onConfirm({
              label: "Mirpur, Dhaka",
              latitude: 23.81,
              longitude: 90.413,
              precision: "APPROXIMATE",
              preciseLatitude: 23.810332,
              preciseLongitude: 90.412518,
            })
          }
        >
          stub-confirm-approx
        </button>
        <button
          type="button"
          onClick={() =>
            onConfirm({
              label: "Mirpur, Dhaka",
              latitude: 23.810332,
              longitude: 90.412518,
              precision: "EXACT",
              preciseLatitude: 23.810332,
              preciseLongitude: 90.412518,
            })
          }
        >
          stub-confirm-exact
        </button>
        <button type="button" onClick={onClose}>
          stub-close
        </button>
      </div>
    ) : null;
  },
}));

afterEach(cleanup);
afterEach(() => {
  vi.unstubAllGlobals();
});
// The geolocation API must never leak between tests: an installed stub is an
// own navigator property and is removed again here.
afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).geolocation;
});

/** Captures the callbacks the component hands to navigator.geolocation. */
interface GeoStub {
  getCurrentPosition: ReturnType<typeof vi.fn>;
  pending: Array<{
    success: (position: {
      coords: { latitude: number; longitude: number; accuracy?: number };
    }) => void;
    failure: (error: { code?: number }) => void;
    options?: PositionOptions;
  }>;
  grant: (coords?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  }) => void;
  reject: (code?: number) => void;
}

/**
 * Installs a navigator.geolocation stub that never answers on its own, so a
 * test decides exactly when a fix arrives or fails. Nothing is requested until
 * the component is explicitly asked for it.
 */
function installGeolocation(): GeoStub {
  const pending: GeoStub["pending"] = [];
  const getCurrentPosition = vi.fn(
    (
      success: GeoStub["pending"][number]["success"],
      failure: GeoStub["pending"][number]["failure"],
      options?: PositionOptions,
    ) => {
      pending.push({ success, failure, options });
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return {
    getCurrentPosition,
    pending,
    grant(coords = { latitude: 23.8103321, longitude: 90.4125189, accuracy: 42 }) {
      const next = pending.shift();
      if (!next) throw new Error("no location request in flight");
      next.success({ coords });
    },
    reject(code = 1) {
      const next = pending.shift();
      if (!next) throw new Error("no location request in flight");
      next.failure({ code });
    },
  };
}

function renderPicker(value: LocationValue) {
  const onChange = vi.fn();
  const { rerender } = render(<LocationPicker value={value} onChange={onChange} />);
  return { onChange, rerender };
}

const approxValue: LocationValue = {
  label: "Pinned location",
  latitude: 23.81,
  longitude: 90.412,
  precision: "APPROXIMATE",
  preciseLatitude: 23.810332,
  preciseLongitude: 90.412518,
};

const emptyValue: LocationValue = {
  label: "",
  latitude: null,
  longitude: null,
  precision: "APPROXIMATE",
  preciseLatitude: null,
  preciseLongitude: null,
};

function input(): HTMLInputElement {
  return screen.getByPlaceholderText(
    /place, decimal coords/i,
  ) as HTMLInputElement;
}

function locationRow(): HTMLButtonElement {
  return screen.getByRole("button", { name: /choose on map/i }) as HTMLButtonElement;
}

describe("LocationPicker coordinate readout", () => {
  it("shows approximate pins at 3 decimals, matching the ~100 m claim", () => {
    renderPicker(approxValue);
    expect(screen.getByText("23.810, 90.412")).toBeTruthy();
  });

  it("shows exact pins at full stored precision", () => {
    renderPicker({
      ...approxValue,
      latitude: 23.810332,
      longitude: 90.412518,
      precision: "EXACT",
    });
    expect(screen.getByText("23.810332, 90.412518")).toBeTruthy();
  });

  it("keeps the readout in sync when a new committed value changes precision", () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<LocationValue>({
        ...approxValue,
        latitude: 23.810332,
        longitude: 90.412518,
        precision: "EXACT",
      });
      return (
        <LocationPicker
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Harness />);
    expect(screen.getByText("23.810332, 90.412518")).toBeTruthy();
    fireEvent.click(locationRow());
    fireEvent.click(screen.getByRole("button", { name: "stub-confirm-approx" }));
    expect(screen.getByText("23.810, 90.413")).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 23.81, longitude: 90.413, precision: "APPROXIMATE" }),
    );
  });
});

describe("LocationPicker single map row", () => {
  function renderHarness(initial: LocationValue) {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<LocationValue>(initial);
      return (
        <LocationPicker
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Harness />);
    return { onChange };
  }

  it("shows the empty prompt on the row instead of separate action buttons", () => {
    renderPicker(emptyValue);
    const row = locationRow();
    expect(row.textContent).toContain("Choose on map");
    expect(row.textContent).toContain("Set a location for this report");
    expect(row.getAttribute("aria-label")).toBe("Choose on map. Set a location for this report");
    expect(row.className).toContain("min-h-[48px]");
    // The controls that moved into the sheet are gone from the form.
    expect(screen.queryByRole("button", { name: /use my location once/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /find location in maps/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open in maps/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /use exact pin/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /preview map in app/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear location/i })).toBeNull();
  });

  it("carries the current label and readout in the row's accessible name", () => {
    renderPicker(approxValue);
    const row = locationRow();
    expect(row.getAttribute("aria-label")).toBe(
      "Choose on map. Pinned location. 23.810, 90.412",
    );
    expect(row.textContent).toContain("Pinned location");
    expect(row.textContent).toContain("23.810, 90.412");
  });

  it("opens the sheet with the existing pin and emits nothing on open", () => {
    const { onChange } = renderPicker(approxValue);
    fireEvent.click(locationRow());
    expect(screen.getByTestId("map-picker-stub")).toBeTruthy();
    expect(screen.getByTestId("stub-value").textContent).toBe("23.81,90.412");
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("Pinned location");
  });

  it("closing the sheet without confirming leaves the value alone", () => {
    const { onChange } = renderPicker(approxValue);
    fireEvent.click(locationRow());
    fireEvent.click(screen.getByRole("button", { name: "stub-close" }));
    expect(screen.queryByTestId("map-picker-stub")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("map confirm commits approximate-by-default and syncs the text field", () => {
    const { onChange } = renderHarness(emptyValue);
    fireEvent.click(locationRow());
    fireEvent.click(screen.getByRole("button", { name: "stub-confirm-approx" }));
    expect(onChange).toHaveBeenCalledWith({
      label: "Mirpur, Dhaka",
      latitude: 23.81,
      longitude: 90.413,
      precision: "APPROXIMATE",
      preciseLatitude: 23.810332,
      preciseLongitude: 90.412518,
    });
    expect(input().value).toBe("Mirpur, Dhaka");
    expect(screen.getByText("23.810, 90.413")).toBeTruthy();
  });

  it("map confirm with exact shows the public-visibility warning at full precision", () => {
    renderHarness(emptyValue);
    fireEvent.click(locationRow());
    fireEvent.click(screen.getByRole("button", { name: "stub-confirm-exact" }));
    expect(screen.getByText("23.810332, 90.412518")).toBeTruthy();
    expect(
      screen.getByText(/exact pin and will be shown publicly/i),
    ).toBeTruthy();
  });

  it("clear removes the pin, resets the field and never opens the sheet", () => {
    const { onChange } = renderHarness(approxValue);
    fireEvent.click(screen.getByRole("button", { name: /clear location/i }));
    expect(onChange).toHaveBeenCalledWith({
      label: "",
      latitude: null,
      longitude: null,
      precision: "APPROXIMATE",
      preciseLatitude: null,
      preciseLongitude: null,
    });
    expect(input().value).toBe("");
    expect(screen.queryByTestId("map-picker-stub")).toBeNull();
    expect(screen.queryByRole("button", { name: /clear location/i })).toBeNull();
  });

  it("typed coordinates keep working without ever opening the map", () => {
    const { onChange } = renderPicker(emptyValue);
    expect(screen.queryByTestId("map-picker-stub")).toBeNull();
    fireEvent.change(input(), { target: { value: "23.810332, 90.412518" } });
    expect(onChange).toHaveBeenCalledWith({
      label: "Pinned location",
      latitude: 23.81,
      longitude: 90.413,
      precision: "APPROXIMATE",
      preciseLatitude: 23.810332,
      preciseLongitude: 90.412518,
    });
  });

  it("typed place text stays usable and does not open the sheet", () => {
    const { onChange } = renderPicker(emptyValue);
    fireEvent.change(input(), { target: { value: "Dhanmondi Lake" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Dhanmondi Lake", latitude: null, longitude: null }),
    );
    expect(screen.queryByTestId("map-picker-stub")).toBeNull();
  });

  it("renders no map imagery, iframe or OSM tile request in the form", () => {
    renderPicker(approxValue);
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector('img[src*="tile.openstreetmap.org"]')).toBeNull();
    expect(screen.queryByTestId("map-embed-frame")).toBeNull();
  });

  it("disabled locks the field, the row and the clear control", () => {
    render(<LocationPicker value={approxValue} onChange={vi.fn()} disabled />);
    expect(input()).toHaveProperty("disabled", true);
    expect(locationRow()).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /clear location/i })).toHaveProperty("disabled", true);
  });
});

describe("LocationPicker input hygiene", () => {
  it("discards a short-link resolution begun before locking even if it settles after unlocking", async () => {
    let resolveLink!: (response: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { resolveLink = resolve; }));
    const onChange = vi.fn();
    const { rerender } = render(<LocationPicker value={emptyValue} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/place, decimal coords/i), { target: { value: "https://maps.app.goo.gl/fixture" } });
    expect(resolveLink).toBeTypeOf("function");
    rerender(<LocationPicker value={emptyValue} onChange={onChange} disabled />);
    rerender(<LocationPicker value={emptyValue} onChange={onChange} />);
    await act(async () => resolveLink(new Response("", { status: 200 })));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/place, decimal coords/i)).toHaveProperty("value", "https://maps.app.goo.gl/fixture");
  });

  it("never requests a location on mount, on re-render or when the sheet opens", () => {
    const geo = installGeolocation();
    const { rerender } = renderPicker(emptyValue);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    rerender(<LocationPicker value={emptyValue} onChange={vi.fn()} />);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(locationRow());
    expect(screen.getByTestId("map-picker-stub")).toBeTruthy();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("opening the picker never hands off to the external map app", () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    try {
      renderPicker(approxValue);
      fireEvent.click(locationRow());
      expect(screen.getByTestId("map-picker-stub")).toBeTruthy();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
