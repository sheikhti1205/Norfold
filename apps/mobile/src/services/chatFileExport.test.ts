// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  isNative: false,
  platform: "web" as string,
  pluginAvailable: true,
  handlers: [] as Array<(event: string, session: { user: { id: string } } | null) => void>,
  registerPlugin: vi.fn(),
  getSupabase: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  signed: vi.fn(),
  download: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => m.isNative,
    getPlatform: () => m.platform,
    isPluginAvailable: () => m.pluginAvailable,
  },
  registerPlugin: (name: string) => m.registerPlugin(name),
}));

vi.mock("./supabaseClient", () => ({
  getSupabase: (...args: unknown[]) => m.getSupabase(...args),
  getSupabaseBackendUrl: () => "https://project.supabase.co",
}));

vi.mock("./messaging/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./messaging/files")>()),
  signedChatFileUrl: m.signed,
  downloadChatFile: m.download,
}));

import { ChatFileExportError, saveChatFile, viewChatFile } from "./chatFileExport";
import type { ChatFileMeta } from "./messaging/files";

const SIGN_KEY = "files/11111111-1111-4111-8111-111111111111/"
  + "22222222-2222-4222-8222-222222222222/"
  + "33333333-3333-4333-8333-333333333333-report.pdf";
const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/"
  + "findback-chat-files/files/11111111-1111-4111-8111-111111111111/"
  + "22222222-2222-4222-8222-222222222222/"
  + "33333333-3333-4333-8333-333333333333-report.pdf?token=scoped";
const PDF_BYTES = "%PDF-1.7";
const TEXT_BYTES = "a,b\n1,2";

const pdfMeta: ChatFileMeta = {
  key: SIGN_KEY,
  name: "report.pdf",
  mime: "application/pdf",
  byteSize: PDF_BYTES.length,
  kind: "pdf",
};
const textMeta: ChatFileMeta = {
  key: SIGN_KEY,
  name: "rows.csv",
  mime: "text/csv",
  byteSize: TEXT_BYTES.length,
  kind: "document",
};

const bridge = {
  saveToDownloads: vi.fn(),
  openDocument: vi.fn(),
  cancelExport: vi.fn(),
};

const openMock = vi.fn();
let clicked: HTMLAnchorElement | null = null;

function session(id: string | null) {
  return { data: { session: id ? { user: { id } } : null }, error: null };
}

function blobOf(text: string, type = "application/octet-stream"): Blob {
  return new Blob([text], { type });
}

function viewerStub() {
  return {
    closed: false,
    opener: {} as unknown,
    location: { href: "about:blank" },
    close: vi.fn(),
  };
}

async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

function fireAuth(event: string, id: string | null): void {
  const next = id === null ? null : { user: { id } };
  for (const handler of [...m.handlers]) handler(event, next);
}

beforeEach(() => {
  m.handlers.length = 0;
  m.onAuthStateChange.mockReset();
  m.onAuthStateChange.mockImplementation((callback: typeof m.handlers[number]) => {
    m.handlers.push(callback);
    return { data: { subscription: { unsubscribe: m.unsubscribe } } };
  });
  m.isNative = false;
  m.platform = "web";
  m.pluginAvailable = true;
  m.registerPlugin.mockReset();
  m.registerPlugin.mockReturnValue(bridge);
  m.getSupabase.mockReset();
  m.getSupabase.mockReturnValue({
    auth: { getSession: m.getSession, onAuthStateChange: m.onAuthStateChange },
  });
  m.getSession.mockReset();
  m.getSession.mockResolvedValue(session("account-a"));
  m.unsubscribe.mockReset();
  m.signed.mockReset();
  m.signed.mockResolvedValue(SIGNED_URL);
  m.download.mockReset();
  m.createObjectURL.mockReset();
  m.createObjectURL.mockReturnValue("blob:download");
  m.revokeObjectURL.mockReset();
  bridge.saveToDownloads.mockReset();
  bridge.openDocument.mockReset();
  bridge.cancelExport.mockReset();
  bridge.cancelExport.mockResolvedValue({ cancelled: true });
  openMock.mockReset();
  openMock.mockReturnValue(viewerStub());
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: openMock });
  clicked = null;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    // The anchor is mounted only for the click, so capture it from the DOM the
    // way a browser would hand it the event.
    clicked = document.querySelector<HTMLAnchorElement>("a[download]");
  });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: m.createObjectURL,
    revokeObjectURL: m.revokeObjectURL,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("side-effect free import", () => {
  it("does not touch auth, the SDK, the native plugin or a window until an action", () => {
    expect(m.getSupabase).not.toHaveBeenCalled();
    expect(m.getSession).not.toHaveBeenCalled();
    expect(m.onAuthStateChange).not.toHaveBeenCalled();
    expect(m.registerPlugin).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });
});

describe("web save", () => {
  it("copies the exact bytes to a browser download and never claims Saved", async () => {
    m.download.mockResolvedValue(blobOf(PDF_BYTES, "application/pdf"));

    await expect(saveChatFile(pdfMeta)).resolves.toEqual({ status: "download-started" });

    expect(m.download).toHaveBeenCalledExactlyOnceWith(SIGN_KEY);
    expect(m.signed).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
    expect(clicked).not.toBeNull();
    expect(clicked!.download).toBe("report.pdf");
    expect(clicked!.href).toBe("blob:download");
    expect(clicked!.rel).toContain("noopener");
    const typed = m.createObjectURL.mock.calls[0]![0] as Blob;
    expect(typed.type).toBe("application/pdf");
    expect(typed.size).toBe(PDF_BYTES.length);
    expect(m.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("uses the neutral .download name and octet-stream for a refused extension", async () => {
    const meta: ChatFileMeta = {
      ...pdfMeta,
      name: "invoice.html",
      mime: "text/html",
      byteSize: PDF_BYTES.length,
      kind: "document",
    };
    m.download.mockResolvedValue(blobOf(PDF_BYTES, "text/html"));

    await expect(saveChatFile(meta)).resolves.toEqual({ status: "download-started" });
    expect(clicked!.download).toBe("invoice.download");
    expect((m.createObjectURL.mock.calls[0]![0] as Blob).type).toBe("application/octet-stream");
  });

  it("refuses a size that does not match the authorized metadata", async () => {
    m.download.mockResolvedValue(blobOf(PDF_BYTES));
    await expect(saveChatFile({ ...pdfMeta, byteSize: PDF_BYTES.length + 1 }))
      .rejects.toMatchObject({ code: "SIZE_MISMATCH" });
    expect(m.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toBeNull();
  });

  it("refuses a meta size above the 20 MB transport ceiling before downloading", async () => {
    await expect(saveChatFile({ ...pdfMeta, byteSize: 20 * 1024 * 1024 + 1 }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(m.download).not.toHaveBeenCalled();
  });

  it("fails closed with PERMISSION_DENIED when the canonical session is absent", async () => {
    m.getSession.mockResolvedValue(session(null));
    await expect(saveChatFile(pdfMeta)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "You don't have access to this file.",
    });
    expect(m.download).not.toHaveBeenCalled();
  });

  it("drops a download that completes after sign-out and never clicks a late anchor", async () => {
    let finish!: (blob: Blob) => void;
    m.download.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const pending = saveChatFile(pdfMeta);
    await flush();
    expect(m.download).toHaveBeenCalledTimes(1);

    fireAuth("SIGNED_OUT", null);
    finish(blobOf(PDF_BYTES));

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(clicked).toBeNull();
    expect(m.createObjectURL).not.toHaveBeenCalled();
  });

  it("fences an A -> B -> A account change during the download", async () => {
    let finish!: (blob: Blob) => void;
    m.download.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const pending = saveChatFile(pdfMeta);
    await flush();

    fireAuth("SIGNED_IN", "account-b");
    fireAuth("SIGNED_IN", "account-a");
    finish(blobOf(PDF_BYTES));

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(clicked).toBeNull();
  });

  it("fences an account change discovered by the post-download session read", async () => {
    m.download.mockResolvedValue(blobOf(PDF_BYTES));
    m.getSession
      .mockResolvedValueOnce(session("account-a"))
      .mockResolvedValueOnce(session("account-b"));

    await expect(saveChatFile(pdfMeta)).resolves.toEqual({ status: "cancelled" });
    expect(clicked).toBeNull();
    expect(m.createObjectURL).not.toHaveBeenCalled();
  });

  it("revokes the download object URL after the bounded 60-second window", async () => {
    vi.useFakeTimers();
    m.download.mockResolvedValue(blobOf(PDF_BYTES));

    await saveChatFile(pdfMeta);
    expect(m.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });
});

describe("web view", () => {
  it("opens a PDF only after its %PDF- prefix is verified", async () => {
    const viewer = viewerStub();
    openMock.mockReturnValue(viewer as unknown as Window);
    m.createObjectURL.mockReturnValue("blob:view");
    m.download.mockResolvedValue(blobOf(PDF_BYTES, "application/pdf"));

    await expect(viewChatFile(pdfMeta)).resolves.toEqual({ status: "opened" });

    expect(openMock).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank");
    expect(viewer.opener).toBeNull();
    expect(viewer.location.href).toBe("blob:view");
    expect(clicked).toBeNull();
    expect(m.signed).not.toHaveBeenCalled();
    expect((m.createObjectURL.mock.calls[0]![0] as Blob).type).toBe("application/pdf");
  });

  it("refuses bytes relabelled as PDF instead of opening them", async () => {
    const viewer = viewerStub();
    openMock.mockReturnValue(viewer as unknown as Window);
    m.download.mockResolvedValue(blobOf("<html><script>alert(1)</script>", "application/pdf"));

    await expect(viewChatFile(pdfMeta)).rejects.toMatchObject({
      code: "UNSUPPORTED_VIEW",
      message: "Your browser can’t view this file. Save it and open it with a compatible app.",
    });
    expect(viewer.close).toHaveBeenCalled();
    expect(m.createObjectURL).not.toHaveBeenCalled();
  });

  it("forces text-like documents to plain UTF-8 text", async () => {
    const viewer = viewerStub();
    openMock.mockReturnValue(viewer as unknown as Window);
    m.createObjectURL.mockReturnValue("blob:view");
    m.download.mockResolvedValue(blobOf(TEXT_BYTES, "text/csv"));

    await expect(viewChatFile(textMeta)).resolves.toEqual({ status: "opened" });
    const typed = m.createObjectURL.mock.calls[0]![0] as Blob;
    expect(typed.type).toBe("text/plain;charset=utf-8");
    expect(typed.size).toBe(TEXT_BYTES.length);
    expect(viewer.location.href).toBe("blob:view");
  });

  it.each([
    ["page.html", "text/html"],
    ["icon.svg", "image/svg+xml"],
    ["script.js", "text/javascript"],
  ])("never gives %s a live viewer type", async (name, mime) => {
    const meta: ChatFileMeta = { ...pdfMeta, name, mime, kind: "document" };
    await expect(viewChatFile(meta)).rejects.toMatchObject({ code: "UNSUPPORTED_VIEW" });
    expect(openMock).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
  });

  it("reports a blocked viewer tab honestly without downloading", async () => {
    openMock.mockReturnValue(null);
    await expect(viewChatFile(pdfMeta)).rejects.toMatchObject({ code: "UNSUPPORTED_VIEW" });
    expect(m.download).not.toHaveBeenCalled();
  });

  it("closes the reserved viewer when the export cannot subscribe to auth", async () => {
    const viewer = viewerStub();
    openMock.mockReturnValue(viewer as unknown as Window);
    m.getSupabase.mockImplementation(() => {
      throw new Error("auth client unavailable");
    });

    const error = await viewChatFile(pdfMeta).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    // The blank tab is released exactly once and no bytes were fetched. The
    // raw client message never reaches the reader.
    expect(viewer.close).toHaveBeenCalledTimes(1);
    expect(m.download).not.toHaveBeenCalled();
    expect(m.createObjectURL).not.toHaveBeenCalled();
    expect(String((error as Error).message)).not.toContain("auth client unavailable");
  });

  it("does not fake an opened viewer after sign-out during the download", async () => {
    const viewer = viewerStub();
    openMock.mockReturnValue(viewer as unknown as Window);
    let finish!: (blob: Blob) => void;
    m.download.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const pending = viewChatFile(pdfMeta);
    await flush();

    fireAuth("SIGNED_OUT", null);
    finish(blobOf(PDF_BYTES));

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(viewer.location.href).toBe("about:blank");
    expect(viewer.close).toHaveBeenCalled();
    expect(m.createObjectURL).not.toHaveBeenCalled();
  });

  it("closes a user-closed placeholder instead of claiming a viewer opened", async () => {
    const viewer = viewerStub();
    viewer.closed = true;
    openMock.mockReturnValue(viewer as unknown as Window);
    m.download.mockResolvedValue(blobOf(PDF_BYTES));

    await expect(viewChatFile(pdfMeta)).resolves.toEqual({ status: "cancelled" });
    expect(m.createObjectURL).not.toHaveBeenCalled();
  });

  it("reports an unsupported type, then lets Save copy it honestly", async () => {
    const zip: ChatFileMeta = { ...pdfMeta, name: "photos.zip", mime: "application/zip", byteSize: 4, kind: "archive" };
    await expect(viewChatFile(zip)).rejects.toMatchObject({ code: "UNSUPPORTED_VIEW" });
    expect(m.download).not.toHaveBeenCalled();

    m.download.mockResolvedValue(blobOf("PK\u0003\u0004", "application/zip"));
    await expect(saveChatFile(zip)).resolves.toEqual({ status: "download-started" });
    expect(clicked!.download).toBe("photos.zip");
  });
});

describe("android bridge", () => {
  function android(): void {
    m.isNative = true;
    m.platform = "android";
    m.pluginAvailable = true;
    m.registerPlugin.mockReturnValue(bridge);
  }

  it("saves to Downloads only after the native plugin resolves saved:true", async () => {
    android();
    bridge.saveToDownloads.mockResolvedValue({ saved: true, name: "report.pdf" });

    await expect(saveChatFile(pdfMeta)).resolves.toEqual({
      status: "saved",
      location: "downloads",
    });

    expect(m.registerPlugin).toHaveBeenCalledWith("FindbackFileExport");
    expect(m.signed).toHaveBeenCalledExactlyOnceWith(SIGN_KEY, 60);
    const request = bridge.saveToDownloads.mock.calls[0]![0] as {
      requestId: string; url: string; name: string; mime: string; byteSize: number;
    };
    expect(request).toEqual({
      requestId: expect.any(String),
      url: SIGNED_URL,
      name: "report.pdf",
      mime: "application/pdf",
      byteSize: PDF_BYTES.length,
    });
    // The scoped URL goes to native only: never a browser download or anchor.
    expect(m.download).not.toHaveBeenCalled();
    expect(m.createObjectURL).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
    expect(clicked).toBeNull();
    expect(m.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("opens the document through the native viewer and nothing else", async () => {
    android();
    bridge.openDocument.mockResolvedValue({ opened: true });

    await expect(viewChatFile(pdfMeta)).resolves.toEqual({ status: "opened" });
    expect(m.signed).toHaveBeenCalledWith(SIGN_KEY, 60);
    expect(bridge.openDocument).toHaveBeenCalledTimes(1);
    expect(m.download).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it("maps a denied export without leaking native text, a URL or a token", async () => {
    android();
    bridge.saveToDownloads.mockRejectedValue({
      code: "PERMISSION_DENIED",
      message: `denied ${SIGNED_URL}`,
    });

    const error = await saveChatFile(pdfMeta).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChatFileExportError);
    expect(error).toMatchObject({
      code: "PERMISSION_DENIED",
      message: "You don't have access to this file.",
    });
    expect(String((error as Error).message)).not.toContain("token");
  });

  it("maps platform cancellation to a cancelled result, not a false save", async () => {
    android();
    bridge.saveToDownloads.mockRejectedValue({ code: "ABORTED", message: "user cancelled" });

    await expect(saveChatFile(pdfMeta)).resolves.toEqual({ status: "cancelled" });
    const requestId = bridge.saveToDownloads.mock.calls[0]![0].requestId as string;
    expect(bridge.cancelExport).toHaveBeenCalledWith({ requestId });
  });

  it("maps missing handlers and storage/size failures to their fixed codes", async () => {
    android();
    bridge.openDocument.mockRejectedValueOnce({ code: "ACTIVITY_NOT_FOUND", message: "no app" });
    await expect(viewChatFile(pdfMeta)).rejects.toMatchObject({ code: "NO_HANDLER" });

    bridge.saveToDownloads.mockRejectedValueOnce({ code: "INSUFFICIENT_STORAGE", message: "full" });
    await expect(saveChatFile(pdfMeta)).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE" });

    bridge.saveToDownloads.mockRejectedValueOnce({ code: "SIZE_MISMATCH", message: "short" });
    await expect(saveChatFile(pdfMeta)).rejects.toMatchObject({ code: "SIZE_MISMATCH" });
  });

  it("never reports saved for a plugin reply that is not saved:true", async () => {
    android();
    bridge.saveToDownloads.mockResolvedValue({ saved: false });
    await expect(saveChatFile(pdfMeta)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("fails closed with NO_HANDLER when this Android build lacks the plugin", async () => {
    android();
    m.pluginAvailable = false;

    await expect(saveChatFile(pdfMeta)).rejects.toMatchObject({ code: "NO_HANDLER" });
    // No web fallback and no token were created for a missing native handler.
    expect(m.signed).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
    expect(m.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toBeNull();
  });

  it("rejects a non-Android native shell explicitly instead of promising Downloads", async () => {
    m.isNative = true;
    m.platform = "ios";

    await expect(viewChatFile(pdfMeta)).rejects.toMatchObject({ code: "NO_HANDLER" });
    expect(m.signed).not.toHaveBeenCalled();
    expect(m.download).not.toHaveBeenCalled();
  });

  it("cancels the active native request on sign-out and discards its late success", async () => {
    android();
    let finish!: (value: { saved: boolean }) => void;
    bridge.saveToDownloads.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = saveChatFile(pdfMeta);
    await flush();
    expect(bridge.saveToDownloads).toHaveBeenCalledTimes(1);

    fireAuth("SIGNED_OUT", null);
    const requestId = bridge.saveToDownloads.mock.calls[0]![0].requestId as string;
    expect(bridge.cancelExport).toHaveBeenCalledWith({ requestId });
    finish({ saved: true });

    await expect(pending).resolves.toEqual({ status: "cancelled" });
  });

  it("cancels on an A -> B -> A switch and never returns a stale saved result", async () => {
    android();
    let finish!: (value: { saved: boolean }) => void;
    bridge.saveToDownloads.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = saveChatFile(pdfMeta);
    await flush();

    fireAuth("SIGNED_IN", "account-b");
    fireAuth("SIGNED_IN", "account-a");
    const requestId = bridge.saveToDownloads.mock.calls[0]![0].requestId as string;
    expect(bridge.cancelExport).toHaveBeenCalledWith({ requestId });
    finish({ saved: true });

    await expect(pending).resolves.toEqual({ status: "cancelled" });
  });

  it("does not launch native work after sign-out during signing", async () => {
    android();
    let finish!: (url: string) => void;
    m.signed.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const pending = saveChatFile(pdfMeta);
    await flush();

    fireAuth("SIGNED_OUT", null);
    finish(SIGNED_URL);

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(bridge.saveToDownloads).not.toHaveBeenCalled();
  });

  it("allows only one active export per account at a time", async () => {
    android();
    let finish!: (value: { saved: boolean }) => void;
    bridge.saveToDownloads.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = saveChatFile(pdfMeta);
    await flush();

    // A second press is told the other action is still running; it is not
    // collapsed into a cancellation the reader would see as silence.
    await expect(saveChatFile(pdfMeta)).rejects.toMatchObject({
      code: "BUSY",
      message: "Another file action is still finishing. Try again in a moment.",
    });
    expect(bridge.saveToDownloads).toHaveBeenCalledTimes(1);

    finish({ saved: true });
    await expect(first).resolves.toEqual({ status: "saved", location: "downloads" });
  });
});

describe("error contract", () => {
  it("is a real Error with the frozen code union", () => {
    const error = new ChatFileExportError("NOT_FOUND", "That file is no longer available.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ChatFileExportError");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("That file is no longer available.");
  });
});
