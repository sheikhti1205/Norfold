// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  CHAT_FILE_MAX_BYTES,
  chatFileBody,
  chatFileCaption,
  chatFileKindOf,
  chatFileMime,
  chatFilePreview,
  encodeChatFileMarker,
  parseChatFileMarker,
  safeChatFileName,
  validateChatFile,
  type ChatFileMeta,
} from "./files";

function file(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
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
  });

  it("keeps photos on the photo lane", () => {
    expect(validateChatFile(file("photo.jpg", "image/jpeg"))).toMatch(/photo control/i);
  });

  it("accepts documents, archives, video and audio files", () => {
    expect(validateChatFile(file("report.pdf", "application/pdf"))).toBeNull();
    expect(validateChatFile(file("bundle.zip", "application/zip"))).toBeNull();
    expect(validateChatFile(file("clip.mp4", "video/mp4"))).toBeNull();
    expect(validateChatFile(file("song.mp3", "audio/mpeg"))).toBeNull();
    expect(validateChatFile(file("notes.docx", ""))).toBeNull();
  });

  it("refuses unknown types and oversized files", () => {
    expect(validateChatFile(file("weird.xyz", "application/x-unknown"))).toMatch(/not supported/);
    expect(validateChatFile(file("huge.pdf", "application/pdf", CHAT_FILE_MAX_BYTES + 1))).toMatch(/20 MB/);
    expect(validateChatFile(file("empty.pdf", "application/pdf", 0))).toMatch(/empty/);
  });
});

describe("chat file naming", () => {
  it("derives a MIME from the extension when the browser declares none", () => {
    expect(chatFileMime(file("notes.docx", ""))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("strips path separators from the stored name", () => {
    expect(safeChatFileName("../../etc/passwd")).toBe("..-..-etc-passwd");
    expect(safeChatFileName("  ")).toBe("file");
  });

  it("maps MIME families to display kinds", () => {
    expect(chatFileKindOf("video/mp4")).toBe("video");
    expect(chatFileKindOf("audio/mpeg")).toBe("audio");
    expect(chatFileKindOf("application/pdf")).toBe("pdf");
    expect(chatFileKindOf("application/zip")).toBe("archive");
    expect(chatFileKindOf("text/plain")).toBe("document");
  });
});

describe("chat file marker", () => {
  it("round-trips the name, type, size and key", () => {
    const body = chatFileBody(meta, "Here is the report");
    expect(parseChatFileMarker(body)).toEqual(meta);
    expect(chatFilePreview(body)).toBe("report.pdf");
    expect(chatFileCaption(body)).toBe("Here is the report");
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
    const forged = encodeChatFileMarker({ ...meta, mime: "application/x-msdownload", kind: "file" });
    expect(parseChatFileMarker(forged)).toBeNull();
  });
});
