// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ONBOARDING_STORAGE_KEY } from "../services/onboarding";
import { Onboarding, STEP_THRESHOLDS } from "./Onboarding";

const scroll = vi.hoisted(() => ({ progress: null as import("framer-motion").MotionValue<number> | null }));
vi.mock("framer-motion", async importOriginal => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  scroll.progress = actual.motionValue(0);
  return { ...actual, useScroll: () => ({ scrollYProgress: scroll.progress }) };
});

let reduceMotion = false;
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("prefers-reduced-motion") && reduceMotion, media: query,
  onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
})) as unknown as typeof window.matchMedia;
beforeEach(() => { reduceMotion = false; scroll.progress?.set(0); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function show(props: React.ComponentProps<typeof Onboarding> = {}) {
  return render(<MemoryRouter><Onboarding {...props} /></MemoryRouter>);
}

describe("Onboarding", () => {
  it("shows the whole narrative without paging or a fabricated probability", () => {
    show();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of ["Lost or found something?", "How it works", "Report what you know.", "Search what you remember.", "Arrange a safe return.", "A safer return starts with care.", "A place to begin looking.", "Let’s find a way back."]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Back|Next)$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip to sign in" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Sign in or create account" })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/%|\b\d+\s*percent\b/i);
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  });
  it("renders masked headings, route lines, safety wash and primary arrows", () => {
    const { container } = show();
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.getAttribute("aria-label")).toBe("Lost or found something?");
    const masks = title.querySelectorAll(".fb-onboarding-mask");
    expect(masks).toHaveLength(2);
    expect(masks[1]?.classList.contains("fb-onboarding-mask--muted")).toBe(true);
    for (const axis of ["v", "h"]) expect(container.querySelector(`.fb-onboarding-route--${axis}`)?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("ol > .fb-onboarding-route")).toBeNull();
    expect(container.querySelector("#safety")?.firstElementChild?.classList.contains("fb-onboarding-safety-wash")).toBe(true);
    for (const button of screen.getAllByRole("button", { name: "Sign in or create account" })) expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('#how-it-works')?.getAttribute("data-reveal")).toBe("pending");
  });
  it("reveals and latches steps as the route is travelled", () => {
    const { container } = show();
    const steps = container.querySelector("#how-it-works")!;
    expect(steps.getAttribute("data-reveal")).toBe("pending");
    act(() => scroll.progress!.set(0.34));
    expect(steps.getAttribute("data-reveal")).toBe("shown");
    expect(steps.querySelectorAll('[data-reached="true"]')).toHaveLength(2);
    act(() => scroll.progress!.set(0));
    expect(steps.querySelectorAll('[data-reached="true"]')).toHaveLength(2);
    act(() => scroll.progress!.set(0.66));
    expect(steps.querySelectorAll('[data-reached="true"]')).toHaveLength(3);
  });
  it("uses strictly ordered step thresholds", () => {
    expect(STEP_THRESHOLDS).toEqual([0.08, 0.33, 0.66]);
    expect(STEP_THRESHOLDS[0]).toBeLessThan(STEP_THRESHOLDS[1]);
    expect(STEP_THRESHOLDS[1]).toBeLessThan(STEP_THRESHOLDS[2]);
  });
  it("scrolls and focuses the how-it-works heading", () => {
    show();
    const heading = screen.getByRole("heading", { name: "How it works" });
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole("link", { name: "See how it works" }));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(document.activeElement).toBe(heading);
  });
  it.each([0, 1])("primary action %i completes exactly once", index => {
    const onComplete = vi.fn(); show({ onComplete });
    const button = screen.getAllByRole("button", { name: "Sign in or create account" })[index]!;
    fireEvent.click(button); fireEvent.click(button);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("2");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it("skip completes exactly once", () => {
    const onComplete = vi.fn(); show({ onComplete });
    const button = screen.getByRole("button", { name: "Skip to sign in" });
    fireEvent.click(button); fireEvent.click(button);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("2");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it("links home without completing onboarding", () => {
    const onComplete = vi.fn();
    function LocationState() {
      const location = useLocation();
      return <div data-testid="location-state">{JSON.stringify(location.state)}</div>;
    }
    render(<MemoryRouter initialEntries={["/onboarding"]}><Onboarding onComplete={onComplete} /><LocationState /></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Norfold home" });
    expect(link.getAttribute("href")).toBe("/");
    fireEvent.click(link);
    expect(JSON.parse(screen.getByTestId("location-state").textContent || "null")).toEqual({ showPublic: true });
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
  });
  it("omits standalone chrome and legal links when embedded", () => {
    show({ embedded: true });
    expect(screen.queryByRole("link", { name: "Norfold home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip to sign in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Privacy" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Terms" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Community guidelines" })).toBeNull();
  });
  it("offers legal links in standalone mode", () => {
    show();
    for (const name of ["Privacy", "Terms", "Community guidelines"]) expect(screen.getByRole("link", { name })).toBeTruthy();
  });
  it("uses settings actions on replay without the account note or skip", () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "2");
    const onComplete = vi.fn(); show({ onComplete, replay: true });
    expect(screen.getAllByRole("button", { name: "Back to settings" })).toHaveLength(2);
    expect(screen.queryByText("An account is needed to report an item or search reports.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip to sign in" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Back to settings" })[0]!);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("2");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it("keeps the content in reduced motion", () => {
    reduceMotion = true; const { container } = show();
    expect(container.querySelector(".fb-onboarding")?.getAttribute("data-motion")).toBe("static");
    expect(container.querySelectorAll('[data-reveal="pending"]')).toHaveLength(0);
    expect(container.querySelectorAll('.fb-onboarding-steps [data-reached="true"]')).toHaveLength(3);
    for (const span of container.querySelectorAll<HTMLElement>(".fb-onboarding-mask > span")) expect(span.style.transform).not.toContain("125%");
    expect(screen.getByRole("heading", { name: "Arrange a safe return." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Let’s find a way back." })).toBeTruthy();
  });
  it("does not complete on a timer", () => {
    vi.useFakeTimers(); const onComplete = vi.fn(); show({ onComplete });
    vi.advanceTimersByTime(60_000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
  });
  it("flows naturally outside Shell without pinned controls", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const local = join(process.cwd(), "src/screens/Onboarding.css");
    const css = readFileSync(existsSync(local) ? local : join(process.cwd(), "apps/mobile/src/screens/Onboarding.css"), "utf8");
    expect(/\.fb-onboarding\s*\{[^}]*\}/s.exec(css)?.[0]).toMatch(/min-height:\s*100dvh/);
    expect(css).not.toMatch(/position:\s*fixed|margin-top:\s*auto/);
  });
  it("bounds the phone display scale and centres the route on its markers", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const local = join(process.cwd(), "src/screens/Onboarding.css");
    const css = readFileSync(existsSync(local) ? local : join(process.cwd(), "apps/mobile/src/screens/Onboarding.css"), "utf8");
    const phone = /@media \(max-width: 30rem\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(phone).toMatch(/\.fb-onboarding h1 \{ font-size: clamp\(1\.5rem, 11vw, 3\.25rem\)[\s\S]*\.fb-onboarding h2 \{ font-size: clamp\(1\.375rem, 8vw, 2rem\)/);
    expect(phone).toMatch(/\.fb-onboarding-closing h2 \{ font-size: clamp\(1\.75rem, 9vw, 2\.5rem\); \}/);
    expect(phone).toMatch(/\.fb-onboarding-steps li \{ display: block; \}/);
    expect(phone).toMatch(/\.fb-onboarding-route--v\s*\{\s*display:\s*none;\s*\}/);
    expect(css).not.toContain("1.1875rem");
  });
});
