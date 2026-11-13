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

function renderWindow() {
  const onClose = vi.fn();
  const onExit = vi.fn();
  render(<MemoryRouter initialEntries={["/"]}>
    <SettingsWindow open onClose={onClose} onExit={onExit} />
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

  it("hands a non-settings destination back to the real app", async () => {
    const { onExit } = renderWindow();
    fireEvent.click(screen.getByRole("link", { name: "Profile link" }));
    await waitFor(() => expect(onExit).toHaveBeenCalledWith("/profile"));
  });
});
