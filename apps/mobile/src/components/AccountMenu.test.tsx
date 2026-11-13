// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AccountMenu } from "./AccountMenu";

const state = vi.hoisted(() => ({ logout: vi.fn(), save: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({
  user: { id: "1", username: "riley", displayName: "Riley", emailVerified: true },
  logout: state.logout,
}) }));
vi.mock("../services/accountRules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/accountRules")>();
  return {
    ...actual,
    fetchContactRules: () => Promise.resolve({ messageFrom: "ANYONE", connectFrom: "CONNECTED", showContact: "CONNECTED" }),
    saveContactRules: state.save,
  };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderMenu() { render(<MemoryRouter><AccountMenu /></MemoryRouter>); }
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

  it("reaches settings, appearance and the account shortcuts from inside", async () => {
    renderMenu();
    const dialog = await openMenu();
    const labels = within(dialog).getAllByRole("button").map((node) => node.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Settings", "Appearance", "Log out"]));
    expect(within(dialog).getByRole("link", { name: /Activity preferences/ }).getAttribute("href")).toBe("/settings/notifications");
    expect(within(dialog).getByRole("link", { name: /Report a problem/ }).getAttribute("href")).toBe("/settings/feedback");
    expect(within(dialog).getByRole("link", { name: /Help/ }).getAttribute("href")).toBe("/settings/help");
    // Saved is a rail destination now; repeating it here was the extra row.
    expect(within(dialog).queryByRole("link", { name: /Saved/ })).toBeNull();
  });

  it("opens a floating appearance preview with the real tiles, not a route", async () => {
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Appearance/ }));
    const panel = await within(dialog).findByRole("group", { name: "Appearance preview" });
    expect(within(panel).getByRole("group", { name: "Accent" })).toBeTruthy();
    expect(within(panel).getAllByRole("radio")).toHaveLength(2);
    expect(within(panel).getByRole("button", { name: /Open Appearance/ })).toBeTruthy();
  });

  // One gate, one question: a first message in this schema is the connection
  // request, so two dropdowns would offer a distinction admission cannot honour.
  // The single answer writes both admission columns.
  it("opens the account panel with a contact rule that persists", async () => {
    state.save.mockImplementation((next: unknown) => Promise.resolve(next));
    renderMenu();
    const dialog = await openMenu();
    fireEvent.click(within(dialog).getByRole("button", { name: /Settings/ }));
    const panel = await within(dialog).findByRole("group", { name: "Settings preview" });
    const rule = await within(panel).findByLabelText("Who can start a conversation with you");
    await waitFor(() => expect((rule as HTMLSelectElement).value).toBe("ANYONE"));
    expect(within(panel).queryByLabelText("Who can see your contact details")).toBeNull();
    fireEvent.change(rule, { target: { value: "NOBODY" } });
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ messageFrom: "NOBODY", connectFrom: "NOBODY" })));
    expect((rule as HTMLSelectElement).value).toBe("NOBODY");
  });

  it("Escape closes the preview first and hands focus back to its row", async () => {
    renderMenu();
    const dialog = await openMenu();
    const row = within(dialog).getByRole("button", { name: /Appearance/ });
    row.focus();
    fireEvent.click(row);
    await within(dialog).findByRole("group", { name: "Appearance preview" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: "Appearance preview" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Account" })).toBeTruthy();
    expect(document.activeElement).toBe(row);
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
