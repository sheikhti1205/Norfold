// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_FILE_FALLBACK_MIME,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_MIME_ALLOWLIST,
  chatFileBody,
  chatFileCaption,
  chatFileExportIdentity,
  chatFileKindOf,
  chatFileMime,
  chatFilePreview,
  encodeChatFileMarker,
  isChatFileMimeAllowed,
  isSignableChatFileKey,
  parseChatFileMarker,
  safeChatFileName,
  signedChatFileUrl,
  validateChatFile,
  type ChatFileMeta,
} from "./files";

const signing = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  origin: "https://project.supabase.co",
}));

vi.mock("../supabaseClient", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({ createSignedUrl: signing.createSignedUrl }),
    },
  }),
  getSupabaseBackendUrl: () => signing.origin,
}));

const REPO_ROOT = resolve(process.cwd(), "../..");
const WIDENING_MIGRATION = "20261115130000_chat_file_type_widening.sql";

function file(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function wideningMigrationSql(): string {
  return readFileSync(resolve(REPO_ROOT, "supabase", "migrations", WIDENING_MIGRATION), "utf8");
}

const meta: ChatFileMeta = {
  key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-report.pdf",
  name: "report.pdf",
  mime: "application/pdf",
  byteSize: 4096,
  kind: "pdf",
};

describe("validateChatFile", () => {
  it("refuses programs and scripts before reading them", () => {
    expect(validateChatFile(file("run.bat", "application/x-msdownload"))).toMatch(/\.bat/);
    expect(validateChatFile(file("tool.exe", "application/x-msdownload"))).toMatch(/\.exe/);
    expect(validateChatFile(file("page.html", "text/html"))).toMatch(/program|code/);
    expect(validateChatFile(file("icon.svg", "image/svg+xml"))).toMatch(/\.svg|code/);
    expect(validateChatFile(file("mod.wasm", "application/wasm"))).toMatch(/\.wasm|code/);
    expect(validateChatFile(file("setup.msi", ""))).toMatch(/\.msi/);
    expect(validateChatFile(file("page.xhtml", "application/xhtml+xml"))).toMatch(/\.xhtml|code/);
  });

  it("accepts any ordinary file the browser cannot name", () => {
    for (const name of [
      "art.psd", "backup.7z", "film.mkv", "book.epub", "font.ttf", "mesh.obj", "scene.blend", "README",
    ]) {
      expect(validateChatFile(file(name, ""))).toBeNull();
    }
    expect(validateChatFile(file("notes.weird", "application/x-unknown"))).toBeNull();
  });

  it("accepts images through the file lane instead of redirecting them", () => {
    const images: Array<[string, string]> = [
      ["photo.gif", "image/gif"],
      ["photo.bmp", "image/bmp"],
      ["photo.tiff", "image/tiff"],
      ["photo.heic", "image/heic"],
      ["photo.heif", "image/heif"],
      ["photo.avif", "image/avif"],
      ["photo.webp", "image/webp"],
      ["photo.jpg", "image/jpeg"],
      ["photo.png", "image/png"],
    ];
    for (const [name, type] of images) expect(validateChatFile(file(name, type))).toBeNull();
    expect(validateChatFile(file("photo.jpg", ""))).toBeNull();
  });

  it("accepts documents, archives, video and audio files", () => {
    expect(validateChatFile(file("report.pdf", "application/pdf"))).toBeNull();
    expect(validateChatFile(file("bundle.zip", "application/zip"))).toBeNull();
    expect(validateChatFile(file("backup.rar", "application/vnd.rar"))).toBeNull();
    expect(validateChatFile(file("clip.mp4", "video/mp4"))).toBeNull();
    expect(validateChatFile(file("clip.mkv", "video/x-matroska"))).toBeNull();
    expect(validateChatFile(file("song.mp3", "audio/mpeg"))).toBeNull();
    expect(validateChatFile(file("notes.docx", ""))).toBeNull();
    expect(validateChatFile(file("book.epub", "application/epub+zip"))).toBeNull();
  });

  it("refuses only empty and oversized files", () => {
    expect(validateChatFile(file("huge.pdf", "application/pdf", CHAT_FILE_MAX_BYTES + 1))).toMatch(/20 MB/);
    expect(validateChatFile(file("empty.pdf", "application/pdf", 0))).toMatch(/empty/);
    expect(validateChatFile(file("limit.pdf", "application/pdf", CHAT_FILE_MAX_BYTES))).toBeNull();
  });
});

describe("chat file MIME resolution", () => {
  it("derives a MIME from the extension when the browser declares none", () => {
    expect(chatFileMime(file("notes.docx", ""))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(chatFileMime(file("backup.tar.gz", ""))).toBe("application/gzip");
    expect(chatFileMime(file("photo.jpg", ""))).toBe("image/jpeg");
  });

  it("falls back to the octet-stream catch-all for formats nothing can name", () => {
    for (const name of [
      "art.psd", "backup.7z", "film.mkv", "book.epub", "font.ttf", "mesh.obj", "scene.blend",
      "mystery.xyz", "README",
    ]) {
      expect(chatFileMime(file(name, ""))).toBe(CHAT_FILE_FALLBACK_MIME);
    }
    expect(chatFileMime(file("art.psd", "application/octet-stream"))).toBe(CHAT_FILE_FALLBACK_MIME);
  });

  it("normalizes a declared type and ignores one the bucket would refuse", () => {
    expect(chatFileMime(file("notes.txt", "text/plain; charset=utf-8"))).toBe("text/plain");
    expect(chatFileMime(file("report.pdf", "application/x-unknown"))).toBe("application/pdf");
  });

  it("strips path separators from the stored name", () => {
    expect(safeChatFileName("../../etc/passwd")).toBe("..-..-etc-passwd");
    expect(safeChatFileName("  ")).toBe("file");
  });

  it("keeps a stored name signable when the sender used ? # or %", () => {
    const safe = safeChatFileName("Q3?final#1%20.pdf");
    expect(safe).not.toMatch(/[?#%]/);
    expect(safe).toBe("Q3-final-1-20.pdf");

    // Composed exactly as `uploadChatFile` composes it: a name that failed the
    // signable-key guard would upload fine and then offer no View or Save.
    const key = "files/11111111-1111-4111-8111-111111111111/"
      + "22222222-2222-4222-8222-222222222222/"
      + `33333333-3333-4333-8333-333333333333-${safe}`;
    expect(isSignableChatFileKey(key)).toBe(true);

    // An ordinary name keeps the exact bytes it always produced.
    expect(safeChatFileName("report.pdf")).toBe("report.pdf");
  });

  it("maps MIME families to display kinds", () => {
    expect(chatFileKindOf("video/mp4")).toBe("video");
    expect(chatFileKindOf("video/x-matroska")).toBe("video");
    expect(chatFileKindOf("audio/mpeg")).toBe("audio");
    expect(chatFileKindOf("application/pdf")).toBe("pdf");
    expect(chatFileKindOf("application/zip")).toBe("archive");
    expect(chatFileKindOf("application/x-7z-compressed")).toBe("archive");
    expect(chatFileKindOf("text/plain")).toBe("document");
    expect(chatFileKindOf("application/epub+zip")).toBe("document");
    // Images download like a document; the transcript never renders them.
    expect(chatFileKindOf("image/jpeg")).toBe("document");
    expect(chatFileKindOf(CHAT_FILE_FALLBACK_MIME)).toBe("file");
  });
});

describe("chat file marker", () => {
  it("round-trips the name, type, size and key", () => {
    const body = chatFileBody(meta, "Here is the report");
    expect(parseChatFileMarker(body)).toEqual(meta);
    expect(chatFilePreview(body)).toBe("report.pdf");
    expect(chatFileCaption(body)).toBe("Here is the report");
  });

  it("round-trips an octet-stream file", () => {
    const generic: ChatFileMeta = {
      key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-art.psd",
      name: "art.psd",
      mime: CHAT_FILE_FALLBACK_MIME,
      byteSize: 2048,
      kind: "file",
    };
    expect(parseChatFileMarker(chatFileBody(generic))).toEqual(generic);
    expect(isChatFileMimeAllowed(CHAT_FILE_FALLBACK_MIME)).toBe(true);
  });

  it("accepts every MIME the widened bucket stores", () => {
    for (const mime of CHAT_FILE_MIME_ALLOWLIST) {
      const forged = encodeChatFileMarker({
        key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-x",
        name: "x",
        mime,
        byteSize: 1,
        kind: chatFileKindOf(mime),
      });
      expect(parseChatFileMarker(forged)?.mime).toBe(mime);
    }
  });

  it("rejects malformed payloads and keys outside the file lane", () => {
    expect(parseChatFileMarker("norfold-file:v1:%%%")).toBeNull();
    expect(parseChatFileMarker("just text")).toBeNull();
    const forged = encodeChatFileMarker({ ...meta, key: "attachments/other" });
    expect(parseChatFileMarker(forged)).toBeNull();
    const outside = encodeChatFileMarker({ ...meta, key: "files/../secret" });
    expect(parseChatFileMarker(outside)).toBeNull();
  });

  it("rejects a type the bucket would never store", () => {
    for (const mime of [
      "application/x-msdownload", "application/wasm", "text/html", "image/svg+xml", "application/x-nope",
    ]) {
      const forged = encodeChatFileMarker({ ...meta, mime, kind: "file" });
      expect(parseChatFileMarker(forged)).toBeNull();
    }
  });
});

describe("bucket allowlist parity", () => {
  it("keeps the client allowlist exactly in step with the widening migration", () => {
    const sql = wideningMigrationSql();
    const block = /allowed_mime_types\s*=\s*array\[([\s\S]*?)\]/i.exec(sql);
    expect(block).not.toBeNull();
    const bucketMimes = [...block![1]!.matchAll(/'([^']+)'/g)]
      .map((match) => match[1]!)
      .filter((mime) => mime.includes("/"));
    expect(bucketMimes.length).toBe(new Set(bucketMimes).size);
    expect(new Set(bucketMimes)).toEqual(new Set(CHAT_FILE_MIME_ALLOWLIST));
    expect([...CHAT_FILE_MIME_ALLOWLIST].length).toBe(new Set(CHAT_FILE_MIME_ALLOWLIST).size);
  });

  it("never allows a type the refusal list blocks", () => {
    for (const mime of [
      "text/html", "application/xhtml+xml", "image/svg+xml", "application/wasm",
      "application/x-msdownload", "application/x-sh",
    ]) {
      expect(isChatFileMimeAllowed(mime)).toBe(false);
    }
  });

  it("changes only the MIME array: the 20 MB ceiling stays in the transport migration", () => {
    const sql = wideningMigrationSql();
    expect(sql).toMatch(/where id = 'findback-chat-files'/);
    expect(sql).not.toMatch(/file_size_limit\s*=/i);
    expect(sql).not.toMatch(/drop\s+(table|column)|delete\s+from|truncate/i);
  });
});

const SIGN_KEY = "files/11111111-1111-4111-8111-111111111111/"
  + "22222222-2222-4222-8222-222222222222/"
  + "33333333-3333-4333-8333-333333333333-report.pdf";
const SIGNED_PREFIX = "https://project.supabase.co/storage/v1/object/sign/findback-chat-files/";

function signedUrlFor(key: string, query = "token=jwt.token.value"): string {
  return `${SIGNED_PREFIX}${encodeURI(key)}?${query}`;
}

function signReturns(signedUrl: string): void {
  signing.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl }, error: null });
}

beforeEach(() => {
  signing.createSignedUrl.mockReset();
});

describe("signed chat-file URLs", () => {
  it("signs the exact key for the short default window", async () => {
    signReturns(signedUrlFor(SIGN_KEY));
    await expect(signedChatFileUrl(SIGN_KEY)).resolves.toBe(signedUrlFor(SIGN_KEY));
    expect(signing.createSignedUrl).toHaveBeenCalledExactlyOnceWith(SIGN_KEY, 60);
  });

  it("clamps an accidental long token to 60 seconds and never signs below one", async () => {
    signing.createSignedUrl.mockResolvedValue({ data: { signedUrl: signedUrlFor(SIGN_KEY) }, error: null });
    await signedChatFileUrl(SIGN_KEY, 365 * 24 * 60 * 60);
    await signedChatFileUrl(SIGN_KEY, 0);
    await signedChatFileUrl(SIGN_KEY, 5);
    await signedChatFileUrl(SIGN_KEY, Number.NaN);
    expect(signing.createSignedUrl.mock.calls).toEqual([
      [SIGN_KEY, 60],
      [SIGN_KEY, 1],
      [SIGN_KEY, 5],
      [SIGN_KEY, 60],
    ]);
  });

  it.each([
    "",
    "attachments/other/file.pdf",
    "files/../secret.pdf",
    "files/u/c/a\\b.pdf",
    "files/u/c/a\u0000b.pdf",
    "files/u/c/a%2Fb.pdf",
    "files/u/c/a%5Cb.pdf",
    "files/u/c/a%2eb.pdf",
    "files/u/c/a?b.pdf",
    "files/u/c/a#b.pdf",
    "files/u/c",
    "files//c/a.pdf",
    "files/u/./a.pdf",
    `files/u/c/${"a".repeat(1100)}.pdf`,
  ])("refuses an unsafe or non-canonical key before signing: %s", async (key) => {
    await expect(signedChatFileUrl(key)).rejects.toMatchObject({ status: 400 });
    expect(signing.createSignedUrl).not.toHaveBeenCalled();
  });

  it("accepts the exact key shape uploads create", () => {
    expect(isSignableChatFileKey(SIGN_KEY)).toBe(true);
    expect(isSignableChatFileKey("files/u/c/" + "x".repeat(100) + ".pdf")).toBe(true);
  });

  it.each([
    ["a different origin", SIGN_KEY, signedUrlFor(SIGN_KEY).replace("project.supabase.co", "evil.example")],
    ["plain http", SIGN_KEY, signedUrlFor(SIGN_KEY).replace("https://", "http://")],
    ["a different bucket", SIGN_KEY, signedUrlFor(SIGN_KEY).replace("findback-chat-files", "other-bucket")],
    ["a missing token", SIGN_KEY, `${SIGNED_PREFIX}${encodeURI(SIGN_KEY)}`],
    ["an empty token", SIGN_KEY, `${SIGNED_PREFIX}${encodeURI(SIGN_KEY)}?token=`],
    ["an extra query parameter", SIGN_KEY, `${SIGNED_PREFIX}${encodeURI(SIGN_KEY)}?token=x&download=true`],
    ["a fragment", SIGN_KEY, `${SIGNED_PREFIX}${encodeURI(SIGN_KEY)}?token=x#frag`],
    ["user info", SIGN_KEY, signedUrlFor(SIGN_KEY).replace("https://", "https://user:pass@")],
    ["a different key", SIGN_KEY, signedUrlFor(SIGN_KEY.replace("report.pdf", "other.pdf"))],
    ["an encoded separator", SIGN_KEY, `${SIGNED_PREFIX}${encodeURI(SIGN_KEY).replace("33333333-3333-4333-8333-333333333333-report", "33333333-3333-4333-8333-333333333333%2Freport")}?token=x`],
  ])("rejects a signed URL with %s", async (_label, key, signedUrl) => {
    signReturns(signedUrl);
    await expect(signedChatFileUrl(key)).rejects.toMatchObject({ status: 502 });
  });

  it("accepts the SDK's percent-encoded form for spaces and non-ASCII names", async () => {
    const spaced = SIGN_KEY.replace("report.pdf", "Q3 report.pdf");
    const renamed = SIGN_KEY.replace("report.pdf", "résumé.pdf");
    signReturns(signedUrlFor(spaced));
    await expect(signedChatFileUrl(spaced)).resolves.toBe(signedUrlFor(spaced));
    signReturns(signedUrlFor(renamed));
    await expect(signedChatFileUrl(renamed)).resolves.toBe(signedUrlFor(renamed));
  });

  it("maps a masked missing or inaccessible object to a 404 without leaking a URL", async () => {
    signing.createSignedUrl.mockResolvedValueOnce({ data: null, error: { status: 400, message: "Object not found" } });
    const error = await signedChatFileUrl(SIGN_KEY).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 404, message: "That file is no longer available." });
    expect(JSON.stringify(error)).not.toContain("token");
  });
});

describe("chat file export identity", () => {
  function identity(name: string, mime: string): { name: string; mime: string } {
    return chatFileExportIdentity({
      key: "files/u/c/00000000-0000-4000-8000-000000000000-x",
      name,
      mime,
      byteSize: 1024,
      kind: "file",
    });
  }

  it("keeps an ordinary allowed extension and the exact bytes' type", () => {
    expect(identity("Q3 report.pdf", "application/pdf")).toEqual({ name: "Q3 report.pdf", mime: "application/pdf" });
    expect(identity("notes.txt", "text/plain; charset=utf-8")).toEqual({ name: "notes.txt", mime: "text/plain" });
    expect(identity("book.epub", "application/epub+zip")).toEqual({ name: "book.epub", mime: "application/epub+zip" });
  });

  it("lets a known ordinary extension correct a lying marker type", () => {
    expect(identity("report.pdf", "text/plain")).toEqual({ name: "report.pdf", mime: "application/pdf" });
    expect(identity("photo.jpg", "application/octet-stream")).toEqual({ name: "photo.jpg", mime: "image/jpeg" });
  });

  it("keeps only a safe marker type for an unknown extension", () => {
    expect(identity("scene.obj", "application/pdf")).toEqual({ name: "scene.obj", mime: "application/pdf" });
    expect(identity("scene.obj", "text/plain")).toEqual({ name: "scene.obj", mime: "text/plain" });
    expect(identity("scene.obj", "text/html")).toEqual({ name: "scene.obj", mime: CHAT_FILE_FALLBACK_MIME });
    expect(identity("scene.obj", "application/x-msdownload")).toEqual({ name: "scene.obj", mime: CHAT_FILE_FALLBACK_MIME });
  });

  it.each(["page.html", "icon.svg", "data.bin", "tool.exe", "run.bat", "mod.wasm"])(
    "neutralizes the refused extension on %s",
    (name) => {
      const result = identity(name, "text/plain");
      expect(result.name.endsWith(".download")).toBe(true);
      expect(result.name).not.toMatch(/\.(?:html|svg|bin|exe|bat|wasm)$/i);
      expect(result.mime).toBe(CHAT_FILE_FALLBACK_MIME);
    },
  );

  it("turns a bare refused extension into a named download", () => {
    expect(identity(".exe", "application/octet-stream")).toEqual({ name: "file.download", mime: CHAT_FILE_FALLBACK_MIME });
  });

  it("does not neutralize an ordinary extension that merely contains HTML in the name", () => {
    // The bytes may be HTML, but the copy is a text file: neither the name nor
    // the forced MIME can execute in a browser or a native viewer.
    expect(identity("invoice.html.txt", "text/html")).toEqual({ name: "invoice.html.txt", mime: "text/plain" });
  });

  it("removes Windows-forbidden characters, bidi overrides, NUL and trailing dots/spaces", () => {
    const result = identity('a<b>c:"d"|e?f*.pdf', "application/pdf");
    // eslint-disable-next-line no-control-regex
    expect(result.name).not.toMatch(/[<>:"|?*\u0000]/);
    expect(result.name.endsWith(".pdf")).toBe(true);
    expect(identity("report\u202Efdp.pdf", "application/pdf").name).toBe("reportfdp.pdf");
    expect(identity("report.pdf. . ", "application/pdf").name).toBe("report.pdf");
  });

  it("prefixes a reserved DOS device stem", () => {
    expect(identity("CON.pdf", "application/pdf").name).toBe("file-CON.pdf");
    expect(identity("com1.txt", "text/plain").name).toBe("file-com1.txt");
    expect(identity("LPT9", "application/octet-stream").name).toBe("file-LPT9");
  });

  it("caps a long name at 120 code points and keeps its extension", () => {
    const long = `${"a".repeat(200)}.pdf`;
    const capped = identity(long, "application/pdf").name;
    expect(Array.from(capped).length).toBe(120);
    expect(capped.endsWith(".pdf")).toBe(true);
    const unicode = identity(`${"📄".repeat(200)}.pdf`, "application/pdf").name;
    expect(Array.from(unicode).length).toBe(120);
    expect(unicode.endsWith(".pdf")).toBe(true);
  });

  it("never returns an empty, dot or traversal name", () => {
    expect(identity("", "").name).toBe("file");
    expect(identity("   ", "").name).toBe("file");
    expect(identity("..", "").name).toBe("file");
    expect(identity("../../etc/passwd", "").name).not.toMatch(/[\\/]/);
  });
});
