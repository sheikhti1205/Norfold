import { describe, expect, it } from "vitest";
import { convertEmoticons, convertEmoticonsLive, isEmojiOnly } from "./emoji";

describe("convertEmoticonsLive", () => {
  it("converts as soon as a complete emoticon is typed and keeps the caret after it", () => {
    expect(convertEmoticonsLive(":)", 2)).toEqual({ text: "🙂", caret: 2 });
    expect(convertEmoticonsLive("hi :)", 5)).toEqual({ text: "hi 🙂", caret: 5 });
    expect(convertEmoticonsLive("hi :) ", 6)).toEqual({ text: "hi 🙂 ", caret: 6 });
  });

  it("maps the caret across a shorter replacement", () => {
    const { text, caret } = convertEmoticonsLive(":-) ok", 3);
    expect(text).toBe("🙂 ok");
    expect(text.slice(0, caret)).toBe("🙂");
  });

  it("defers a token that could still grow into a word", () => {
    expect(convertEmoticonsLive(":p", 2)).toEqual({ text: ":p", caret: 2 });
    expect(convertEmoticonsLive(":D", 2)).toEqual({ text: ":D", caret: 2 });
    expect(convertEmoticonsLive(":p ", 3)).toEqual({ text: "😛 ", caret: 3 });
  });

  it("never rewrites the token the caret is inside", () => {
    expect(convertEmoticonsLive("hi :-)", 4)).toEqual({ text: "hi :-)", caret: 4 });
  });

  it("keeps URLs, emails, paths and code untouched mid-typing", () => {
    const url = "see https://example.test/a:)";
    expect(convertEmoticonsLive(url, url.length).text).toBe(url);
    const code = "`:)`";
    expect(convertEmoticonsLive(code, code.length).text).toBe(code);
  });
});

describe("convertEmoticons", () => {
  it("converts the unambiguous emoticons people actually type", () => {
    expect(convertEmoticons(":)")).toBe("🙂");
    expect(convertEmoticons(":D")).toBe("😃");
    expect(convertEmoticons(";) ok")).toBe("😉 ok");
    expect(convertEmoticons(":( ")).toBe("🙁 ");
    expect(convertEmoticons(":P")).toBe("😛");
    expect(convertEmoticons("<3")).toBe("❤️");
  });

  it("keeps punctuation around the replaced token and converts unspaced use", () => {
    expect(convertEmoticons("hi :)!")).toBe("hi 🙂!");
    expect(convertEmoticons("hi:)")).toBe("hi🙂");
    expect(convertEmoticons("(:")).toBe("(:");
  });

  it("never rewrites URLs, emails, paths or code", () => {
    const text = "see https://example.test/a:) and me@example.test and /tmp/a:) and `:)`";
    expect(convertEmoticons(text)).toBe(text);
  });

  it("leaves normal prose alone", () => {
    expect(convertEmoticons("Meeting at 7:30 pm")).toBe("Meeting at 7:30 pm");
    expect(convertEmoticons("ratio 3:1")).toBe("ratio 3:1");
  });
});

describe("isEmojiOnly", () => {
  it("accepts single and composed emoji", () => {
    expect(isEmojiOnly("🙂")).toBe(true);
    expect(isEmojiOnly("👨‍👩‍👧")).toBe(true);
    expect(isEmojiOnly("👍🏽")).toBe(true);
    expect(isEmojiOnly("🇬🇧")).toBe(true);
    expect(isEmojiOnly("1️⃣")).toBe(true);
    expect(isEmojiOnly("😀 😀")).toBe(true);
  });

  it("rejects text, digits and mixed content", () => {
    expect(isEmojiOnly("123")).toBe(false);
    expect(isEmojiOnly("hello 🙂")).toBe(false);
    expect(isEmojiOnly("7:30")).toBe(false);
    expect(isEmojiOnly("   ")).toBe(false);
  });
});
