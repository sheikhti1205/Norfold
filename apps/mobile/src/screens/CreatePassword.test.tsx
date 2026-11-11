// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ saveRequiredPassword: vi.fn(), confirmRequiredPassword: vi.fn(), logout: vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => auth }));
import { CreatePassword } from "./CreatePassword";

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

function open() {
  return render(<MemoryRouter initialEntries={["/create-password"]}><Routes><Route path="/create-password" element={<CreatePassword />} /><Route path="/" element={<p>Public entry</p>} /></Routes></MemoryRouter>);
}
function fill() {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password123" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Save password" }));
}

it("saves and confirms the password", async () => {
  auth.saveRequiredPassword.mockResolvedValue(undefined);
  auth.confirmRequiredPassword.mockResolvedValue(true);
  open(); fill();
  await waitFor(() => expect(auth.confirmRequiredPassword).toHaveBeenCalledOnce());
  expect(auth.saveRequiredPassword).toHaveBeenCalledWith("password123");
});

it("keeps the saved-but-unconfirmed state on retry without resaving or looping", async () => {
  auth.saveRequiredPassword.mockResolvedValue(undefined);
  auth.confirmRequiredPassword.mockResolvedValue(false);
  open(); fill();
  await screen.findByRole("alert");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(auth.confirmRequiredPassword).toHaveBeenCalledTimes(2));
  expect(auth.saveRequiredPassword).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByLabelText("New password")).toHaveProperty("value", "password123");
});

it("allows sign out to the public entry", async () => {
  auth.logout.mockResolvedValue(undefined);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Public entry");
  expect(auth.logout).toHaveBeenCalledOnce();
});

it("keeps input after a save error", async () => {
  auth.saveRequiredPassword.mockRejectedValue(new Error("Please try again."));
  open(); fill();
  await screen.findByRole("alert");
  expect(screen.getByLabelText("New password")).toHaveProperty("value", "password123");
});
