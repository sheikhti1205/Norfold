import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramLink, getTelegramAccount, getTelegramLinkState, unlinkTelegram } from "./telegram";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabaseClient", () => ({ getSupabase: () => ({ rpc }) }));
const token = "0123456789abcdef0123456789abcdef";
const deepLink = `https://t.me/Norfold_auth_bot?start=${token}`;
beforeEach(() => rpc.mockReset());

describe("Telegram RPCs", () => {
  it("validates and returns the expected deep link", async () => {
    rpc.mockResolvedValue({ data: { token, deep_link: deepLink, expires_at: "2026-11-11T12:00:00Z" }, error: null });
    await expect(createTelegramLink()).resolves.toEqual({ token, deepLink, expiresAt: "2026-11-11T12:00:00Z" });
  });
  it.each([null, {}, { token: "bad", deep_link: deepLink, expires_at: "2026-11-11T12:00:00Z" }, { token, deep_link: "https://evil.example/", expires_at: "2026-11-11T12:00:00Z" }, { token, deep_link: deepLink, expires_at: "bad" }])("rejects invalid creation response %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(createTelegramLink()).rejects.toMatchObject({ code: "UNEXPECTED_SHAPE" });
  });
  it("rejects invalid tokens before calling the server", async () => {
    await expect(getTelegramLinkState("bad")).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reads the account and linked phone without expecting an id", async () => {
    rpc.mockResolvedValueOnce({ data: { linked: true, phone: "+880123456789", telegram_username: "reader" }, error: null });
    await expect(getTelegramAccount()).resolves.toEqual({ linked: true, phone: "+880123456789", username: "reader" });
    rpc.mockResolvedValueOnce({ data: { state: "linked", phone: "+880123456789" }, error: null });
    await expect(getTelegramLinkState(token)).resolves.toEqual({ state: "linked", phone: "+880123456789" });
    expect(rpc).toHaveBeenLastCalledWith("findback_telegram_link_state", { p_token: token });
    rpc.mockResolvedValueOnce({ data: { unlinked: true }, error: null });
    await expect(unlinkTelegram()).resolves.toBeUndefined();
  });
  it.each([null, {}, { state: "other", phone: null }, { state: "linked", phone: 7 }])("rejects invalid link state %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getTelegramLinkState(token)).rejects.toMatchObject({ code: "UNEXPECTED_SHAPE" });
  });
  it.each([null, {}, { linked: true, phone: 7, telegram_username: null }, { linked: true, phone: null, telegram_username: 7 }])("rejects invalid account state %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getTelegramAccount()).rejects.toMatchObject({ code: "UNEXPECTED_SHAPE" });
  });
  it.each([null, {}, { unlinked: false }])("rejects invalid unlink result %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(unlinkTelegram()).rejects.toMatchObject({ code: "UNEXPECTED_SHAPE" });
  });
});
