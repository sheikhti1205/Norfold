// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfilePreview, clearProfilePreviewCache } from "./ProfilePreview";

const mocks = vi.hoisted(() => ({ fine: true, fetch: vi.fn() }));

vi.mock("./inputCapabilities", () => ({ useFinePointer: () => mocks.fine }));
vi.mock("../services/profile", () => ({ fetchPublicProfile: mocks.fetch }));
// A signed-in reader with no live messaging snapshot: the card must still carry
// the one people action, and it must not invent a relationship.
vi.mock("../auth", () => ({ useOptionalAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("../services/messaging/useMessaging", () => ({
  useMessaging: () => ({ accountId: null, status: "closed", currentProjections: null }),
}));

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

it("opens on a tap when the device has no hover", async () => {
  mocks.fine = false;
  mount();
  const identity = screen.getByRole("link", { name: "Samira" });
  // A keyboard or assistive activation carries no pointer detail: it keeps the
  // link's direct destination instead of forcing a card step.
  fireEvent.click(identity, { detail: 0 });
  expect(screen.queryByTestId("profile-preview")).toBeNull();
  fireEvent.click(identity, { detail: 1 });
  expect(await screen.findByTestId("profile-preview")).toBeTruthy();
});

it("opens after a rest and shows the facts, the action and both destinations", async () => {
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  expect(screen.queryByTestId("profile-preview")).toBeNull();
  const card = await screen.findByTestId("profile-preview");
  expect(card.getAttribute("role")).toBe("dialog");
  expect(screen.getByTestId("profile-preview-handle").textContent).toBe("@samira");
  await waitFor(() => {
    expect(screen.getByTestId("profile-preview").textContent)
      .toContain("Keeps an eye on the reading room noticeboard.");
    expect(screen.getByTestId("profile-preview").textContent).toContain("Central Library");
    expect(screen.getByTestId("profile-preview").textContent).toContain("Joined January 2026");
  });
  // The avatar and the name are the profile destination; the extra button says
  // so in words.
  expect(within(card).getByRole("link", { name: "Open Samira's profile" }).getAttribute("href")).toBe("/u/samira");
  expect(within(card).getByRole("link", { name: "View full profile" }).getAttribute("href")).toBe("/u/samira");
  expect(within(card).getByRole("button", { name: "Add friend Samira" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Close profile preview" })).toBeTruthy();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("samira"));
});

it("keeps a long bio partial until See more is pressed", async () => {
  mocks.fetch.mockResolvedValue({
    ...profile,
    bio: "Runs the Saturday repair desk at the community hall, keeps the noticeboard current, and answers questions about the lost property shelf every week without fail.",
  });
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  const card = await screen.findByTestId("profile-preview");
  const more = await within(card).findByRole("button", { name: "See more" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  const bio = card.querySelector(".fb-profile-preview-bio")!;
  expect(bio.getAttribute("data-expanded")).toBeNull();
  fireEvent.click(more);
  expect(within(card).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  expect(bio.getAttribute("data-expanded")).toBe("true");
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
  expect(screen.getByRole("link", { name: "View full profile" })).toBeTruthy();
});

it("opens on key focus, moves into the card and Escape returns to the link", async () => {
  const { trigger } = mount();
  const identity = screen.getByRole("link", { name: "Samira" });
  identity.focus();
  const card = await screen.findByTestId("profile-preview");
  const close = screen.getByRole("button", { name: "Close profile preview" });
  await waitFor(() => expect(document.activeElement).toBe(close));
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(identity));
  expect(card).toBeTruthy();
  expect(trigger.contains(identity)).toBe(true);
});

it("leaves a row's own keyboard focus alone when the card only layers hover and tap", async () => {
  render(
    <MemoryRouter>
      <ProfilePreview person={person} openOnFocus={false}>
        <a href="/posts/p1">Report row</a>
      </ProfilePreview>
    </MemoryRouter>,
  );
  const row = screen.getByRole("link", { name: "Report row" });
  row.focus();
  expect(screen.queryByTestId("profile-preview")).toBeNull();
  // The pointer path is unchanged: a rest still opens the person card.
  fireEvent.pointerOver(row, { pointerType: "mouse" });
  expect(await screen.findByTestId("profile-preview")).toBeTruthy();
});

it("returns to the identity on Shift+Tab from the card's first control", async () => {
  mount();
  const identity = screen.getByRole("link", { name: "Samira" });
  identity.focus();
  const close = await screen.findByRole("button", { name: "Close profile preview" });
  await waitFor(() => expect(document.activeElement).toBe(close));
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
  expect(document.activeElement).toBe(identity);
});

it("closes on the close button and on a press outside the card", async () => {
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  const close = await screen.findByRole("button", { name: "Close profile preview" });
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
  fireEvent.pointerOver(trigger, { pointerType: "mouse" });
  await screen.findByTestId("profile-preview");
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByTestId("profile-preview")).toBeNull());
});
