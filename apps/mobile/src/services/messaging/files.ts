import { getSupabase } from "../supabaseClient";
import { ApiError } from "../session";

/**
 * Conversation files that are not photos (owner order 2026-11-12, R4).
 *
 * Photos and voice keep the byte-verified media lane. Everything else - a PDF,
 * a document, a video, an audio file, an archive - travels as a private
 * Storage object in `findback-chat-files`, and the message body carries a
 * short marker naming it. The bucket enforces the same MIME allowlist again
 * server-side, and it does not admit executables, scripts, HTML or SVG, so a
 * client that is tricked into trying one is refused by the server as well.
 *
 * The client decides the type here (the owner's brief) but never invents one:
 * an unknown MIME or an unlisted extension is refused with copy rather than
 * stored and rendered as something it is not.
 */

export const CHAT_FILE_BUCKET = "findback-chat-files";
export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_FILE_MARKER_PREFIX = "norfold-file:v1:";

export type ChatFileKind = "video" | "audio" | "pdf" | "document" | "archive" | "file";

/** Mirrors the bucket's `allowed_mime_types`. Keep both lists in step. */
export const CHAT_FILE_MIME_ALLOWLIST = [
  "application/pdf",
  "application/rtf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/zip",
  "application/x-zip-compressed",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
] as const;

/**
 * Executable and script types, refused before anything is read. These are
 * absent from the bucket allowlist too; the client list exists so the refusal
 * is immediate and explained rather than a failed upload.
 */
const REFUSED_EXTENSIONS = new Set([
  "bat", "cmd", "com", "scr", "pif", "exe", "msi", "dll", "ps1", "psm1", "vbs", "vbe",
  "jse", "wsf", "wsh", "hta", "jar", "reg", "lnk", "cpl", "inf", "apk", "aab", "dmg",
  "pkg", "sh", "bash", "zsh", "py", "rb", "php", "pl", "js", "mjs", "cjs", "ts", "html",
  "htm", "xhtml", "svg", "svgz", "swf", "iso", "img", "vhd", "vhdx", "scf", "url",
  "application", "gadget", "msc", "csh", "vb", "ws", "drv", "sys", "ocx", "bin",
  "deb", "rpm", "app",
]);

const REFUSED_MIME = new Set([
  "application/x-msdownload", "application/x-msdos-program", "application/x-bat",
  "application/x-sh", "application/x-shellscript", "application/javascript",
  "text/javascript", "text/html", "application/xhtml+xml", "image/svg+xml",
  "application/x-shockwave-flash", "application/vnd.microsoft.portable-executable",
  "application/vnd.android.package-archive", "application/x-apple-diskimage",
]);

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf", rtf: "application/rtf", txt: "text/plain", csv: "text/csv",
  json: "application/json", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  zip: "application/zip", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
};

export interface ChatFileMeta {
  /** Storage object key, `files/<uid>/<conversation>/<uuid>-<name>`. */
  key: string;
  name: string;
  mime: string;
  byteSize: number;
  kind: ChatFileKind;
}

export function chatFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Strip path separators and control characters from a name used in a key. */
export function safeChatFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "-")
    // Control characters are exactly what this sanitizer exists to remove.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
}

export function chatFileKindOf(mime: string): ChatFileKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return "archive";
  if (mime.startsWith("text/") || mime.includes("document") || mime.includes("sheet")
    || mime.includes("presentation") || mime === "application/msword" || mime === "application/rtf"
    || mime === "application/json") return "document";
  return "file";
}

/**
 * Returns the refusal sentence, or null when the file may travel. The caller
 * shows this string as-is; it always names the limit or the reason, never a
 * transport error.
 */
export function validateChatFile(file: File): string | null {
  if (file.size <= 0) return "That file is empty. Choose another one.";
  if (file.size > CHAT_FILE_MAX_BYTES) return "Files are limited to 20 MB.";
  const extension = chatFileExtension(file.name);
  if (REFUSED_EXTENSIONS.has(extension)) {
    return `.${extension} files can carry a program. Norfold will not send this one.`;
  }
  const declared = file.type.toLowerCase().split(";")[0]!.trim();
  if (declared !== "" && REFUSED_MIME.has(declared)) {
    return "That file type can run code. Norfold will not send this one.";
  }
  if (declared.startsWith("image/")) {
    return "Photos send through the photo control so they stay private. Send the image there.";
  }
  const mime = declared !== "" ? declared : EXTENSION_MIME[extension] ?? "";
  if (mime === "" || !(CHAT_FILE_MIME_ALLOWLIST as readonly string[]).includes(mime)) {
    return "That file type is not supported in messages yet.";
  }
  return null;
}

/** The MIME a validated file travels as, honouring the extension when the
 * browser does not declare one. */
export function chatFileMime(file: File): string {
  const declared = file.type.toLowerCase().split(";")[0]!.trim();
  return declared !== "" ? declared : EXTENSION_MIME[chatFileExtension(file.name)] ?? "";
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeChatFileMarker(meta: ChatFileMeta): string {
  return CHAT_FILE_MARKER_PREFIX + base64UrlEncode(JSON.stringify({
    k: meta.key, n: meta.name, m: meta.mime, s: meta.byteSize,
  }));
}

/**
 * Read a file marker out of a message body. Returns null for ordinary text and
 * for anything malformed: a body that merely looks like a marker must not make
 * the transcript fetch a key the reader was never allowed to see (Storage RLS
 * still decides, this is only the parser).
 */
export function parseChatFileMarker(body: string): ChatFileMeta | null {
  const text = body.trim();
  if (!text.startsWith(CHAT_FILE_MARKER_PREFIX)) return null;
  const payload = text.slice(CHAT_FILE_MARKER_PREFIX.length).split(/\s/)[0]!;
  if (payload === "" || payload.length > 4000) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
    const key = parsed.k, name = parsed.n, mime = parsed.m, size = parsed.s;
    if (typeof key !== "string" || !key.startsWith("files/") || key.includes("..")) return null;
    if (typeof name !== "string" || name === "" || name.length > 160) return null;
    if (typeof mime !== "string" || !(CHAT_FILE_MIME_ALLOWLIST as readonly string[]).includes(mime)) return null;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > CHAT_FILE_MAX_BYTES) return null;
    return { key, name, mime, byteSize: size, kind: chatFileKindOf(mime) };
  } catch {
    return null;
  }
}

/** Marker first, then the caption on its own line. */
export function chatFileBody(meta: ChatFileMeta, caption = ""): string {
  const marker = encodeChatFileMarker(meta);
  const trimmed = caption.trim();
  return trimmed === "" ? marker : `${marker}\n${trimmed}`;
}

/** A reply preview for a file message: the name, not the encoded marker. */
export function chatFilePreview(body: string): string | null {
  const meta = parseChatFileMarker(body);
  return meta ? meta.name : null;
}

/** The caption written after the marker line, if any. */
export function chatFileCaption(body: string): string {
  const newline = body.indexOf("\n");
  return newline < 0 ? "" : body.slice(newline + 1).trim();
}

export interface UploadChatFileOptions {
  userId: string;
  conversationId: string;
  onProgress?: (ratio: number) => void;
}

/**
 * Upload one validated file and return the marker metadata. Throws an
 * ApiError with consumer copy; the caller turns a failed send into an error
 * line and never leaves a half-sent message behind.
 */
export async function uploadChatFile(file: File, options: UploadChatFileOptions): Promise<ChatFileMeta> {
  const problem = validateChatFile(file);
  if (problem) throw new ApiError(problem, 400);
  const mime = chatFileMime(file);
  const key = `files/${options.userId}/${options.conversationId}/${crypto.randomUUID()}-${safeChatFileName(file.name)}`;
  options.onProgress?.(0);
  const { error } = await getSupabase().storage
    .from(CHAT_FILE_BUCKET)
    // Private chat transport: a shared or long-lived browser cache would keep
    // the bytes readable after an account switch, so no cache window is offered.
    .upload(key, file, { contentType: mime, upsert: false, cacheControl: "0" });
  if (error) throw new ApiError("That file could not be uploaded. Try again.", 502);
  options.onProgress?.(1);
  return { key, name: safeChatFileName(file.name), mime, byteSize: file.size, kind: chatFileKindOf(mime) };
}

export async function downloadChatFile(key: string): Promise<Blob> {
  const { data, error } = await getSupabase().storage.from(CHAT_FILE_BUCKET).download(key);
  if (error || !data) throw new ApiError("That file is no longer available.", 404);
  return data;
}

/** Best effort: a failed send removes the object it uploaded. Never throws. */
export async function removeChatFile(key: string): Promise<void> {
  try {
    await getSupabase().storage.from(CHAT_FILE_BUCKET).remove([key]);
  } catch {
    // Nothing else retries this: the bucket has no expiry of its own. The
    // cleanup-chat-files sweep removes objects no live message references.
  }
}
