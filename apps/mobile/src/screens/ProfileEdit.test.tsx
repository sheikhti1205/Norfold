// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@norfold/shared";

const {
  mockUpdateProfile,
  mockSetUser,
  mockUser,
  telegramMock,
  browserMock,
} = vi.hoisted(() => ({
  mockUpdateProfile: vi.fn(),
  mockSetUser: vi.fn(),
  mockUser: {
    value: null as PublicUser | null,
  },
  telegramMock: { account: vi.fn(), create: vi.fn(), state: vi.fn() },
  browserMock: { open: vi.fn() },
}));

vi.mock("../auth", () => ({
  useAuth: () => ({
    user: mockUser.value,
    setUser: mockSetUser,
  }),
}));

vi.mock("../services/profile", () => ({ updateMyProfile: mockUpdateProfile }));
vi.mock("../services/telegram", () => ({
  getTelegramAccount: (...args: unknown[]) => telegramMock.account(...args),
  createTelegramLink: (...args: unknown[]) => telegramMock.create(...args),
  getTelegramLinkState: (...args: unknown[]) => telegramMock.state(...args),
  TELEGRAM_BOT_URL: "https://t.me/Norfold_auth_bot",
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: (...args: unknown[]) => browserMock.open(...args) } }));

import { ProfileEdit } from "./ProfileEdit";

const baseUser: PublicUser = {
  id: "u1",
  username: "tester",
  email: "tester@example.com",
  phone: "+8801812345678",
  emailVerified: true,
  phoneVerified: false,
  avatarUrl: null,
  displayName: "Tester",
  bio: null,
  locationLabel: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TOKEN = "0123456789abcdef0123456789abcdef";

function renderEdit() {
  return render(
    <MemoryRouter>
      <ProfileEdit />
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.value = { ...baseUser };
  mockUpdateProfile.mockResolvedValue({ ...baseUser, displayName: "New Tester", bio: "hi", locationLabel: "Dhaka" });
  telegramMock.account.mockReset().mockResolvedValue({ linked: false, phone: null, username: null });
  telegramMock.create.mockReset().mockResolvedValue({
    token: TOKEN,
    deepLink: `https://t.me/Norfold_auth_bot?start=${TOKEN}`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  telegramMock.state.mockReset().mockResolvedValue({ state: "pending", phone: null });
  browserMock.open.mockReset().mockResolvedValue(undefined);
});

describe("ProfileEdit rework", () => {
  it("renders one heading with a back link to the profile hub", () => {
    renderEdit();
    expect(screen.getByRole("heading", { level: 1, name: "Edit profile" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Back to Profile" })).toBeTruthy();
  });

  it("keeps username and email read-only information, not editable inputs", () => {
    renderEdit();
    expect(screen.getByText("@tester")).toBeTruthy();
    expect(screen.getByText("tester@example.com")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /username/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /email/i })).toBeNull();
  });

  it("offers editable display name, bio and location fields", () => {
    renderEdit();
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /bio/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /location/i })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /mobile/i })).toBeNull();
  });

  it("shows a live bio character count against the 280 limit", () => {
    renderEdit();
    expect(screen.getByText("0/280")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), { target: { value: "hello" } });
    expect(screen.getByText("5/280")).toBeTruthy();
  });

  it("says phone verification happens in Telegram and never promises SMS", async () => {
    renderEdit();
    await flush();
    expect(screen.getByText(/does not send text messages/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify with Telegram" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /mobile/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /SMS code/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Send code/i })).toBeNull();
  });

  it("shows the server-verified number and badge", async () => {
    telegramMock.account.mockResolvedValue({ linked: true, phone: "+8801912345678", username: "reader" });
    renderEdit();
    expect(await screen.findByText("Mobile number verified with Telegram")).toBeTruthy();
    expect(screen.getByText("+8801912345678")).toBeTruthy();
    expect(screen.getByText("@reader")).toBeTruthy();
  });

  it("starts the existing Telegram bot link flow", async () => {
    renderEdit();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Verify with Telegram" }));
    await waitFor(() => expect(telegramMock.create).toHaveBeenCalledTimes(1));
    expect(browserMock.open).toHaveBeenCalledWith({
      url: `https://t.me/Norfold_auth_bot?start=${TOKEN}`,
    });
    expect(await screen.findByText(/Open Telegram and press Start/i)).toBeTruthy();
  });

  it("leaves the saved number unverified when Telegram cannot be checked", async () => {
    telegramMock.account.mockRejectedValue(new Error("offline"));
    renderEdit();
    expect(await screen.findByText(/could not check Telegram/i)).toBeTruthy();
    expect(screen.getByText(/Not verified/)).toBeTruthy();
    expect(screen.queryByText("Mobile number verified with Telegram")).toBeNull();
  });

  it("saves identity fields via updateMyProfile and reflects the refreshed user", async () => {
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /display name/i }), {
      target: { value: "New Tester" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), { target: { value: "hi" } });
    fireEvent.change(screen.getByRole("textbox", { name: /location/i }), {
      target: { value: "Dhaka" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        displayName: "New Tester",
        bio: "hi",
        locationLabel: "Dhaka",
      }),
    );
    await waitFor(() =>
      expect(mockSetUser).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "New Tester", locationLabel: "Dhaka" }),
      ),
    );
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("replaces the draft on account change and ignores an earlier save", async () => {
    let resolveSave!: (value: PublicUser) => void;
    mockUpdateProfile.mockReturnValueOnce(new Promise<PublicUser>((resolve) => { resolveSave = resolve; }));
    const view = renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /display name/i }), { target: { value: "Old draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    mockUser.value = { ...baseUser, id: "u2", displayName: "Second account" };
    view.rerender(<MemoryRouter><ProfileEdit /></MemoryRouter>);
    expect((screen.getByRole("textbox", { name: /display name/i }) as HTMLInputElement).value).toBe("Second account");
    resolveSave({ ...baseUser, displayName: "Old draft" });
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("keeps the identity save disabled until something changes", () => {
    renderEdit();
    const save = screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /display name/i }), {
      target: { value: "Changed" },
    });
    expect(save.disabled).toBe(false);
  });

  it("refuses a blank display name without calling the backend", async () => {
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /display name/i }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText(/enter a display name/i)).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it("surfaces identity save failures as human copy, never raw errors", async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error("Network request failed"));
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /display name/i }), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not save/i);
    expect(alert.textContent).not.toContain("Network request failed");
  });

  it("renders nothing when there is no signed-in user", () => {
    mockUser.value = null;
    const { container } = renderEdit();
    expect(container.textContent).toBe("");
  });
});
