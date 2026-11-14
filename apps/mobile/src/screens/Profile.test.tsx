// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@norfold/shared";

const { mockSetUser, mockUpdateProfile, mockReadProviders, mockTelegram, mockDrive } = vi.hoisted(() => ({
  mockSetUser: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockReadProviders: vi.fn(),
  mockTelegram: vi.fn(),
  mockDrive: vi.fn(),
}));

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    value: null as PublicUser | null,
  },
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ user: mockUser.value, setUser: mockSetUser }),
}));
vi.mock("../services/accountProviders", () => ({ readLinkedProviders: mockReadProviders }));
vi.mock("../services/telegram", () => ({ getTelegramAccount: mockTelegram }));
vi.mock("../services/profile", () => ({ updateMyProfile: mockUpdateProfile }));
vi.mock("./AccountSettings", () => ({
  AccountSecuritySections: () => <section aria-label="Sign-in controls">Password and contact rules</section>,
  MobileNumberRow: () => <a href="/profile/edit">Mobile number</a>,
}));
vi.mock("../services/messaging/driveAuth", () => ({
  driveAuth: () => ({
    available: () => mockDrive().available,
    current: () => (mockDrive().connected ? { token: "synthetic", expiresAt: Date.now() + 60_000 } : null),
  }),
}));

import { Profile } from "./Profile";
import { ThemeProvider } from "../theme";

const trust = vi.hoisted(() => ({
  fetchReputationTier: vi.fn(),
  listMyRecoveries: vi.fn(),
}));
vi.mock("../services/trust", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/trust")>()),
  fetchReputationTier: trust.fetchReputationTier,
  listMyRecoveries: trust.listMyRecoveries,
}));

const baseUser: PublicUser = {
  id: "u1",
  username: "tester",
  email: "tester@example.com",
  phone: "+10000000000",
  emailVerified: true,
  phoneVerified: false,
  avatarUrl: null,
  displayName: "Tester Name",
  bio: null,
  locationLabel: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  trust.fetchReputationTier.mockResolvedValue("TRUSTED");
  trust.listMyRecoveries.mockResolvedValue([
    { returnId: "r1", lostPostId: "p1", counterpartUserId: "u2", externalHelper: false, recoveredAt: "2026-10-01T00:00:00Z", myRating: 5, counterpartRating: 4 },
  ]);
  mockUser.value = { ...baseUser };
  mockReadProviders.mockResolvedValue(new Set(["email"]));
  mockTelegram.mockResolvedValue({ linked: false, phone: null, username: null });
  mockDrive.mockReturnValue({ available: false, connected: false });
  mockUpdateProfile.mockResolvedValue({ ...baseUser, displayName: "New Name" });
});

function renderProfile() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Profile />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("Profile landing", () => {
  it("renders the identity hero with the large avatar, editable name, copyable handle and verification chips", () => {
    renderProfile();
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
    expect(screen.getByText("Tester Name")).toBeTruthy();
    expect(screen.getByText("@tester")).toBeTruthy();
    expect(screen.getByText("TE")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy username @tester" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change profile photo" }).getAttribute("href")).toBe(
      "/profile/edit",
    );
    expect(screen.getByText("Email verified")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Verify mobile" }).getAttribute("href")).toBe(
      "/profile/edit",
    );
  });

  it("edits the name in place and keeps the other identity fields intact", async () => {
    const view = renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Edit name" }));
    const input = screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement;
    expect(input.value).toBe("Tester Name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        displayName: "New Name",
        bio: "",
        locationLabel: "",
      }),
    );
    await waitFor(() =>
      expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({ displayName: "New Name" })),
    );
    view.rerender(
      <MemoryRouter>
        <ThemeProvider>
          <Profile />
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Edit name" })).toBeTruthy();
  });

  it("copies the handle on press, with the clipboard as the single write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Copy username @tester" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("@tester"));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("shows Google as linked only when the session says it is", async () => {
    mockReadProviders.mockResolvedValue(new Set(["email", "google"]));
    renderProfile();
    const region = await screen.findByRole("region", { name: "Connected accounts" });
    expect(await within(region).findByText("Connected")).toBeTruthy();
    expect(within(region).getByText(/Google is linked/i)).toBeTruthy();
  });

  it("does not claim Google is linked on an email-only account", async () => {
    renderProfile();
    const region = await screen.findByRole("region", { name: "Connected accounts" });
    expect(await within(region).findByText("Not linked")).toBeTruthy();
    expect(within(region).getByText(/signs in with email and password/i)).toBeTruthy();
  });

  it("shows Telegram status without linking back to the same screen", async () => {
    mockTelegram.mockResolvedValue({ linked: true, phone: null, username: "tester_tg" });
    renderProfile();
    const region = await screen.findByRole("region", { name: "Connected accounts" });
    expect(await within(region).findByText("@tester_tg")).toBeTruthy();
    expect(within(region).queryByRole("link", { name: "Telegram" })).toBeNull();
  });

  it("shows Drive access below the connected accounts and links to Chat backup", async () => {
    mockDrive.mockReturnValue({ available: true, connected: true });
    renderProfile();
    const drive = await screen.findByRole("region", { name: "Drive access" });
    expect(await within(drive).findByText("Connected")).toBeTruthy();
    expect(within(drive).getByRole("link", { name: "Chat backup" }).getAttribute("href")).toBe(
      "/settings/backup",
    );
    const groups = Array.from(document.querySelectorAll(".fb-profile-groups > section"));
    expect(groups.indexOf(drive)).toBeGreaterThan(groups.findIndex((group) => group.getAttribute("aria-labelledby") && group.textContent?.includes("Connected accounts")));
  });

  it("states when Drive backup is not available instead of pretending it is off", async () => {
    renderProfile();
    const drive = await screen.findByRole("region", { name: "Drive access" });
    expect(within(drive).getByText("Unavailable")).toBeTruthy();
    expect(within(drive).getByText(/not set up in this build/i)).toBeTruthy();
  });

  it("shows security controls and devices without a redundant account link", async () => {
    renderProfile();
    expect(screen.getByRole("region", { name: "Sign-in controls" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign-in & security" })).toBeNull();
    const region = await screen.findByRole("region", { name: "Devices" });
    expect(within(region).getByRole("link", { name: "Devices" }).getAttribute("href")).toBe(
      "/settings/devices",
    );
  });

  it("links to the public profile route for the signed-in user", () => {
    renderProfile();
    const link = screen.getByRole("link", { name: /public profile/i });
    expect(link.getAttribute("href")).toBe("/u/tester");
  });

  it("offers a real Verify action when the email is unverified", () => {
    mockUser.value = { ...baseUser, emailVerified: false };
    renderProfile();
    expect(screen.queryByText("Email verified")).toBeNull();
    const links = screen.getAllByRole("link", { name: "Verify email" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe("/verify");
  });

  it("links My reports, Saved reports, Chats, Ratings, Public profile, Settings and Help to their canonical routes", () => {
    renderProfile();
    const nav = screen.getByRole("navigation", { name: "Profile actions" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/my",
      "/saved",
      "/chats",
      "/settings/returns",
      "/u/tester",
      "/settings",
      "/settings/help",
    ]);
    for (const link of links) expect(link.tagName).toBe("A");
    expect(within(nav).getByText("Public profile")).toBeTruthy();
    expect(within(nav).getByText("My reports")).toBeTruthy();
    expect(within(nav).getByText("Chats")).toBeTruthy();
    expect(within(nav).getByText("Saved reports")).toBeTruthy();
    expect(within(nav).getByText("Settings")).toBeTruthy();
    expect(within(nav).getByText("Help & guide")).toBeTruthy();
  });

  it("keeps the mobile number and email out of the public identity hero", async () => {
    renderProfile();
    const identity = await screen.findByRole("region", { name: "Your identity" });
    expect(identity.textContent).not.toMatch(/tester@example\.com|\+10000000000/);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: /log out|sign out/i })).toBeNull();
  });

  it("shows the server-owned reputation label on the own profile", async () => {
    renderProfile();
    const region = await screen.findByRole("region", { name: "Reputation" });
    expect(await within(region).findByText("Trusted")).toBeTruthy();
    expect(trust.fetchReputationTier).toHaveBeenCalledWith("u1");
  });

  it("reaches rating detail from Profile, not from Settings", async () => {
    renderProfile();
    const link = await screen.findByRole("link", { name: /ratings & recoveries/i });
    expect(link.getAttribute("href")).toBe("/settings/returns");
  });

  it("keeps trust honest while loading and when the server refuses", async () => {
    let reject!: (error: Error) => void;
    trust.fetchReputationTier.mockReturnValue(new Promise((_ok, no) => { reject = no; }));
    renderProfile();
    const region = await screen.findByRole("region", { name: "Reputation" });
    expect(within(region).getByRole("status").textContent).toMatch(/checking your reputation/i);
    reject(new Error("offline"));
    expect(await within(region).findByText(/reputation is unavailable right now/i)).toBeTruthy();
    expect(within(region).queryByText(/trusted|established|^new$/i)).toBeNull();
  });
});
