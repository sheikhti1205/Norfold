// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { mockSubmitFeedback, mockListMyFeedback, mockRatingContext, mockRateApp } = vi.hoisted(() => ({
  mockSubmitFeedback: vi.fn(),
  mockListMyFeedback: vi.fn(),
  mockRatingContext: vi.fn(),
  mockRateApp: vi.fn(),
}));

vi.mock("../services/feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/feedback")>();
  return {
    ...actual,
    submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
    listMyFeedback: (...args: unknown[]) => mockListMyFeedback(...args),
    fetchAppRatingContext: (...args: unknown[]) => mockRatingContext(...args),
    rateApp: (...args: unknown[]) => mockRateApp(...args),
  };
});

import { FeedbackForm } from "./FeedbackForm";
import { ApiError } from "../services/session";
const viewer = vi.hoisted(() => ({ id: "me" }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: viewer.id } }) }));

afterEach(cleanup);

beforeEach(() => {
  viewer.id = "me";
  vi.clearAllMocks();
  mockSubmitFeedback.mockResolvedValue("feedback-1");
  mockRatingContext.mockReset().mockResolvedValue({ myScore: null, average: null, count: 0 });
  mockRateApp.mockReset();
  mockListMyFeedback.mockResolvedValue([
    {
      id: "feedback-1",
      category: "BUG",
      status: "NEW",
      createdAt: "2026-10-22T10:00:00.000Z",
      updatedAt: "2026-10-22T10:00:00.000Z",
    },
  ]);
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <FeedbackForm />
    </MemoryRouter>,
  );
}

describe("the one feedback form", () => {
  it.each([
    "#/settings/feedback?email=synthetic-person@example.invalid",
    "#/u/synthetic-member-id?access_token=synthetic-not-a-credential",
    `#/settings/feedback?context=${"synthetic-".repeat(20)}`,
  ])("never adds URL parameters or dynamic identity to opted-in screen context: %s", async (hash) => {
    const previous = window.location.href;
    try {
      window.history.replaceState(null, "", hash);
      renderScreen();
      fireEvent.click(screen.getByRole("switch", { name: /include technical details/i }));
      fireEvent.click(screen.getByRole("radio", { name: /an idea/i }));
      fireEvent.change(screen.getByLabelText(/tell us what happened/i), { target: { value: "A synthetic suggestion" } });
      fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
      await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(1));
      expect(mockSubmitFeedback.mock.calls[0]![0].screen).toBe("feedback");
    } finally { window.history.replaceState(null, "", previous); }
  });

  it("suppresses old-account history reads", async () => {
    let finish!: (rows: unknown[]) => void;
    mockListMyFeedback.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = renderScreen();
    viewer.id = "other";
    mockListMyFeedback.mockResolvedValue([]);
    view.rerender(<MemoryRouter><FeedbackForm /></MemoryRouter>);
    await screen.findByText(/haven’t sent any feedback yet/i);
    await act(async () => { finish([{ id: "old", category: "BUG", status: "RECEIVED", createdAt: "2026-10-22" }]); });
    expect(screen.queryByTestId("feedback-history-row")).toBeNull();
  });

  it("suppresses old-account submit completion, feedback text and announcement", async () => {
    let finish!: () => void;
    mockSubmitFeedback.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const heard = vi.fn(); window.addEventListener("findback:announce", heard);
    try {
      const view = renderScreen();
      fireEvent.click(screen.getByRole("radio", { name: /something is broken/i }));
      fireEvent.change(screen.getByLabelText(/tell us what happened/i), { target: { value: "Private old account text" } });
      fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
      viewer.id = "other";
      view.rerender(<MemoryRouter><FeedbackForm /></MemoryRouter>);
      await act(async () => { finish(); });
      expect(screen.queryByDisplayValue("Private old account text")).toBeNull();
      expect(screen.queryByTestId("feedback-notice")).toBeNull();
      expect(heard).not.toHaveBeenCalled();
    } finally { window.removeEventListener("findback:announce", heard); }
  });
  it.each([new ApiError("missing", 500, "PGRST202"), new Error("network")])("keeps failed history distinct from empty and retries without submitting", async (failure) => {
    mockListMyFeedback.mockRejectedValueOnce(failure);
    renderScreen();
    expect(await screen.findByTestId("feedback-history-error")).toBeTruthy();
    if (failure instanceof ApiError) expect(screen.getByTestId("feedback-history-error").textContent).toMatch(/not available in this build/i);
    expect(screen.queryByText(/haven’t sent any feedback yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry feedback history" }));
    expect(await screen.findByText("Received")).toBeTruthy();
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });
  it("offers the four kinds the server knows", () => {
    renderScreen();
    expect(screen.getAllByRole("radio", { name: /something is broken|an idea|hard to use|something else/i })).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /something is broken/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /hard to use/i })).toBeTruthy();
  });

  it("sends the kind, the message and no technical value while the switch is off", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: /something is broken/i }));
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), {
      target: { value: "The map does not load." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(1));
    const draft = mockSubmitFeedback.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(draft.category).toBe("BUG");
    expect(draft.message).toBe("The map does not load.");
    expect(draft.includeTechnicalInfo).toBe(false);
    expect(draft.appVersion).toBeNull();
    expect(draft.platform).toBeNull();
    expect(draft.screen).toBeNull();
    expect(draft.deviceClass).toBeNull();
  });

  it("sends the four named scalars — and nothing else — while the switch is on", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("switch", { name: /include technical details/i }));
    fireEvent.click(screen.getByRole("radio", { name: /an idea/i }));
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), {
      target: { value: "Please add dark mode." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(mockSubmitFeedback).toHaveBeenCalledTimes(1));
    const draft = mockSubmitFeedback.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(draft.includeTechnicalInfo).toBe(true);
    expect(typeof draft.appVersion).toBe("string");
    expect(typeof draft.platform).toBe("string");
    expect(typeof draft.deviceClass).toBe("string");
    // Never a blob.
    expect(Object.keys(draft).sort()).toEqual([
      "appVersion",
      "category",
      "deviceClass",
      "includeTechnicalInfo",
      "message",
      "platform",
      "screen",
    ]);
  });

  it("refuses an empty message without a round trip", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: /something is broken/i }));
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    expect(await screen.findByTestId("feedback-error")).toBeTruthy();
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });

  it("shows the reader their own status, and nothing else", async () => {
    renderScreen();
    expect(await screen.findByText("Something is broken")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    // The server does not grant the message or the moderator's note.
    expect(document.body.textContent).not.toMatch(/admin_note|technical_context/);
  });

  it("says thanks only after the server confirmed it", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: /something is broken/i }));
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), {
      target: { value: "The map does not load." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    expect(await screen.findByTestId("feedback-notice")).toBeTruthy();
  });

  it("shows a refusal as a sentence", async () => {
    mockSubmitFeedback.mockRejectedValue(new Error("boom"));
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: /something is broken/i }));
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), {
      target: { value: "The map does not load." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));
    await waitFor(() => expect(screen.getByTestId("feedback-error")).toBeTruthy());
    expect(screen.queryByTestId("feedback-notice")).toBeNull();
  });

  it("says plainly that sending is not in this build when the server has no such function", async () => {
    mockSubmitFeedback.mockRejectedValue(new ApiError("Could not find the function", 500, "PGRST202"));
    renderScreen();
    fireEvent.click(screen.getByRole("radio", { name: /something is broken/i }));
    fireEvent.change(screen.getByLabelText(/tell us what happened/i), {
      target: { value: "The map does not load." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    const error = await screen.findByTestId("feedback-error");
    expect(error.textContent).toMatch(/not available in this build/i);
    expect(error.textContent).not.toMatch(/PGRST202|schema/i);
    // No fake success.
    expect(screen.queryByTestId("feedback-notice")).toBeNull();
  });
});

describe("app rating", () => {
  it("shows the empty state and saves the first rating", async () => {
    mockRateApp.mockResolvedValue({ myScore: 5, average: 5, count: 1 });
    renderScreen();
    expect(await screen.findByText(/no ratings yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "5 out of 5" }));
    expect(await screen.findByText(/5\.0 out of 5 from 1 rating/i)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "5 out of 5" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/rating saved/i)).toBeTruthy();
    expect(screen.getByLabelText(/tell us what happened/i)).toBeTruthy();
  });
  it("shows the current score and aggregate, and updates both after editing", async () => {
    mockRatingContext.mockResolvedValue({ myScore: 2, average: 3.5, count: 2 });
    mockRateApp.mockResolvedValue({ myScore: 4, average: 4.5, count: 2 });
    renderScreen();
    expect(await screen.findByText(/3\.5 out of 5 from 2 ratings/i)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "2 out of 5" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "4 out of 5" }));
    expect(await screen.findByText(/4\.5 out of 5 from 2 ratings/i)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "4 out of 5" }) as HTMLInputElement).checked).toBe(true);
  });
  it("keeps the pending score selected on failure and retries that choice", async () => {
    mockRatingContext.mockResolvedValue({ myScore: 2, average: 2, count: 1 });
    mockRateApp.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ myScore: 3, average: 3, count: 1 });
    renderScreen();
    await screen.findByText(/2\.0 out of 5 from 1 rating/i);
    fireEvent.click(screen.getByRole("radio", { name: "3 out of 5" }));
    expect(await screen.findByText(/could not save your rating/i)).toBeTruthy();
    const selected = screen.getByRole("radio", { name: "3 out of 5" }) as HTMLInputElement;
    expect(selected.checked).toBe(true);
    expect(screen.getByText("Rating not saved yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry rating/i }));
    expect(mockRateApp).toHaveBeenLastCalledWith(Number(selected.value));
    expect(await screen.findByText(/3\.0 out of 5 from 1 rating/i)).toBeTruthy();
  });
  it("changes selection with arrow navigation without saving or disabling controls", async () => {
    mockRatingContext.mockResolvedValue({ myScore: 1, average: 1, count: 1 });
    renderScreen();
    const first = await screen.findByRole("radio", { name: "1 out of 5" });
    const second = screen.getByRole("radio", { name: "2 out of 5" }) as HTMLInputElement;
    fireEvent.keyDown(first, { key: "ArrowRight" });
    fireEvent.change(second, { target: { checked: true } });
    expect(mockRateApp).not.toHaveBeenCalled();
    expect(second.disabled).toBe(false);
    expect(second.closest("fieldset")?.disabled).toBe(false);
  });
  it("commits a clicked score once", async () => {
    mockRateApp.mockResolvedValue({ myScore: 4, average: 4, count: 1 });
    renderScreen();
    fireEvent.click(await screen.findByRole("radio", { name: "4 out of 5" }));
    expect(mockRateApp).toHaveBeenCalledOnce();
    expect(mockRateApp).toHaveBeenCalledWith(4);
    await screen.findByText("Rating saved. Thank you.");
  });
  it("guards repeated clicks during saving and keeps focus", async () => {
    let finish!: (value: { myScore: number; average: number; count: number }) => void;
    mockRateApp.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderScreen();
    const radio = await screen.findByRole("radio", { name: "4 out of 5" });
    radio.focus();
    fireEvent.click(radio);
    fireEvent.click(radio);
    expect(mockRateApp).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(radio);
    expect(radio.closest("fieldset")?.getAttribute("aria-busy")).toBe("true");
    expect((radio as HTMLInputElement).disabled).toBe(false);
    await act(async () => { finish({ myScore: 4, average: 4, count: 1 }); });
  });
});
