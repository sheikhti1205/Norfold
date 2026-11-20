import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStandalonePreviewBody } from "./chatPreviewBody";
import { segmentChatTextLinks } from "./chatTextLinks";

const origin = "https://findbackapp.social";
const id = "5b6f7c8d-1234-4abc-8def-123456789012";

beforeEach(() => vi.stubEnv("VITE_PUBLIC_SHARE_ORIGIN", origin));
afterEach(() => vi.unstubAllEnvs());

describe("standalone preview body", () => {
  it("accepts a bare YouTube link", () => {
    expect(isStandalonePreviewBody("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("accepts a bare Norfold report link", () => {
    expect(isStandalonePreviewBody(`${origin}/r/${id}`)).toBe(true);
  });

  it("accepts a bare previewable ordinary https link", () => {
    expect(isStandalonePreviewBody("https://example.com/article")).toBe(true);
  });

  it("accepts two bare links separated by whitespace", () => {
    const body = "https://youtu.be/dQw4w9WgXcQ \n https://example.com/later";
    expect(isStandalonePreviewBody(body)).toBe(true);
  });

  it("rejects prose", () => {
    expect(isStandalonePreviewBody("Watch this later")).toBe(false);
  });

  it("rejects prose with a previewable link", () => {
    const body = "look at this https://youtu.be/dQw4w9WgXcQ";
    expect(isStandalonePreviewBody(body)).toBe(false);
  });

  it("rejects a bare non-previewable link", () => {
    // A safe anchor, but the preview policy requires HTTPS on the default port.
    expect(isStandalonePreviewBody("http://example.com/article")).toBe(false);
  });

  it("rejects whitespace and punctuation only", () => {
    for (const body of ["", "   ", "\n\t", "...", "!!"]) {
      expect(isStandalonePreviewBody(body)).toBe(false);
    }
  });

  it("keeps the exact body without trimming or rewriting it", () => {
    const body = "  https://youtu.be/dQw4w9WgXcQ \n";
    expect(isStandalonePreviewBody(body)).toBe(true);
    expect(segmentChatTextLinks(body).map((segment) => segment.text).join("")).toBe(body);
  });
});
