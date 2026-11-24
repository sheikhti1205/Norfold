import { describe, expect, it } from "vitest";
import {
  isBlobMediaUrl,
  isHttpsMediaUrl,
  isSafeMediaScheme,
  safeMediaSrc,
} from "./mediaUrl";

describe("safeMediaSrc", () => {
  it("keeps the two schemes a staged preview can use", () => {
    // A locally staged file and a provider preview are the real inputs.
    expect(safeMediaSrc("blob:local-preview")).toBe("blob:local-preview");
    expect(safeMediaSrc("https://media.klipy.com/x.gif")).toBe("https://media.klipy.com/x.gif");
  });

  it("omits the attribute for every other scheme and for unparseable input", () => {
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "//evil.test/x",
      "not a url",
      "",
    ]) {
      expect(safeMediaSrc(unsafe)).toBe("");
    }
  });
});

describe("media URL predicates", () => {
  it("answers the same allowlist the src check applies", () => {
    expect(isSafeMediaScheme("blob:")).toBe(true);
    expect(isSafeMediaScheme("https:")).toBe(true);
    for (const scheme of ["http:", "data:", "file:", "javascript:", ""]) {
      expect(isSafeMediaScheme(scheme)).toBe(false);
    }
    expect(isHttpsMediaUrl("https://cdn.test/a.jpg")).toBe(true);
    expect(isHttpsMediaUrl("http://cdn.test/a.jpg")).toBe(false);
    expect(isBlobMediaUrl("blob:local-preview")).toBe(true);
    expect(isBlobMediaUrl("https://cdn.test/a.jpg")).toBe(false);
  });
});
