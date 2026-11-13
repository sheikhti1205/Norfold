// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SettingsWindow } from "./SettingsWindow";

/**
 * The window is mounted inside the app's router in production, and React
 * Router 8 refuses a nested <Router>. These tests mount it inside a
 * MemoryRouter on purpose: that is the constraint the window's own history
 * shim exists for.
 */
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "window-reader" } }) }));

vi.mock("../screens/Settings", async () => {
  const { Link, Outlet } = await import("react-router");
  return {
    Settings: () => <div>
      <h2>Settings root</h2>
      <Link to="/settings/account">Account link</Link>
      <Link to="/profile">Profile link</Link>
      <Outlet />
    </div>,
  };
});

vi.mock("../screens/settingsRoutes", async () => {
  const { Route } = await import("react-router");
  return {
    settingsRouteElements: () => <Route path="/settings/account" element={<p>Account page</p>} />,
  };
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderWindow(initialPath?: string) {
  const onClose = vi.fn();
  const onExit = vi.fn();
  render(<MemoryRouter initialEntries={["/"]}>
    <SettingsWindow open initialPath={initialPath} onClose={onClose} onExit={onExit} />
  </MemoryRouter>);
  return { onClose, onExit };
}

describe("settings window", () => {
  it("renders the settings tree inside the app router without nesting a Router", async () => {
    renderWindow();
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Settings root")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close settings" })).toBeTruthy();
  });

  it("opens at the requested section, so a menu row lands inside the window", async () => {
    renderWindow("/settings/account");
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
    // The section renders inside the window's own tree, over its parent.
    expect(screen.getByText("Account page")).toBeTruthy();
    expect(screen.getByText("Settings root")).toBeTruthy();
  });

  it("follows a settings link inside the window instead of navigating the app", async () => {
    renderWindow();
    fireEvent.click(screen.getByRole("link", { name: "Account link" }));
    // The memory history must notify on push; without v5Compat the window
    // stayed on the root page and the link did nothing.
    await waitFor(() => expect(screen.getByText("Account page")).toBeTruthy());
    expect(screen.getByText("Settings root")).toBeTruthy();
  });

  it("closes when the press lands outside the window", async () => {
    const { onClose } = renderWindow();
    const backdrop = document.querySelector(".fb-settings-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.pointerDown(backdrop!);
    fireEvent.pointerUp(backdrop!);
    fireEvent.click(backdrop!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on Escape", async () => {
    const { onClose } = renderWindow();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("offers exactly one search control at the top and no notification bell", async () => {
    renderWindow();
    await screen.findByRole("dialog", { name: "Settings" });
    expect(screen.getAllByRole("button", { name: "Search settings" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /notifications/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /notifications/i })).toBeNull();
  });

  it("opens a top-attached search field whose results pick a section inside the window", async () => {
    renderWindow();
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Search settings" }));
    const field = screen.getByRole("searchbox", { name: "Search settings" });
    // The field takes focus when it opens, and the whole settings catalogue is
    // searchable - not just the current section.
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "account" } });
    expect(screen.getByRole("status").textContent).toContain("setting");
    const account = screen.getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/settings/account");
    expect(account).toBeTruthy();
    fireEvent.click(account!);
    // Picking navigates the window's own history; the app behind never moves,
    // and the field puts itself away.
    await waitFor(() => expect(screen.getByText("Account page")).toBeTruthy());
    expect(screen.queryByRole("searchbox", { name: "Search settings" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("closes only the search field on Escape, not the window", async () => {
    const { onClose } = renderWindow();
    await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Search settings" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "Search settings" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search settings" }));
  });

  it("hands a non-settings destination back to the real app", async () => {
    const { onExit } = renderWindow();
    fireEvent.click(screen.getByRole("link", { name: "Profile link" }));
    await waitFor(() => expect(onExit).toHaveBeenCalledWith("/profile"));
  });
});
