import { getSupabase, getSupabaseBackendUrl } from "../supabaseClient";
import { ApiError } from "../session";

/**
 * Conversation files (widened 2026-11-15).
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

/**
 * Strip path separators and control characters from a name used in a key.
 * `?`, `#` and `%` go too: `isSignableChatFileKey` refuses a key carrying a
 * query, fragment or percent escape, so a name with one would upload and then
 * never sign, leaving View and Save dead for that file.
 */
export function safeChatFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "-")
    // Control characters are exactly what this sanitizer exists to remove.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[?#%]/g, "-")
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

/**
 * Characters Windows refuses in a file name, and the invisible direction
 * controls that can disguise an extension. Export copies are for other apps,
 * so the copy name is cleaned here even though the uploaded name and marker
 * bytes are never rewritten.
 */
const EXPORT_WINDOWS_FORBIDDEN = /[<>:"|?*]/g;
const EXPORT_BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;
const EXPORT_MAX_NAME_CODE_POINTS = 120;

/** Reserved DOS device names, matched on the stem (before the first dot). */
const EXPORT_DOS_DEVICES: ReadonlySet<string> = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function stripExportTrailing(value: string): string {
  return value.replace(/[. ]+$/g, "");
}

/**
 * The same separator/control rules as `safeChatFileName`. The 120-unit cap
 * that function applies is skipped only for a longer source, so a real
 * extension at the end survives the export-specific code-point cap below.
 */
function exportNameSource(raw: string): string {
  if (raw.length <= EXPORT_MAX_NAME_CODE_POINTS) return safeChatFileName(raw);
  const cleaned = raw
    .replace(/[\\/]/g, "-")
    // Control characters are exactly what this sanitizer exists to remove.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return cleaned;
}

function capExportName(name: string): string {
  if (Array.from(name).length <= EXPORT_MAX_NAME_CODE_POINTS) return name;
  const dot = name.lastIndexOf(".");
  const suffix = dot > 0 && name.length - dot <= 24 ? name.slice(dot) : "";
  const stem = suffix === "" ? name : name.slice(0, dot);
  const keep = EXPORT_MAX_NAME_CODE_POINTS - Array.from(suffix).length;
  const capped = stripExportTrailing(Array.from(stem).slice(0, Math.max(1, keep)).join(""));
  return `${capped === "" ? "file" : capped}${suffix}`;
}

/**
 * A safe copy name for an export. The stored marker keeps the sender's name
 * verbatim; only the copy handed to the browser or the platform downloader is
 * cleaned. Path separators and control characters become neutral, Windows
 * forbidden characters and bidi overrides are removed, a reserved device stem
 * is prefixed, and the result is capped at 120 code points without losing its
 * extension.
 */
function exportCopyName(raw: string): string {
  let name = exportNameSource(typeof raw === "string" ? raw : "")
    .replace(EXPORT_WINDOWS_FORBIDDEN, "-")
    .replace(EXPORT_BIDI_CONTROLS, "");
  name = stripExportTrailing(name);
  if (name === "" || name === "." || name === "..") name = "file";
  const firstDot = name.indexOf(".");
  const stem = (firstDot < 0 ? name : name.slice(0, firstDot)).trim().toUpperCase();
  if (EXPORT_DOS_DEVICES.has(stem)) name = `file-${name}`;
  return capExportName(name);
}

/**
 * Replace a refused executable/script extension with the neutral `.download`
 * suffix. `.bin` is deliberately not reused: `bin` is itself on the refusal
 * list, so the copy would still look like a program.
 */
function neutralExportName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : "";
  const cleaned = stripExportTrailing(stem);
  return capExportName(
    `${cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned}.download`,
  );
}

/**
 * The exact name and MIME an export copy may carry.
 *
 * The marker's declared type is not trusted on its own: a refused extension
 * always wins (`.html`, `.svg`, `.bin`, every script/installer suffix becomes
 * `.download` with the octet-stream catch-all), a known ordinary extension
 * overrides a lying marker MIME, and an unknown extension keeps only an
 * allowlisted non-executable marker type, otherwise octet-stream. Ordinary
 * allowed files keep their original extension and their exact bytes.
 */
export function chatFileExportIdentity(meta: ChatFileMeta): { name: string; mime: string } {
  const name = exportCopyName(meta.name);
  const extension = chatFileExtension(name);
  if (extension !== "" && REFUSED_EXTENSIONS.has(extension)) {
    return { name: neutralExportName(name), mime: CHAT_FILE_FALLBACK_MIME };
  }
  const declared = normalizeChatFileMime(typeof meta.mime === "string" ? meta.mime : "");
  const mapped = EXTENSION_MIME[extension];
  const mappedMime = mapped !== undefined && isChatFileMimeAllowed(mapped) ? mapped : undefined;
  const declaredMime = declared !== "" && isChatFileMimeAllowed(declared) && !REFUSED_MIME.has(declared)
    ? declared
    : undefined;
  const mime = mappedMime ?? declaredMime ?? CHAT_FILE_FALLBACK_MIME;
  if (REFUSED_MIME.has(mime)) return { name: neutralExportName(name), mime: CHAT_FILE_FALLBACK_MIME };
  return { name, mime };
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

/**
 * Short-lived signed addresses for the platform exporter.
 *
 * The native downloader streams this URL straight to a viewer or Downloads, so
 * the bytes never cross the JS bridge (a 20 MB base64 payload would cost about
 * 26.7 MB of memory and a second copy). Signing asks Storage to authorize one
 * object for the current account; it requires the same `objects` SELECT
 * permission as a download and never uses a service-role key. The URL is
 * returned to the native caller only: it must never become a browser anchor,
 * because that would expose the scoped token and bypass the export identity.
 */
export const CHAT_FILE_SIGNED_URL_SECONDS = 60;

/** Storage keys are bounded; anything longer is not one of our uploads. */
const CHAT_FILE_MAX_KEY_LENGTH = 1024;

/**
 * True for the one key shape uploads create:
 * `files/<uid>/<conversation>/<uuid>-<name>`.
 *
 * This is stricter than the historical marker parser on purpose: signing is a
 * new capability, so it accepts only a normal four-segment path with no empty
 * dot segment, traversal, control character, query/fragment, or percent-encoded
 * separator. `%2f`/`%5c`/`%2e` are refused rather than assumed to name the same
 * path segment; the upload path never produces them.
 */
export function isSignableChatFileKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > CHAT_FILE_MAX_KEY_LENGTH) return false;
  if (!key.startsWith("files/")) return false;
  if (key.includes("..") || key.includes("\\") || /[?#]/.test(key)) return false;
  // NUL and the other C0 controls never belong in a Storage key.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  if (/%2f|%5c|%2e/i.test(key)) return false;
  const segments = key.split("/");
  return segments.length === 4
    && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Clamp to the documented short export window. A caller can ask for less, but
 * never for the SDK's long-lived default: a signed address is handed to another
 * app, so an accidental year-long token is not acceptable.
 */
function signedUrlTtl(seconds: number): number {
  if (!Number.isFinite(seconds)) return CHAT_FILE_SIGNED_URL_SECONDS;
  return Math.min(CHAT_FILE_SIGNED_URL_SECONDS, Math.max(1, Math.floor(seconds)));
}

function rejectedSignedUrl(): ApiError {
  return new ApiError("That file can't be opened safely.", 502);
}

/**
 * Accept only the URL the SDK itself documents: the configured HTTPS origin,
 * `/storage/v1/object/sign/findback-chat-files/<key>`, and exactly one `token`
 * query parameter. The key suffix is compared after decoding, and an encoded
 * slash is refused instead of treated as equivalent, so a URL cannot name a
 * different object than the key the caller asked for.
 */
function validateSignedChatFileUrl(raw: string, key: string): string {
  let signed: URL;
  let base: URL;
  try {
    signed = new URL(raw);
    base = new URL(getSupabaseBackendUrl());
  } catch {
    throw rejectedSignedUrl();
  }
  if (signed.protocol !== "https:" || signed.origin !== base.origin) throw rejectedSignedUrl();
  if (signed.username !== "" || signed.password !== "" || signed.hash !== "") throw rejectedSignedUrl();
  const prefix = `/storage/v1/object/sign/${CHAT_FILE_BUCKET}/`;
  if (!signed.pathname.startsWith(prefix)) throw rejectedSignedUrl();
  const encodedKey = signed.pathname.slice(prefix.length);
  if (/%2f|%5c/i.test(encodedKey)) throw rejectedSignedUrl();
  let decodedKey: string;
  try {
    decodedKey = decodeURIComponent(encodedKey);
  } catch {
    throw rejectedSignedUrl();
  }
  if (decodedKey !== key) throw rejectedSignedUrl();
  const parameters = [...signed.searchParams.keys()];
  if (parameters.length !== 1 || parameters[0] !== "token") throw rejectedSignedUrl();
  if (!signed.searchParams.get("token")) throw rejectedSignedUrl();
  return signed.href;
}

/**
 * Sign one chat-file object for a short native export. Throws an `ApiError`
 * with a consumer-safe message; the caller maps the status to its own code and
 * never logs or prints the returned URL. No token, secret or long-lived
 * credential is created here.
 */
export async function signedChatFileUrl(
  key: string,
  seconds: number = CHAT_FILE_SIGNED_URL_SECONDS,
): Promise<string> {
  if (!isSignableChatFileKey(key)) throw new ApiError("That file can't be opened.", 400);
  let signedUrl: string | undefined;
  let status: number | undefined;
  try {
    const { data, error } = await getSupabase().storage
      .from(CHAT_FILE_BUCKET)
      // No `download`/transform option: the caller needs the exact stored
      // bytes and this keeps the token the only query parameter.
      .createSignedUrl(key, signedUrlTtl(seconds));
    if (error || !data?.signedUrl) {
      const raw = (error as { status?: unknown } | null)?.status;
      status = typeof raw === "number" ? raw : undefined;
    } else {
      signedUrl = data.signedUrl;
    }
  } catch {
    throw new ApiError("That file is no longer available.", 502);
  }
  if (signedUrl === undefined) {
    if (status === 401 || status === 403) {
      throw new ApiError("You don't have access to this file.", 403);
    }
    // Storage masks an inaccessible or missing object as 400/404; either way
    // the honest consumer answer is that the file is gone.
    if (status === 400 || status === 404) {
      throw new ApiError("That file is no longer available.", 404);
    }
    throw new ApiError("That file is no longer available.", 502);
  }
  return validateSignedChatFileUrl(signedUrl, key);
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
