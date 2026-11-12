// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AccountMenu } from "./AccountMenu";

const state = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "1", username: "riley", displayName: "Riley" }, logout: state.logout }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderMenu() { render(<MemoryRouter><AccountMenu /></MemoryRouter>); }

describe("account menu", () => {
  it("renders the specified entries in order and omits unavailable entries", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const dialog = await screen.findByRole("dialog", { name: "Account" });
    expect(within(dialog).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/u/riley", "/settings/appearance", "/saved", "/settings/feedback", "/settings", "/settings/help"]);
    expect(within(dialog).getByText("Riley")).toBeTruthy();
    expect(within(dialog).getByText("@riley")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(within(dialog).queryByText("Activity preferences")).toBeNull();
    expect(within(dialog).queryByText("Switch account")).toBeNull();
  });

  it("exposes expanded state on both triggers and restores focus after Escape", async () => {
    renderMenu();
    const account = screen.getByRole("button", { name: "Account" });
    const gear = screen.getByRole("button", { name: "Settings" });
    for (const button of [account, gear]) {
      expect(button.hasAttribute("aria-expanded")).toBe(true);
      expect(button.hasAttribute("aria-current")).toBe(false);
    }
    account.focus(); fireEvent.click(account);
    await screen.findByRole("dialog", { name: "Account" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(account));
  });

  it("confirms logout once even if confirmation is pressed twice", async () => {
    state.logout.mockImplementation(() => new Promise(() => {}));
    renderMenu(); fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Log out" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(state.logout).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation open when logout fails", async () => {
    state.logout.mockRejectedValueOnce(new Error("failure"));
    renderMenu(); fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Log out" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not log out. Please try again.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
