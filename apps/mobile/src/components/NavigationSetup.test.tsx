// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationSetup } from "./NavigationSetup";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, loadAppearance, saveAppearance } from "../appearance";
import { useNavLayout } from "./navLayout";

function Harness() { const layout = useNavLayout(); return <><NavigationSetup /><output aria-label="Resolved navigation">{layout}</output></>; }
function width(value: number) { Object.defineProperty(window, "innerWidth", { configurable: true, value }); }
function prompt() { return screen.queryByRole("dialog", { name: "Choose your navigation" }); }
beforeEach(() => {
  localStorage.clear();
  width(1200);
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return q.includes("min-width: 600px") && window.innerWidth >= 600; },
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("first use device navigation choice", () => {
  it.each([320, 393, 599])("does not ask on compact widths (%spx) and resolves Automatic to the bottom bar", value => {
    width(value); render(<Harness />);
    expect(prompt()).toBeNull();
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("bottom");
    expect(loadAppearance().navLayoutChosen).toBe(false);
  });

  it("resolves Automatic to the rail on a wide first use without acknowledging a choice", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("rail");
    expect(loadAppearance().navLayoutChosen).toBe(false);
  });

  it("offers all three layouts as picture tiles with Automatic recommended", () => {
    render(<Harness />);
    expect(prompt()).toBeTruthy();
    for (const name of ["Automatic", "Side rail", "Bottom bar"]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
    // The tiles are the Appearance previews, so each one carries its own picture.
    expect(document.querySelectorAll(".fb-nav-preview")).toHaveLength(3);
    // Five destinations on the bar, four on the rail, and Automatic shows both.
    expect(document.querySelectorAll('.fb-nav-preview[data-layout="bottom"] .fb-nav-preview-bar i')).toHaveLength(5);
    expect(document.querySelectorAll('.fb-nav-preview[data-layout="rail"] .fb-nav-preview-bar i')).toHaveLength(4);
    expect(document.querySelectorAll('.fb-nav-preview[data-layout="auto"] .fb-nav-preview-side i')).toHaveLength(4);
    expect(document.querySelectorAll('.fb-nav-preview[data-layout="auto"] .fb-nav-preview-bar i')).toHaveLength(5);
    expect(prompt()?.textContent).toContain(
      "Recommended: Automatic. The rail appears when the screen has room; the bottom bar stays on phones.",
    );
  });

  it("offers no separate control that picks for the reader", () => {
    render(<Harness />);
    // `Use recommended` stays removed: three tiles, nothing else.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it.each([
    ["Automatic", "auto", "rail"],
    ["Side rail", "rail", "rail"],
    ["Bottom bar", "bottom", "bottom"],
  ] as const)("picking the %s tile records that layout and dismisses", (tile, expected, resolved) => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: tile }));
    expect(loadAppearance()).toMatchObject({ navLayout: expected, navLayoutChosen: true });
    expect(prompt()).toBeNull();
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe(resolved);
  });

  it("explicit bottom overrides the wide recommendation and persists across remounts", () => {
    const first = render(<Harness />); fireEvent.click(screen.getByRole("radio", { name: "Bottom bar" }));
    first.unmount(); render(<Harness />);
    expect(prompt()).toBeNull();
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("bottom");
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY)!)).toMatchObject({ navLayoutChosen: true });
  });

  it.each(["rail", "auto"] as const)("an explicit %s preference survives a phone resize and returns when wide", (preference) => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: preference === "rail" ? "Side rail" : "Automatic" }));
    act(() => { width(393); window.dispatchEvent(new Event("resize")); });
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("bottom");
    act(() => { width(1200); window.dispatchEvent(new Event("resize")); });
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("rail");
    expect(prompt()).toBeNull();
    expect(loadAppearance().navLayout).toBe(preference);
  });

  it("does not erase a legacy explicit preference or a later Appearance choice", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ navLayout: "rail" }));
    const first = render(<Harness />);
    expect(prompt()).toBeNull();
    first.unmount(); localStorage.clear(); render(<Harness />);
    act(() => saveAppearance({ ...DEFAULT_APPEARANCE, navLayout: "bottom", navLayoutChosen: true }));
    expect(prompt()).toBeNull();
  });

  it("hides when narrowed without silently accepting and offers again when expanded", () => {
    render(<Harness />);
    act(() => { width(393); window.dispatchEvent(new Event("resize")); });
    expect(prompt()).toBeNull();
    expect(loadAppearance().navLayoutChosen).toBe(false);
    act(() => { width(840); window.dispatchEvent(new Event("resize")); });
    expect(prompt()).toBeTruthy();
  });

  it("unrelated personalization does not silently accept the default navigation", () => {
    render(<Harness />);
    act(() => { saveAppearance({ ...DEFAULT_APPEARANCE, accent: "rose" }); });
    expect(prompt()).toBeTruthy();
    expect(loadAppearance().navLayoutChosen).toBe(false);
  });
});
