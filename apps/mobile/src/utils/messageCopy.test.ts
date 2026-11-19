import { describe, expect, it } from "vitest";
import {
  CHAT_FILE_MARKER_PREFIX,
  chatFileBody,
  encodeChatFileMarker,
  type ChatFileMeta,
} from "../services/messaging/files";
import { copyableMessageText, isBareKlipyMediaBody } from "./messageCopy";

const meta: ChatFileMeta = {
  key: "files/u-1/c-1/00000000-0000-4000-8000-000000000000-report.pdf",
  name: "report.pdf",
  mime: "application/pdf",
  byteSize: 4096,
  kind: "pdf",
};

describe("message Copy policy", () => {
  it("copies ordinary text exactly, preserving whitespace, newlines and emoji", () => {
    const bodies = [
      "Meet me at 5",
      "  leading and trailing spaces  ",
      "line one\nline two\n\nline four",
      "emoji 🎉🔥 and text 🧵",
      "tabs\tand\r\nwindows breaks",
    ];
    for (const body of bodies) {
      expect(copyableMessageText({ body })).toBe(body);
    }
  });

  it("copies ordinary pasted URLs and prose containing a Klipy media URL exactly", () => {
    const bodies = [
      "https://example.com/report/123?ref=chat",
      "look at https://media.klipy.com/a.gif it is funny",
      "https://media.klipy.com/a.gif and https://media.klipy.com/b.gif",
      "https://klipy.com/a.gif sits inside this sentence",
      "prefix https://example.com then more text",
    ];
    for (const body of bodies) {
      expect(copyableMessageText({ body })).toBe(body);
    }
  });

  it("copies leading and multiline prose that starts with a Klipy URL", () => {
    const bodies = [
      "https://media.klipy.com/a.gif is the one I meant",
      "https://media.klipy.com/a.gif\nthat was the GIF\nand more text",
      "  https://media.klipy.com/a.gif\tafter a tab",
    ];
    for (const body of bodies) {
      expect(copyableMessageText({ body })).toBe(body);
    }
  });

  it.each([
    "https://media.klipy.com/a.gif",
    "https://klipy.com/a.gif",
    "  https://media.klipy.com/a.gif  ",
    "https://media.klipy.com/a.gif\n",
    "https://media.klipy.com/a%20b.gif",
    // A new send tags its picker kind in the fragment. The body is still one
    // bare provider URL, so Copy stays omitted instead of exposing the marker.
    "https://media.klipy.com/a.gif#norfold-media=gif",
    "https://media.klipy.com/s.webp#norfold-media=sticker",
  ])("disables Copy for a bare Klipy GIF or sticker body: %s", (body) => {
    expect(copyableMessageText({ body })).toBeNull();
  });

  it("classifies bare provider media only for a single whitespace-free URL", () => {
    expect(isBareKlipyMediaBody("https://media.klipy.com/a.gif")).toBe(true);
    expect(isBareKlipyMediaBody("  https://media.klipy.com/a.gif  ")).toBe(true);
    expect(isBareKlipyMediaBody("https://media.klipy.com/a%20b.gif")).toBe(true);
    // The kind fragment never changes the transport class of the body.
    expect(isBareKlipyMediaBody("https://media.klipy.com/a.gif#norfold-media=gif")).toBe(true);
    expect(isBareKlipyMediaBody("https://media.klipy.com/s.webp#norfold-media=sticker")).toBe(true);
    expect(isBareKlipyMediaBody("https://media.klipy.com/a.gif and more")).toBe(false);
    expect(isBareKlipyMediaBody("https://media.klipy.com/a.gif\nmore")).toBe(false);
    expect(isBareKlipyMediaBody("https://example.com/a.gif")).toBe(false);
    expect(isBareKlipyMediaBody("")).toBe(false);
  });

  it("copies only the visible caption of a conversation file", () => {
    const body = chatFileBody(meta, "Here is the report 🎉");
    expect(body.startsWith(CHAT_FILE_MARKER_PREFIX)).toBe(true);
    expect(copyableMessageText({ body })).toBe("Here is the report 🎉");
  });

  it("copies the canonical trimmed caption the transcript shows", () => {
    const body = chatFileBody(meta, "  spaced caption  ");
    expect(copyableMessageText({ body })).toBe("spaced caption");
  });

  it("never leaks the marker when the marker sits after a leading blank line", () => {
    const body = ` \n${chatFileBody(meta, "Caption stays 🎉")}`;
    const copied = copyableMessageText({ body });
    expect(copied).toBe("Caption stays 🎉");
    expect(copied).not.toContain(CHAT_FILE_MARKER_PREFIX);
  });

  it("never leaks the marker when the file body uses CRLF", () => {
    const body = `\r\n${encodeChatFileMarker(meta)}\r\nCRLF caption`;
    const copied = copyableMessageText({ body });
    expect(copied).toBe("CRLF caption");
    expect(copied).not.toContain(CHAT_FILE_MARKER_PREFIX);
  });

  it.each([
    ` \n${chatFileBody(meta)}`,
    `\r\n${encodeChatFileMarker(meta)}\r\n`,
  ])("disables Copy for a captionless file after a leading blank line", (body) => {
    expect(copyableMessageText({ body })).toBeNull();
  });

  it("disables Copy for a conversation file with no caption", () => {
    expect(copyableMessageText({ body: chatFileBody(meta) })).toBeNull();
  });

  it.each([
    CHAT_FILE_MARKER_PREFIX,
    `${CHAT_FILE_MARKER_PREFIX}!!!not-base64`,
    `${CHAT_FILE_MARKER_PREFIX}${"A".repeat(10)}\ncaption that must not leak`,
    "norfold-file:v2:AAAA",
    `norfold-file:v2:${encodeChatFileMarker(meta).slice(CHAT_FILE_MARKER_PREFIX.length)}`,
    encodeChatFileMarker({ ...meta, key: "files/../escape" }),
    encodeChatFileMarker({ ...meta, mime: "application/x-msdownload" }),
  ])("never copies a reserved or malformed file marker body: %s", (body) => {
    expect(copyableMessageText({ body })).toBeNull();
  });

  it("still copies a reserved-looking marker mentioned mid-prose", () => {
    const body = "the prefix looks like norfold-file:v1: nothing more";
    expect(copyableMessageText({ body })).toBe(body);
  });

  it("refuses an unsent body", () => {
    expect(copyableMessageText({ body: "already gone", unsentAt: 1_700_000_000_000 })).toBeNull();
    expect(copyableMessageText({ body: "", unsentAt: 1 })).toBeNull();
  });

  it("returns null for empty and whitespace-only bodies", () => {
    expect(copyableMessageText({ body: "" })).toBeNull();
    expect(copyableMessageText({ body: "   \n\t " })).toBeNull();
  });
});
