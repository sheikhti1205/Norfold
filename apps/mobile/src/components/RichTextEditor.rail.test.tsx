// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { createRef } from "react";
import type { Editor } from "@tiptap/react";
import { RichTextEditor, tiptapToMarkdown } from "./RichTextEditor";
import { settleSelectionRender } from "../test-utils/editorSelection";
import { openRailMore, pickRailMore } from "../test-utils/editorRail";
import { polyfillRangeGeometry, restoreRangeGeometry } from "../test-utils/jsdomRangeGeometry";
import { openSoftKeyboard, renderFocused, restoreSoftKeyboard } from "../test-utils/softKeyboard";

beforeEach(openSoftKeyboard);
beforeEach(polyfillRangeGeometry);
afterEach(restoreRangeGeometry);
afterEach(restoreSoftKeyboard);
afterEach(cleanup);

describe("Report editor caret formatting", () => {
  it("toggles Bold at an empty caret on and off without formatting subsequent plain typing", async () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="intro" onChange={() => {}} editorRef={ref} />);
    act(() => {
      ref.current?.commands.setContent({ type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "intro" }] },
        { type: "paragraph" },
      ] });
      ref.current?.commands.setTextSelection(ref.current.state.doc.content.size - 1);
    });
    const bold = screen.getByRole("button", { name: "Bold" });
    fireEvent.click(bold);
    expect(ref.current?.state.storedMarks?.some((mark) => mark.type.name === "bold")).toBe(true);
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    act(() => ref.current?.commands.insertContent("bold"));
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("intro\n\n**bold**");
    fireEvent.click(bold);
    expect(ref.current?.state.storedMarks?.some((mark) => mark.type.name === "bold")).toBe(false);
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    await settleSelectionRender();
    act(() => ref.current?.commands.insertContent(" plain"));
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("intro\n\n**bold** plain");
  });

  it("toggles selected text twice without losing the selected range", async () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="hello world" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.setTextSelection({ from: 1, to: 6 }));
    await settleSelectionRender();
    const bold = screen.getByRole("button", { name: "Bold" });
    fireEvent.click(bold);
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("**hello** world");
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(bold);
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("hello world");
    expect(bold.getAttribute("aria-pressed")).toBe("false");
  });

  it("updates Bold when moving the caret between bold and plain text", async () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="**bold** plain" onChange={() => {}} editorRef={ref} />);
    const bold = screen.getByRole("button", { name: "Bold" });
    act(() => ref.current?.commands.setTextSelection(3));
    await settleSelectionRender();
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    act(() => ref.current?.commands.setTextSelection(9));
    await settleSelectionRender();
    expect(bold.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Report editor formatting rail", () => {
  it("keeps the composing slots in both modes and the rest one tap away", () => {
    renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    for (const mode of ["inline", "fullscreen"]) {
      if (mode === "fullscreen") pickRailMore("Expand editor");
      const rail = screen.getByRole("toolbar", { name: "Description formatting" });
      expect(rail.className).not.toContain("overflow-x-auto");
      expect(rail.className).toContain("flex-nowrap");
      expect(rail.querySelectorAll("button")).toHaveLength(7);
      for (const name of ["Undo", "Bold", "Italic", "Bullets", "Link", "More"]) {
        expect(within(rail).getByRole("button", { name })).toBeTruthy();
      }
      expect(within(rail).getByRole("button", { name: /Block type/ })).toBeTruthy();
      const more = openRailMore();
      for (const name of ["Numbered list", "Quote", "Paste as Markdown", "Clear formatting"]) {
        expect(within(more).getByRole("option", { name })).toBeTruthy();
      }
    }
  });

  it("keeps one independently scrolling content area above the pinned rail inside the visual viewport", () => {
    renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay")!;
    const scroller = screen.getByTestId("report-editor-scroller");
    const rail = within(overlay).getByRole("toolbar", { name: "Description formatting" });
    expect(overlay.style.height).toContain("--fb-visible-height");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.contains(rail)).toBe(false);
    expect(scroller.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rail.parentElement?.className).toContain("flex-shrink-0");
    // The overlay itself ends at the IME top, so the rail is flush with no
    // second safe area and no gap.
    expect(rail.parentElement?.getAttribute("style")).toContain("padding-bottom: 0px");
    expect(rail.parentElement?.getAttribute("style")).not.toContain("safe-area-inset-bottom");
    expect(scroller.querySelector(".tiptap")?.className).not.toContain("overflow-y-auto");
  });

  it("inserts clipboard Markdown at the captured selection even when the async read moves the caret", async () => {
    const ref = createRef<Editor | null>();
    let resolveClipboard!: (value: string) => void;
    const readText = vi.fn(() => new Promise<string>((resolve) => { resolveClipboard = resolve; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    try {
      renderFocused(<RichTextEditor label="Description" value="before after" onChange={() => {}} editorRef={ref} />);
      act(() => ref.current?.commands.setTextSelection({ from: 8, to: 13 }));
      await settleSelectionRender();
      pickRailMore("Paste as Markdown");
      act(() => ref.current?.commands.setTextSelection(1));
      await act(async () => resolveClipboard("**replacement**"));
      expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("before \n\n**replacement**");
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }
  });

  it("discards clipboard input begun before a lock even when it settles after unlocking", async () => {
    const ref = createRef<Editor | null>();
    const onChange = vi.fn();
    let resolveClipboard!: (value: string) => void;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: () => new Promise<string>((resolve) => { resolveClipboard = resolve; }) } });
    try {
      const { rerender } = renderFocused(<RichTextEditor label="Description" value="before after" onChange={onChange} editorRef={ref} />);
      pickRailMore("Paste as Markdown");
      rerender(<RichTextEditor label="Description" value="before after" onChange={onChange} editorRef={ref} disabled />);
      rerender(<RichTextEditor label="Description" value="before after" onChange={onChange} editorRef={ref} />);
      await act(async () => resolveClipboard("**late clipboard**"));
      expect(ref.current?.getText()).toBe("before after");
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }
  });
});
