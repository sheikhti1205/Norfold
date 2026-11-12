// @vitest-environment jsdom
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
