// @vitest-environment jsdom
/**
 * Report AI is an Android-only on-device capability.
 *
 * - Web and other native platforms never render the suggestion entry, its Stop
 *   control, results, failure note or Manage local tools affordance, and never
 *   start a report AI warm-up or inference.
 * - Android renders the entry, warms only the existing installed/verified
 *   helper exactly once, and a failed warm-up never decorates the form.
 * - Memory pressure is a calm, recoverable answer when the person taps Suggest
 *   details: it never offers a reinstall.
 * - The retired helper's saved-note recovery is draft recovery, not AI, and
 *   stays available on every platform.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, photo, nativeMedia } = vi.hoisted(() => ({
  state: {
    platform: "web" as "web" | "ios" | "android",
    native: false,
    prewarmNeedle: vi.fn(),
    fieldsGenerate: vi.fn(),
    categoryGenerate: vi.fn(),
  },
  photo: {
    isNativeCameraAvailable: vi.fn(() => false),
    takePhoto: vi.fn(),
    chooseFromGallery: vi.fn(),
    photoToFile: vi.fn(),
    normalizeForUpload: vi.fn(async (file: File) => file),
    toNativeImageUri: vi.fn(),
  },
  nativeMedia: {
    chooseNativeImage: vi.fn(),
    chooseNativeImages: vi.fn(),
    importNativeImageUri: vi.fn(),
  },
}));

function setPlatform(platform: "web" | "ios" | "android"): void {
  state.platform = platform;
  state.native = platform !== "web";
}

vi.mock("@capacitor/core", () => {
  // `utils/location` registers the short-link resolver at module scope on
  // Android; the Android renders in this suite need the real export present.
  const shortLinks = { resolve: vi.fn(async ({ url }: { url: string }) => ({ url })) };
  return {
    Capacitor: { isNativePlatform: () => state.native, getPlatform: () => state.platform },
    registerPlugin: (name: string) => name === "ShortLinkResolver" ? shortLinks : {},
    Plugins: { ShortLinkResolver: shortLinks },
  };
});
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "u1", username: "tester" } }) }));
vi.mock("../services/posts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/posts")>();
  return { ...actual, publishReport: vi.fn(), publishReportWithPhotos: vi.fn() };
});
vi.mock("../services/photo", () => photo);
vi.mock("../services/media/nativeMedia", () => ({
  chooseNativeImage: nativeMedia.chooseNativeImage,
  chooseNativeImages: nativeMedia.chooseNativeImages,
  importNativeImageUri: nativeMedia.importNativeImageUri,
  importedImageToFile: (item: { fileName?: string; derivative: { bytes: Uint8Array; mimeType: string } }) =>
    new File([item.derivative.bytes.slice()], item.fileName || "photo.jpg", { type: item.derivative.mimeType }),
}));
// The report form's only wiring to the app AI coordinator in this slice is the
// load-only warm-up; a real service would spin up the native runtime seams.
vi.mock("../services/ai/applicationAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai/applicationAi")>();
  return {
    ...actual,
    getApplicationAi: () => ({
      android: state.platform === "android",
      prewarmNeedle: state.prewarmNeedle,
    }),
  };
});
vi.mock("../services/liveNarrowTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/liveNarrowTasks")>();
  return {
    ...actual,
    nlHelperState: async () => "ready",
    generateForFieldsLive: (...args: unknown[]) => state.fieldsGenerate(...args),
    generateForCategoryLive: (...args: unknown[]) => state.categoryGenerate(...args),
  };
});

import { CreateReport } from "./CreateReport";
import { LocalRouteError } from "../services/liveNarrowTasks";
import { clearDraft, saveDraft } from "../services/reportDraft";
import { clearPhotoStore } from "../services/photoStore";
import { todayInputValue } from "../utils/dates";

const DRAFT_KEY = "findback:reportDraft:v1:u1";

function seedStoredNote(note: string): void {
  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      type: "LOST",
      title: "",
      description: "",
      category: "",
      eventDate: todayInputValue(),
      location: { label: "", latitude: null, longitude: null },
      youtubeUrl: "",
      aiSuggestInput: note,
    }),
  );
}

function seedDescription(description: string): void {
  saveDraft(
    {
      type: "LOST",
      title: "",
      description,
      category: "",
      eventDate: todayInputValue(),
      location: { label: "", latitude: null, longitude: null },
      youtubeUrl: "",
      photoId: null,
      photoNativeUri: null,
      photoWebPath: null,
      photoFormat: null,
    },
    "u1",
  );
}

async function renderForm(): Promise<void> {
  render(<CreateReport />);
  await screen.findByRole("textbox", { name: "Description" });
}

function expectNoReportAiUi(): void {
  expect(screen.queryByTestId("report-suggest-details")).toBeNull();
  expect(screen.queryByRole("button", { name: /suggest details/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
  expect(screen.queryByTestId("report-suggestion-note-row")).toBeNull();
  expect(screen.queryByTestId("report-suggestion-manage-models")).toBeNull();
}

beforeEach(() => {
  setPlatform("web");
  state.prewarmNeedle.mockReset();
  state.prewarmNeedle.mockResolvedValue(true);
  state.fieldsGenerate.mockReset();
  state.categoryGenerate.mockReset();
  state.fieldsGenerate.mockResolvedValue(JSON.stringify({ title: "Black umbrella" }));
  state.categoryGenerate.mockResolvedValue(JSON.stringify({ category: "accessories" }));
  clearDraft();
  clearPhotoStore();
  window.localStorage.removeItem(DRAFT_KEY);
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => "blob:preview");
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  clearDraft();
  clearPhotoStore();
  window.localStorage.removeItem(DRAFT_KEY);
  vi.restoreAllMocks();
});

describe("CreateReport report AI platform gate", () => {
  it("never renders the on-device suggestion surface on web", async () => {
    seedDescription("Black umbrella lost yesterday.");
    await renderForm();

    expectNoReportAiUi();
    // No warm-up and no inference start just because the form mounted.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.prewarmNeedle).not.toHaveBeenCalled();
    expect(state.fieldsGenerate).not.toHaveBeenCalled();
    expect(state.categoryGenerate).not.toHaveBeenCalled();
  });

  it("treats iOS (generic native) as ineligible: Android only", async () => {
    setPlatform("ios");
    await renderForm();

    expectNoReportAiUi();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.prewarmNeedle).not.toHaveBeenCalled();
  });

  it("renders the entry on Android and warms the existing helper once", async () => {
    setPlatform("android");
    await renderForm();

    expect(screen.getByRole("button", { name: "Suggest details" })).toBeTruthy();
    expect(screen.getByTestId("report-suggest-details")).toBeTruthy();
    await waitFor(() => expect(state.prewarmNeedle).toHaveBeenCalledTimes(1));
    // Warm-up is load-only: no suggestion is generated automatically.
    expect(state.fieldsGenerate).not.toHaveBeenCalled();
    expect(state.categoryGenerate).not.toHaveBeenCalled();
  });

  it("survives a rejected warm-up without decorating the form or throwing", async () => {
    setPlatform("android");
    state.prewarmNeedle.mockRejectedValue(new Error("not installed"));
    await renderForm();

    await waitFor(() => expect(state.prewarmNeedle).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("report-suggestion-note-row")).toBeNull();
    expect(screen.getByRole("button", { name: "Suggest details" })).toBeTruthy();
    expect((screen.getByLabelText(/what did you lose/i) as HTMLInputElement).disabled).toBe(false);
  });

  it("answers memory pressure calmly, with no install prompt, when the person asks", async () => {
    setPlatform("android");
    state.fieldsGenerate.mockRejectedValue(
      new LocalRouteError("LOW_MEMORY", "Not enough free memory to load the on-device helper right now."),
    );
    await renderForm();

    fireEvent.change(screen.getByLabelText(/what did you lose/i), {
      target: { value: "Black umbrella lost yesterday." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suggest details" }));

    await screen.findByText(/Not enough free memory/i);
    expect(screen.queryByTestId("report-suggestion-manage-models")).toBeNull();
    expect(screen.queryByText(/open Manage local tools/i)).toBeNull();
    expect(screen.queryByText(/download|reinstall|install it/i)).toBeNull();
    // The form is still usable and the text is intact.
    expect((screen.getByLabelText(/what did you lose/i) as HTMLInputElement).value).toBe(
      "Black umbrella lost yesterday.",
    );
  });

  it("keeps saved-note recovery, which is draft recovery rather than AI, on web", async () => {
    const note = "Black umbrella with a blue sticker, lost near gate 3";
    seedStoredNote(note);
    await renderForm();

    expectNoReportAiUi();
    expect(screen.getByTestId("report-saved-note")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recover saved note" }));
    expect((await screen.findByTestId("report-saved-note-text")).textContent).toBe(note);
    fireEvent.click(screen.getByRole("button", { name: "Use as description" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Description" }).textContent ?? "").toContain(note);
    });
    expect(state.prewarmNeedle).not.toHaveBeenCalled();
  });
});
