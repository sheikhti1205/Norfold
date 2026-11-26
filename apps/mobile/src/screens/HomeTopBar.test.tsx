// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRef, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { HomeTopBar } from "./HomeTopBar";
import { InlineRailProvider } from "../components/navLayout";
import { NavDrawerProvider } from "../components/navDrawer";

function Harness({
  expanded,
  inlineRail = false,
  utilities = null,
}: {
  expanded: boolean;
  inlineRail?: boolean;
  utilities?: ReactNode;
}) {
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
          utilities={utilities}
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
    // The wordmark keeps its type size; the link's own box carries the 48px
    // density floor. jsdom has no layout, so the stylesheet is the evidence.
    expect(brand.classList.contains("fb-home-brand--target")).toBe(true);
  });

  it("gives the brand link a 48px target without growing the wordmark", () => {
    const css = readFileSync("src/screens/HomeTopBar.css", "utf8");
    const start = css.indexOf(".fb-home-brand.fb-home-brand--target {");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("min-height: 48px");
    expect(rule).not.toContain("font-size");
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

  it("keeps the drawer control in the row while search opens and drops it only for an in-flow rail", () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const open = () => undefined;
    const view = render(
      <NavDrawerProvider available expanded={false} open={open} triggerRef={triggerRef}>
        <Harness expanded={false} />
      </NavDrawerProvider>,
    );
    const row = screen.getByTestId("home-search-row");
    expect(row.className).toContain("min-h-[48px]");
    // The mark itself is the navigation trigger: one button, and no separate
    // home link sharing the row's leading edge.
    const button = within(row).getByRole("button", { name: /^Norfold, open navigation$/i });
    expect(within(row).queryAllByRole("button", { name: /^Norfold, open navigation$/i })).toHaveLength(1);
    expect(within(row).queryByRole("link", { name: "Norfold home" })).toBeNull();
    expect(button.textContent).toContain("Norfold");
    // The control owns the shell's focus target, so closing the drawer returns
    // focus to the visible trigger.
    expect(triggerRef.current).toBe(button);

    view.rerender(
      <NavDrawerProvider available expanded open={open} triggerRef={triggerRef}>
        <Harness expanded />
      </NavDrawerProvider>,
    );
    // Search yields the wordmark to the field but leaves the row exactly 48px
    // tall; the mark stays mounted so the shell fallback never flashes a
    // floating control over the feed.
    expect(row.className).toContain("min-h-[48px]");
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    const searchingButton = screen.getByRole("button", { name: /^Norfold, open navigation$/i });
    expect(searchingButton).toBe(button);
    expect(searchingButton.textContent).not.toContain("Norfold");
    expect(triggerRef.current).toBe(button);

    view.rerender(
      <NavDrawerProvider available expanded={false} open={open} triggerRef={triggerRef}>
        <Harness expanded={false} inlineRail />
      </NavDrawerProvider>,
    );
    // The in-flow rail owns the identity and the shell never offers this
    // control there.
    expect(screen.queryByRole("button", { name: /^Norfold, open navigation$/i })).toBeNull();
  });

  it("drops the trailing utilities while searching and restores them on close", () => {
    const utilities = <button type="button">Create report</button>;
    const view = render(<Harness expanded={false} utilities={utilities} />);
    const row = screen.getByTestId("home-search-row");
    // The idle row keeps the cluster; the 48px floor is unchanged.
    expect(row.className).toContain("min-h-[48px]");
    expect(within(row).getByRole("button", { name: "Create report" })).toBeTruthy();

    view.rerender(<Harness expanded utilities={utilities} />);
    // While the field owns the row the cluster is gone: it is not part of the
    // search task and only squeezes the input on a 320px screen.
    expect(row.className).toContain("min-h-[48px]");
    expect(screen.getByRole("searchbox", { name: "Search posts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create report" })).toBeNull();

    view.rerender(<Harness expanded={false} utilities={utilities} />);
    // Closing restores the idle cluster without moving the row.
    expect(row.className).toContain("min-h-[48px]");
    expect(within(row).getByRole("button", { name: "Create report" })).toBeTruthy();
  });
});
