// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MapEmbed } from "./MapEmbed";

afterEach(cleanup);

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
  });

  it("keeps the neutral placeholder without coordinates", () => {
    render(<MapEmbed label="Dhaka" />);
    expect(screen.queryByTestId("raster-tile-mosaic")).toBeNull();
    expect(screen.getByText(/No location yet/)).toBeDefined();
  });
});
