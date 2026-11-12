// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationSetup } from "./NavigationSetup";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, loadAppearance, saveAppearance } from "../appearance";
import { useNavLayout } from "./navLayout";

function Harness() { const layout = useNavLayout(); return <><NavigationSetup /><output aria-label="Resolved navigation">{layout}</output></>; }
function width(value: number) { Object.defineProperty(window, "innerWidth", { configurable: true, value }); }
function prompt() { return screen.queryByRole("dialog", { name: "Choose your navigation" }); }
let pointer = true;
beforeEach(() => { localStorage.clear(); width(1200); pointer = true; vi.stubGlobal("matchMedia", (q: string) => ({ get matches() { return q.includes("pointer: fine") ? pointer : q.includes("min-width: 600px") && window.innerWidth >= 600; }, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("first use device navigation choice", () => {
  it.each([320, 393, 599, 768])("does not ask on compact or small tablet %spx, without acknowledging a choice", value => {
    width(value); render(<Harness />);
    expect(prompt()).toBeNull();
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("bottom");
    expect(loadAppearance().navLayoutChosen).toBe(false);
  });
  it.each([true, false])("wide first use offers both layouts as picture tiles, recommended follows fine pointer=%s", fine => {
    pointer = fine; render(<Harness />);
    expect(prompt()).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Side rail" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Bottom bar" })).toBeTruthy();
    // The tiles are the Appearance previews, so each one carries its own picture.
    expect(document.querySelectorAll(".fb-nav-preview")).toHaveLength(2);
    // §4: five destinations on the bar, four on the rail.
    expect(document.querySelectorAll('.fb-nav-preview[data-layout="bottom"] .fb-nav-preview-bar i')).toHaveLength(5);
    expect(document.querySelectorAll('.fb-nav-preview[data-layout="rail"] .fb-nav-preview-bar i')).toHaveLength(4);
    expect(prompt()?.textContent).toContain(fine
      ? "Recommended: Side rail. Wide screens have room for a column."
      : "Recommended: Bottom bar. Every control stays within thumb reach.");
  });
  it("offers no third control that picks for the reader", () => {
    render(<Harness />);
    // §5: `Use recommended` was removed on purpose. Two tiles, nothing else.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
  it.each(["Side rail", "Bottom bar"])("picking the %s tile records that layout and dismisses", tile => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: tile }));
    const expected = tile === "Side rail" ? "rail" : "bottom";
    expect(loadAppearance()).toMatchObject({ navLayout: expected, navLayoutChosen: true });
    expect(prompt()).toBeNull();
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe(expected);
  });
  it("explicit bottom overrides a fine-pointer recommendation and persists across remounts", () => {
    const first = render(<Harness />); fireEvent.click(screen.getByRole("radio", { name: "Bottom bar" }));
    first.unmount(); render(<Harness />);
    expect(prompt()).toBeNull();
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("bottom");
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY)!)).toMatchObject({ navLayoutChosen: true });
  });
  it("explicit rail survives phone resize and reappears as rail when wide again", () => {
    render(<Harness />); fireEvent.click(screen.getByRole("radio", { name: "Side rail" }));
    act(() => { width(393); window.dispatchEvent(new Event("resize")); });
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("bottom");
    act(() => { width(1200); window.dispatchEvent(new Event("resize")); });
    expect(screen.getByLabelText("Resolved navigation").textContent).toBe("rail");
    expect(prompt()).toBeNull();
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
    act(() => saveAppearance({ ...DEFAULT_APPEARANCE, accent: "rose" }));
    expect(prompt()).toBeTruthy();
    expect(loadAppearance().navLayoutChosen).toBe(false);
  });
});
