// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmojiPicker, insertEmoji } from "./EmojiPicker";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { ExpressionPicker } from "./ExpressionPicker";
import { ExpressionPickerButton } from "./ExpressionPickerButton";

beforeEach(() => {
  // Keep the GIF/sticker provider disabled so switching tabs never reaches
  // the network; the geometry under test does not depend on provider data.
  vi.stubEnv("VITE_KLIPY_API_KEY", "");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

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
 * The picker has two presentations: the original floating popover and a docked
 * pane that sits in the composer's flow. These tests pin the observable
 * difference so a later refactor cannot quietly turn the pane back into an
 * overlay, or drop the close control the docked mode depends on.
 */
describe("picker presentation", () => {
  const noop = () => undefined;

  function pickerProps() {
    return { onPickEmoji: noop, onPickKlipy: noop, onClose: noop };
  }

  it("keeps the floating layer in popover mode", () => {
    render(<ExpressionPickerButton onPickEmoji={noop} onPickKlipy={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
    const layer = document.querySelector(".fb-picker-layer");
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute("role")).toBe("dialog");
    expect(document.querySelector(".fb-expression-dock")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("renders the docked pane inline, not as an overlay", () => {
    const { container } = render(<ExpressionPicker {...pickerProps()} dock="ime" />);
    const picker = screen.getByTestId("expression-picker");
    expect(picker.classList.contains("fb-expression-dock")).toBe(true);
    expect(picker.classList.contains("fb-expression-picker")).toBe(true);
    expect(picker.closest(".fb-picker-layer")).toBeNull();
    expect(picker.parentElement).not.toBe(document.body);
    expect(container.contains(picker)).toBe(true);
    expect(picker.querySelector(".fb-expression-drag")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("exposes the tab list, the active tabpanel and the close control", () => {
    const onDismiss = vi.fn();
    render(<ExpressionPicker {...pickerProps()} onDismiss={onDismiss} dock="ime" />);
    expect(screen.getByRole("tablist", { name: "Emoji, GIFs and stickers" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Emoji", "GIFs", "Stickers"]);
    expect(screen.getByRole("tabpanel", { name: "Emoji" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("switches the panel to the selected tab", () => {
    render(<ExpressionPicker {...pickerProps()} dock="ime" />);
    fireEvent.click(screen.getByRole("tab", { name: "GIFs" }));
    expect(screen.getByRole("tab", { name: "GIFs" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Emoji" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel", { name: "GIFs" })).toBeTruthy();
  });

  it("keeps the composer field mounted while the docked pane opens and closes", () => {
    render(
      <div>
        <input aria-label="Comment" />
        <ExpressionPickerButton dock="ime" onPickEmoji={noop} onPickKlipy={noop} />
      </div>,
    );
    const field = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.click(screen.getByRole("button", { name: "Emoji, GIFs and stickers" }));
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Comment" })).toBe(field);
    fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Comment" })).toBe(field);
  });
});

describe("docked emoji-only header", () => {
  const noop = () => undefined;

  it("labels the pane without a one-item tablist and closes back to the trigger", () => {
    render(
      <div>
        <input aria-label="Comment" />
        <EmojiPickerButton dock="ime" onPick={noop} />
      </div>,
    );
    const field = screen.getByRole("textbox", { name: "Comment" });
    const trigger = screen.getByRole("button", { name: "Emoji" });
    fireEvent.click(trigger);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "Emoji" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Comment" })).toBe(field);

    fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Comment" })).toBe(field);
    expect(document.activeElement).toBe(trigger);
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

  it("docks the pane in normal flow with a fallback height", () => {
    const dock = rule(".fb-expression-dock");
    expect(dock).toContain("position: relative;");
    expect(dock).toContain("width: 100%;");
    expect(dock).toContain("height: 100%;");
    expect(dock).toContain("min-height: 260px;");
    expect(dock).not.toContain("position: absolute");
    expect(dock).not.toContain("position: fixed");
  });

  it("draws a 40 x 4 grab handle with 8px vertical padding", () => {
    expect(rule(".fb-expression-drag")).toContain("padding: 8px 0;");
    expect(rule(".fb-expression-drag-bar")).toContain("width: 40px;");
    expect(rule(".fb-expression-drag-bar")).toContain("height: 4px;");
  });

  it("scrolls the grid under fixed chrome inside a docked pane", () => {
    expect(rule(".fb-expression-dock .fb-expression-tabpanel")).toContain("overflow: hidden;");
    expect(rule(".fb-expression-dock .fb-emoji-scroll")).toContain("min-height: 0;");
    expect(rule(".fb-expression-dock .fb-emoji-scroll")).toContain("overflow-y: auto;");
    expect(rule(".fb-expression-dock .fb-klipy-body")).toContain("min-height: 0;");
    expect(rule(".fb-expression-dock .fb-klipy-body")).toContain("overflow-y: auto;");
  });
});
