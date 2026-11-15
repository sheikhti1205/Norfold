// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HomeTopBar } from "./HomeTopBar";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, type NavLayout } from "../appearance";

function stubWideViewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function Harness({ expanded }: { expanded: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <MemoryRouter>
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
  </MemoryRouter>;
}

function storeLayout(layout: NavLayout) {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ ...DEFAULT_APPEARANCE, navLayout: layout }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Home brand ownership", () => {
  it("paints the mark and wordmark when the bottom bar owns navigation", () => {
    stubWideViewport(false);
    storeLayout("bottom");
    render(<Harness expanded={false} />);
    const brand = screen.getByRole("link", { name: "Norfold home" });
    expect(brand.textContent).toContain("Norfold");
    expect(brand.querySelector("img")).toBeTruthy();
  });

  it("leaves the brand to the rail on a wide viewport with the rail stored", () => {
    stubWideViewport(true);
    storeLayout("rail");
    render(<Harness expanded={false} />);
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    // The screen still has its one heading.
    expect(screen.getByRole("heading", { name: "Norfold" })).toBeTruthy();
  });

  it("yields the row to the search field while search is open", () => {
    stubWideViewport(false);
    storeLayout("bottom");
    render(<Harness expanded />);
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search posts" })).toBeTruthy();
  });
});
