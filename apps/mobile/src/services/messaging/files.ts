import { getSupabase } from "../supabaseClient";
import { ApiError } from "../session";

/**
 * Conversation files (owner order 2026-11-12 R4; widened 2026-11-15).
 *
 * A conversation carries any ordinary file: documents, images, video, audio,
 * archives and containers this app has never heard of. The bytes travel as a
 * private Storage object in `findback-chat-files` and the message body carries
 * a short marker naming it. Video and audio are the only types played inline,
 * and only after the reader presses Open; everything else - a PDF, a PSD, an
 * archive, an unknown binary - downloads as a blob, so stored bytes never
 * become a page in the app's origin.
 *
 * Refusal is narrow on purpose: a file is refused only when its name or its
 * declared type is on the executable/script list, when it is empty, or when it
 * exceeds 20 MB. The type is never a reason to refuse. When the browser cannot
 * name a format the file travels as `application/octet-stream`, which the
 * bucket accepts. The client list is the malware guard because Storage only
 * sees the declared MIME header, never the filename; the bucket stays private
 * and participant-only, so a stored program is not reachable by strangers.
 */

export const CHAT_FILE_BUCKET = "findback-chat-files";
export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_FILE_MARKER_PREFIX = "norfold-file:v1:";

export type ChatFileKind = "video" | "audio" | "pdf" | "document" | "archive" | "file";

/**
 * Mirrors the bucket's `allowed_mime_types` after
 * `20261115130000_chat_file_type_widening.sql`. Keep both lists in step;
 * `files.test.ts` parses the migration and fails on drift.
 */
export const CHAT_FILE_MIME_ALLOWLIST = [
  // images (also accepted here; the photo control keeps its own media lane)
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/avif",
  // video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "video/x-m4v",
  "video/3gpp",
  // audio
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/aac",
  "audio/opus",
  "audio/webm",
  // archives
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/gzip",
  "application/x-tar",
  // documents
  "application/pdf",
  "application/rtf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  // explicit catch-all: a file whose type nothing can name still travels
  "application/octet-stream",
] as const;

/** The type an ordinary file travels as when nothing better is known. */
export const CHAT_FILE_FALLBACK_MIME = "application/octet-stream";

const CHAT_FILE_MIME_SET: ReadonlySet<string> = new Set(CHAT_FILE_MIME_ALLOWLIST);

/** True when the widened bucket would store this MIME. */
export function isChatFileMimeAllowed(mime: string): boolean {
  return CHAT_FILE_MIME_SET.has(mime);
}

/**
 * Executable, installer and script types, refused before anything is read.
 * The bucket no longer filters these by MIME (it accepts the octet-stream
 * catch-all), so this client list is the only place a person gets a clear
 * refusal instead of sending a program to a contact. It is also a UX guard:
 * Storage never sees the filename, so it cannot enforce this list itself.
 */
const REFUSED_EXTENSIONS = new Set([
  "bat", "cmd", "com", "scr", "pif", "exe", "msi", "dll", "ps1", "psm1", "psd1", "pssc",
  "vbs", "vbe", "jse", "wsf", "wsh", "hta", "jar", "reg", "lnk", "cpl", "inf", "apk", "aab",
  "dmg", "pkg", "sh", "bash", "zsh", "py", "rb", "php", "pl", "js", "mjs", "cjs", "ts", "html",
  "htm", "xhtml", "svg", "svgz", "swf", "iso", "img", "vhd", "vhdx", "scf", "url",
  "application", "gadget", "msc", "csh", "vb", "ws", "drv", "sys", "ocx", "bin",
  "deb", "rpm", "app", "appx", "appxbundle", "msix", "msixbundle", "wasm", "msh", "msh1",
  "msh2", "command", "workflow", "action", "desktop", "scpt", "air",
]);

const REFUSED_MIME = new Set([
  "application/x-msdownload", "application/x-msdos-program", "application/x-bat",
  "application/x-sh", "application/x-shellscript", "application/javascript",
  "text/javascript", "text/html", "application/xhtml+xml", "image/svg+xml",
  "application/x-shockwave-flash", "application/vnd.microsoft.portable-executable",
  "application/vnd.android.package-archive", "application/x-apple-diskimage",
  "application/wasm", "application/x-executable", "application/x-mach-binary",
  "application/x-msi",
]);

/**
 * The extension fallback used when the browser declares no type, or declares
 * the octet-stream catch-all. Formats the app has no reason to guess - `.psd`,
 * `.blend`, `.7z`, `.mkv`, `.epub`, `.ttf`, `.obj` - are deliberately absent,
 * so they resolve to `application/octet-stream` like any unlisted extension.
 */
const EXTENSION_MIME: Record<string, string> = {
  // documents
  pdf: "application/pdf", rtf: "application/rtf", txt: "text/plain", csv: "text/csv",
  json: "application/json", xml: "application/xml", md: "text/markdown", markdown: "text/markdown",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  // images
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif", avif: "image/avif",
  // video
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo",
  m4v: "video/x-m4v", "3gp": "video/3gpp", "3gpp": "video/3gpp",
  // audio
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav",
  flac: "audio/flac", aac: "audio/aac", opus: "audio/opus", weba: "audio/webm",
  // archives
  zip: "application/zip", rar: "application/vnd.rar", tar: "application/x-tar",
  gz: "application/gzip",
};

const ARCHIVE_MIME: ReadonlySet<string> = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/gzip",
  "application/x-tar",
]);

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
  // A leading dot normally marks a hidden file (`.gitignore`), but a name that
  // is only an extension (`.exe`) must still expose it to the refusal list.
  return dot < 0 || dot === name.length - 1 ? "" : name.slice(dot + 1).toLowerCase();
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

/**
 * The display kind of one file message. An image stays a document kind: the
 * transcript offers an explicit preview only when the bytes sniff as an
 * allowlisted raster, and every other image downloads like a file.
 */
export function chatFileKindOf(mime: string): ChatFileKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "document";
  if (mime === "application/pdf") return "pdf";
  if (ARCHIVE_MIME.has(mime)) return "archive";
  if (mime.startsWith("text/") || mime.includes("document") || mime.includes("sheet")
    || mime.includes("presentation") || mime === "application/msword" || mime === "application/rtf"
    || mime === "application/json" || mime === "application/xml"
    || mime === "application/epub+zip" || mime === "application/x-mobipocket-ebook") return "document";
  return "file";
}

function normalizeChatFileMime(value: string): string {
  // `text/plain; charset=utf-8` is still text/plain; Storage compares the bare
  // type against the bucket allowlist.
  return value.toLowerCase().split(";")[0]!.trim();
}

/**
 * Returns the refusal sentence, or null when the file may travel. The caller
 * shows this string as-is; it names only the three real refusals - a program,
 * an empty file, or the 20 MB ceiling - and never a type the transport could
 * carry.
 */
export function validateChatFile(file: File): string | null {
  if (file.size <= 0) return "That file is empty. Choose another one.";
  if (file.size > CHAT_FILE_MAX_BYTES) return "Files are limited to 20 MB.";
  const extension = chatFileExtension(file.name);
  if (REFUSED_EXTENSIONS.has(extension)) {
    return `.${extension} files can carry a program. Norfold will not send this one.`;
  }
  if (REFUSED_MIME.has(normalizeChatFileMime(file.type))) {
    return "That file type can run code. Norfold will not send this one.";
  }
  return null;
}

/** The MIME a validated file travels as. A declared type wins only when the
 * bucket would store it; otherwise the extension decides, and an unknown
 * format falls back to the explicit octet-stream catch-all. */
export function chatFileMime(file: File): string {
  const declared = normalizeChatFileMime(file.type);
  if (declared !== "" && declared !== CHAT_FILE_FALLBACK_MIME && isChatFileMimeAllowed(declared)) {
    return declared;
  }
  return EXTENSION_MIME[chatFileExtension(file.name)] ?? CHAT_FILE_FALLBACK_MIME;
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
    if (typeof mime !== "string" || !isChatFileMimeAllowed(mime)) return null;
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
  if (error) {
    // The bucket's insert policy refuses an over-budget upload as a row-level
    // security rejection (100 MB cumulative per account). That is the only 4xx
    // a validated upload into a joined conversation can produce, and the server
    // stays the authority: the client never pre-counts, so a stale count cannot
    // win a race against another device.
    const refused = error.status === 400 || error.status === 403;
    if (refused && /row-level security/i.test(error.message ?? "")) {
      throw new ApiError(
        "Your file space is full (100 MB sent across chats). Remove a file to send more.",
        409,
      );
    }
    throw new ApiError("That file could not be uploaded. Try again.", 502);
  }
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
