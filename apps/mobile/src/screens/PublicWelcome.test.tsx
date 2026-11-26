// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicWelcome } from "./PublicWelcome";
import { isOnboardingComplete } from "../services/onboarding";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);
function welcome() {
  return render(<MemoryRouter><Routes>
    <Route path="/" element={<PublicWelcome />} />
    <Route path="/auth" element={<h1>Intentional authentication</h1>} />
  </Routes></MemoryRouter>);
}
it("shows one consolidated explanation and canonical legal links", () => {
  welcome();
  expect(screen.getByRole("heading", { level: 1, name: "Lost or found something?" })).toBeTruthy();
  expect(screen.getAllByRole("heading", { name: "How it works" })).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "A possible match is just that." })).toBeNull();
  expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  expect(screen.getByText(/current site remains findbackapp.social/i)).toBeTruthy();
});
it("has three account actions in separate locations", () => {
  const { container } = welcome();
  const header = screen.getByRole("navigation", { name: "Public navigation" });
  expect(within(header).getAllByRole("link", { name: "Sign in" })).toHaveLength(1);
  const actions = [...screen.getAllByRole("link", { name: "Sign in" }), ...screen.getAllByRole("button", { name: "Sign in or create account" })];
  expect(actions).toHaveLength(3);
  expect(new Set(actions.map(action => action.parentElement)).size).toBe(3);
  expect(container.querySelector(".nf-public-hero-cta, .nf-public-sticky")).toBeNull();
});
it("header sign in does not complete onboarding", () => {
  welcome(); fireEvent.click(screen.getByRole("link", { name: "Sign in" }));
  expect(screen.getByRole("heading", { name: "Intentional authentication" })).toBeTruthy();
  expect(isOnboardingComplete()).toBe(false);
});
it.each([0, 1])("account button %i completes and navigates", index => {
  welcome(); fireEvent.click(screen.getAllByRole("button", { name: "Sign in or create account" })[index]!);
  expect(screen.getByRole("heading", { name: "Intentional authentication" })).toBeTruthy();
  expect(isOnboardingComplete()).toBe(true);
});
it("skip link focuses the how-it-works heading", () => {
  welcome(); fireEvent.click(screen.getByRole("link", { name: "Skip to how it works" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How it works" }));
});
it("intro link focuses the explanation without navigating away", () => {
  welcome(); fireEvent.click(screen.getByRole("link", { name: "See how it works" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How it works" }));
  expect(isOnboardingComplete()).toBe(false);
});
describe("public shell touch targets", () => {
  const css = readFileSync("src/screens/PublicWelcome.css", "utf8");
  it("keeps the brand, navigation, footer and skip link at 48px", () => {
    const brand = css.match(/\.nf-public-brand\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(brand).toMatch(/min-height:\s*48px/);
    expect(brand).toMatch(/min-width:\s*48px/);
    expect(css).toMatch(/\.nf-public nav :is\(a, button, summary\) \{[^}]*min-height:\s*48px/);
    expect(css).toMatch(/\.nf-public-nav :is\(a, button, summary\), \.nf-public-footer nav :is\(a, button\) \{[^}]*min-width:\s*48px/);
    expect(css).toMatch(/\.nf-public-skip \{[^}]*min-height:\s*48px/);
    expect(css).not.toContain("44px");
  });
});
