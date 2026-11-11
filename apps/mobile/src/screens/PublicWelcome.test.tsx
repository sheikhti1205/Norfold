// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PublicWelcome } from "./PublicWelcome";
import { isOnboardingComplete } from "../services/onboarding";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);
function welcome() {
  return render(<MemoryRouter><Routes>
    <Route path="/" element={<PublicWelcome />} />
    <Route path="/auth" element={<h1>Intentional authentication</h1>} />
  </Routes></MemoryRouter>);
}
it("reuses the editorial opening and exposes truthful chapters and canonical legal links", () => {
  welcome();
  expect(screen.getByRole("heading", { name: "Lost or found something?" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "A possible match is just that." })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
  expect(screen.getByText(/current site remains findbackapp.social/i)).toBeTruthy();
});
it("shows one account action per section on the last onboarding slide", () => {
  const { container } = welcome();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const header = screen.getByRole("navigation", { name: "Public navigation" });
  const hero = screen.getByRole("region", { name: "Onboarding" });
  expect(within(header).getAllByRole("link", { name: /sign in/i })).toHaveLength(1);
  expect(within(hero).getAllByRole("button", { name: /sign in/i })).toHaveLength(1);
  const actions = screen.getAllByRole("link", { name: /sign in/i }).concat(screen.getAllByRole("button", { name: /sign in/i }));
  expect(actions).toHaveLength(3);
  expect(new Set(actions.map(action => action.parentElement)).size).toBe(3);
  expect(container.querySelector(".nf-public-hero-cta, .nf-public-sticky")).toBeNull();
});
it("signs in deliberately without claiming onboarding was completed", () => {
  welcome();
  fireEvent.click(screen.getByRole("link", { name: "Sign in" }));
  expect(screen.getByRole("heading", { name: "Intentional authentication" })).toBeTruthy();
  expect(isOnboardingComplete()).toBe(false);
});
it("navigates from the closing account action", () => {
  welcome();
  fireEvent.click(screen.getByRole("button", { name: "Sign in or create account" }));
  expect(screen.getByRole("heading", { name: "Intentional authentication" })).toBeTruthy();
  expect(isOnboardingComplete()).toBe(true);
});
it("keeps previous scenes and vertical content available and completes on Skip", () => {
  welcome();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(isOnboardingComplete()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(isOnboardingComplete()).toBe(true);
  expect(screen.getByRole("heading", { name: "Intentional authentication" })).toBeTruthy();
});
