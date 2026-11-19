import { Capacitor, registerPlugin } from "@capacitor/core";
import { ApiError } from "./session";
import {
  CHAT_FILE_MAX_BYTES,
  chatFileExportIdentity,
  downloadChatFile,
  isSignableChatFileKey,
  signedChatFileUrl,
  type ChatFileMeta,
} from "./messaging/files";
import { getSupabase } from "./supabaseClient";

/**
 * Export one conversation file to the platform's viewer or a real save.
 *
 * This service is the only owner of the bytes between private Storage and the
 * outside world. It never renders a document in the app's origin and never
 * embeds one: View hands a forced, non-executable type to an external viewer,
 * Save copies the exact stored bytes under a cleaned name.
 *
 * Platform split, and why:
 * - Android streams a 60-second signed Storage URL through the native
 *   `FindbackFileExport` bridge. A 20 MB base64 payload over the JS bridge
 *   would cost roughly 26.7 MB plus a second copy, so bytes never transit JS.
 * - Windows/web uses the canonical authenticated Storage download, then a
 *   typed Blob and the normal browser file flow. A signed URL is never handed
 *   to a browser anchor: that would expose the scoped token and skip the
 *   export identity clamp.
 * - Viewing is deliberately narrow on the web: PDF (after a `%PDF-` prefix
 *   check) and plain-text-like documents, forced to `text/plain;charset=utf-8`.
 *   Anything else says it cannot be viewed and asks the reader to save it -
 *   there is no hidden Save, no fake "opened" and no inline preview.
 *
 * A "opened" result means the viewer was requested and navigated, not that the
 * external application painted; that remains an unverified browser/platform
 * acceptance item. A "download-started" result is never "saved".
 *
 * Import is side-effect free: no SDK client, auth subscription, plugin
 * registration or window access happens until a person presses View or Save.
 */

export type ChatFileExportCode =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CANCELLED"
  | "BUSY"
  | "NO_HANDLER"
  | "SIZE_MISMATCH"
  | "INSUFFICIENT_STORAGE"
  | "NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_VIEW";

export class ChatFileExportError extends Error {
  /** Stable consumer code; the fixed message map is what a reader sees. */
  readonly code?: ChatFileExportCode;

  constructor(code: ChatFileExportCode, message: string) {
    super(message);
    this.name = "ChatFileExportError";
    this.code = code;
  }
}

export interface ChatFileExportViewResult {
  status: "opened" | "download-started" | "cancelled";
}

export interface ChatFileExportSaveResult {
  status: "saved" | "download-started" | "cancelled";
  location?: "downloads";
}

type ExportAction = "view" | "save";

/** Fixed consumer copy. Raw platform text, URLs and tokens are never shown. */
const MESSAGES = {
  permission: "You don't have access to this file.",
  notFound: "That file is no longer available.",
  cancelled: "Export cancelled.",
  busy: "Another file action is still finishing. Try again in a moment.",
  noHandlerView: "No app on this device can open that file. Save it instead.",
  noHandlerSave: "This device can't save that file here. Try View instead.",
  otherPlatform: "Saving and opening files isn't available on this platform yet.",
  pluginMissing: "This app version can't export files yet. Update Norfold and try again.",
  unsupportedView: "Your browser can’t view this file. Save it and open it with a compatible app.",
  popupBlocked: "Your browser blocked the viewer tab. Allow pop-ups, or save the file instead.",
  size: "That file could not be exported intact. Try again.",
  storage: "There isn't enough free space to save that file.",
  viewFailed: "That file couldn't be opened. Try again.",
  saveFailed: "That file couldn't be saved. Try again.",
  invalid: "That file can't be exported.",
} as const;

const NATIVE_PLUGIN = "FindbackFileExport";
/** One browser object URL lives at most this long; auth invalidation is sooner. */
const OBJECT_URL_LIFETIME_MS = 60_000;

/**
 * Only these types have an honest web viewer here. CSV/Markdown/JSON/XML are
 * forced to plain text so their bytes can never run as HTML or SVG, and PDF is
 * additionally checked for its `%PDF-` prefix before the viewer sees it.
 */
const WEB_TEXT_VIEW_MIMES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
]);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // "%PDF-"

interface ExportOperation {
  aborted: boolean;
  account: string | null;
  accountKnown: boolean;
  abortHandlers: Array<() => void>;
  subscription?: { unsubscribe?: () => void };
}

interface NativeExportRequest {
  requestId: string;
  url: string;
  name: string;
  mime: string;
  byteSize: number;
}

interface NativeFileExportBridge {
  saveToDownloads(request: NativeExportRequest): Promise<{ saved?: boolean; name?: string } | null>;
  openDocument(request: NativeExportRequest): Promise<{ opened?: boolean } | null>;
  cancelExport(request: { requestId: string }): Promise<{ cancelled?: boolean } | null>;
}

const activeAccounts = new Set<string>();

function invalid(): ChatFileExportError {
  return new ChatFileExportError("INVALID_REQUEST", MESSAGES.invalid);
}

function cancelled(): ChatFileExportError {
  return new ChatFileExportError("CANCELLED", MESSAGES.cancelled);
}

function noHandler(action: ExportAction, pluginMissing = false): ChatFileExportError {
  return new ChatFileExportError(
    "NO_HANDLER",
    pluginMissing ? MESSAGES.pluginMissing : action === "view" ? MESSAGES.noHandlerView : MESSAGES.noHandlerSave,
  );
}

function platformKind(): "web" | "android" | "other-native" {
  try {
    if (!Capacitor.isNativePlatform()) return "web";
    return Capacitor.getPlatform() === "android" ? "android" : "other-native";
  } catch {
    return "web";
  }
}

/**
 * A lazy native bridge: merely importing this module (or rendering a media
 * row that never presses View/Save) must not touch the Capacitor plugin.
 */
function nativeBridge(): NativeFileExportBridge {
  if (typeof Capacitor.isPluginAvailable === "function" && !Capacitor.isPluginAvailable(NATIVE_PLUGIN)) {
    throw noHandler("save", true);
  }
  try {
    return registerPlugin<NativeFileExportBridge>(NATIVE_PLUGIN);
  } catch {
    throw noHandler("save", true);
  }
}

function newRequestId(): string {
  // A request id lets the native side cancel exactly the operation a
  // sign-out or account switch abandoned. Without a UUID source this build
  // cannot fence the request, so it declines instead of guessing.
  const source = globalThis.crypto;
  const value = source !== undefined && typeof source.randomUUID === "function"
    ? source.randomUUID()
    : "";
  if (value === "") throw invalid();
  return value;
}

function checkedMeta(meta: ChatFileMeta): { name: string; mime: string; byteSize: number } {
  if (typeof meta !== "object" || meta === null) throw invalid();
  if (!isSignableChatFileKey(meta.key)) throw invalid();
  if (typeof meta.name !== "string" || meta.name.trim() === "" || meta.name.length > 400) throw invalid();
  if (typeof meta.mime !== "string") throw invalid();
  if (typeof meta.byteSize !== "number"
    || !Number.isSafeInteger(meta.byteSize)
    || meta.byteSize <= 0
    || meta.byteSize > CHAT_FILE_MAX_BYTES) {
    throw invalid();
  }
  const identity = chatFileExportIdentity(meta);
  if (identity.name === "" || identity.mime === "") throw invalid();
  return { name: identity.name, mime: identity.mime, byteSize: meta.byteSize };
}

function abortOperation(operation: ExportOperation): void {
  if (operation.aborted) return;
  operation.aborted = true;
  const handlers = operation.abortHandlers.splice(0);
  for (const handler of handlers) {
    try {
      handler();
    } catch {
      // Cleanup is best effort; the late completion is still fenced below.
    }
  }
}

function beginOperation(): ExportOperation {
  const operation: ExportOperation = {
    aborted: false,
    account: null,
    accountKnown: false,
    abortHandlers: [],
  };
  // Subscribe BEFORE the asynchronous getSession so an overlapping sign-out
  // or account switch is observed even while the first session read is in
  // flight. The subscription belongs to this operation and is released in its
  // finally block.
  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    const next = session?.user.id ?? null;
    if (event === "SIGNED_OUT") {
      abortOperation(operation);
      return;
    }
    if (next === null) return;
    if (!operation.accountKnown) {
      operation.account = next;
      operation.accountKnown = true;
      return;
    }
    if (next !== operation.account) abortOperation(operation);
  });
  operation.subscription = data?.subscription;
  return operation;
}

function endOperation(operation: ExportOperation): void {
  operation.abortHandlers.length = 0;
  try {
    operation.subscription?.unsubscribe?.();
  } catch {
    // The SDK is already tearing the session down.
  }
}

async function captureAccount(operation: ExportOperation): Promise<string> {
  const { data, error } = await getSupabase().auth.getSession();
  const id = data?.session?.user.id ?? null;
  if (operation.aborted) throw cancelled();
  if (error || !id) throw new ChatFileExportError("PERMISSION_DENIED", MESSAGES.permission);
  if (!operation.accountKnown) {
    operation.account = id;
    operation.accountKnown = true;
  } else if (operation.account !== id) {
    abortOperation(operation);
    throw cancelled();
  }
  return id;
}

/** Re-read the canonical session immediately before any launch or success. */
async function assertSameAccount(operation: ExportOperation, account: string): Promise<void> {
  if (operation.aborted) throw cancelled();
  const { data } = await getSupabase().auth.getSession();
  const id = data?.session?.user.id ?? null;
  if (operation.aborted || id !== account || operation.account !== account) throw cancelled();
}

function claimAccount(account: string): void {
  if (activeAccounts.has(account)) throw new ChatFileExportError("BUSY", MESSAGES.busy);
  activeAccounts.add(account);
}

function releaseAccount(account: string | null): void {
  if (account !== null) activeAccounts.delete(account);
}

function assertByteSize(actual: number, expected: number): void {
  if (actual !== expected || actual > CHAT_FILE_MAX_BYTES) {
    throw new ChatFileExportError("SIZE_MISMATCH", MESSAGES.size);
  }
}

function webViewMime(mime: string): "application/pdf" | "text/plain;charset=utf-8" | null {
  if (mime === "application/pdf") return "application/pdf";
  return WEB_TEXT_VIEW_MIMES.has(mime) ? "text/plain;charset=utf-8" : null;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length === PDF_MAGIC.length && PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

function openViewer(): Window | null {
  if (typeof window === "undefined" || typeof window.open !== "function") return null;
  // Reserved synchronously on the press, before the first await, because a
  // later popup is normally blocked. The placeholder inherits this origin but
  // its opener is severed before any signed-in data exists in it. The tab is
  // navigated only to a locally-created blob URL with a forced non-executable
  // type; it never receives the signed Storage URL.
  const viewer = window.open("about:blank", "_blank");
  if (!viewer) return null;
  try {
    viewer.opener = null;
  } catch {
    // Some browsers expose a read-only opener; the tab is still blank.
  }
  return viewer;
}

function closeViewer(viewer: Window | null): void {
  if (!viewer) return;
  try {
    if (!viewer.closed) viewer.close();
  } catch {
    // Already gone; nothing to release.
  }
}

/**
 * Subscribe this export to auth. The viewer tab is already open, so a failure
 * here (for example the SDK client refusing to construct) must release it once
 * instead of leaving a blank orphan in the reader's window list. The caller's
 * try/finally owns every later release; this path never reaches it.
 */
function beginViewerOperation(viewer: Window | null): ExportOperation {
  try {
    return beginOperation();
  } catch (error) {
    closeViewer(viewer);
    throw error;
  }
}

function scheduleObjectUrlRevoke(url: string): void {
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // The URL was already revoked during an account change.
    }
  }, OBJECT_URL_LIFETIME_MS);
}

/**
 * Map any failure onto the fixed taxonomy. The thrown message never carries a
 * raw platform string: a storage path, signed URL or token must not reach the
 * reader or a log line.
 */
function translateFailure(error: unknown, action: ExportAction): ChatFileExportError {
  if (error instanceof ChatFileExportError) return error;
  if (error instanceof ApiError) {
    if (error.status === 400 || error.status === 404) {
      return new ChatFileExportError("NOT_FOUND", MESSAGES.notFound);
    }
    if (error.status === 401 || error.status === 403) {
      return new ChatFileExportError("PERMISSION_DENIED", MESSAGES.permission);
    }
    return new ChatFileExportError("NETWORK_ERROR", action === "view" ? MESSAGES.viewFailed : MESSAGES.saveFailed);
  }
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
  const text = typeof record.message === "string" ? record.message : "";
  switch (code) {
    case "CANCELLED":
    case "ABORTED":
      return cancelled();
    case "PERMISSION_DENIED":
    case "DENIED":
    case "EACCES":
    case "EPERM":
      return new ChatFileExportError("PERMISSION_DENIED", MESSAGES.permission);
    case "NOT_FOUND":
    case "ENOENT":
    case "OBJECT_NOT_FOUND":
    case "NO_SUCH_FILE":
      return new ChatFileExportError("NOT_FOUND", MESSAGES.notFound);
    case "NO_HANDLER":
    case "ACTIVITY_NOT_FOUND":
    case "NO_ACTIVITY":
    case "HANDLER_NOT_FOUND":
      return noHandler(action);
    case "SIZE_MISMATCH":
    case "TRUNCATED":
    case "CONTENT_LENGTH_MISMATCH":
      return new ChatFileExportError("SIZE_MISMATCH", MESSAGES.size);
    case "INSUFFICIENT_STORAGE":
    case "ENOSPC":
      return new ChatFileExportError("INSUFFICIENT_STORAGE", MESSAGES.storage);
    case "INVALID_REQUEST":
    case "BAD_REQUEST":
    case "BAD_URI":
      return invalid();
    case "UNSUPPORTED_VIEW":
      return new ChatFileExportError("UNSUPPORTED_VIEW", MESSAGES.unsupportedView);
    case "NOT_IMPLEMENTED":
    case "UNAVAILABLE":
    case "PLUGIN_NOT_FOUND":
      return noHandler(action, true);
    default:
      break;
  }
  if (/not implemented|not available|plugin/i.test(text)) return noHandler(action, true);
  return new ChatFileExportError("NETWORK_ERROR", action === "view" ? MESSAGES.viewFailed : MESSAGES.saveFailed);
}

async function settle<T extends { status: string }>(
  action: ExportAction,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const failure = translateFailure(error, action);
    if (failure.code === "CANCELLED") return { status: "cancelled" } as unknown as T;
    throw failure;
  }
}

async function performWebView(meta: ChatFileMeta, identity: { name: string; mime: string }): Promise<ChatFileExportViewResult> {
  const target = webViewMime(identity.mime);
  if (target === null) {
    throw new ChatFileExportError("UNSUPPORTED_VIEW", MESSAGES.unsupportedView);
  }
  // Reserved before the first await so the press gesture still counts.
  const viewer = openViewer();
  if (viewer === null) {
    throw new ChatFileExportError("UNSUPPORTED_VIEW", MESSAGES.popupBlocked);
  }
  const operation = beginViewerOperation(viewer);
  let account: string | null = null;
  let claimed = false;
  let objectUrl: string | null = null;
  let finished = false;
  const release = () => {
    closeViewer(viewer);
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };
  operation.abortHandlers.push(release);
  try {
    account = await captureAccount(operation);
    claimAccount(account);
    claimed = true;
    const blob = await downloadChatFile(meta.key);
    if (operation.aborted) throw cancelled();
    assertByteSize(blob.size, meta.byteSize);
    if (target === "application/pdf") {
      const head = new Uint8Array(await blob.slice(0, PDF_MAGIC.length).arrayBuffer());
      if (operation.aborted) throw cancelled();
      if (!hasPdfMagic(head)) {
        throw new ChatFileExportError("UNSUPPORTED_VIEW", MESSAGES.unsupportedView);
      }
    }
    await assertSameAccount(operation, account);
    if (viewer.closed) throw cancelled();
    // Copy the original bytes under the forced type. Nothing is transcoded.
    const typed = new Blob([blob], { type: target });
    const created = URL.createObjectURL(typed);
    objectUrl = created;
    if (operation.aborted) throw cancelled();
    viewer.location.href = created;
    scheduleObjectUrlRevoke(created);
    finished = true;
    return { status: "opened" };
  } catch (error) {
    throw translateFailure(error, "view");
  } finally {
    if (!finished) release();
    endOperation(operation);
    if (claimed) releaseAccount(account);
  }
}

async function performWebSave(meta: ChatFileMeta, identity: { name: string; mime: string }): Promise<ChatFileExportSaveResult> {
  if (typeof document === "undefined") throw noHandler("save");
  const operation = beginOperation();
  let account: string | null = null;
  let claimed = false;
  let objectUrl: string | null = null;
  let finished = false;
  const release = () => {
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };
  operation.abortHandlers.push(release);
  try {
    account = await captureAccount(operation);
    claimAccount(account);
    claimed = true;
    const blob = await downloadChatFile(meta.key);
    if (operation.aborted) throw cancelled();
    assertByteSize(blob.size, meta.byteSize);
    await assertSameAccount(operation, account);
    if (operation.aborted) throw cancelled();
    const typed = new Blob([blob], { type: identity.mime });
    const created = URL.createObjectURL(typed);
    objectUrl = created;
    const anchor = document.createElement("a");
    anchor.href = created;
    anchor.download = identity.name;
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
    // The browser owns the started file flow now; the URL only has to outlive
    // the download handoff, so the bounded timer releases it after 60 seconds.
    scheduleObjectUrlRevoke(created);
    objectUrl = null;
    finished = true;
    return { status: "download-started" };
  } catch (error) {
    throw translateFailure(error, "save");
  } finally {
    if (!finished) release();
    endOperation(operation);
    if (claimed) releaseAccount(account);
  }
}

async function performNative(
  meta: ChatFileMeta,
  identity: { name: string; mime: string },
  action: ExportAction,
): Promise<ChatFileExportViewResult | ChatFileExportSaveResult> {
  if (platformKind() === "other-native") {
    throw new ChatFileExportError("NO_HANDLER", MESSAGES.otherPlatform);
  }
  const operation = beginOperation();
  let account: string | null = null;
  let claimed = false;
  try {
    account = await captureAccount(operation);
    claimAccount(account);
    claimed = true;
    // Fail closed before minting a token when this build has no native plugin;
    // an Android shell must never quietly fall back to a web download.
    const bridge = nativeBridge();
    const url = await signedChatFileUrl(meta.key, 60);
    if (operation.aborted) throw cancelled();
    await assertSameAccount(operation, account);
    const request: NativeExportRequest = {
      requestId: newRequestId(),
      url,
      name: identity.name,
      mime: identity.mime,
      byteSize: meta.byteSize,
    };
    operation.abortHandlers.push(() => {
      void bridge.cancelExport({ requestId: request.requestId }).catch(() => undefined);
    });
    try {
      if (action === "view") {
        const result = await bridge.openDocument(request);
        if (operation.aborted) throw cancelled();
        await assertSameAccount(operation, account);
        if (result?.opened !== true) throw noHandler("view");
        return { status: "opened" };
      }
      const result = await bridge.saveToDownloads(request);
      if (operation.aborted) throw cancelled();
      await assertSameAccount(operation, account);
      if (result?.saved !== true) throw new ChatFileExportError("NETWORK_ERROR", MESSAGES.saveFailed);
      return { status: "saved", location: "downloads" };
    } catch (error) {
      if (!operation.aborted) {
        void bridge.cancelExport({ requestId: request.requestId }).catch(() => undefined);
      }
      throw translateFailure(error, action);
    }
  } finally {
    endOperation(operation);
    if (claimed) releaseAccount(account);
  }
}

export function viewChatFile(meta: ChatFileMeta): Promise<ChatFileExportViewResult> {
  return settle("view", async () => {
    const identity = checkedMeta(meta);
    return platformKind() === "web"
      ? performWebView(meta, identity)
      : performNative(meta, identity, "view") as unknown as Promise<ChatFileExportViewResult>;
  });
}

export function saveChatFile(meta: ChatFileMeta): Promise<ChatFileExportSaveResult> {
  return settle("save", async () => {
    const identity = checkedMeta(meta);
    return platformKind() === "web"
      ? performWebSave(meta, identity)
      : performNative(meta, identity, "save") as unknown as Promise<ChatFileExportSaveResult>;
  });
}
