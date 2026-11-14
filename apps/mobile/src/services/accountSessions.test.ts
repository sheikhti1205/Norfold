// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearAccountSessions, readAccountSession, removeAccountSession, saveAccountSession } from "./accountSessions";

const session = { accountId: "a", access_token: "access", refresh_token: "refresh", expires_at: 123 };

describe("account sessions", () => {
  beforeEach(() => localStorage.clear());

  it("saves, replaces and removes sessions independently", () => {
    saveAccountSession(session);
    saveAccountSession({ ...session, accountId: "b" });
    saveAccountSession({ ...session, refresh_token: "new" });
    expect(readAccountSession("a")?.refresh_token).toBe("new");
    removeAccountSession("a");
    expect(readAccountSession("a")).toBeNull();
    expect(readAccountSession("b")).toEqual({ ...session, accountId: "b" });
    clearAccountSessions();
    expect(readAccountSession("b")).toBeNull();
  });

  it("rejects malformed and excess entries without overwriting saved sessions", () => {
    for (let i = 0; i < 6; i++) saveAccountSession({ ...session, accountId: String(i) });
    expect(() => saveAccountSession({ ...session, accountId: "extra" })).toThrow();
    expect(readAccountSession("0")).not.toBeNull();
    localStorage.setItem("findback.accountSessions", "not json");
    expect(() => saveAccountSession(session)).toThrow();
  });
});
