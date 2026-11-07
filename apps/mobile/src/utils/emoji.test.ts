import { describe, expect, it } from "vitest";
import { convertEmoticons, isEmojiOnly } from "./emoji";

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
