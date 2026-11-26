// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicUser } from "@norfold/shared";
import { SignedOutEntry } from "./RememberedAccounts";
import { rememberAccount } from "../services/rememberedAccounts";

const USER: PublicUser = {
  id: "u1",
  username: "route-tester",
  email: "routes@test.example",
  phone: "+15550001111",
  emailVerified: true,
  phoneVerified: false,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => { cleanup(); localStorage.clear(); });

describe("remembered accounts touch targets", () => {
  it("keeps the row, remove and switch controls at 48px minimum", () => {
    expect(rememberAccount(USER)).toBe(true);
    render(<MemoryRouter><SignedOutEntry /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Continue as route-tester, @route-tester" }).className).toContain("min-h-14");
    const remove = screen.getByRole("button", { name: "Remove route-tester, @route-tester from this device" });
    expect(remove.className).toContain("h-12");
    expect(remove.className).toContain("w-12");
    expect(screen.getByRole("button", { name: "Use another account" }).className).toContain("min-h-[48px]");
  });
});
