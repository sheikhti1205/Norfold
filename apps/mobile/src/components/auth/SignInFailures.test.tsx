// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/session";

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("../../auth", () => ({ useAuth: () => ({ login }) }));
import { SignInForm } from "./SignInForm";

afterEach(() => { cleanup(); login.mockReset(); });

describe("sign-in failures", () => {
  it.each([
    [new ApiError("bad password", 401), "We couldn't sign you in. Check your email and password and try again."],
    [new ApiError("account missing", 401), "We couldn't sign you in. Check your email and password and try again."],
    [new ApiError("private transport details", 503, "AUTH_UNAVAILABLE"), "We couldn't connect. Check your connection and try again."],
  ])("shows safe copy for a failure", async (failure, message) => {
    login.mockRejectedValueOnce(failure);
    render(<MemoryRouter><SignInForm initialEmail="person@example.com" emailLocked onRequestChangeEmail={() => {}} onSwitchToSignup={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });
});
