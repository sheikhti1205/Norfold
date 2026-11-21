// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@norfold/shared";

const { mockSetUser, mockUpdateProfile, mockReadProviders, mockTelegram } = vi.hoisted(() => ({
  mockSetUser: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockReadProviders: vi.fn(),
  mockTelegram: vi.fn(),
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
  AccountSecuritySections: () => <section id="profile-telegram-settings" tabIndex={-1} aria-label="Sign-in controls">Password sign-in</section>,
  MobileNumberRow: ({ onManage }: { onManage: () => void }) => (
    <button onClick={onManage} className="fb-settings-row fb-profile-account-row">
      <span className="fb-settings-row-title">Mobile number</span>
    </button>
  ),
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
    expect(screen.getByRole("button", { name: "Verify mobile" })).toBeTruthy();
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
    expect(within(region).queryByText("Not linked")).toBeNull();
  });

  it("does not claim Google is linked on an email-only account", async () => {
    renderProfile();
    const region = await screen.findByRole("region", { name: "Connected accounts" });
    expect(await within(region).findByText("Not linked")).toBeTruthy();
    expect(within(region).queryByText("Connected")).toBeNull();
  });

  it("shows Telegram status and focuses its existing controls", async () => {
    mockTelegram.mockResolvedValue({ linked: true, phone: null, username: "tester_tg" });
    renderProfile();
    const region = await screen.findByRole("region", { name: "Connected accounts" });
    expect(await within(region).findByText("@tester_tg")).toBeTruthy();
    const target = screen.getByRole("region", { name: "Sign-in controls" });
    target.scrollIntoView = vi.fn();
    fireEvent.click(within(region).getByRole("button", { name: "Telegram" }));
    expect(document.activeElement).toBe(target);
  });

  it("marks the mobile chip verified only from the Telegram account state", async () => {
    mockTelegram.mockResolvedValue({ linked: true, phone: "+8801912345678", username: "tester_tg" });
    renderProfile();
    expect(await screen.findByText("Mobile verified")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify mobile" })).toBeNull();
  });

  it("keeps the action label Verify mobile when Telegram has no number", async () => {
    mockTelegram.mockResolvedValue({ linked: true, phone: null, username: "tester_tg" });
    renderProfile();
    const action = await screen.findByRole("button", { name: "Verify mobile" });
    const target = screen.getByRole("region", { name: "Sign-in controls" });
    target.scrollIntoView = vi.fn();
    fireEvent.click(action);
    expect(document.activeElement).toBe(target);
    expect(screen.queryByText("Add mobile")).toBeNull();
  });

  it("keeps chat-owned controls out of Profile", () => {
    renderProfile();
    // Contact rules, auto-connect and backup belong to Chat. Profile is
    // identity and sign-in security, so it must not repeat them.
    expect(screen.queryByRole("region", { name: "Drive access" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Chat backup" })).toBeNull();
    expect(screen.queryByText(/contact rules/i)).toBeNull();
    expect(screen.queryByText(/who can message you/i)).toBeNull();
  });

  it("keeps the email address on one line", () => {
    renderProfile();
    const region = screen.getByRole("region", { name: "Connected accounts" });
    const label = within(region).getByText("Email");
    const row = label.closest(".fb-settings-row");
    expect(row).toBeTruthy();
    // One-line rows replaced the old wrapped address block.
    expect(row!.classList.contains("fb-profile-email-row")).toBe(false);
    expect(within(region).getByText("tester@example.com").getAttribute("title")).toBe("tester@example.com");
    // Every connected row carries the hook the phone-width one-line override
    // targets, so a future row cannot silently fall back to the wrapped layout.
    for (const title of ["Google", "Email", "Mobile number", "Telegram"]) {
      const accountRow = within(region).getByText(title).closest(".fb-settings-row");
      expect(accountRow?.classList.contains("fb-profile-account-row"), title).toBe(true);
    }
  });

  it("shows security controls without redundant account and device links", () => {
    renderProfile();
    expect(screen.getByRole("region", { name: "Sign-in controls" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign-in & security" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Devices" })).toBeNull();
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

  it("keeps the public profile action without repeating primary navigation", () => {
    renderProfile();
    const nav = screen.getByRole("navigation", { name: "Profile actions" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/u/tester",
    ]);
    for (const link of links) expect(link.tagName).toBe("A");
    expect(within(nav).getByText("Public profile")).toBeTruthy();
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
