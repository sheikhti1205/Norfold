// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { passwordRecoveryRedirect } from "./auth";

const { native } = vi.hoisted(() => ({ native: { value: false } }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.value,
    getPlatform: () => (native.value ? "android" : "web"),
  },
}));
vi.mock("../utils/reportLinks", () => ({
  publicShareOrigin: () => "https://findbackapp.social",
}));

describe("passwordRecoveryRedirect", () => {
  beforeEach(() => { native.value = false; });

  it("returns the reader to the browser origin they requested the reset from", () => {
    expect(passwordRecoveryRedirect()).toBe(`${window.location.origin}/recovery`);
  });

  it("keeps the canonical public origin on a native shell", () => {
    native.value = true;
    expect(passwordRecoveryRedirect()).toBe("https://findbackapp.social/recovery");
  });
});
