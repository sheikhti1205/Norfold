// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAccountIntentAccount, beginAddAccountIntent, clearAddAccountIntent } from "./addAccountIntent";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe("add-account intent", () => {
  it("remembers which account must stay signed in", () => {
    beginAddAccountIntent("u1");
    expect(addAccountIntentAccount()).toBe("u1");
  });

  it("is cleared by cancel or by a different account finishing sign-in", () => {
    beginAddAccountIntent("u1");
    clearAddAccountIntent();
    expect(addAccountIntentAccount()).toBeNull();
  });

  it("expires instead of turning a later auth visit into an add-account screen", () => {
    vi.useFakeTimers();
    beginAddAccountIntent("u1");
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(addAccountIntentAccount()).toBeNull();
  });

  it("ignores malformed storage", () => {
    sessionStorage.setItem("findback.addAccountIntent", "{not json");
    expect(addAccountIntentAccount()).toBeNull();
  });
});
