// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import type { Editor } from "@tiptap/react";
import { RichTextEditor } from "./RichTextEditor";
import { pickRailMore } from "../test-utils/editorRail";
import {
  closeSoftKeyboard,
  focusDescriptionEditor,
  openSoftKeyboard,
  restoreSoftKeyboard,
} from "../test-utils/softKeyboard";

afterEach(() => {
  cleanup();
  restoreSoftKeyboard();
});

/** Install the viewport geometry a browser reports for the current window. */
function installViewport(height: number, options: { scale?: number; offsetTop?: number } = {}): void {
  const viewport = new EventTarget() as VisualViewport;
  Object.defineProperties(viewport, {
    height: { configurable: true, writable: true, value: height },
    offsetTop: { configurable: true, writable: true, value: options.offsetTop ?? 0 },
    scale: { configurable: true, writable: true, value: options.scale ?? 1 },
  });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
}

function toolbar(): HTMLElement | null {
  return screen.queryByRole("toolbar", { name: "Description formatting" });
}

function railShell(): HTMLElement | null {
  return document.querySelector('[data-testid="rich-text-rail"]');
}

function slashHint(): HTMLElement | null {
  return screen.queryByTestId("rich-text-slash-hint");
}

/** The slash menu caps an empty query at eight rows, so name the action. */
function expandFromSlash(ref: { current: Editor | null }): void {
  const editor = ref.current;
  if (!editor) throw new Error("editor is not mounted");
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.commands.insertContent("/expand");
  });
  const menu = screen.getByRole("listbox", { name: "Formatting commands" });
  fireEvent.click(within(menu).getByRole("option", { name: "Expand editor" }));
}

describe("RichTextEditor rail — only above a proved soft keyboard", () => {
  it("shows no rail on a desktop web surface without a soft keyboard, and keeps slash working", () => {
    const ref = createRef<Editor | null>();
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    focusDescriptionEditor();

    expect(toolbar()).toBeNull();
    const hint = slashHint()!;
    expect(hint.textContent).toMatch(/Type\s*\/\s*for formatting/);
    expect(screen.getByRole("textbox", { name: "Description" }).getAttribute("aria-describedby")).toContain(hint.id);

    act(() => ref.current?.commands.insertContent("/"));
    expect(screen.getByRole("listbox", { name: "Formatting commands" })).toBeTruthy();
    // The slash menu is a transient command list, never a replacement rail.
    expect(toolbar()).toBeNull();
  });

  it("docks the one rail flush to the IME top using the covered inset once", () => {
    installViewport(window.innerHeight - 300);
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();

    const rail = toolbar();
    const shell = railShell();
    expect(rail).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(shell?.getAttribute("data-docked")).toBe("true");
    expect(shell?.className).toContain("fixed");
    expect(shell?.style.bottom).toBe("300px");
    // Double subtraction would have produced innerHeight or the visible height.
    expect(shell?.style.bottom).not.toBe(`${window.innerHeight}px`);
    expect(shell?.style.bottom).not.toBe(`${window.innerHeight - 300}px`);
    // The keyboard already occupies the bottom edge; a second safe-area inset
    // would lift the rail off it.
    expect(shell?.style.paddingBottom).toBe("");
    // The fixed rail's old flow height is reserved so the form does not jump.
    expect(screen.getByTestId("rich-text-rail-dock").style.height).toBe("49px");
    expect(slashHint()).toBeNull();
  });

  it("keeps the rail hidden when the viewport difference is browser chrome, not a keyboard", () => {
    installViewport(window.innerHeight - 80);
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();
    expect(toolbar()).toBeNull();
    expect(slashHint()).toBeTruthy();
  });

  it("keeps the rail hidden for a hardware keyboard/no IME because the visible height does not shrink", () => {
    installViewport(window.innerHeight);
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();
    expect(toolbar()).toBeNull();
    expect(slashHint()).toBeTruthy();
  });

  it("does not mistake pinch zoom for a soft keyboard", () => {
    installViewport(window.innerHeight - 300, { scale: 2 });
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();
    expect(toolbar()).toBeNull();
  });

  it("detects a resizing-content keyboard from the layout shrink on a coarse pointer", () => {
    const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 400 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      focusDescriptionEditor();
      expect(toolbar()).toBeNull();
      expect(slashHint()).toBeTruthy();

      // interactive-widget=resizes-content shrinks the layout viewport only.
      Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 520 });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(toolbar()).toBeTruthy();
      expect(railShell()?.style.bottom).toBe("0px");
      expect(slashHint()).toBeNull();

      Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(toolbar()).toBeNull();
      expect(slashHint()).toBeTruthy();
    } finally {
      if (originalHeight) Object.defineProperty(window, "innerHeight", originalHeight);
      else delete (window as { innerHeight?: number }).innerHeight;
      if (originalWidth) Object.defineProperty(window, "innerWidth", originalWidth);
      else delete (window as { innerWidth?: number }).innerWidth;
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });

  it("does not treat a desktop window shrink as a keyboard", () => {
    const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      focusDescriptionEditor();
      Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 520 });
      act(() => window.dispatchEvent(new Event("resize")));
      expect(toolbar()).toBeNull();
      expect(slashHint()).toBeTruthy();
    } finally {
      if (originalHeight) Object.defineProperty(window, "innerHeight", originalHeight);
      else delete (window as { innerHeight?: number }).innerHeight;
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });

  it("does not lay the rail over another field's keyboard", () => {
    installViewport(window.innerHeight - 300);
    render(
      <div>
        <RichTextEditor label="Description" value="hello" onChange={() => {}} />
        <input aria-label="Title" />
      </div>,
    );
    const description = screen.getByRole("textbox", { name: "Description" });
    act(() => description.focus());
    expect(toolbar()).toBeTruthy();

    act(() => screen.getByRole("textbox", { name: "Title" }).focus());
    expect(toolbar()).toBeNull();
    // The keyboard is open, so this is not the no-keyboard fallback surface.
    expect(slashHint()).toBeNull();
  });

  it("removes the dock when the keyboard closes under an open menu, keeping the menu anchored", () => {
    openSoftKeyboard();
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();
    // Opening the Block menu moves focus into the menu, which is what makes
    // Android dismiss the IME.
    fireEvent.click(screen.getByRole("button", { name: /Block type/i }));
    const menu = screen.getByRole("menu", { name: "Block type" });
    expect(toolbar()).toBeTruthy();

    closeSoftKeyboard();
    act(() => window.dispatchEvent(new Event("resize")));
    // No visible rail without an IME — the file's one hard rule.
    expect(toolbar()).toBeNull();
    expect(railShell()).toBeNull();
    expect(screen.queryByTestId("rich-text-rail-dock")).toBeNull();
    // The menu is portalled and independently mounted, so it survives the rail
    // unmounting under it and re-anchors to the editor box.
    expect(screen.getByRole("menu", { name: "Block type" })).toBe(menu);
    // The field's own menu already lists the actions; the hint stays out.
    expect(slashHint()).toBeNull();
  });

  it("shows exactly one rail in the expanded editor only while the keyboard is open", () => {
    const ref = createRef<Editor | null>();
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} editorRef={ref} />);
    focusDescriptionEditor();
    closeSoftKeyboard();
    act(() => window.dispatchEvent(new Event("resize")));

    expandFromSlash(ref);
    const first = document.getElementById("report-editor-overlay");
    expect(first).toBeTruthy();
    expect(within(first!).queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
    const fallback = within(first!).getByTestId("rich-text-slash-hint");
    expect(fallback.textContent).toMatch(/Type\s*\/\s*for formatting/);
    expect(screen.getAllByTestId("rich-text-slash-hint")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(document.getElementById("report-editor-overlay")).toBeNull();

    openSoftKeyboard();
    act(() => window.dispatchEvent(new Event("resize")));
    expect(toolbar()).toBeTruthy();

    pickRailMore("Expand editor");
    const expanded = document.getElementById("report-editor-overlay")!;
    expect(within(expanded).getAllByRole("toolbar", { name: "Description formatting" })).toHaveLength(1);
    expect(screen.getAllByRole("toolbar", { name: "Description formatting" })).toHaveLength(1);
    expect(slashHint()).toBeNull();

    const shell = railShell() as HTMLElement;
    // The overlay itself already ends at the IME top; the rail is flush.
    expect(shell.style.paddingBottom).toBe("0px");
    expect(shell.getAttribute("data-docked")).toBeNull();
  });

  it("keeps every 48px slot and pins More outside the horizontal overflow at narrow widths", () => {
    openSoftKeyboard();
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();

    const rail = toolbar()!;
    const scroller = rail.querySelector('[data-testid="rich-text-rail-scroll"]') as HTMLElement;
    const more = within(rail).getByRole("button", { name: "More" });
    expect(rail.className).not.toContain("overflow-x-auto");
    expect(rail.className).toContain("flex-nowrap");
    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(scroller.getAttribute("role")).toBe("group");
    expect(scroller.getAttribute("aria-label")).toBe("Description formatting actions");
    expect(scroller.contains(more)).toBe(false);
    expect(more.parentElement).toBe(rail);
    expect(scroller.querySelectorAll("button")).toHaveLength(6);
    for (const button of Array.from(rail.querySelectorAll("button"))) {
      expect(button.className).toMatch(/min-h-\[48px\]/);
      expect(button.className).toMatch(/min-w-\[48px\]/);
    }
  });

  it("keeps the caret and selection when a rail slot is pressed", () => {
    openSoftKeyboard();
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    focusDescriptionEditor();
    const textbox = screen.getByRole("textbox", { name: "Description" });
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(fireEvent.mouseDown(bold)).toBe(false);
    expect(fireEvent.pointerDown(bold)).toBe(false);
    expect(document.activeElement).toBe(textbox);
  });
});
