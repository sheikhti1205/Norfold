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
    expect(brand.classList.contains("fb-home-brand")).toBe(true);
  });

  it("leaves the outside name to the shell while a rail is in flow", () => {
    render(<Harness expanded={false} inlineRail />);
    // One shell-owned name is anchored beside the rail head; this row must not
    // paint a second copy.
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    // The screen still has its one heading.
    expect(screen.getByRole("heading", { name: "Norfold" })).toBeTruthy();
  });

  it("yields the row to the search field while search is open", () => {
    render(<Harness expanded />);
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search posts" })).toBeTruthy();
  });
});
