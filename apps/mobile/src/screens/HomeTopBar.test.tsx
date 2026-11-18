// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HomeTopBar } from "./HomeTopBar";
import { InlineRailProvider } from "../components/navLayout";

function Harness({ expanded, inlineRail = false }: { expanded: boolean; inlineRail?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <InlineRailProvider show={inlineRail}>
      <MemoryRouter>
        <HomeTopBar
          expanded={expanded}
          query=""
          onQueryChange={() => undefined}
          onOpen={() => undefined}
          onClear={() => undefined}
          onClose={() => undefined}
          onFocus={() => undefined}
          onFieldBlur={() => undefined}
          onBlur={() => undefined}
          inputRef={inputRef}
          utilities={null}
        />
      </MemoryRouter>
    </InlineRailProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("Home brand ownership", () => {
  it("paints the full lockup when no in-flow rail is on screen", () => {
    // The shell publishes `false` for the bottom bar and for a phone drawer, so
    // this row stays the only brand surface instead of depending on a column
    // that is not painted.
    render(<Harness expanded={false} />);
    const brand = screen.getByRole("link", { name: "Norfold home" });
    expect(brand.textContent).toContain("Norfold");
    expect(brand.querySelector("img")).toBeTruthy();
    // It still opts into the shared contract, so a rail on this viewport would
    // take the name over without a second rule.
    expect(brand.classList.contains("fb-nav-outside-brand")).toBe(true);
  });

  it("paints the wordmark outside the rail and leaves the mark to the rail head", () => {
    render(<Harness expanded={false} inlineRail />);
    const brand = screen.getByRole("link", { name: "Norfold home" });
    expect(brand.textContent).toContain("Norfold");
    expect(brand.querySelector("img")).toBeNull();
    // The rail owns when this copy may show: the same contract also hides the
    // app bar's copy once the panel names itself.
    expect(brand.classList.contains("fb-nav-outside-brand")).toBe(true);
    // The screen still has its one heading.
    expect(screen.getByRole("heading", { name: "Norfold" })).toBeTruthy();
  });

  it("yields the row to the search field while search is open", () => {
    render(<Harness expanded />);
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search posts" })).toBeTruthy();
  });
});
