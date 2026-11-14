// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { AccountMenu } from "./AccountMenu";
import { addAccountIntentAccount } from "../utils/addAccountIntent";
import { peekAuthReturnTo } from "../utils/authReturnTo";

const state = vi.hoisted(() => ({
  logout: vi.fn(),
  switchAccount: vi.fn(),
  setAccountKept: vi.fn(),
  accounts: [] as { id: string; username: string; displayName: string; maskedEmail: string; loginEmail: string; lastUsedAt: number }[],
}));
vi.mock("../auth", () => ({ useAuth: () => ({
  user: { id: "1", username: "riley", displayName: "Riley", emailVerified: true },
  logout: state.logout,
  switchAccount: state.switchAccount,
  setAccountKept: state.setAccountKept,
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

beforeEach(() => { state.accounts = []; onOpenSettings.mockReset(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname}{l.search}</output>;
}
function renderMenu() {
  render(<MemoryRouter><LocationProbe /><AccountMenu onOpenSettings={onOpenSettings} /></MemoryRouter>);
}
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
    expect(within(dialog).getByRole("button", { name: /Activity preferences/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Report a problem/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Help$/ })).toBeTruthy();
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
    fireEvent.click(within(panel).getByRole("button", { name: /Open Personalization/ }));
    expect(onOpenSettings).toHaveBeenCalledWith("/settings/appearance");
  });

  it("opens the floating settings window from the Settings row instead of a nested option list", async () => {
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Settings$/ }));
    expect(onOpenSettings).toHaveBeenCalledWith("/settings");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Account" })).toBeNull());
  });

  it.each([
    ["Activity preferences", "/settings/notifications"],
    ["Report a problem", "/settings/feedback"],
    ["Help", "/settings/help"],
  ])("opens %s inside the settings window at %s", async (label, path) => {
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${label}$`) }));
    expect(onOpenSettings).toHaveBeenCalledWith(path);
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
    expect(panel.querySelectorAll(".fb-account-add")).toHaveLength(1);
  });

  it("switches without logging out the current account", async () => {
    state.switchAccount.mockResolvedValue({ status: "switched" });
    state.accounts = [other];
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Riley/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Switch to Sam/ }));
    await waitFor(() => expect(state.switchAccount).toHaveBeenCalledWith(other));
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("keeps the current account signed in before opening the add-account gateway", async () => {
    state.setAccountKept.mockResolvedValue(undefined);
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Riley/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Add another account/ }));
    await waitFor(() => expect(state.setAccountKept).toHaveBeenCalledWith("1", true));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/auth?addAccount=1"));
    expect(addAccountIntentAccount()).toBe("1");
    expect(peekAuthReturnTo()).toBe("/settings");
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("stays on the account panel when the current account cannot be kept", async () => {
    state.setAccountKept.mockRejectedValue(new Error("storage full"));
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Riley/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Add another account/ }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Could not add another account. Try again.");
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(addAccountIntentAccount()).toBeNull();
  });

  it("shows an error when switching cannot start", async () => {
    state.switchAccount.mockRejectedValue(new Error("unavailable"));
    state.accounts = [other];
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Riley/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Switch to Sam/ }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Could not switch accounts. Try again.");
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
