package com.findback.app.file;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure decision logic for the native chat-file export bridge
 * ({@link FindbackFileExportPlugin}).
 *
 * <p>Deliberately free of any {@code android.*} import so every rule can be
 * exercised on the JVM. The plugin owns the Android side (MediaStore,
 * {@code HttpsURLConnection}, FileProvider, legacy public Downloads) and this
 * class owns what may be downloaded, what may be named, and what may be
 * opened.
 *
 * <p>The accepted object is the one the web uploader already writes
 * ({@code apps/mobile/src/services/messaging/files.ts}):
 * {@code findback-chat-files/files/<uploader-uuid>/<conversation-uuid>/
 * <file-uuid>-<safeName>}. Only a short-lived signed URL for exactly that
 * object is allowed; no other Storage path, bucket, host or query shape is.
 * The refusal sets below are a verbatim copy of the web lists, and the JVM
 * test compares them against {@code files.ts} whenever that file is readable.
 */
public final class ChatFileExportPolicy {

    /** Interface error codes. The JS service maps these; nothing else crosses the bridge. */
    public static final String CODE_PERMISSION_DENIED = "PERMISSION_DENIED";
    public static final String CODE_CANCELLED = "CANCELLED";
    public static final String CODE_NO_HANDLER = "NO_HANDLER";
    public static final String CODE_SIZE_MISMATCH = "SIZE_MISMATCH";
    public static final String CODE_INSUFFICIENT_STORAGE = "INSUFFICIENT_STORAGE";
    public static final String CODE_NETWORK_ERROR = "NETWORK_ERROR";
    public static final String CODE_INVALID_REQUEST = "INVALID_REQUEST";
    public static final String CODE_NOT_FOUND = "NOT_FOUND";

    /** One chat file is capped at 20 MiB by the web upload path. */
    public static final long MAX_BYTES = 20L * 1024L * 1024L;

    /** Output file names are capped in code points, not UTF-16 units. */
    public static final int MAX_NAME_CODE_POINTS = 120;

    /** A signed Storage URL is short; anything larger is not ours. */
    public static final int MAX_URL_LENGTH = 16 * 1024;

    /** Supabase signed tokens are JWTs; bound the query value. */
    public static final int MAX_TOKEN_LENGTH = 8192;

    /** Bounded exclusive-create attempts for a non-clobbering Downloads name. */
    public static final int MAX_COLLISION_ATTEMPTS = 1000;

    /** Executable/script names are stored under this neutral extension. */
    public static final String NEUTRAL_EXTENSION = "download";

    public static final String OCTET_STREAM = "application/octet-stream";

    public static final String BUCKET = "findback-chat-files";

    /** View cache budget and age rules (owned cache only). */
    public static final long VIEW_CACHE_BUDGET_BYTES = 50L * 1024L * 1024L;
    public static final long VIEW_RETENTION_MS = 24L * 60L * 60L * 1000L;
    public static final long VIEW_MIN_AGE_MS = 10L * 60L * 1000L;

    private static final Pattern PROJECT_HOST =
        Pattern.compile("^[a-z0-9-]+\\.supabase\\.co$");
    private static final Pattern MIME_SHAPE =
        Pattern.compile("^[a-z0-9.+-]+/[a-z0-9.+-]+$");
    private static final Pattern JWT_SHAPE =
        Pattern.compile("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$");
    private static final Pattern DOUBLE_ENCODED_SEPARATOR =
        Pattern.compile("(?i)%(2e|2f|5c|00)");

    private static final char[] HEX_UPPER = "0123456789ABCDEF".toCharArray();

    private static final Set<String> RESERVED_DOS_NAMES = new HashSet<>(Arrays.asList(
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    ));

    /**
     * Verbatim copy of {@code REFUSED_EXTENSIONS} in
     * {@code apps/mobile/src/services/messaging/files.ts}. A stored program is
     * copied to Downloads under {@link #NEUTRAL_EXTENSION} instead of its real
     * extension, so no viewer is offered a runnable type by name.
     */
    private static final Set<String> REFUSED_EXTENSIONS = Collections.unmodifiableSet(
        new LinkedHashSet<>(Arrays.asList(
            "bat", "cmd", "com", "scr", "pif", "exe", "msi", "dll", "ps1", "psm1", "psd1", "pssc",
            "vbs", "vbe", "jse", "wsf", "wsh", "hta", "jar", "reg", "lnk", "cpl", "inf", "apk", "aab",
            "dmg", "pkg", "sh", "bash", "zsh", "py", "rb", "php", "pl", "js", "mjs", "cjs", "ts", "html",
            "htm", "xhtml", "svg", "svgz", "swf", "iso", "img", "vhd", "vhdx", "scf", "url",
            "application", "gadget", "msc", "csh", "vb", "ws", "drv", "sys", "ocx", "bin",
            "deb", "rpm", "app", "appx", "appxbundle", "msix", "msixbundle", "wasm", "msh", "msh1",
            "msh2", "command", "workflow", "action", "desktop", "scpt", "air"
        ))
    );

    /** Verbatim copy of {@code REFUSED_MIME} in {@code files.ts}. */
    private static final Set<String> REFUSED_MIME = Collections.unmodifiableSet(
        new LinkedHashSet<>(Arrays.asList(
            "application/x-msdownload", "application/x-msdos-program", "application/x-bat",
            "application/x-sh", "application/x-shellscript", "application/javascript",
            "text/javascript", "text/html", "application/xhtml+xml", "image/svg+xml",
            "application/x-shockwave-flash", "application/vnd.microsoft.portable-executable",
            "application/vnd.android.package-archive", "application/x-apple-diskimage",
            "application/wasm", "application/x-executable", "application/x-mach-binary",
            "application/x-msi"
        ))
    );

    /**
     * Verbatim copy of {@code CHAT_FILE_MIME_ALLOWLIST} in {@code files.ts}.
     * A declared type outside this list is clamped to {@link #OCTET_STREAM}
     * before it reaches MediaStore or an ACTION_VIEW Intent.
     */
    private static final Set<String> MIME_ALLOWED = Collections.unmodifiableSet(
        new LinkedHashSet<>(Arrays.asList(
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff",
            "image/heic", "image/heif", "image/avif",
            "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
            "video/x-msvideo", "video/x-m4v", "video/3gpp",
            "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav",
            "audio/flac", "audio/aac", "audio/opus", "audio/webm",
            "application/zip", "application/x-zip-compressed", "application/x-7z-compressed",
            "application/x-rar-compressed", "application/vnd.rar", "application/gzip",
            "application/x-tar",
            "application/pdf", "application/rtf", "text/plain", "text/csv",
            "application/json", "application/xml", "text/xml", "text/markdown",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "application/vnd.oasis.opendocument.presentation",
            "application/epub+zip", "application/x-mobipocket-ebook",
            "application/octet-stream"
        ))
    );

    /**
     * Verbatim copy of {@code EXTENSION_MIME} in {@code files.ts}. A known
     * extension wins over a mismatched declared marker, so a file named
     * {@code report.docx} is never offered to a text viewer just because the
     * marker lied. Formats outside this map stay {@link #OCTET_STREAM}.
     */
    private static final java.util.Map<String, String> EXTENSION_MIME;

    static {
        java.util.Map<String, String> map = new java.util.HashMap<>();
        map.put("pdf", "application/pdf");
        map.put("rtf", "application/rtf");
        map.put("txt", "text/plain");
        map.put("csv", "text/csv");
        map.put("json", "application/json");
        map.put("xml", "application/xml");
        map.put("md", "text/markdown");
        map.put("markdown", "text/markdown");
        map.put("doc", "application/msword");
        map.put("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        map.put("xls", "application/vnd.ms-excel");
        map.put("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        map.put("ppt", "application/vnd.ms-powerpoint");
        map.put("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        map.put("odt", "application/vnd.oasis.opendocument.text");
        map.put("ods", "application/vnd.oasis.opendocument.spreadsheet");
        map.put("odp", "application/vnd.oasis.opendocument.presentation");
        map.put("jpg", "image/jpeg");
        map.put("jpeg", "image/jpeg");
        map.put("png", "image/png");
        map.put("gif", "image/gif");
        map.put("webp", "image/webp");
        map.put("bmp", "image/bmp");
        map.put("tif", "image/tiff");
        map.put("tiff", "image/tiff");
        map.put("heic", "image/heic");
        map.put("heif", "image/heif");
        map.put("avif", "image/avif");
        map.put("mp4", "video/mp4");
        map.put("webm", "video/webm");
        map.put("mov", "video/quicktime");
        map.put("avi", "video/x-msvideo");
        map.put("m4v", "video/x-m4v");
        map.put("3gp", "video/3gpp");
        map.put("3gpp", "video/3gpp");
        map.put("mp3", "audio/mpeg");
        map.put("m4a", "audio/mp4");
        map.put("ogg", "audio/ogg");
        map.put("oga", "audio/ogg");
        map.put("wav", "audio/wav");
        map.put("flac", "audio/flac");
        map.put("aac", "audio/aac");
        map.put("opus", "audio/opus");
        map.put("weba", "audio/webm");
        map.put("zip", "application/zip");
        map.put("rar", "application/vnd.rar");
        map.put("tar", "application/x-tar");
        map.put("gz", "application/gzip");
        EXTENSION_MIME = Collections.unmodifiableMap(map);
    }

    private ChatFileExportPolicy() {}

    /** A validated, sanitised name + MIME pair for one export. */
    public static final class ExportFile {
        public final String name;
        public final String mime;

        ExportFile(String name, String mime) {
            this.name = name;
            this.mime = mime;
        }
    }

    // --- origin and signed URL gate ---------------------------------------

    /**
     * Returns the lowercase Storage host from the compiled Supabase origin,
     * or {@code null} when the value is not a bare
     * {@code https://<project>.supabase.co} origin. The origin is build-time
     * configuration, never a JS argument.
     */
    public static String normalizeOrigin(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty() || value.length() > 2048) return null;
        if (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getRawUserInfo() != null) return null;
            if (uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            String path = uri.getRawPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) return null;
            int port = uri.getPort();
            if (port != -1 && port != 443) return null;
            String host = uri.getHost();
            if (host == null) return null;
            host = host.toLowerCase(Locale.ROOT);
            if (host.length() > 253 || !PROJECT_HOST.matcher(host).matches()) return null;
            return host;
        } catch (Exception refused) {
            return null;
        }
    }

    /**
     * True only for a short-lived signed URL for the chat-file bucket on the
     * configured origin: exact scheme/host/port, exact
     * {@code /storage/v1/object/sign/findback-chat-files/files/<uuid>/<uuid>/<uuid>-name}
     * path, and a single JWT {@code token} query parameter. No credentials,
     * fragment, extra query field, encoded separator, dot segment or second
     * decode is accepted.
     */
    public static boolean isAllowedSignedUrl(String url, String originHost) {
        if (url == null || originHost == null) return false;
        if (url.length() < 1 || url.length() > MAX_URL_LENGTH) return false;
        for (int i = 0; i < url.length(); i++) {
            char c = url.charAt(i);
            if (c <= 0x20 || c == 0x7f) return false;
        }
        try {
            URI uri = new URI(encodeNonAscii(url));
            if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
            if (uri.isOpaque()) return false;
            if (uri.getRawUserInfo() != null) return false;
            if (uri.getRawFragment() != null) return false;
            int port = uri.getPort();
            if (port != -1 && port != 443) return false;
            String host = uri.getHost();
            if (host == null || !host.equalsIgnoreCase(originHost)) return false;

            String rawPath = uri.getRawPath();
            if (rawPath == null || rawPath.isEmpty() || rawPath.charAt(0) != '/') return false;
            String[] segments = rawPath.split("/", -1);
            if (segments.length != 10) return false;
            String[] decoded = new String[segments.length];
            for (int i = 0; i < segments.length; i++) {
                if (i == 0 && segments[i].isEmpty()) {
                    decoded[0] = "";
                    continue;
                }
                String segment = decodeSegment(segments[i]);
                if (segment == null) return false;
                decoded[i] = segment;
            }
            if (!"".equals(decoded[0])) return false;
            if (!"storage".equals(decoded[1])) return false;
            if (!"v1".equals(decoded[2])) return false;
            if (!"object".equals(decoded[3])) return false;
            if (!"sign".equals(decoded[4])) return false;
            if (!BUCKET.equals(decoded[5])) return false;
            if (!"files".equals(decoded[6])) return false;
            if (!isUuid(decoded[7])) return false;
            if (!isUuid(decoded[8])) return false;
            if (!isUuidFileName(decoded[9])) return false;

            String rawQuery = uri.getRawQuery();
            return isAllowedTokenQuery(rawQuery);
        } catch (Exception refused) {
            return false;
        }
    }

    private static boolean isUuidFileName(String decoded) {
        if (decoded.length() < 37 || decoded.charAt(36) != '-') return false;
        if (!isUuid(decoded.substring(0, 36))) return false;
        String name = decoded.substring(37);
        if (name.isEmpty() || name.length() > 512) return false;
        if (".".equals(name) || "..".equals(name)) return false;
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c < 0x20 || c == 0x7f) return false;
        }
        return true;
    }

    private static boolean isAllowedTokenQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) return false;
        if (rawQuery.indexOf('&') >= 0) return false;
        if (rawQuery.indexOf('#') >= 0) return false;
        if (!rawQuery.startsWith("token=")) return false;
        String token = rawQuery.substring("token=".length());
        if (token.isEmpty() || token.length() > MAX_TOKEN_LENGTH) return false;
        return JWT_SHAPE.matcher(token).matches();
    }

    /**
     * Percent-encodes only code points above US-ASCII (as UTF-8) so the URL
     * parser sees an ASCII raw path on both the JVM and Android. ASCII text,
     * including existing {@code %XX} escapes, passes through untouched so the
     * single-decode rule in {@link #decodeSegment} still holds.
     */
    private static String encodeNonAscii(String value) {
        StringBuilder out = null;
        for (int i = 0; i < value.length(); ) {
            int codePoint = value.codePointAt(i);
            int width = Character.charCount(codePoint);
            if (codePoint <= 0x7f) {
                if (out != null) out.append((char) codePoint);
                i += width;
                continue;
            }
            if (out == null) {
                out = new StringBuilder(value.length() + 24);
                out.append(value, 0, i);
            }
            byte[] bytes = new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8);
            for (byte b : bytes) {
                out.append('%');
                out.append(HEX_UPPER[(b >> 4) & 0xF]);
                out.append(HEX_UPPER[b & 0xF]);
            }
            i += width;
        }
        return out == null ? value : out.toString();
    }

    /**
     * Percent-decodes one raw path segment exactly once (strict UTF-8) and
     * rejects anything that could hide a path boundary or a second decode:
     * NUL, backslash, slash, control characters, dot segments, and
     * double-encoded {@code 2e/2f/5c/00} sequences.
     */
    private static String decodeSegment(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(raw.length());
        for (int i = 0; i < raw.length(); ) {
            char c = raw.charAt(i);
            if (c == '%') {
                if (i + 2 >= raw.length()) return null;
                int high = hexValue(raw.charAt(i + 1));
                int low = hexValue(raw.charAt(i + 2));
                if (high < 0 || low < 0) return null;
                int value = (high << 4) | low;
                if (value == 0) return null;
                bytes.write(value);
                i += 3;
            } else {
                if (c == '\\') return null;
                int codePoint = raw.codePointAt(i);
                byte[] encoded = new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8);
                bytes.write(encoded, 0, encoded.length);
                i += Character.charCount(codePoint);
            }
        }
        String decoded;
        try {
            CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
            decoded = decoder.decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException refused) {
            return null;
        }
        if (decoded.isEmpty() || ".".equals(decoded) || "..".equals(decoded)) return null;
        for (int i = 0; i < decoded.length(); i++) {
            char c = decoded.charAt(i);
            if (c == '/' || c == '\\' || c < 0x20 || c == 0x7f) return null;
        }
        if (DOUBLE_ENCODED_SEPARATOR.matcher(decoded).find()) return null;
        return decoded;
    }

    private static int hexValue(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    // --- request fields ----------------------------------------------------

    /** A canonical lowercase-or-uppercase 8-4-4-4-12 UUID. */
    public static boolean isUuid(String value) {
        if (value == null || value.length() != 36) return false;
        for (int i = 0; i < 36; i++) {
            char c = value.charAt(i);
            if (i == 8 || i == 13 || i == 18 || i == 23) {
                if (c != '-') return false;
            } else if (hexValue(c) < 0) {
                return false;
            }
        }
        return true;
    }

    /** The advertised byteSize is untrusted; accept 1..20 MiB only. */
    public static boolean isAllowedByteSize(long byteSize) {
        return byteSize > 0 && byteSize <= MAX_BYTES;
    }

    // --- names and MIME ----------------------------------------------------

    /**
     * Sanitises a provided display name for Downloads: no separators, no
     * controls or bidi overrides, no Windows-illegal characters, no trailing
     * dot/space, no reserved DOS device name, at most 120 code points. An
     * executable extension is replaced by {@link #NEUTRAL_EXTENSION} and the
     * MIME is forced to octet-stream.
     */
    public static ExportFile prepareFile(String rawName, String declaredMime) {
        String cleaned = cleanDisplayName(rawName);
        String extension = extensionOf(cleaned);
        String declared = normalizeMime(declaredMime);

        if (!extension.isEmpty() && REFUSED_EXTENSIONS.contains(extension)) {
            return new ExportFile(neutralName(cleaned), OCTET_STREAM);
        }
        String known = EXTENSION_MIME.get(extension);
        if (known != null) {
            // A known extension wins over a lying marker; every known type is
            // safe to view and none is on the refused lists.
            return new ExportFile(cleaned, known);
        }
        if (declared != null && REFUSED_MIME.contains(declared)) {
            return new ExportFile(neutralName(cleaned), OCTET_STREAM);
        }
        if (declared == null || !MIME_ALLOWED.contains(declared)) {
            return new ExportFile(cleaned, OCTET_STREAM);
        }
        return new ExportFile(cleaned, declared);
    }

    /** Name-only sanitisation (no executable neutralisation). Exposed for tests. */
    public static String cleanDisplayName(String raw) {
        String name = raw == null ? "" : raw;
        StringBuilder out = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); ) {
            int codePoint = name.codePointAt(i);
            i += Character.charCount(codePoint);
            if (codePoint == '/' || codePoint == '\\') {
                out.append('-');
                continue;
            }
            if (codePoint < 0x20 || codePoint == 0x7f) continue;
            if (isBidiControl(codePoint)) continue;
            if (codePoint == '<' || codePoint == '>' || codePoint == ':' || codePoint == '"'
                || codePoint == '|' || codePoint == '?' || codePoint == '*') {
                out.append('-');
                continue;
            }
            out.appendCodePoint(codePoint);
        }
        String cleaned = stripTrailingDotsAndSpaces(out.toString().trim());
        if (cleaned.isEmpty() || ".".equals(cleaned) || "..".equals(cleaned)) cleaned = "file";
        if (RESERVED_DOS_NAMES.contains(stemOf(cleaned).toUpperCase(Locale.ROOT))) {
            cleaned = "_" + cleaned;
        }
        cleaned = truncateToCodePoints(cleaned, MAX_NAME_CODE_POINTS);
        cleaned = stripTrailingDotsAndSpaces(cleaned);
        return cleaned.isEmpty() ? "file" : cleaned;
    }

    private static boolean isBidiControl(int codePoint) {
        return codePoint == 0x061c || codePoint == 0x200e || codePoint == 0x200f
            || (codePoint >= 0x202a && codePoint <= 0x202e)
            || (codePoint >= 0x2066 && codePoint <= 0x2069);
    }

    private static String stemOf(String name) {
        int dot = name.indexOf('.');
        return dot < 0 ? name : name.substring(0, dot);
    }

    private static String stripTrailingDotsAndSpaces(String value) {
        int end = value.length();
        while (end > 0) {
            char c = value.charAt(end - 1);
            if (c == '.' || c == ' ') end--;
            else break;
        }
        return value.substring(0, end);
    }

    private static String truncateToCodePoints(String value, int limit) {
        if (value == null || value.isEmpty() || limit <= 0) return "";
        if (value.codePointCount(0, value.length()) <= limit) return value;
        return value.substring(0, value.offsetByCodePoints(0, limit));
    }

    private static String neutralName(String cleaned) {
        int dot = cleaned.lastIndexOf('.');
        String base;
        if (dot > 0) {
            base = cleaned.substring(0, dot);
        } else if (dot == 0) {
            base = "file";
        } else {
            base = cleaned;
        }
        base = stripTrailingDotsAndSpaces(base);
        if (base.isEmpty()) base = "file";
        return truncateToCodePoints(base + "." + NEUTRAL_EXTENSION, MAX_NAME_CODE_POINTS);
    }

    /** Lowercase extension without the dot, or "" when there is none. */
    public static String extensionOf(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** Bare lowercase MIME, or {@code null} when the marker is not MIME-shaped. */
    public static String normalizeMime(String value) {
        if (value == null) return null;
        String mime = value.trim().toLowerCase(Locale.ROOT);
        int parameters = mime.indexOf(';');
        if (parameters >= 0) mime = mime.substring(0, parameters).trim();
        if (mime.isEmpty() || mime.length() > 127) return null;
        if (!MIME_SHAPE.matcher(mime).matches()) return null;
        return mime;
    }

    /**
     * The Nth free-name candidate. Attempt 0 is the sanitised name itself;
     * attempt N is {@code base (N).ext}, preserving the extension and keeping
     * the whole name within 120 code points. No candidate ever overwrites an
     * existing path: callers must create exclusively.
     */
    public static String collisionName(String safeName, int attempt) {
        if (safeName == null || safeName.isEmpty()) safeName = "file";
        if (attempt <= 0) return safeName;
        String suffix = " (" + attempt + ")";
        int dot = safeName.lastIndexOf('.');
        boolean hasExtension = dot > 0 && dot < safeName.length() - 1;
        String base = hasExtension ? safeName.substring(0, dot) : safeName;
        String extension = hasExtension ? safeName.substring(dot) : "";
        int room = MAX_NAME_CODE_POINTS - codePointCount(suffix) - codePointCount(extension);
        if (room < 1) room = 1;
        return truncateToCodePoints(base, room) + suffix + extension;
    }

    private static int codePointCount(String value) {
        return value.codePointCount(0, value.length());
    }

    /**
     * Pure-Java exclusive reservation used by the JVM tests. The Android
     * plugin uses {@code Os.open(O_CREAT | O_EXCL)} with a retained fd for the
     * same guarantee on API 24-28; both call {@link #collisionName} so the
     * suffix policy has one source.
     */
    public static File reserveExclusiveName(File directory, String safeName, int maxAttempts)
        throws IOException {
        if (directory == null || !directory.isDirectory()) {
            throw new IOException("downloads_unavailable");
        }
        int limit = maxAttempts <= 0
            ? MAX_COLLISION_ATTEMPTS
            : Math.min(maxAttempts, MAX_COLLISION_ATTEMPTS);
        for (int attempt = 0; attempt < limit; attempt++) {
            String candidate = collisionName(safeName, attempt);
            if (candidate.indexOf('/') >= 0 || candidate.indexOf('\\') >= 0) {
                throw new IOException("invalid_name");
            }
            File file = new File(directory, candidate);
            if (file.createNewFile()) return file;
        }
        throw new IOException("name_exhausted");
    }

    // --- owned view cache --------------------------------------------------

    /**
     * Prunes only {@code viewRoot} (the plugin's own
     * {@code cache/findback-chat-view} tree): first anything older than the
     * 24 h retention window, then the oldest eligible files until
     * {@code incomingBytes} fits inside the 50 MiB budget. A file younger than
     * 10 minutes is never deleted (a viewer opened moments ago may still page
     * it), and a file belonging to an active view operation is never touched.
     * Returns whether the incoming file fits after pruning; when it does not,
     * the caller must fail with INSUFFICIENT_STORAGE rather than overrun.
     */
    public static boolean planViewCache(
        File viewRoot,
        long nowMillis,
        Set<String> activeRequestIds,
        long incomingBytes
    ) {
        if (incomingBytes < 0 || incomingBytes > VIEW_CACHE_BUDGET_BYTES) return false;
        Set<String> active = activeRequestIds == null
            ? Collections.<String>emptySet()
            : activeRequestIds;
        if (viewRoot == null || !viewRoot.isDirectory()) return incomingBytes <= VIEW_CACHE_BUDGET_BYTES;
        String rootPath;
        try {
            rootPath = viewRoot.getCanonicalPath();
        } catch (IOException refused) {
            return false;
        }

        List<File> files = new ArrayList<>();
        collectOwnedFiles(viewRoot, rootPath, files, 0);
        long total = 0L;
        for (File file : files) total += file.length();

        for (File file : files) {
            if (isActive(requestIdOf(viewRoot, file), active)) continue;
            long age = ageOf(file, nowMillis);
            if (age >= VIEW_RETENTION_MS) {
                long length = Math.max(0L, file.length());
                if (file.delete()) total -= length;
            }
        }

        if (total + incomingBytes > VIEW_CACHE_BUDGET_BYTES) {
            List<File> candidates = new ArrayList<>();
            for (File file : files) {
                if (!file.exists()) continue;
                if (isActive(requestIdOf(viewRoot, file), active)) continue;
                if (ageOf(file, nowMillis) < VIEW_MIN_AGE_MS) continue;
                candidates.add(file);
            }
            Collections.sort(candidates, new Comparator<File>() {
                @Override
                public int compare(File left, File right) {
                    return Long.compare(left.lastModified(), right.lastModified());
                }
            });
            for (File file : candidates) {
                if (total + incomingBytes <= VIEW_CACHE_BUDGET_BYTES) break;
                long length = Math.max(0L, file.length());
                if (file.delete()) total -= length;
            }
        }

        removeEmptyRequestDirs(viewRoot, rootPath, active);
        return total + incomingBytes <= VIEW_CACHE_BUDGET_BYTES;
    }

    private static void collectOwnedFiles(File directory, String rootPath, List<File> files, int depth) {
        if (depth > 3) return;
        File[] children = directory.listFiles();
        if (children == null) return;
        for (File child : children) {
            try {
                String canonical = child.getCanonicalPath();
                if (!canonical.startsWith(rootPath + File.separator)) continue;
                if (child.isDirectory()) {
                    collectOwnedFiles(child, rootPath, files, depth + 1);
                } else if (child.isFile()) {
                    files.add(child);
                }
            } catch (IOException refused) {
                // Skip anything that cannot be proven to live under the cache.
            }
        }
    }

    private static void removeEmptyRequestDirs(File viewRoot, String rootPath, Set<String> active) {
        File[] children = viewRoot.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (!child.isDirectory()) continue;
            if (isActive(child.getName(), active)) continue;
            try {
                if (!child.getCanonicalPath().startsWith(rootPath + File.separator)) continue;
            } catch (IOException refused) {
                continue;
            }
            File[] remaining = child.listFiles();
            if (remaining != null && remaining.length == 0) child.delete();
        }
    }

    private static String requestIdOf(File viewRoot, File file) {
        try {
            String root = viewRoot.getCanonicalPath();
            String path = file.getCanonicalPath();
            if (!path.startsWith(root + File.separator)) return null;
            String relative = path.substring(root.length() + 1);
            int separator = relative.indexOf(File.separatorChar);
            return separator < 0 ? relative : relative.substring(0, separator);
        } catch (IOException refused) {
            return null;
        }
    }

    private static boolean isActive(String requestId, Set<String> active) {
        return requestId != null && active.contains(requestId);
    }

    private static long ageOf(File file, long nowMillis) {
        long modified = file.lastModified();
        if (modified <= 0L || modified > nowMillis) return 0L;
        return nowMillis - modified;
    }

    // --- fixed copy --------------------------------------------------------

    /** Stable, diagnostic-free message per interface code. */
    public static String messageFor(String code) {
        if (code != null) {
            switch (code) {
                case CODE_PERMISSION_DENIED:
                    return "Storage permission is required to save this file.";
                case CODE_CANCELLED:
                    return "That was cancelled.";
                case CODE_NO_HANDLER:
                    return "No app on this device can open this file.";
                case CODE_SIZE_MISMATCH:
                    return "That file could not be downloaded completely.";
                case CODE_INSUFFICIENT_STORAGE:
                    return "There isn't enough space to save this file.";
                case CODE_NETWORK_ERROR:
                    return "That file could not be downloaded.";
                case CODE_NOT_FOUND:
                    return MESSAGE_FILE_GONE;
                case CODE_INVALID_REQUEST:
                    return "That file can't be opened.";
                default:
                    break;
            }
        }
        return "That file can't be opened.";
    }

    /** Fixed copy for a signed object that no longer exists (HTTP 404). */
    public static final String MESSAGE_FILE_GONE = "That file is no longer available.";

    // --- parity surface for the JVM test -----------------------------------

    public static Set<String> refusedExtensions() {
        return REFUSED_EXTENSIONS;
    }

    public static Set<String> refusedMimes() {
        return REFUSED_MIME;
    }

    public static Set<String> allowedMimes() {
        return MIME_ALLOWED;
    }
}
