// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, pendingMock, servicesMock, telegramMock, browserMock } = vi.hoisted(() => ({
  authMock: {
    user: null as null | Record<string, unknown>,
    booting: false,
    pendingEmail: null as null | string,
    pendingEmailDeadline: 0,
    verifyPendingEmail: vi.fn(),
    resendPendingEmail: vi.fn(),
    refreshUser: vi.fn(),
    setUser: vi.fn(),
  },
  pendingMock: { getPendingReportRoute: vi.fn((): string | null => null) },
  servicesMock: {
    sendPendingEmailCode: vi.fn(),
    verifyPendingEmailCode: vi.fn(),
  },
  telegramMock: {
    account: vi.fn(),
    create: vi.fn(),
    state: vi.fn(),
  },
  browserMock: { open: vi.fn() },
}));

vi.mock("../auth", () => ({ useAuth: () => authMock }));
vi.mock("../services/auth", () => servicesMock);
vi.mock("../services/telegram", () => ({
  getTelegramAccount: (...args: unknown[]) => telegramMock.account(...args),
  createTelegramLink: (...args: unknown[]) => telegramMock.create(...args),
  getTelegramLinkState: (...args: unknown[]) => telegramMock.state(...args),
  TELEGRAM_BOT_URL: "https://t.me/Norfold_auth_bot",
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: (...args: unknown[]) => browserMock.open(...args) } }));
vi.mock("../utils/pendingReportLink", () => pendingMock);

import { Verify } from "./Verify";

const TOKEN = "0123456789abcdef0123456789abcdef";
const UNLINKED = { linked: false, phone: null, username: null };
const VERIFIED = { linked: true, phone: "+8801812345678", username: "reader" };

function renderVerify(path = "/verify") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify" element={<Verify />} />
        <Route path="/signin" element={<p>Sign in destination</p>} />
        <Route path="/auth" element={<p>Auth gateway destination</p>} />
        <Route path="/posts/:id" element={<p>Shared report destination</p>} />
        <Route path="/" element={<p>Home destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  authMock.user = null;
  authMock.pendingEmail = null;
  authMock.pendingEmailDeadline = 0;
  authMock.verifyPendingEmail.mockReset();
  authMock.resendPendingEmail.mockReset();
  authMock.refreshUser.mockReset();
  servicesMock.sendPendingEmailCode.mockReset();
  servicesMock.verifyPendingEmailCode.mockReset();
  authMock.setUser.mockReset();
  pendingMock.getPendingReportRoute.mockReset();
  pendingMock.getPendingReportRoute.mockReturnValue(null);
  telegramMock.account.mockReset().mockResolvedValue(UNLINKED);
  telegramMock.create.mockReset().mockResolvedValue({
    token: TOKEN,
    deepLink: `https://t.me/Norfold_auth_bot?start=${TOKEN}`,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  telegramMock.state.mockReset().mockResolvedValue({ state: "pending", phone: null });
  browserMock.open.mockReset().mockResolvedValue(undefined);
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Verify pending-signup mode (no session yet)", () => {
  const pending = { pendingEmail: "new@example.com" };

  beforeEach(() => {
    authMock.pendingEmail = pending.pendingEmail;
  });

  it("shows a clear heading, the destination email, and one accessible code input", () => {
    renderVerify();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByText("new@example.com")).toBeTruthy();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
  });

  it("routes a successful verification to the pending report destination", async () => {
    pendingMock.getPendingReportRoute.mockReturnValue("/posts/abc123");
    authMock.verifyPendingEmail.mockResolvedValue({ id: "u1" });
    renderVerify();
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(authMock.verifyPendingEmail).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(screen.getByText("Shared report destination")).toBeTruthy());
  });

  it("accepts an eight-digit signup code unchanged", async () => {
    authMock.verifyPendingEmail.mockResolvedValue({ id: "u1" });
    renderVerify();
    const input = screen.getByLabelText("Verification code") as HTMLInputElement;
    expect(input.maxLength).toBe(10);
    fireEvent.change(input, { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(authMock.verifyPendingEmail).toHaveBeenCalledWith("12345678"));
  });

  it("announces resend status without leaving the screen", async () => {
    authMock.resendPendingEmail.mockResolvedValue(undefined);
    vi.useFakeTimers();
    renderVerify();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(authMock.resendPendingEmail).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toBeTruthy();
    // Still on verify: the code input is intact.
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
  });

  it("restores the original pending deadline on remount", async () => {
    vi.useFakeTimers();
    authMock.pendingEmailDeadline = Date.now() + 120_000;
    const view = renderVerify();
    expect((screen.getByRole("button", { name: "Resend in 120s" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    view.unmount();
    renderVerify();
    expect((screen.getByRole("button", { name: "Resend in 75s" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000); });
    expect((screen.getByRole("button", { name: "Resend code" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers Back and a change-email exit that preserve backend behavior", () => {
    renderVerify();
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeTruthy();
    expect(back.className).toContain("min-h-[48px]");
    expect(back.className).toContain("min-w-[48px]");
    const change = screen.getByRole("link", { name: /different email/i });
    expect(change.getAttribute("href")).toBe("/auth");
    expect(change.className).toContain("min-h-[48px]");
  });

  it("keeps backend OTP errors verbatim and preserves the typed code", async () => {
    authMock.verifyPendingEmail.mockRejectedValue(new Error("Invalid or expired verification code"));
    renderVerify();
    const input = screen.getByLabelText("Verification code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() =>
      expect(screen.getByText("Invalid or expired verification code")).toBeTruthy(),
    );
    expect((screen.getByLabelText("Verification code") as HTMLInputElement).value).toBe("000000");
  });
});

describe("Verify signed-in mode", () => {
  beforeEach(() => {
    authMock.user = {
      id: "u1",
      username: "someone",
      email: "me@example.com",
      phone: "01812345678",
      emailVerified: false,
      phoneVerified: false,
    };
  });

  it("shows the destination email with resend status and a pending-aware continue", async () => {
    pendingMock.getPendingReportRoute.mockReturnValue("/posts/abc123");
    servicesMock.sendPendingEmailCode.mockResolvedValue(undefined);
    renderVerify();
    expect(screen.getByText("me@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send email code" }));
    await waitFor(() => expect(servicesMock.sendPendingEmailCode).toHaveBeenCalled());
    expect(screen.getByRole("status")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue to app" }));
    await waitFor(() => expect(screen.getByText("Shared report destination")).toBeTruthy());
  });

  it("offers Telegram phone verification and never an SMS code", async () => {
    renderVerify();
    await flush();
    expect(screen.getByRole("button", { name: "Verify with Telegram" })).toBeTruthy();
    expect(screen.getByText(/not text messages/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /SMS/i })).toBeNull();
    expect(screen.queryByLabelText(/SMS code/i)).toBeNull();
  });

  it("starts the Telegram link and shows the own-contact instructions", async () => {
    renderVerify();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Verify with Telegram" }));
    await waitFor(() => expect(telegramMock.create).toHaveBeenCalledTimes(1));
    expect(browserMock.open).toHaveBeenCalledWith({
      url: `https://t.me/Norfold_auth_bot?start=${TOKEN}`,
    });
    expect(await screen.findByText(/Open Telegram and press Start/i)).toBeTruthy();
    expect(screen.getByText(/Share my number/i)).toBeTruthy();
    expect(screen.getByText(/typed number does not verify/i)).toBeTruthy();
  });

  it("reflects a Telegram-verified number from the server", async () => {
    telegramMock.account.mockResolvedValue(VERIFIED);
    renderVerify();
    expect(await screen.findByText("Mobile number verified with Telegram")).toBeTruthy();
    expect(screen.getByText("+8801812345678")).toBeTruthy();
    expect(screen.getByText("@reader")).toBeTruthy();
  });

  it("leaves the number unverified when Telegram cannot be checked", async () => {
    telegramMock.account.mockRejectedValue(new Error("offline"));
    renderVerify();
    expect(await screen.findByText(/could not check Telegram/i)).toBeTruthy();
    expect(screen.queryByText("Mobile number verified with Telegram")).toBeNull();
    expect(screen.getByText(/stays unverified/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /SMS/i })).toBeNull();
  });

  it("shows connected but unverified until the reader shares a contact", async () => {
    telegramMock.account.mockResolvedValue({ linked: true, phone: null, username: "reader" });
    renderVerify();
    expect(await screen.findByText(/Telegram is connected as @reader/i)).toBeTruthy();
    expect(screen.getByText(/Share my number/i)).toBeTruthy();
    expect(screen.queryByText("Mobile number verified with Telegram")).toBeNull();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("reports honestly when the email is not verified yet", async () => {
    telegramMock.create.mockRejectedValue(new Error("verify your email first"));
    renderVerify();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Verify with Telegram" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Verify your email first");
    expect(browserMock.open).not.toHaveBeenCalled();
  });

  it("updates to verified after the bot link is consumed and a contact arrives", async () => {
    vi.useFakeTimers();
    try {
      telegramMock.account
        .mockResolvedValueOnce(UNLINKED)
        .mockResolvedValue(VERIFIED);
      telegramMock.state
        .mockResolvedValueOnce({ state: "pending", phone: null })
        .mockResolvedValueOnce({ state: "linked", phone: VERIFIED.phone });
      renderVerify();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      fireEvent.click(screen.getByRole("button", { name: "Verify with Telegram" }));
      // Let the click's state update commit so the polling effect (and its
      // timer) exists before the clock advances.
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText(/Open Telegram and press Start/i)).toBeTruthy();
      // Poll 1 (3s) still sees the pending token; poll 2 (6s) sees it consumed.
      await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
      expect(telegramMock.state).toHaveBeenCalled();
      expect(screen.getByText("Mobile number verified with Telegram")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
