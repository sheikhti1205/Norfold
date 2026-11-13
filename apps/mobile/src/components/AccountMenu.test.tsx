// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AccountMenu } from "./AccountMenu";

const state = vi.hoisted(() => ({
  logout: vi.fn(),
  accounts: [] as { id: string; username: string; displayName: string; maskedEmail: string; loginEmail: string; lastUsedAt: number }[],
}));
vi.mock("../auth", () => ({ useAuth: () => ({
  user: { id: "1", username: "riley", displayName: "Riley", emailVerified: true },
  logout: state.logout,
}) }));
vi.mock("../services/rememberedAccounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/rememberedAccounts")>();
  return {
    ...actual,
    readRememberedAccounts: () => state.accounts,
    subscribeRememberedAccounts: () => () => {},
  };
});

const other = {
  id: "2", username: "sam", displayName: "Sam", maskedEmail: "s.@example.com",
  loginEmail: "sam@example.com", lastUsedAt: 1,
};
const onOpenSettings = vi.fn();

beforeEach(() => { state.accounts = []; onOpenSettings.mockReset(); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderMenu() { render(<MemoryRouter><AccountMenu onOpenSettings={onOpenSettings} /></MemoryRouter>); }
async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account, Riley" }));
  return screen.findByRole("dialog", { name: "Account" });
}

describe("account menu", () => {
  it("is one control carrying the avatar, name, handle and badge", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Account, Riley" });
    expect(trigger.textContent).toContain("Riley");
    expect(trigger.textContent).toContain("@riley");
    expect(within(trigger).getByRole("img", { name: "Email verified" })).toBeTruthy();
    // The separate gear is gone: settings is reached from inside the popover.
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("leads with the identity and orders the rows Personalization, Activity preferences, Settings, Report, Help, Log out", async () => {
    renderMenu();
    const dialog = await openMenu();
    const rows = Array.from(dialog.querySelectorAll(".fb-account-row"))
      .map((node) => node.textContent?.replace(/\s+/g, " ").trim());
    expect(rows[0]).toContain("Riley");
    expect(rows.slice(1)).toEqual([
      "Personalization",
      "Activity preferences",
      "Settings",
      "Report a problem",
      "Help",
      "Log out",
    ]);
    expect(within(dialog).getByRole("link", { name: /Activity preferences/ }).getAttribute("href")).toBe("/settings/notifications");
    expect(within(dialog).getByRole("link", { name: /Report a problem/ }).getAttribute("href")).toBe("/settings/feedback");
    expect(within(dialog).getByRole("link", { name: /Help/ }).getAttribute("href")).toBe("/settings/help");
    // Saved is a rail destination; Saved/Appearance are no longer menu rows.
    expect(within(dialog).queryByRole("link", { name: /Saved/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Appearance$/ })).toBeNull();
  });

  it("opens Personalization in the card, with the real theme, accent and navigation controls", async () => {
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Personalization/ }));
    const panel = await within(dialog).findByRole("group", { name: "Personalization" });
    expect(within(panel).getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(within(panel).getByRole("group", { name: "Accent" })).toBeTruthy();
    expect(within(panel).getAllByRole("radio")).toHaveLength(5);
    expect(within(panel).getByRole("button", { name: /Open Personalization/ })).toBeTruthy();
    // The rows are replaced, not painted beside: no Settings row while the panel is open.
    expect(within(dialog).queryByRole("button", { name: /^Settings$/ })).toBeNull();
  });

  it("opens the floating settings window from the Settings row instead of a nested option list", async () => {
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Settings$/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Account" })).toBeNull());
  });

  it("opens the account switcher from the identity row and marks the current account", async () => {
    state.accounts = [other];
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Riley/ }));
    const panel = await within(dialog).findByRole("group", { name: "Switch account" });
    expect(within(panel).getByText("Current")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /Switch to Sam/ })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /Add another account/ })).toBeTruthy();
  });

  it("keeps the account being left when switching", async () => {
    state.logout.mockResolvedValue(undefined);
    state.accounts = [other];
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Riley/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Switch to Sam/ }));
    await waitFor(() => expect(state.logout).toHaveBeenCalledWith({ keepAccount: true }));
  });

  it("Escape closes the open panel before the popover", async () => {
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Personalization/ }));
    await within(dialog).findByRole("group", { name: "Personalization" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Personalization" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Account" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Settings$/ })).toBeTruthy();
  });

  it("confirms logout once even if confirmation is pressed twice", async () => {
    state.logout.mockImplementation(() => new Promise(() => {}));
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Log out/ }));
    const confirm = await screen.findByRole("alertdialog");
    const button = within(confirm).getByRole("button", { name: "Log out" });
    fireEvent.click(button); fireEvent.click(button);
    expect(state.logout).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation open when logout fails", async () => {
    state.logout.mockRejectedValueOnce(new Error("failure"));
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Log out/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Log out" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not log out. Please try again.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
