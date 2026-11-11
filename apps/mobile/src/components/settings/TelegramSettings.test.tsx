// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramSettings } from "./TelegramSettings";

const mocks = vi.hoisted(() => ({ account: vi.fn(), create: vi.fn(), state: vi.fn(), unlink: vi.fn(), open: vi.fn() }));
vi.mock("../../services/telegram", () => ({ getTelegramAccount: mocks.account, createTelegramLink: mocks.create, getTelegramLinkState: mocks.state, unlinkTelegram: mocks.unlink }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.open } }));
const token = "0123456789abcdef0123456789abcdef";
const unlinked = { linked: false, phone: null, username: null };
const linked = { linked: true, phone: "+880123456789", username: "reader" };
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function start() { render(<TelegramSettings />); await flush(); fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" })); await flush(); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  vi.clearAllMocks();
  mocks.account.mockResolvedValue(unlinked);
  mocks.create.mockResolvedValue({ token, deepLink: `https://t.me/Norfold_auth_bot?start=${token}`, expiresAt: "2026-11-11T12:10:00Z" });
  mocks.state.mockResolvedValue({ state: "pending", phone: null });
  mocks.open.mockResolvedValue(undefined); mocks.unlink.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Telegram settings", () => {
  it("keeps the action hidden while loading and shows an existing account", async () => {
    mocks.account.mockResolvedValue(linked);
    render(<TelegramSettings />);
    expect(screen.getByText("Connect Telegram")).toBeTruthy();
    expect(screen.queryByText(/checking/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
    await flush();
    expect(screen.getByText("Connected as @reader")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
  });
  it("offers retry when account lookup fails", async () => {
    mocks.account.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(unlinked);
    render(<TelegramSettings />); await flush();
    expect(screen.getByText("Could not check your Telegram connection.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry Telegram" })); await flush();
    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeTruthy();
  });
  it("opens a connection, counts down and shows the linked phone", async () => {
    mocks.state.mockResolvedValueOnce({ state: "pending", phone: null }).mockResolvedValueOnce({ state: "linked", phone: linked.phone });
    mocks.account.mockResolvedValueOnce(unlinked).mockResolvedValueOnce(linked);
    await start();
    expect(screen.getByText(/Open Telegram and press Start/)).toBeTruthy();
    expect(screen.getByText(/10:00/)).toBeTruthy();
    await advance(3000); expect(screen.getByText(/9:57/)).toBeTruthy();
    await advance(3000); expect(screen.getByText(linked.phone)).toBeTruthy();
    expect(screen.getByText("Connected as @reader")).toBeTruthy();
  });
  it("expires and stops checking", async () => {
    await start(); await advance(600000);
    expect(screen.getByText(/expired/i)).toBeTruthy();
    const count = mocks.state.mock.calls.length; await advance(60000); expect(mocks.state).toHaveBeenCalledTimes(count);
  });
  it("confirms unlinking and explains the session remains signed in", async () => {
    mocks.account.mockResolvedValue(linked); render(<TelegramSettings />); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(screen.getByText(/does not sign you out/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm unlink" })); await flush();
    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeTruthy();
  });
  it("backs off after a failed check", async () => {
    mocks.state.mockRejectedValueOnce(new Error("offline")); await start(); await advance(3000);
    expect(screen.getByText(/could not check/i)).toBeTruthy();
    await advance(3000); expect(mocks.state).toHaveBeenCalledTimes(1);
    await advance(3000); expect(mocks.state).toHaveBeenCalledTimes(2);
  });
  it("stops timers on unmount", async () => {
    const view = render(<TelegramSettings />); await flush(); fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" })); await flush();
    view.unmount(); await advance(12000); expect(mocks.state).not.toHaveBeenCalled();
  });
  it("cancels waiting and stops checking", async () => {
    await start(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeTruthy();
    await advance(12000); expect(mocks.state).not.toHaveBeenCalled();
  });
});
