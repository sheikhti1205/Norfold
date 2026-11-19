import { afterEach, describe, expect, it, vi } from "vitest";
import { segmentChatTextLinks, type ChatTextSegment } from "./chatTextLinks";

const origin = "https://findbackapp.social";
const id = "5b6f7c8d-1234-4abc-8def-123456789012";

function joined(segments: ChatTextSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

afterEach(() => vi.unstubAllEnvs());

describe("chat text link segmentation", () => {
  it("returns one text segment for empty and plain bodies", () => {
    expect(segmentChatTextLinks("")).toEqual([]);
    for (const body of ["Just a plain sentence, no links.", "🎉 line one\nline two"]) {
      expect(segmentChatTextLinks(body)).toEqual([{ kind: "text", text: body }]);
    }
  });

  it("splits one URL out of prose without touching the visible text", () => {
    const body = "See https://example.com/a?x=1 for details";
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "https://example.com/a?x=1", href: "https://example.com/a?x=1" },
      { kind: "text", text: " for details" },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it("keeps unicode, emoji and newlines around a link byte-for-byte", () => {
    const url = "https://example.com/ü?x=1";
    const body = `héllo 🎉\n${url}\nbye ✅`;
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "text", text: "héllo 🎉\n" },
      { kind: "link", text: url, href: url },
      { kind: "text", text: "\nbye ✅" },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it.each([
    { label: "NBSP", space: "\u00a0" },
    { label: "ideographic space", space: "\u3000" },
    { label: "line separator", space: "\u2028" },
  ])("stops a URL at $label and keeps the prose as text", ({ space }) => {
    const url = "https://example.com/a";
    const body = `Before${space}${url}${space}after`;
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "text", text: `Before${space}` },
      { kind: "link", text: url, href: url },
      { kind: "text", text: `${space}after` },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it.each([
    { label: "NBSP", space: "\u00a0" },
    { label: "ideographic space", space: "\u3000" },
    { label: "line separator", space: "\u2028" },
  ])("never lets $label prose enter a report or YouTube link", ({ space }) => {
    const report = `${origin}/r/${id}`;
    expect(segmentChatTextLinks(`${report}${space}not part of it`, { reportOrigin: origin })).toEqual([
      { kind: "link", text: report, href: report, reportId: id },
      { kind: "text", text: `${space}not part of it` },
    ]);

    const video = "https://youtu.be/dQw4w9WgXcQ";
    expect(segmentChatTextLinks(`${video}${space}watch this`)).toEqual([
      { kind: "link", text: video, href: video, youtubeId: "dQw4w9WgXcQ" },
      { kind: "text", text: `${space}watch this` },
    ]);
  });

  it("accepts plain http links", () => {
    const body = "old http://example.com/a still works";
    expect(segmentChatTextLinks(body)[1]).toEqual({
      kind: "link", text: "http://example.com/a", href: "http://example.com/a",
    });
  });

  it("classifies canonical report links on both share routes", () => {
    for (const route of ["r", "api/share"]) {
      const url = `${origin}/${route}/${id}`;
      const body = `Shared: ${url} ok`;
      const segments = segmentChatTextLinks(body, { reportOrigin: origin });
      expect(segments).toEqual([
        { kind: "text", text: "Shared: " },
        { kind: "link", text: url, href: url, reportId: id },
        { kind: "text", text: " ok" },
      ]);
      expect(joined(segments)).toBe(body);
    }
  });

  it("keeps an allowed report query but refuses a disallowed one", () => {
    const good = `${origin}/r/${id}?focus=comments&comment=${id}`;
    const mixed = segmentChatTextLinks(`A ${good} B`, { reportOrigin: origin });
    expect(mixed[1]).toEqual({ kind: "link", text: good, href: good, reportId: id });

    const bad = `${origin}/r/${id}?next=evil`;
    const refused = segmentChatTextLinks(`A ${bad} B`, { reportOrigin: origin });
    expect(refused[1]).toEqual({ kind: "link", text: bad, href: bad });
  });

  it("never turns a lookalike Norfold host into a report card", () => {
    for (const url of [
      `https://findbackapp.social.evil.test/r/${id}`,
      `https://evil.test/r/${id}`,
      `http://findbackapp.social/r/${id}`,
    ]) {
      const segments = segmentChatTextLinks(`x ${url} y`, { reportOrigin: origin });
      expect(segments[1]).toEqual({ kind: "link", text: url, href: url });
      expect(joined(segments)).toBe(`x ${url} y`);
    }
  });

  it("classifies supported YouTube links with the shared extractor", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=12",
      "https://youtu.be/dQw4w9WgXcQ?si=share",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      const body = `Watch ${url}!`;
      const segments = segmentChatTextLinks(body);
      expect(segments[1]).toEqual({ kind: "link", text: url, href: url, youtubeId: "dQw4w9WgXcQ" });
      expect(joined(segments)).toBe(body);
    }
  });

  it("keeps forged YouTube hosts and credential URLs out of embed classification", () => {
    for (const url of [
      "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
      "https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      const segments = segmentChatTextLinks(url);
      expect(segments).toEqual([{ kind: "link", text: url, href: url }]);
    }
    const credential = "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ";
    expect(segmentChatTextLinks(credential)).toEqual([{ kind: "text", text: credential }]);
  });

  it("ends a URL at a control character and keeps the control in the text", () => {
    const url = "https://example.com/a";
    for (const control of ["\u0000", "\u001f", "\u007f"]) {
      const body = `${url}${control}b`;
      expect(segmentChatTextLinks(body)).toEqual([
        { kind: "link", text: url, href: url },
        { kind: "text", text: `${control}b` },
      ]);
      expect(joined(segmentChatTextLinks(body))).toBe(body);
    }
  });

  it("refuses malformed and untrusted schemes instead of linking them", () => {
    for (const body of [
      "javascript:alert(1)",
      "ftp://example.com/a",
      "//example.com/a",
      "mailto:a@b.test",
      "https://",
      "https:///",
      "https:example.com",
    ]) {
      expect(segmentChatTextLinks(body)).toEqual([{ kind: "text", text: body }]);
    }
  });

  it("strips prose punctuation outside the URL and keeps wrappers as text", () => {
    const body = 'He wrote (https://en.wikipedia.org/wiki/Rust_(programming_language)) and "https://example.com/b".';
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "text", text: "He wrote (" },
      { kind: "link", text: "https://en.wikipedia.org/wiki/Rust_(programming_language)",
        href: "https://en.wikipedia.org/wiki/Rust_(programming_language)" },
      { kind: "text", text: ') and "' },
      { kind: "link", text: "https://example.com/b", href: "https://example.com/b" },
      { kind: "text", text: '".' },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it("trims trailing prose punctuation without dropping it from the text", () => {
    const body = "Look: https://example.com/a, https://example.com/b; https://example.com/c!";
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "text", text: "Look: " },
      { kind: "link", text: "https://example.com/a", href: "https://example.com/a" },
      { kind: "text", text: ", " },
      { kind: "link", text: "https://example.com/b", href: "https://example.com/b" },
      { kind: "text", text: "; " },
      { kind: "link", text: "https://example.com/c", href: "https://example.com/c" },
      { kind: "text", text: "!" },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it("keeps curly wrappers and ellipsis in the text", () => {
    const body = "She said “https://example.com/ok”…";
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "text", text: "She said “" },
      { kind: "link", text: "https://example.com/ok", href: "https://example.com/ok" },
      { kind: "text", text: "”…" },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it("keeps angle-bracket wrappers as text", () => {
    const body = "Use <https://example.com/a> now";
    expect(segmentChatTextLinks(body)).toEqual([
      { kind: "text", text: "Use <" },
      { kind: "link", text: "https://example.com/a", href: "https://example.com/a" },
      { kind: "text", text: "> now" },
    ]);
  });

  it("keeps repeated URLs as separate link segments and all text", () => {
    const url = `${origin}/r/${id}`;
    const body = `${url} and again ${url}`;
    const segments = segmentChatTextLinks(body, { reportOrigin: origin });
    const links = segments.filter((segment) => segment.kind === "link");
    expect(links).toHaveLength(2);
    expect(links).toEqual([
      { kind: "link", text: url, href: url, reportId: id },
      { kind: "link", text: url, href: url, reportId: id },
    ]);
    expect(joined(segments)).toBe(body);
  });

  it("returns no report id when no share origin is configured", () => {
    vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", "");
    const url = `${origin}/r/${id}`;
    const segments = segmentChatTextLinks(`x ${url} y`);
    expect(segments[1]).toEqual({ kind: "link", text: url, href: url });
    expect(joined(segments)).toBe(`x ${url} y`);
  });

  it("stays exact across long bounded input", () => {
    const tail = "a".repeat(500);
    const body = `${"word ".repeat(20_000)}https://example.com/${tail} tail`;
    const segments = segmentChatTextLinks(body);
    expect(joined(segments)).toBe(body);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toEqual({ kind: "link", text: `https://example.com/${tail}`, href: `https://example.com/${tail}` });
  });

  it("trims a long run of unbalanced closing parentheses without losing text", () => {
    const closers = ")".repeat(2_000);
    const body = `https://example.com/x${closers}`;
    const segments = segmentChatTextLinks(body);
    expect(segments).toEqual([
      { kind: "link", text: "https://example.com/x", href: "https://example.com/x" },
      { kind: "text", text: closers },
    ]);
    expect(joined(segments)).toBe(body);
  });
});
