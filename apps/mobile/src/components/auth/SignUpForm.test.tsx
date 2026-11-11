// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const { checkUsername, register } = vi.hoisted(() => ({
  checkUsername: vi.fn(),
  register: vi.fn(),
}));
vi.mock("../../auth", () => ({ useAuth: () => ({ register }) }));
vi.mock("../../services/auth", () => ({ checkUsername }));

import { SignUpForm } from "./SignUpForm";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("retries a failed username check on submit without editing the username", async () => {
  let resolveRetry!: (value: { available: boolean }) => void;
  checkUsername.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(
    new Promise((resolve) => { resolveRetry = resolve; }),
  );
  register.mockResolvedValue({ status: "pending" });
  render(<MemoryRouter initialEntries={["/register"]}><Routes>
    <Route path="/register" element={<SignUpForm initialEmail="test@example.test" onBackToSignin={() => {}} />} />
    <Route path="/verify" element={<p>Verify destination</p>} />
  </Routes></MemoryRouter>);

  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "testuser" } });
  fireEvent.change(screen.getByLabelText("Mobile (Bangladesh)"), { target: { value: "01812345678" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "password123" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password123" } });
  await screen.findByText(/could not check availability/i);
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(checkUsername).toHaveBeenCalledTimes(2);
  expect(register).not.toHaveBeenCalled();
  resolveRetry({ available: true });
  await waitFor(() => expect(screen.getByText(/Username available/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByText("Verify destination")).toBeTruthy();
  expect(register).toHaveBeenCalledTimes(1);
});
