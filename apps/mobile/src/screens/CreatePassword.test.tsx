// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: { email: "tester@example.com" },
  requestRequiredPasswordCode: vi.fn(),
  saveRequiredPassword: vi.fn(),
  confirmRequiredPassword: vi.fn(),
  dismissPasswordSetup: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../auth", () => ({ useAuth: () => auth }));
import { CreatePassword } from "./CreatePassword";

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

function open() {
  return render(<MemoryRouter initialEntries={["/create-password"]}><Routes><Route path="/create-password" element={<CreatePassword />} /><Route path="/" element={<p>Public entry</p>} /></Routes></MemoryRouter>);
}
function fillPassword() {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password123" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
}
async function reachCodeStep() {
  auth.requestRequiredPasswordCode.mockResolvedValue(undefined);
  open();
  fillPassword();
  await screen.findByLabelText("Email code");
}

it("sends a code and does not save before the code is entered", async () => {
  await reachCodeStep();
  expect(auth.requestRequiredPasswordCode).toHaveBeenCalledOnce();
  expect(auth.saveRequiredPassword).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Verify and save" })).toHaveProperty("disabled", true);
});

it("verifies the code, saves the password, and continues", async () => {
  await reachCodeStep();
  auth.saveRequiredPassword.mockResolvedValue({ confirmed: true });
  fireEvent.change(screen.getByLabelText("Email code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and save" }));
  await screen.findByText("Public entry");
  expect(auth.saveRequiredPassword).toHaveBeenCalledWith("password123", "123456");
});

it("shows an expired or wrong code honestly and never claims a save", async () => {
  await reachCodeStep();
  auth.saveRequiredPassword.mockRejectedValue(new Error("Invalid or expired verification code"));
  fireEvent.change(screen.getByLabelText("Email code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Invalid or expired verification code");
  expect(screen.queryByText("Public entry")).toBeNull();
  expect(screen.getByLabelText("Email code")).toHaveProperty("value", "123456");
});

it("surfaces an unconfirmed save and retries only the confirmation", async () => {
  await reachCodeStep();
  auth.saveRequiredPassword.mockResolvedValue({ confirmed: false });
  fireEvent.change(screen.getByLabelText("Email code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and save" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/saved/i);
  expect(auth.saveRequiredPassword).toHaveBeenCalledOnce();

  auth.confirmRequiredPassword.mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Public entry");
  expect(auth.confirmRequiredPassword).toHaveBeenCalledOnce();
  expect(auth.saveRequiredPassword).toHaveBeenCalledOnce();
});

it("lets the reader choose Not now and leave without saving", async () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await screen.findByText("Public entry");
  expect(auth.dismissPasswordSetup).toHaveBeenCalledOnce();
  expect(auth.saveRequiredPassword).not.toHaveBeenCalled();
});

it("allows sign out to the public entry", async () => {
  auth.logout.mockResolvedValue(undefined);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Public entry");
  expect(auth.logout).toHaveBeenCalledOnce();
});

it("keeps the password after a send error", async () => {
  auth.requestRequiredPasswordCode.mockRejectedValue(new Error("Could not send the code. Try again."));
  open();
  fillPassword();
  await screen.findByRole("alert");
  expect(screen.getByLabelText("New password")).toHaveProperty("value", "password123");
  expect(screen.getByRole("button", { name: "Send code" })).toBeTruthy();
});
