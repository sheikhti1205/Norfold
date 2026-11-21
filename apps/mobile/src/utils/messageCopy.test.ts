import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_FILE_MARKER_PREFIX,
  chatFileBody,
  encodeChatFileMarker,
  type ChatFileMeta,
} from "../services/messaging/files";
import {
  copyableMessageLinks,
  copyableMessageText,
  isBareKlipyMediaBody,
  messageCopyActions,
} from "./messageCopy";

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

describe("message copy actions", () => {
  const origin = "https://findbackapp.social";
  const reportId = "5b6f7c8d-1234-4abc-8def-123456789012";
  const reportUrl = `${origin}/r/${reportId}`;

  it("offers one exact Copy text action for plain prose", () => {
    const body = "  keep\nthis exactly 🎉  ";
    expect(messageCopyActions({ body })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: body },
    ]);
  });

  it("offers Copy link, never Copy text, for one bare safe URL", () => {
    const url = "https://example.com/report/123?ref=chat";
    expect(messageCopyActions({ body: url })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("splits prose from one link into two actions without hiding the URL", () => {
    const url = "https://example.com/a?x=1";
    expect(messageCopyActions({ body: `Read ${url} and reply` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "Read and reply" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("keeps line breaks and the other prose slices exactly", () => {
    const url = "https://example.com/x";
    expect(messageCopyActions({ body: `line one\n${url}\nline two` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "line one\nline two" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("preserves blank lines after a previewed link", () => {
    const url = "https://example.com/x";
    expect(messageCopyActions({ body: `before ${url}\n\nafter` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "before\n\nafter" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("does not offer a punctuation-only Copy text beside a bare URL", () => {
    expect(messageCopyActions({ body: "https://example.com/x." })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url: "https://example.com/x" },
    ]);
    expect(messageCopyActions({ body: "\"https://example.com/x\"" })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url: "https://example.com/x" },
    ]);
  });

  it("keeps a real symbol or emoji beside a link copyable as text", () => {
    expect(messageCopyActions({ body: "🎉 https://example.com/x" })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "🎉" },
      { id: "copy-link", kind: "link", label: "Copy link", url: "https://example.com/x" },
    ]);
    expect(messageCopyActions({ body: "→ https://example.com/x" })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "→" },
      { id: "copy-link", kind: "link", label: "Copy link", url: "https://example.com/x" },
    ]);
  });

  it("offers one clear Copy link action per distinct URL, in order, with repeats removed", () => {
    const first = "https://a.example/one";
    const second = "https://b.example/two";
    expect(messageCopyActions({ body: `Compare ${first} with ${second} first` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "Compare with first" },
      {
        id: "copy-links", kind: "link-menu", label: "Copy link",
        links: [{ id: "copy-link-1", url: first }, { id: "copy-link-2", url: second }],
      },
    ]);
  });

  it("dedupes a repeated URL into one direct Copy link", () => {
    const url = "https://example.com/one";
    expect(messageCopyActions({ body: `${url} again ${url}` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "again" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("keeps the URL exactly as written, including percent encoding and a fragment", () => {
    const url = "https://example.com/a%20b?q=x%26y#frag";
    expect(messageCopyActions({ body: `See ${url} now` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "See now" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("never treats an unsafe scheme as a link", () => {
    expect(messageCopyActions({ body: "javascript:alert(1)" })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "javascript:alert(1)" },
    ]);
    expect(messageCopyActions({ body: "data:text/html,<b>x</b>" })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "data:text/html,<b>x</b>" },
    ]);
    expect(messageCopyActions({ body: "javascript:alert(1) then https://example.com/x" })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "javascript:alert(1) then" },
      { id: "copy-link", kind: "link", label: "Copy link", url: "https://example.com/x" },
    ]);
  });

  it("keeps a visible provider link copyable while a bare media body is not", () => {
    const url = "https://media.klipy.com/a.gif";
    expect(messageCopyActions({ body: `See ${url} now` })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "See now" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
    expect(copyableMessageLinks(`See ${url} now`)).toEqual([{ id: "copy-link-1", url }]);
    for (const body of [
      url,
      `${url}#norfold-media=gif`,
      "https://media.klipy.com/s.webp#norfold-media=sticker",
    ]) {
      expect(messageCopyActions({ body })).toEqual([]);
      expect(copyableMessageLinks(body)).toEqual([]);
    }
  });

  it("copies only the caption of a file and keeps its visible link separate", () => {
    const url = "https://example.com/report/1";
    expect(messageCopyActions({ body: chatFileBody(meta, `Please read ${url} now`) })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "Please read now" },
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
    expect(messageCopyActions({ body: chatFileBody(meta, ` ${url} `) })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url },
    ]);
  });

  it("never exposes the payload of a reserved or malformed marker", () => {
    const malformed = "norfold-file:v1:!!!not-base64 https://evil.example/x";
    expect(messageCopyActions({ body: malformed })).toEqual([]);
    expect(copyableMessageLinks(malformed)).toEqual([]);
    expect(messageCopyActions({ body: "norfold-file:v2:AAAA" })).toEqual([]);
  });

  it("never copies unsent work, empty bodies or whitespace", () => {
    expect(messageCopyActions({ body: "https://example.com/x", unsentAt: 5 })).toEqual([]);
    expect(messageCopyActions({ body: "Gone", unsentAt: 5 })).toEqual([]);
    expect(messageCopyActions({ body: "" })).toEqual([]);
    expect(messageCopyActions({ body: "  \n\t " })).toEqual([]);
    expect(copyableMessageLinks("")).toEqual([]);
  });

  it("uses the exact visible report share URL instead of the internal report id", () => {
    expect(messageCopyActions({ body: reportUrl }, { reportOrigin: origin })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url: reportUrl },
    ]);
    expect(copyableMessageLinks(reportUrl, { reportOrigin: origin })).toEqual([
      { id: "copy-link-1", url: reportUrl, reportId },
    ]);
    // The app's own share endpoint is the same visible link, copied as written.
    const share = `${origin}/api/share/${reportId}`;
    expect(copyableMessageLinks(share, { reportOrigin: origin })).toEqual([
      { id: "copy-link-1", url: share, reportId },
    ]);
  });

  it("reports the visible link projection in first-occurrence order", () => {
    const first = "https://a.example/one";
    const second = "https://b.example/two";
    expect(copyableMessageLinks(`Nothing here`)).toEqual([]);
    expect(copyableMessageLinks(`${second} ${first} ${second}`)).toEqual([
      { id: "copy-link-1", url: second },
      { id: "copy-link-2", url: first },
    ]);
  });
});

describe("message copy actions with a report context", () => {
  const origin = "https://findbackapp.social";
  const reportId = "5b6f7c8d-1234-4abc-8def-123456789012";
  const shareUrl = `${origin}/api/share/${reportId}`;

  afterEach(() => vi.unstubAllEnvs());

  it("offers the canonical report share link for a context-only message", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    expect(messageCopyActions({ body: "", contextReportId: reportId })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url: shareUrl },
    ]);
    expect(messageCopyActions({ body: "  \n\t ", contextReportId: reportId })).toEqual([
      { id: "copy-link", kind: "link", label: "Copy link", url: shareUrl },
    ]);
  });

  it("keeps prose and adds the report link separately", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    expect(messageCopyActions({ body: "About this report", contextReportId: reportId })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "About this report" },
      { id: "copy-link", kind: "link", label: "Copy link", url: shareUrl },
    ]);
  });

  it("keeps a file caption and the report link, never the serialized marker", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const body = chatFileBody(meta, "See the photo");
    expect(messageCopyActions({ body, contextReportId: reportId })).toEqual([
      { id: "copy-text", kind: "text", label: "Copy text", text: "See the photo" },
      { id: "copy-link", kind: "link", label: "Copy link", url: shareUrl },
    ]);
    const copied = messageCopyActions({ body, contextReportId: reportId });
    expect(JSON.stringify(copied)).not.toContain(CHAT_FILE_MARKER_PREFIX);
  });

  it("offers only the report link for a bare sticker body, never the media URL", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    for (const body of [
      "https://media.klipy.com/a.gif",
      "https://media.klipy.com/s.webp#norfold-media=sticker",
    ]) {
      expect(messageCopyActions({ body, contextReportId: reportId })).toEqual([
        { id: "copy-link", kind: "link", label: "Copy link", url: shareUrl },
      ]);
    }
    // Without a context the bare media body still exposes nothing.
    expect(messageCopyActions({ body: "https://media.klipy.com/a.gif" })).toEqual([]);
  });

  it("does not duplicate a report link the body already shows", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    for (const bodyUrl of [`${origin}/r/${reportId}`, shareUrl]) {
      expect(messageCopyActions({ body: bodyUrl, contextReportId: reportId })).toEqual([
        { id: "copy-link", kind: "link", label: "Copy link", url: bodyUrl },
      ]);
    }
  });

  it("keeps a distinct body report link and the context link apart", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    const other = "11111111-2222-4333-8444-555555555555";
    const bodyUrl = `${origin}/r/${other}`;
    expect(messageCopyActions({ body: bodyUrl, contextReportId: reportId })).toEqual([
      {
        id: "copy-links", kind: "link-menu", label: "Copy link",
        links: [
          { id: "copy-link-1", url: bodyUrl, reportId: other },
          { id: "copy-link-2", url: shareUrl, reportId },
        ],
      },
    ]);
  });

  it("never derives a link from an unknown or malformed context id", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    for (const contextReportId of ["not-a-report", "../../evil", `${reportId}/x`, " "]) {
      expect(messageCopyActions({ body: "Keep this prose", contextReportId })).toEqual([
        { id: "copy-text", kind: "text", label: "Copy text", text: "Keep this prose" },
      ]);
    }
  });

  it("never invents an origin when the public share origin is unset or invalid", () => {
    for (const value of ["", "http://localhost:5173", "https://localhost"]) {
      vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", value);
      expect(messageCopyActions({ body: "Keep this prose", contextReportId: reportId })).toEqual([
        { id: "copy-text", kind: "text", label: "Copy text", text: "Keep this prose" },
      ]);
      expect(messageCopyActions({ body: "", contextReportId: reportId })).toEqual([]);
    }
  });

  it("still offers nothing for an unsent message that carries a context", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin);
    expect(messageCopyActions({ body: "", contextReportId: reportId, unsentAt: 5 })).toEqual([]);
    expect(messageCopyActions({
      body: `${origin}/r/${reportId}`, contextReportId: reportId, unsentAt: 5,
    })).toEqual([]);
  });
});
