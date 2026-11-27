// @vitest-environment jsdom
/**
 * The compact entry for the local suggestion helper: one primary description
 * input (plus the title beside it), and one "Suggest details" action directly
 * after the description. No second text box, no duplicated instructions, no
 * bordered panel. The action is manual-first — it never runs on mount or while
 * typing — and reads only the title/description already in the form.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { suggestFieldsMock, suggestCategoryMock, nlHelperStateMock, prewarmNeedleMock, photo, nativeMedia } = vi.hoisted(() => ({
  suggestFieldsMock: vi.fn(),
  suggestCategoryMock: vi.fn(),
  nlHelperStateMock: vi.fn(),
  prewarmNeedleMock: vi.fn(),
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

// Report AI is Android-only; these tests exercise that surface.
vi.mock("@capacitor/core", () => {
  // `utils/location` registers the short-link resolver at module scope on
  // Android, so the partial core mock must expose the real export.
  const shortLinks = { resolve: vi.fn(async ({ url }: { url: string }) => ({ url })) };
  return {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
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
vi.mock("../services/reportFieldSuggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/reportFieldSuggestions")>();
  return { ...actual, suggestReportFields: (...args: unknown[]) => suggestFieldsMock(...args) };
});
vi.mock("../services/liveNarrowTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/liveNarrowTasks")>();
  return { ...actual, nlHelperState: () => nlHelperStateMock() };
});
vi.mock("../services/categorySuggestion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/categorySuggestion")>();
  return { ...actual, suggestCategoryForText: (...args: unknown[]) => suggestCategoryMock(...args) };
});
// The load-only warm-up runs on entry; a real service would construct the
// native runtime seams under jsdom.
vi.mock("../services/ai/applicationAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai/applicationAi")>();
  return {
    ...actual,
    getApplicationAi: () => ({ android: true, prewarmNeedle: prewarmNeedleMock }),
  };
});

import { CreateReport } from "./CreateReport";
import { clearDraft, loadDraft, saveDraft } from "../services/reportDraft";
import { clearPhotoStore } from "../services/photoStore";
import { todayInputValue } from "../utils/dates";

const FIELDS_OK = {
  ok: true,
  value: {
    suggestions: [
      { field: "title", suggestedValue: "Black umbrella", source: "extract-report-fields" },
    ],
    droppedCategory: false,
    action: { action: "NONE" },
  },
} as const;

const CATEGORY_OK = {
  ok: true,
  value: {
    suggestion: { suggestedCategory: "Keys", source: "classify-category" },
    dropped: false,
  },
} as const;

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

const DRAFT_KEY = "findback:reportDraft:v1:u1";

/**
 * Write a cold legacy payload straight into localStorage — the shape a previous
 * build left behind, not one `saveDraft` shaped today.
 */
function seedStoredDraft(patch: Record<string, unknown>): void {
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
      ...patch,
    }),
  );
}

function storedDraft(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(DRAFT_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
  suggestFieldsMock.mockReset();
  suggestCategoryMock.mockReset();
  nlHelperStateMock.mockReset();
  prewarmNeedleMock.mockReset();
  prewarmNeedleMock.mockResolvedValue(true);
  suggestFieldsMock.mockImplementation(async () => FIELDS_OK);
  suggestCategoryMock.mockImplementation(async () => CATEGORY_OK);
  nlHelperStateMock.mockResolvedValue("ready");
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

async function renderForm() {
  render(<CreateReport />);
  await screen.findByRole("textbox", { name: "Description" });
}

describe("CreateReport compact suggestion entry", () => {
  it("renders one primary description input and no second text entry", async () => {
    await renderForm();

    expect(screen.getAllByRole("textbox", { name: "Description" })).toHaveLength(1);
    expect(screen.queryByLabelText(/describe the item in your own words/i)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /describe the item/i })).toBeNull();
    // The old heading, instructions and panel are gone with the second box.
    expect(screen.queryByText(/fill missing details/i)).toBeNull();
    expect(screen.queryByText(/suggestions appear here one at a time/i)).toBeNull();
  });

  it("places the Suggest details action directly after the description with a 48px target that wraps", async () => {
    await renderForm();

    const description = screen.getByTestId("report-description");
    const action = screen.getByTestId("report-suggest-details");
    expect(description.nextElementSibling).toBe(action);

    const button = within(action).getByRole("button", { name: "Suggest details" });
    // Button size md is the app's 48px touch target.
    expect(button.className).toContain("min-h-[48px]");
    // The row wraps before it clips at narrow widths / large text.
    const row = button.parentElement;
    expect(row?.className).toContain("flex-wrap");
  });

  it("uses the existing title as input without a second box", async () => {
    await renderForm();
    fireEvent.change(screen.getByLabelText(/what did you lose/i), {
      target: { value: "Black umbrella lost near the market" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suggest details" }));

    await waitFor(() => expect(suggestFieldsMock).toHaveBeenCalledTimes(1));
    expect(suggestFieldsMock.mock.calls[0]![1]).toContain("Black umbrella lost near the market");
  });

  it("uses the existing description as input without a second box", async () => {
    seedDescription("Black umbrella lost near the central market");
    await renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Suggest details" }));

    await waitFor(() => expect(suggestFieldsMock).toHaveBeenCalledTimes(1));
    expect(suggestFieldsMock.mock.calls[0]![1]).toContain("Black umbrella lost near the central market");
  });

  it("never asks for suggestions automatically", async () => {
    seedDescription("Black umbrella lost near the central market");
    await renderForm();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(suggestFieldsMock).not.toHaveBeenCalled();
    expect(suggestCategoryMock).not.toHaveBeenCalled();
  });

  it("asks for title or description first, never for a removed box", async () => {
    await renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Suggest details" }));

    await screen.findByText(/Add a title or a description first/i);
    expect(screen.queryByText(/box above/i)).toBeNull();
    expect(suggestFieldsMock).not.toHaveBeenCalled();
  });
});

describe("CreateReport restored legacy helper note", () => {
  it("keeps a helper-only note in its draft until the person recovers it", async () => {
    const note = "Black umbrella with a blue sticker, lost near gate 3";
    seedStoredDraft({ aiSuggestInput: note });
    await renderForm();

    expect(screen.getByTestId("report-saved-note")).toBeTruthy();
    // Review is a separate, explicit step: the private note is not revealed on
    // mount.
    expect(screen.queryByTestId("report-saved-note-text")).toBeNull();
    const description = screen.getByRole("textbox", { name: "Description" });
    expect(description.textContent ?? "").not.toContain("blue sticker");

    // Autosave rewrites the draft; the legacy note survives it and the
    // description is still untouched. (`photoIds` marks the first save: the
    // cold payload written by the previous build has no such key.)
    await waitFor(() => expect(storedDraft()).toHaveProperty("photoIds"));
    expect(storedDraft()?.aiSuggestInput).toBe(note);
    expect(storedDraft()?.description).toBe("");

    // Leaving and returning restores the same note from the draft, not from
    // this component instance.
    cleanup();
    await renderForm();
    expect(screen.getByTestId("report-saved-note")).toBeTruthy();

    // The private note is never folded into the helper's inference input.
    fireEvent.click(screen.getByRole("button", { name: "Suggest details" }));
    await screen.findByText(/Add a title or a description first/i);
    expect(suggestFieldsMock).not.toHaveBeenCalled();

    // Recovery is an explicit second tap after the review.
    fireEvent.click(screen.getByRole("button", { name: "Recover saved note" }));
    expect((await screen.findByTestId("report-saved-note-text")).textContent).toBe(note);
    fireEvent.click(screen.getByRole("button", { name: "Use as description" }));

    await waitFor(() => {
      expect(storedDraft()?.aiSuggestInput).toBeUndefined();
      expect(storedDraft()?.description).toBe(note);
    });
    expect(loadDraft("u1")?.aiSuggestInput).toBeUndefined();
    expect(screen.queryByTestId("report-saved-note")).toBeNull();
  });

  it("appends a restored note to a written description without overwriting it", async () => {
    const description = "A black umbrella lost near the market.";
    const note = "It has a blue sticker and a cracked handle.";
    seedStoredDraft({ description, aiSuggestInput: note });
    await renderForm();

    const editor = screen.getByRole("textbox", { name: "Description" });
    await waitFor(() => expect(editor.textContent ?? "").toContain(description));
    expect(editor.textContent ?? "").not.toContain("cracked handle");
    expect(screen.getByTestId("report-saved-note")).toBeTruthy();

    // Autosave still round-trips the original description unchanged before any
    // recovery action.
    await waitFor(() => expect(storedDraft()).toHaveProperty("photoIds"));
    expect(storedDraft()?.description).toBe(description);
    expect(storedDraft()?.aiSuggestInput).toBe(note);

    fireEvent.click(screen.getByRole("button", { name: "Recover saved note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Append to description" }));

    await waitFor(() => {
      const text = screen.getByRole("textbox", { name: "Description" }).textContent ?? "";
      expect(text).toContain(description);
      expect(text).toContain(note);
    });
    await waitFor(() => {
      expect(storedDraft()?.aiSuggestInput).toBeUndefined();
      expect(storedDraft()?.description).toContain(description);
      expect(storedDraft()?.description).toContain(note);
    });
  });

  it("never grows a legacy note key on a fresh draft", async () => {
    await renderForm();
    expect(screen.queryByTestId("report-saved-note")).toBeNull();

    fireEvent.change(screen.getByLabelText(/what did you lose/i), {
      target: { value: "Lost umbrella" },
    });
    await waitFor(() => expect(loadDraft("u1")?.title).toBe("Lost umbrella"));
    await waitFor(() => expect(storedDraft()).toHaveProperty("photoIds"));
    expect(storedDraft()).not.toHaveProperty("aiSuggestInput");
  });
});
