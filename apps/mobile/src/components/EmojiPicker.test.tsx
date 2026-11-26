// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmojiPicker, insertEmoji } from "./EmojiPicker";

afterEach(cleanup);

describe("insertEmoji", () => {
  it("replaces the selection and returns the caret after the glyph", () => {
    expect(insertEmoji("hello world", 6, 11, "🌍")).toEqual({ text: "hello 🌍", caret: 8 });
  });

  it("appends at the end when there is no selection", () => {
    expect(insertEmoji("hi", 2, 2, "🎉")).toEqual({ text: "hi🎉", caret: 4 });
  });

  it("clamps out-of-range offsets instead of throwing", () => {
    expect(insertEmoji("hi", 99, 120, "!")).toEqual({ text: "hi!", caret: 3 });
  });
});

describe("EmojiPicker", () => {
  it("filters by name and reports the pick", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search emoji" }), { target: { value: "pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "pizza" }));
    expect(onPick).toHaveBeenCalledWith("🍕");
  });

  it("names each group so the palette is navigable by landmark", () => {
    render(<EmojiPicker onPick={() => undefined} />);
    expect(screen.getByRole("region", { name: "Smileys" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Symbols" })).toBeTruthy();
  });

  it("says so when nothing matches instead of showing an empty grid", () => {
    render(<EmojiPicker onPick={() => undefined} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search emoji" }), { target: { value: "zzzz" } });
    expect(screen.getByRole("status").textContent).toContain("No emoji match");
  });
});

/**
 * jsdom has no layout, so these read the declarations that own the palette's
 * hit boxes. The emoji cell and every picker control must be a real 48px box;
 * rendered confirmation at 320dp and a large text scale stays a deployed
 * browser check.
 */
describe("picker hit boxes", () => {
  const css = readFileSync("src/components/EmojiPicker.css", "utf8");

  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!match) throw new Error(`missing ${selector}`);
    return match[1]!;
  }

  it("makes emoji cells and the palette input 48px", () => {
    expect(rule(".fb-emoji-grid")).toContain("minmax(48px, 1fr)");
    expect(rule(".fb-emoji-cell")).toContain("min-height: 48px;");
    expect(rule(".fb-emoji-search")).toContain("min-height: 48px;");
  });

  it("keeps every Klipy control at the 48px minimum", () => {
    expect(rule(".fb-klipy-search")).toContain("min-height: 48px;");
    expect(rule(".fb-klipy-clear")).toContain("width: 48px; height: 48px;");
    expect(rule(".fb-klipy-tab")).toContain("min-height: 48px;");
    expect(rule(".fb-klipy-retry")).toContain("min-height: 48px;");
  });

  it("raises the shared expression and attachment rows to 48px", () => {
    expect(rule(".fb-expression-tab")).toContain("min-height: 48px;");
    expect(rule(".fb-expression-close")).toContain("width: 48px; height: 48px;");
    expect(rule(".fb-expression-recent")).toContain("width: 48px; height: 48px;");
    expect(rule(".fb-peer-attach-menu button")).toContain("min-height: 48px;");
  });
});
