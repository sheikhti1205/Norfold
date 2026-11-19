import { describe, expect, it } from "vitest";
import {
  CHAT_FILE_MARKER_PREFIX,
  chatFileBody,
  encodeChatFileMarker,
  type ChatFileMeta,
} from "../services/messaging/files";
import { messagePreview } from "./messagePreview";

const meta: ChatFileMeta = {
  key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-report.pdf",
  name: "report.pdf",
  mime: "application/pdf",
  byteSize: 4096,
  kind: "pdf",
};

describe("chat preview text", () => {
  it("shows the canonical file name for a valid marker, never the payload", () => {
    const body = chatFileBody(meta, "Here is the report 🎉");
    const preview = messagePreview({ body, messageType: "TEXT" });
    expect(preview).toBe("report.pdf");
    expect(preview).not.toContain(CHAT_FILE_MARKER_PREFIX);
    expect(preview).not.toContain("files/u-1");
  });

  it("recognizes a valid marker after leading blank lines and whitespace", () => {
    const bodies = [
      `\n${chatFileBody(meta, "caption")}`,
      ` \r\n\t${encodeChatFileMarker(meta)}`,
    ];
    for (const body of bodies) {
      expect(messagePreview({ body })).toBe("report.pdf");
    }
  });

  it("shows File for a malformed or future marker and never the encoded payload", () => {
    const bodies = [
      CHAT_FILE_MARKER_PREFIX,
      `${CHAT_FILE_MARKER_PREFIX}!!!not-base64`,
      `${CHAT_FILE_MARKER_PREFIX}${"A".repeat(10)}`,
      "norfold-file:v2:AAAA",
      `norfold-file:v2:${encodeChatFileMarker(meta).slice(CHAT_FILE_MARKER_PREFIX.length)}`,
      encodeChatFileMarker({ ...meta, key: "files/../escape" }),
      `\n ${CHAT_FILE_MARKER_PREFIX}broken`,
    ];
    for (const body of bodies) {
      const preview = messagePreview({ body });
      expect(preview).toBe("File");
      expect(preview).not.toContain("norfold-file");
    }
  });

  it("keeps ordinary prose exactly, including whitespace, newlines and URLs", () => {
    const bodies = [
      "Meet me at 5",
      "  leading and trailing spaces  ",
      "line one\nline two",
      "https://example.com/report/123?ref=chat",
      "look at https://media.klipy.com/a.gif it is funny",
      "the prefix looks like norfold-file:v1: nothing more",
    ];
    for (const body of bodies) {
      expect(messagePreview({ body })).toBe(body);
    }
  });

  it("returns a whitespace-only body unchanged, as the pill does today", () => {
    // Not a new label for a body that exists: only a truly empty body falls back.
    expect(messagePreview({ body: " \n\t " })).toBe(" \n\t ");
  });

  it("names the proven kind and keeps pre-marker history honest", () => {
    expect(messagePreview({ body: "https://media.klipy.com/a.gif#norfold-media=gif" })).toBe("GIF");
    expect(messagePreview({ body: "  https://media.klipy.com/s.webp#norfold-media=sticker  " })).toBe("Sticker");
    // Pre-marker history proves no kind; it is never guessed from an extension.
    expect(messagePreview({ body: "https://media.klipy.com/a.gif" })).toBe("Sticker/GIF");
    expect(messagePreview({ body: "  https://media.klipy.com/a.gif  " })).toBe("Sticker/GIF");
    expect(messagePreview({ body: "https://klipy.com/a.gif" })).toBe("Sticker/GIF");
    // Contradictory markers are not a claim, and prose is never a sticker.
    expect(messagePreview({ body: "https://media.klipy.com/a.gif#norfold-media=sticker&norfold-media=gif" })).toBe("Sticker/GIF");
    expect(messagePreview({ body: "https://media.klipy.com/a.gif\nand more" })).not.toBe("Sticker/GIF");
  });

  it("prefers visible message text over the type fallback", () => {
    expect(messagePreview({ body: "A caption", messageType: "MEDIA" })).toBe("A caption");
    expect(messagePreview({ body: "A caption", messageType: "VOICE" })).toBe("A caption");
  });

  it("uses the existing consumer copy for an empty typed message", () => {
    expect(messagePreview({ body: "", messageType: "MEDIA" })).toBe("Photo");
    expect(messagePreview({ body: "", messageType: "VOICE" })).toBe("Voice message");
    expect(messagePreview({ body: "", messageType: "LOCATION" })).toBe("Location shared");
    expect(messagePreview({ body: "", messageType: "TEXT" })).toBe("Message");
    expect(messagePreview({ body: "" })).toBe("Message");
  });

  it("reports an unsent message before any body classification", () => {
    expect(messagePreview({ body: "still here", messageType: "MEDIA", unsentAt: 1 }))
      .toBe("Message unsent");
    expect(messagePreview({ body: chatFileBody(meta), unsentAt: 1 })).toBe("Message unsent");
  });

  it("is synchronous and needs no storage or network", () => {
    // Nothing is mocked in this file: the helper is a pure string function.
    const preview = messagePreview({ body: "Hello" });
    expect(typeof preview).toBe("string");
    expect(preview).toBe("Hello");
  });
});
