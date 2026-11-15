// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_FILE_FALLBACK_MIME,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_MIME_ALLOWLIST,
  chatFileBody,
  chatFileCaption,
  chatFileKindOf,
  chatFileMime,
  chatFilePreview,
  encodeChatFileMarker,
  isChatFileMimeAllowed,
  parseChatFileMarker,
  safeChatFileName,
  validateChatFile,
  type ChatFileMeta,
} from "./files";

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
