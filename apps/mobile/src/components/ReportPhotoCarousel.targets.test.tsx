// @vitest-environment jsdom
// Density: each dot is a 24px button whose pointer target must still reach
// 48px. jsdom has no layout, so the co-located stylesheet is the evidence.
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportPhotoCarousel, type ReportMediaPhoto } from "./ReportPhotoCarousel";

const PHOTOS: ReportMediaPhoto[] = [
  { id: "A", webPath: "blob:photo-a" },
  { id: "B", webPath: "blob:photo-b" },
];

afterEach(cleanup);

describe("ReportPhotoCarousel dot targets", () => {
  it("keeps the 24px dot box and grows only the hit area", () => {
    render(
      <ReportPhotoCarousel
        photos={PHOTOS}
        onRemove={vi.fn<(id: string) => void>()}
        onMove={vi.fn<(id: string, direction: "earlier" | "later") => void>()}
        onMakeCover={vi.fn<(id: string) => void>()}
        onPreview={vi.fn<(id: string) => void>()}
        disabled={false}
      />,
    );
    for (const dot of screen.getAllByTestId("report-photo-dot")) {
      expect(dot.classList.contains("fb-report-carousel-dot")).toBe(true);
      // The row's spacing and the dot's focus ring stay on the 24px box.
      expect(dot.style.width).toBe("24px");
      expect(dot.style.height).toBe("24px");
    }
    // 24px + 16px upward + 8px downward = 48px tall; 2px per side meets the
    // neighbour at the 28px pitch instead of covering it.
    const css = readFileSync("src/components/ReportPhotoCarousel.css", "utf8");
    expect(css).toContain(".fb-report-carousel-dot::after");
    expect(css).toContain("inset: -16px -2px -8px");
  });
});
