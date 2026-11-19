// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatFile, isDocumentChatFile } from "./ChatFile";
import type { ChatFileMeta } from "../services/messaging/files";

const m = vi.hoisted(() => ({
  view: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../services/chatFileExport", () => ({
  viewChatFile: m.view,
  saveChatFile: m.save,
}));
vi.mock("../services/messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/messaging/files")>()),
  downloadChatFile: m.download,
}));

const pdf: ChatFileMeta = {
  key: "files/account/chat/q3-report.pdf",
  name: "Q3 report.pdf",
  mime: "application/pdf",
  byteSize: 1_258_291,
  kind: "pdf",
};
const zip: ChatFileMeta = {
  key: "files/account/chat/photos.zip",
  name: "photos.zip",
  mime: "application/zip",
  byteSize: 2048,
  kind: "archive",
};
const video: ChatFileMeta = {
  key: "files/account/chat/clip.mp4",
  name: "clip.mp4",
  mime: "video/mp4",
  byteSize: 2_400_000,
  kind: "video",
};
const audio: ChatFileMeta = {
  key: "files/account/chat/voice.m4a",
  name: "voice.m4a",
  mime: "audio/mp4",
  byteSize: 512_000,
  kind: "audio",
};

beforeEach(() => {
  m.view.mockReset();
  m.save.mockReset();
  m.download.mockReset();
  m.create.mockReset().mockReturnValue("blob:document");
  m.revoke.mockReset();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: m.create, revokeObjectURL: m.revoke,
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderDocument(meta = pdf) {
  return render(<ChatFile meta={meta} />);
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

/** The service's own error shape: an uppercase code plus a fixed message. */
function serviceError(code: string, message = "internal detail") {
  return Object.assign(new Error(message), { code });
}

describe("document classification", () => {
  it("takes only non-media files and leaves every media path canonical", () => {
    expect(isDocumentChatFile(pdf)).toBe(true);
    expect(isDocumentChatFile(zip)).toBe(true);
    expect(isDocumentChatFile({ ...pdf, kind: "document", mime: "text/plain" })).toBe(true);
    expect(isDocumentChatFile({ ...pdf, kind: "file", mime: "application/octet-stream" })).toBe(true);

    expect(isDocumentChatFile(video)).toBe(false);
    expect(isDocumentChatFile(audio)).toBe(false);
    // A sniffable raster keeps the private image row even though its stored
    // display kind is "document".
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      expect(isDocumentChatFile({ ...pdf, kind: "document", mime })).toBe(false);
    }
    // The allowlist is exact: a raster outside it is still a document row.
    expect(isDocumentChatFile({ ...pdf, kind: "document", mime: "image/avif" })).toBe(true);
  });
});

describe("compact document surface", () => {
  it("renders one integrated surface and fetches nothing on mount", () => {
    const { container } = renderDocument();

    expect(m.download).not.toHaveBeenCalled();
    expect(m.view).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();

    // One wrapper, no nested painted file card, icon tile or preview frame.
    expect(container.querySelector(".fb-chat-document")).toBeTruthy();
    expect(container.querySelector(".fb-chat-file")).toBeNull();
    expect(container.querySelector(".fb-chat-image-frame")).toBeNull();
    expect(container.querySelector("iframe, object, embed, img, video, audio")).toBeNull();

    expect(screen.getByText("Q3 report.pdf")).toBeTruthy();
    expect(screen.getByText("PDF · 1.2 MB")).toBeTruthy();
    // The owner's pair: the visible word is the accessible name's own start, so
    // a speech control can say "Save Q3 report.pdf" without guessing.
    expect(button("View Q3 report.pdf").textContent).toBe("View");
    expect(button("Save Q3 report.pdf").textContent).toBe("Save");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["pdf", "report.pdf", "application/pdf"],
    ["document", "notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["archive", "photos.zip", "application/zip"],
    ["file", "data.bin", "application/octet-stream"],
  ] as const)("gives the %s kind the same View/Save surface", (kind, name, mime) => {
    const meta: ChatFileMeta = { key: `files/account/chat/${name}`, name, mime, byteSize: 4096, kind };
    renderDocument(meta);
    expect(button(`View ${name}`)).toBeTruthy();
    expect(button(`Save ${name}`)).toBeTruthy();
    expect(document.querySelector(".fb-chat-document")).toBeTruthy();
    expect(document.querySelector(".fb-chat-file")).toBeNull();
    expect(m.download).not.toHaveBeenCalled();
  });
});

describe("view and save are distinct service calls", () => {
  it("uses only the view service and reports a web download honestly", async () => {
    m.view.mockResolvedValue({ status: "download-started" });
    renderDocument();

    fireEvent.click(button("View Q3 report.pdf"));
    expect(await screen.findByText("Download started.")).toBeTruthy();

    expect(m.view).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.revoke).not.toHaveBeenCalled();
  });

  it("stays idle after an opened external viewer", async () => {
    m.view.mockResolvedValue({ status: "opened" });
    renderDocument();

    fireEvent.click(button("View Q3 report.pdf"));
    await waitFor(() => expect(button("View Q3 report.pdf").disabled).toBe(false));
    expect(m.view).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says Saved to Downloads only for a completed save in Downloads", async () => {
    m.save.mockResolvedValue({ status: "saved", location: "downloads" });
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("Saved to Downloads.")).toBeTruthy();
    expect(m.save).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(m.view).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
  });

  it("says Saved without naming a folder when the service does not", async () => {
    m.save.mockResolvedValue({ status: "saved" });
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(screen.queryByText("Saved to Downloads.")).toBeNull();
  });

  it("never claims Saved for a browser download", async () => {
    m.save.mockResolvedValue({ status: "download-started" });
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("Download started.")).toBeTruthy();
    expect(screen.queryAllByText(/^Saved/)).toHaveLength(0);
  });

  it("returns to idle when the platform cancels, clearing any old notice", async () => {
    m.save.mockResolvedValue({ status: "download-started" });
    m.view.mockResolvedValue({ status: "cancelled" });
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("Download started.")).toBeTruthy();

    fireEvent.click(button("View Q3 report.pdf"));
    await waitFor(() => expect(button("View Q3 report.pdf").disabled).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps an unknown result status idle rather than inventing a save", async () => {
    m.save.mockResolvedValue({ status: "something-new" });
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    await waitFor(() => expect(button("Save Q3 report.pdf").disabled).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("busy and failure handling", () => {
  it("blocks a competing press on either action while one request is pending", async () => {
    let finish!: (value: { status: "opened" }) => void;
    m.view.mockImplementation(() => new Promise<{ status: "opened" }>((resolve) => { finish = resolve; }));
    renderDocument();

    const viewButton = button("View Q3 report.pdf");
    const saveButton = button("Save Q3 report.pdf");
    fireEvent.click(viewButton);
    await waitFor(() => expect(viewButton.disabled).toBe(true));
    expect(saveButton.disabled).toBe(true);

    fireEvent.click(saveButton);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.view).toHaveBeenCalledTimes(1);

    await act(async () => { finish({ status: "opened" }); });
    await waitFor(() => expect(viewButton.disabled).toBe(false));
    expect(saveButton.disabled).toBe(false);
    expect(m.view).toHaveBeenCalledTimes(1);
  });

  it("shows the fixed permission copy and lets the next press retry", async () => {
    m.view.mockRejectedValueOnce(serviceError("PERMISSION_DENIED"))
      .mockResolvedValueOnce({ status: "opened" });
    renderDocument();

    fireEvent.click(button("View Q3 report.pdf"));
    expect(await screen.findByText("You don’t have access to this file.")).toBeTruthy();
    expect(button("View Q3 report.pdf").disabled).toBe(false);

    fireEvent.click(button("View Q3 report.pdf"));
    await waitFor(() => expect(screen.queryByText("You don’t have access to this file.")).toBeNull());
    expect(m.view).toHaveBeenCalledTimes(2);
  });

  it("asks for storage access when the save itself is denied", async () => {
    m.save.mockRejectedValueOnce(serviceError("PERMISSION_DENIED", "files/u-1/chat/q3-report.pdf"));
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("Allow storage access to save files.")).toBeTruthy();
    // The service's message stays private: no path from the storage key.
    expect(screen.queryAllByText(/files\/u-1/)).toHaveLength(0);
  });

  it("offers Save when nothing on this device can open the file", async () => {
    m.view.mockRejectedValueOnce(serviceError("NO_HANDLER"));
    renderDocument();

    fireEvent.click(button("View Q3 report.pdf"));
    const notice = await screen.findByText("No app on this device can open this file. Save it instead.");
    // A limitation with a remedy, not a fault: neutral tone, both actions kept.
    expect(notice.getAttribute("data-tone")).toBe("status");
    expect(button("Save Q3 report.pdf").disabled).toBe(false);
    expect(button("View Q3 report.pdf")).toBeTruthy();
  });

  it("refuses a browser-unsupported view honestly instead of claiming Saved", async () => {
    m.view.mockRejectedValueOnce(serviceError("UNSUPPORTED_VIEW"));
    renderDocument();

    fireEvent.click(button("View Q3 report.pdf"));
    const notice = await screen.findByText(
      "Your browser can’t view this file. Save it and open it with a compatible app.",
    );
    expect(notice.getAttribute("data-tone")).toBe("status");
    expect(screen.queryAllByText(/^Saved/)).toHaveLength(0);
    // The pair is never reduced: Save is still there for the remedy.
    expect(button("Save Q3 report.pdf")).toBeTruthy();
  });

  it("calls a gone file gone", async () => {
    m.save.mockRejectedValueOnce(serviceError("NOT_FOUND"));
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("That file is no longer available.")).toBeTruthy();
  });

  it("surfaces a busy refusal from a competing file action instead of silence", async () => {
    m.save.mockRejectedValueOnce(serviceError("BUSY"));
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    const notice = await screen.findByText("Another file action is still running. Try again in a moment.");
    // A transient limitation, not a failure: neutral tone, never red.
    expect(notice.getAttribute("data-tone")).toBe("status");
    expect(screen.queryAllByText(/^Saved/)).toHaveLength(0);
    expect(button("Save Q3 report.pdf").disabled).toBe(false);
  });

  it("returns to idle when the platform throws a cancellation", async () => {
    m.save.mockRejectedValueOnce(serviceError("CANCELLED"));
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    await waitFor(() => expect(button("Save Q3 report.pdf").disabled).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryAllByText(/^Saved/)).toHaveLength(0);
  });

  it("never prints a provider message for an unclassified failure", async () => {
    m.save.mockRejectedValueOnce(serviceError("NETWORK_ERROR", "POST https://xyz.supabase.co/storage failed"));
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("That file couldn’t be saved. Try again.")).toBeTruthy();
    expect(screen.queryAllByText(/supabase\.co/)).toHaveLength(0);
  });

  it("names a plain failure with a save-specific retry line", async () => {
    m.save.mockRejectedValueOnce(new Error("boom"));
    renderDocument();

    fireEvent.click(button("Save Q3 report.pdf"));
    expect(await screen.findByText("That file couldn’t be saved. Try again.")).toBeTruthy();
    expect(button("Save Q3 report.pdf").disabled).toBe(false);
  });

  it("drops a completion from the previous file after the row switches", async () => {
    let finish!: (value: { status: "download-started" }) => void;
    m.view.mockImplementation(() => new Promise<{ status: "download-started" }>((resolve) => { finish = resolve; }));
    const view = renderDocument(pdf);

    fireEvent.click(button("View Q3 report.pdf"));
    await waitFor(() => expect(m.view).toHaveBeenCalledTimes(1));

    view.rerender(<ChatFile meta={zip} />);
    expect(screen.getByText("photos.zip")).toBeTruthy();

    await act(async () => { finish({ status: "download-started" }); });
    expect(screen.queryByText("Download started.")).toBeNull();
    expect(button("View photos.zip").disabled).toBe(false);
  });

  it("drops a completion when only the stored metadata changed under the same key", async () => {
    let finish!: (value: { status: "download-started" }) => void;
    m.view.mockImplementation(() => new Promise<{ status: "download-started" }>((resolve) => { finish = resolve; }));
    const view = renderDocument(pdf);

    fireEvent.click(button("View Q3 report.pdf"));
    await waitFor(() => expect(m.view).toHaveBeenCalledTimes(1));

    // Same key and name; only the stored bytes changed, so this is a different
    // file and the old completion must not paint into the new metadata.
    const replaced: ChatFileMeta = { ...pdf, mime: "application/octet-stream", byteSize: 4_000_000, kind: "file" };
    view.rerender(<ChatFile meta={replaced} />);
    expect(screen.getByText("PDF · 3.8 MB")).toBeTruthy();

    await act(async () => { finish({ status: "download-started" }); });
    expect(screen.queryByText("Download started.")).toBeNull();
    expect(button("View Q3 report.pdf").disabled).toBe(false);
  });

  it("ignores a completion after the row unmounts", async () => {
    let finish!: (value: { status: "download-started" }) => void;
    m.view.mockImplementation(() => new Promise<{ status: "download-started" }>((resolve) => { finish = resolve; }));
    const view = renderDocument();

    fireEvent.click(button("View Q3 report.pdf"));
    await waitFor(() => expect(m.view).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => { finish({ status: "download-started" }); });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
  });
});

/**
 * jsdom has no layout, so these read the declarations that own the compact
 * surface. Rendered pixels at 320px and a 32px root remain a deployed-browser
 * item; the owner's reference is geometry, not a white PDF preview to copy.
 */
describe("document surface declarations", () => {
  const css = readFileSync("src/components/ChatFile.css", "utf8");

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`missing rule ${selector}`);
    return css.slice(start, css.indexOf("}", start) + 1);
  }

  it("paints no inner card and leaves the shared raster row untouched", () => {
    const documentRow = rule(".fb-chat-document");
    expect(documentRow).toContain("background: transparent;");
    expect(documentRow).toContain("border: 0;");
    expect(documentRow).toContain("padding: 0;");
    expect(documentRow).toContain("width: 320px;");
    expect(documentRow).toContain("max-width: 100%;");

    // ChatImageFile still uses the painted shared row; only the document row
    // changed, so the private raster launch keeps its card.
    const fileRow = rule(".fb-chat-file");
    expect(fileRow).toContain("border: 1px solid var(--fb-outline-variant);");
    expect(fileRow).toContain("background: var(--fb-surface-container-low);");
    expect(fileRow).toContain("padding: 10px 12px;");
  });

  it("wraps a long filename and gives both actions equal 44px targets", () => {
    const name = rule(".fb-chat-document-name");
    expect(name).toContain("overflow-wrap: anywhere;");
    expect(name).toContain("word-break: normal;");
    expect(name).not.toContain("white-space: nowrap;");
    expect(name).not.toContain("text-overflow: ellipsis;");

    const actions = rule(".fb-chat-document-actions");
    expect(actions).toContain("grid-template-columns: 1fr 1fr;");
    expect(actions).toContain("border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent);");

    const action = rule(".fb-chat-document-action");
    expect(action).toContain("min-height: 44px;");
    expect(action).toContain("background: transparent;");
  });
});
