// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NavOutsideBrand } from "./NavOutsideBrand";
import { InlineRailProvider } from "./navLayout";

afterEach(() => { cleanup(); });

describe("NavOutsideBrand", () => {
  it("stays absent when no in-flow rail is on screen", () => {
    const { container } = render(<NavOutsideBrand />);
    expect(container.querySelector(".fb-nav-outside-brand")).toBeNull();
    expect(screen.queryByText("Norfold")).toBeNull();
  });

  it("paints the app name when the shell publishes an in-flow rail", () => {
    render(<InlineRailProvider show><NavOutsideBrand /></InlineRailProvider>);
    const brand = screen.getByText("Norfold");
    expect(brand.className).toContain("fb-nav-outside-brand");
    expect(brand.className).toContain("fb-nav-outside-label");
  });
});
