// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { bridgeStub, geolocationStub } = vi.hoisted(() => ({
  bridgeStub: {
    isLocationEnabled: vi.fn(),
    requestEnableLocation: vi.fn(),
  },
  geolocationStub: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    getCurrentPosition: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: (name: string) => {
    if (name === "LocationServices") return bridgeStub;
    // Other plugins in the LocationPicker import chain are unused here.
    return new Proxy({}, { get: () => async () => ({}) });
  },
}));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: geolocationStub,
}));

import { LocationPicker } from "./LocationPicker";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The one-shot fix now lives inside the map picker sheet: open the row first,
 * then drive the sheet. On this native-mocked platform the sheet falls back to
 * its in-place picker when the native Activity is unavailable, which is the
 * path the services-off action belongs to.
 */
async function openSheetFallback() {
  fireEvent.click(screen.getByRole("button", { name: /choose on map/i }));
  return await screen.findByRole("button", { name: /use my location once/i });
}

describe("LocationPicker services-off resolution (native)", () => {
  it("offers Turn on location in the sheet and retries the fix once enabled", async () => {
    bridgeStub.isLocationEnabled.mockResolvedValue({ enabled: false });
    geolocationStub.checkPermissions.mockResolvedValue({ coarseLocation: "prompt", location: "prompt" });
    bridgeStub.requestEnableLocation.mockResolvedValue({ enabled: true });
    geolocationStub.getCurrentPosition.mockResolvedValue({
      coords: { latitude: 23.8103, longitude: 90.4125, accuracy: 12 },
      timestamp: Date.now(),
    });

    const onChange = vi.fn();
    render(
      <LocationPicker
        value={{ label: "", latitude: null, longitude: null }}
        onChange={onChange}
      />,
    );
    fireEvent.click(await openSheetFallback());
    const turnOn = await screen.findByRole("button", { name: /turn on location/i });
    expect(turnOn).toBeTruthy();
    // The failed attempt must not have touched the fused provider.
    expect(geolocationStub.getCurrentPosition).not.toHaveBeenCalled();

    // Enabling the switch retries and lands the fix as a preview.
    bridgeStub.isLocationEnabled.mockResolvedValue({ enabled: true });
    fireEvent.click(turnOn);
    await waitFor(() => {
      expect(geolocationStub.getCurrentPosition).toHaveBeenCalledTimes(1);
    });
    // A sheet fix is a preview: it is committed only by Confirm.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm location/i }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: 23.81, longitude: 90.413 }),
      );
    });
    cleanup();
  });

  it("keeps the manual fallback when the dialog is dismissed", async () => {
    bridgeStub.isLocationEnabled.mockResolvedValue({ enabled: false });
    geolocationStub.checkPermissions.mockResolvedValue({ coarseLocation: "prompt", location: "prompt" });
    bridgeStub.requestEnableLocation.mockResolvedValue({ enabled: false });

    const onChange = vi.fn();
    render(
      <LocationPicker
        value={{ label: "", latitude: null, longitude: null }}
        onChange={onChange}
      />,
    );
    fireEvent.click(await openSheetFallback());
    fireEvent.click(await screen.findByRole("button", { name: /turn on location/i }));
    await waitFor(() => {
      expect(bridgeStub.requestEnableLocation).toHaveBeenCalledTimes(1);
    });
    // No retry, no coords, error message retained for the manual path.
    expect(geolocationStub.getCurrentPosition).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", { name: "Choose location" });
    expect(within(sheet).getByText(/location services are off/i)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /confirm location/i })).toHaveProperty("disabled", true);
    cleanup();
  });
});
