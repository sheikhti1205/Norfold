// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfilePreview, clearProfilePreviewCache } from "./ProfilePreview";

const mocks = vi.hoisted(() => ({ fine: true, fetch: vi.fn() }));

vi.mock("./inputCapabilities", () => ({ useFinePointer: () => mocks.fine }));
vi.mock("../services/profile", () => ({ fetchPublicProfile: mocks.fetch }));

const person = { id: "u1", username: "samira", displayName: "Samira" };
const profile = {
  id: "u1", username: "samira", displayName: "Samira", avatarUrl: null,
  emailVerified: true, phoneVerified: false,
  bio: "Keeps an eye on the reading room noticeboard.",
  locationLabel: "Central Library", createdAt: "2026-01-01T00:00:00.000Z",
};

function mount() {
  const view = render(
    <MemoryRouter>
      <ProfilePreview person={person}>
        <a href="/u/samira">Samira</a>
      </ProfilePreview>
    </MemoryRouter>,
  );
  const trigger = view.container.querySelector(".fb-profile-preview-trigger") as HTMLElement | null;
  return { view, trigger: trigger ?? view.container.firstElementChild as HTMLElement };
}

beforeEach(() => {
  mocks.fine = true;
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(profile);
  clearProfilePreviewCache();
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps the plain link on a coarse pointer", () => {
  mocks.fine = false;
  mount();
  expect(document.querySelector(".fb-profile-preview-trigger")).toBeNull();
  expect(screen.getByRole("link", { name: "Samira" })).toBeTruthy();
  expect(screen.queryByTestId("profile-preview")).toBeNull();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("opens after a rest and shows the public facts", async () => {
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  expect(screen.queryByTestId("profile-preview")).toBeNull();
  const card = await screen.findByTestId("profile-preview");
  expect(card.getAttribute("role")).toBe("dialog");
  expect(screen.getByTestId("profile-preview-handle").textContent).toBe("@samira");
  // The card mounts as soon as it opens and fills from the profile request, so
  // the fetched facts are a second commit. Asserting them straight after the
  // mount only passes when the microtask wins the race.
  await waitFor(() => {
    expect(screen.getByTestId("profile-preview").textContent)
      .toContain("Keeps an eye on the reading room noticeboard.");
    expect(screen.getByTestId("profile-preview").textContent).toContain("Central Library");
  });
  const action = screen.getByRole("link", { name: "View profile" });
  expect(action.getAttribute("href")).toBe("/u/samira");
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("samira"));
});

it("serves the second open from the account cache", async () => {
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  const first = await screen.findByTestId("profile-preview");
  // The account is cached when the request settles, so open number two only
  // proves the cache when the first card has actually filled.
  await waitFor(() => expect(first.textContent).toContain("Central Library"));
  fireEvent.pointerOut(trigger, { pointerType: "mouse", relatedTarget: document.body });
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull(), { timeout: 1200 });
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  await screen.findByTestId("profile-preview");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("names a failed load and still offers the profile page", async () => {
  mocks.fetch.mockRejectedValue(new Error("offline"));
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  const note = await screen.findByTestId("profile-preview-error");
  expect(note.textContent).toContain("Profile details could not load");
  expect(screen.getByRole("link", { name: "View profile" })).toBeTruthy();
});

it("opens on key focus, moves into the card and Escape returns to the link", async () => {
  const { trigger } = mount();
  const identity = screen.getByRole("link", { name: "Samira" });
  identity.focus();
  const card = await screen.findByTestId("profile-preview");
  const action = screen.getByRole("link", { name: "View profile" });
  await waitFor(() => expect(document.activeElement).toBe(action));
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(identity));
  expect(card).toBeTruthy();
  expect(trigger.contains(identity)).toBe(true);
});

it("returns to the identity on Shift+Tab from the card's first action", async () => {
  mount();
  const identity = screen.getByRole("link", { name: "Samira" });
  identity.focus();
  const action = await screen.findByRole("link", { name: "View profile" });
  await waitFor(() => expect(document.activeElement).toBe(action));
  fireEvent.keyDown(action, { key: "Tab", shiftKey: true });
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
  expect(document.activeElement).toBe(identity);
});
