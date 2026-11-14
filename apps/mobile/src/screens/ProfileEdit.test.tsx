// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@norfold/shared";

const {
  mockSendPhone,
  mockVerifyPhone,
  mockUpdateProfile,
  mockSetUser,
  mockUser,
} = vi.hoisted(() => ({
  mockSendPhone: vi.fn(),
  mockVerifyPhone: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockSetUser: vi.fn(),
  mockUser: {
    value: null as PublicUser | null,
  },
}));

vi.mock("../auth", () => ({
  useAuth: () => ({
    user: mockUser.value,
    setUser: mockSetUser,
  }),
}));

vi.mock("../services/auth", () => ({
  sendPhoneChangeCode: mockSendPhone,
  verifyPhoneChangeCode: mockVerifyPhone,
}));
vi.mock("../services/profile", () => ({ updateMyProfile: mockUpdateProfile }));

import { ProfileEdit } from "./ProfileEdit";
import { ApiError } from "../services/session";

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

function renderEdit() {
  return render(
    <MemoryRouter>
      <ProfileEdit />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.value = { ...baseUser };
  mockSendPhone.mockResolvedValue(undefined);
  mockVerifyPhone.mockResolvedValue({
    ...baseUser,
    phone: "+8801912345678",
    phoneVerified: true,
  });
  mockUpdateProfile.mockResolvedValue({ ...baseUser, displayName: "New Tester", bio: "hi", locationLabel: "Dhaka" });
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

  it("offers editable display name, bio, location and mobile fields", () => {
    renderEdit();
    expect(screen.getByRole("textbox", { name: /display name/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /bio/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /location/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /mobile/i })).toBeTruthy();
  });

  it("shows a live bio character count against the 280 limit", () => {
    renderEdit();
    expect(screen.getByText("0/280")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), { target: { value: "hello" } });
    expect(screen.getByText("5/280")).toBeTruthy();
  });

  it("states that a number change is saved only after the code is confirmed", () => {
    renderEdit();
    expect(screen.queryByText(/isn't available in this build/i)).toBeNull();
    expect(screen.getByText(/saved only after the code is confirmed/i)).toBeTruthy();
    expect(screen.getByText("Not verified")).toBeTruthy();
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

  it("rejects an invalid number without asking the server for a code", () => {
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /mobile/i }), {
      target: { value: "not-a-number" },
    });
    expect(screen.getByText(/valid Bangladesh mobile number/i)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send code" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(mockSendPhone).not.toHaveBeenCalled();
    expect(mockVerifyPhone).not.toHaveBeenCalled();
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("sends a code to the typed number and waits for it before writing anything", async () => {
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /mobile/i }), {
      target: { value: "01912345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(mockSendPhone).toHaveBeenCalledWith("u1", "+8801912345678", false));
    expect((await screen.findByRole("status")).textContent).toContain("+8801912345678");
    expect(screen.getByRole("textbox", { name: "SMS code" })).toBeTruthy();
    // The number is not stored, and no verification is claimed, by sending.
    expect(mockSetUser).not.toHaveBeenCalled();
    expect(mockVerifyPhone).not.toHaveBeenCalled();
    // The destination cannot drift while its code is pending.
    expect((screen.getByRole("textbox", { name: /mobile/i }) as HTMLInputElement).disabled).toBe(true);
  });

  it("verifies the SMS code before storing the new number", async () => {
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /mobile/i }), {
      target: { value: "01912345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByRole("textbox", { name: "SMS code" });
    fireEvent.change(screen.getByRole("textbox", { name: "SMS code" }), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify number" }));
    await waitFor(() => expect(mockVerifyPhone).toHaveBeenCalledWith("u1", "+8801912345678", "123456"));
    await waitFor(() =>
      expect(mockSetUser).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "+8801912345678", phoneVerified: true }),
      ),
    );
    expect(await screen.findByText("Mobile number verified.")).toBeTruthy();
  });

  it("shows the server's replacement-gate sentence when a change is held", async () => {
    mockSendPhone.mockRejectedValueOnce(
      new ApiError("You cannot change your mobile number yet. Try again later.", 409),
    );
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /mobile/i }), {
      target: { value: "01912345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You cannot change your mobile number yet. Try again later.",
    );
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("surfaces send failures as human copy in a live alert", async () => {
    mockSendPhone.mockRejectedValueOnce(new Error("Network request failed"));
    renderEdit();
    fireEvent.change(screen.getByRole("textbox", { name: /mobile/i }), {
      target: { value: "01912345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/network problem|could not|try again/i);
    expect(alert.textContent).not.toContain("Network request failed");
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no signed-in user", () => {
    mockUser.value = null;
    const { container } = renderEdit();
    expect(container.textContent).toBe("");
  });
});
