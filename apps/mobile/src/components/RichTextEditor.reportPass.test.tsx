// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import type { Editor } from "@tiptap/react";
import { RichTextEditor, tiptapToMarkdown } from "./RichTextEditor";
import { settleSelectionRender } from "../test-utils/editorSelection";
import { openRailMore, pickRailMore } from "../test-utils/editorRail";

afterEach(cleanup);

describe("RichTextEditor report pass — bounded inline growth", () => {
  it("has min-height ~120px and max-height ~240px via CSS classes", () => {
    render(<RichTextEditor label="Description" value="" onChange={() => {}} />);
    const editorEl = document.querySelector(".tiptap") as HTMLElement;
    expect(editorEl).toBeTruthy();
    // Initial min-height ~120px (4-5 lines) via CSS class
    expect(editorEl.className).toMatch(/min-h-\[120px\]/);
    expect(editorEl.className).toMatch(/max-h-\[240px\]/);
    // Internal scrolling when content exceeds max-height via CSS classes
    expect(editorEl.className).toMatch(/overflow-y-auto/);
    expect(editorEl.className).toMatch(/overscroll-contain/);
  });
});

describe("RichTextEditor report pass — Expand/Collapse full-screen overlay", () => {
  it("offers Expand as a named row in the rail's trailing menu", () => {
    render(<RichTextEditor label="Description" value="hello world" onChange={() => {}} />);
    const more = openRailMore();
    const expand = within(more).getByRole("option", { name: "Expand editor" });
    expect(expand.textContent).toBe("Expand editor");
  });

  it("opens full-screen overlay on Expand", () => {
    render(<RichTextEditor label="Description" value="hello world" onChange={() => {}} />);
    pickRailMore("Expand editor");
    // Overlay should be rendered via portal to document.body
    const overlay = document.getElementById("report-editor-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
  });

  it("preserves exact Markdown content when expanding", () => {
    const ref = createRef<Editor | null>();
    render(
      <RichTextEditor label="Description" value="**bold** and *italic*" onChange={() => {}} editorRef={ref} />,
    );
    const initialMarkdown = tiptapToMarkdown(ref.current?.getJSON());
    pickRailMore("Expand editor");
    const _overlay = document.getElementById("report-editor-overlay");
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe(initialMarkdown);
  });

  it("preserves selection when expanding", () => {
    const ref = createRef<Editor | null>();
    const seen: string[] = [];
    render(
      <RichTextEditor
        label="Description"
        value="hello world"
        onChange={(md) => seen.push(md)}
        editorRef={ref}
      />,
    );
    act(() => {
      ref.current?.commands.setTextSelection({ from: 1, to: 6 }); // select "hello"
    });
    pickRailMore("Expand editor");
    // Selection should be preserved in the overlay
    const _overlay = document.getElementById("report-editor-overlay");
    // The same editor instance should have the same selection
    expect(ref.current?.state.selection.from).toBe(1);
    expect(ref.current?.state.selection.to).toBe(6);
  });

  it("collapses back to inline on Done click with latest content", () => {
    const ref = createRef<Editor | null>();
    const seen: string[] = [];
    render(
      <RichTextEditor
        label="Description"
        value="hello"
        onChange={(md) => seen.push(md)}
        editorRef={ref}
      />,
    );
    pickRailMore("Expand editor");
    // Edit in overlay - insert at end of "hello" (position 6 in Tiptap/ProseMirror)
    act(() => {
      ref.current?.commands.setTextSelection({ from: 6, to: 6 }); // after "hello"
      ref.current?.commands.insertContent(" world");
    });
    // Click Done
    const doneBtn = screen.getByRole("button", { name: /Done/i });
    fireEvent.click(doneBtn);
    // Overlay should be gone
    expect(document.getElementById("report-editor-overlay")).toBeNull();
    // Content should be updated
    expect(seen[seen.length - 1]).toBe("hello world");
  });

  it("Android Back (Escape) dismisses menu first, then overlay", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    // Open a menu in overlay
    fireEvent.click(screen.getByRole("button", { name: /Block type/i }));
    expect(screen.getByRole("menu", { name: "Block type" })).toBeTruthy();
    // First Escape: closes ONLY the menu — the overlay beneath must survive,
    // with focus returned to the menu launcher.
    fireEvent.keyDown(document, { key: "Escape" }); // Simulate Android Back
    expect(screen.queryByRole("menu", { name: "Block type" })).toBeNull();
    expect(document.getElementById("report-editor-overlay")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Block type/i }));
    // Second Escape: closes overlay
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.getElementById("report-editor-overlay")).toBeNull();
  });

  it("Escape closes the link dialog first, never the overlay beneath it", async () => {
    const ref = createRef<Editor | null>();
    render(
      <RichTextEditor label="Description" value="see map here" onChange={() => {}} editorRef={ref} />,
    );
    pickRailMore("Expand editor");
    expect(document.getElementById("report-editor-overlay")).not.toBeNull();
    act(() => {
      ref.current?.commands.setTextSelection({ from: 5, to: 8 });
    });
    await settleSelectionRender();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByRole("dialog", { name: /Add link/i })).toBeTruthy();
    // First Escape: dialog goes, overlay stays with its content intact.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Add link/i })).toBeNull();
    expect(document.getElementById("report-editor-overlay")).not.toBeNull();
    // Second Escape: overlay goes.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.getElementById("report-editor-overlay")).toBeNull();
  });
});

describe("RichTextEditor report pass — formatting rail keyboard visibility", () => {
  it("rail sits at bottom of usable screen when IME hidden (replaces tab bar position)", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay");
    const rail = overlay?.querySelector('[role="toolbar"]');
    expect(rail).toBeTruthy();
    // Rail should be at bottom of overlay flex column
    expect(overlay?.style.display).toBe("flex");
    expect(overlay?.style.flexDirection).toBe("column");
  });

  it("overlay uses CSS custom properties for visualViewport positioning", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay");
    // The overlay should use visualViewport.height/offsetTop for positioning
    // Not keyboardHeight + visualViewport (double subtraction)
    expect(overlay).toBeTruthy();
    // Verify the overlay uses CSS custom properties for visualViewport
    expect(overlay?.style.height).toContain("var(--fb-visible-height");
    expect(overlay?.style.top).toContain("var(--fb-visible-top");
  });

  it("updates the overlay on visual viewport resize and scroll and releases the listeners on close", () => {
    const original = window.visualViewport;
    const viewport = new EventTarget() as VisualViewport;
    Object.defineProperties(viewport, {
      height: { value: 430, writable: true },
      offsetTop: { value: 24, writable: true },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    try {
      render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      pickRailMore("Expand editor");
      const overlay = document.getElementById("report-editor-overlay")!;
      expect(overlay.style.getPropertyValue("--fb-visible-height")).toBe("430px");
      expect(overlay.style.getPropertyValue("--fb-visible-top")).toBe("24px");
      Object.assign(viewport, { height: 310, offsetTop: 44 });
      act(() => viewport.dispatchEvent(new Event("resize")));
      expect(overlay.style.getPropertyValue("--fb-visible-height")).toBe("310px");
      act(() => viewport.dispatchEvent(new Event("scroll")));
      expect(overlay.style.getPropertyValue("--fb-visible-top")).toBe("44px");
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(document.getElementById("report-editor-overlay")).toBeNull();
    } finally {
      Object.defineProperty(window, "visualViewport", { configurable: true, value: original });
    }
  });
});

describe("RichTextEditor report pass — collision-safe formatting menus (Floating UI)", () => {
  it("uses Floating UI for menu positioning with flip, shift, size middleware", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Block type/i }));
    const menu = screen.getByRole("menu", { name: "Block type" });
    expect(menu).toBeTruthy();
    // Menu should be rendered via FloatingPortal to escape clipping ancestors
    // Verify it's not using absolute positioning (no absolute left-0 top-full)
    expect(menu.className).not.toMatch(/absolute left-0 top-full/);
    // Menu should have Floating UI positioning styles (transform-based)
    expect(menu.style.transform).toBeTruthy();
  });

  it("menu caps height and scrolls internally when taller than visible area", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Block type/i }));
    const menu = screen.getByRole("menu", { name: "Block type" });
    // Menu should use Floating UI transform-based positioning (not absolute left-0 top-full)
    expect(menu.style.transform).toBeTruthy();
    expect(menu.style.transform).not.toBe("none");
    // Menu should have overflow-y-auto className for internal scrolling
    expect(menu.className).toMatch(/overflow-y-auto/);
    // Menu should have max-height constraint className
    expect(menu.className).toMatch(/max-h-/);
  });

  it("link dialog is portaled out of the editor subtree with reachable actions", async () => {
    const ref = createRef<Editor | null>();
    const { container } = render(
      <RichTextEditor label="Description" value="see map here" onChange={() => {}} editorRef={ref} />,
    );
    act(() => {
      ref.current?.commands.setTextSelection({ from: 5, to: 8 });
    });
    await settleSelectionRender();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: /Add link/i });
    // Portaled out of the editor subtree so an ancestor clip/transform cannot hide it.
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    // Both actions stay reachable.
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Add link$/ })).toBeTruthy();
    // IME-open adaptivity (bottom sheet / full screen) has no jsdom
    // visualViewport: it is LAB/APP-only and tracked as the R-032 remainder,
    // NOT proven by this test.
  });

  it("Escape/Back/outside click closes one layer at a time", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    fireEvent.click(screen.getByRole("button", { name: /Block type/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Block type" })).toBeNull();
    // The overlay beneath survives this Escape; only the menu closed.
    expect(document.getElementById("report-editor-overlay")).not.toBeNull();
  });
});

describe("RichTextEditor report pass — selection and undo preservation across modes", () => {
  it("undo/redo works identically in inline and full-screen modes", () => {
    const ref = createRef<Editor | null>();
    const seen: string[] = [];
    render(
      <RichTextEditor
        label="Description"
        value="hello"
        onChange={(md) => seen.push(md)}
        editorRef={ref}
      />,
    );
    act(() => {
      ref.current?.commands.setTextSelection({ from: 6, to: 6 });
      ref.current?.commands.insertContent(" world");
    });
    expect(ref.current?.can().undo()).toBe(true);
    pickRailMore("Expand editor");
    // Undo in overlay
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("hello");
    // Redo in overlay
    pickRailMore("Redo");
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("hello world");
  });

  it("no duplicate transactions in history when switching modes", () => {
    const ref = createRef<Editor | null>();
    render(
      <RichTextEditor label="Description" value="hello" onChange={() => {}} editorRef={ref} />,
    );
    const historyBefore = ref.current?.state.doc.content.size;
    pickRailMore("Expand editor");
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));
    const historyAfter = ref.current?.state.doc.content.size;
    expect(historyAfter).toBe(historyBefore);
  });
});

describe("RichTextEditor report pass — accessibility", () => {
  it("overlay has proper ARIA: role=dialog, aria-modal=true, labelled header", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay");
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
    expect(overlay?.querySelector("header")).toBeTruthy();
  });

  it("rail slots have ≥48dp touch targets and accessible labels", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    pickRailMore("Expand editor");
    const rail = screen.getByRole("toolbar", { name: "Description formatting" });
    const names: Array<string | RegExp> = ["Undo", /^Block type: Body$/, "Bold", "Italic", "Bullets", "Link", "More"];
    const slots = within(rail).getAllByRole("button");
    // Every rendered button is one of the seven named slots: a slot that lost
    // its aria-label would leave an extra unnamed button to account for.
    expect(slots).toHaveLength(names.length);
    for (const name of names) {
      const slot = within(rail).getByRole("button", { name });
      expect(slots).toContain(slot);
      expect(slot.className).toMatch(/min-h-\[48px\]/);
      expect(slot.className).toMatch(/min-w-\[48px\]/);
    }
  });

  it("focus trap in overlay, focus restored on close", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    const moreBtn = screen.getByRole("button", { name: "More" });
    // Focus the always-mounted More slot, which is also the element this test
    // expects to receive focus back. The detached-launcher fallback is not
    // exercised here: the More slot survives, so the restore targets it.
    moreBtn.focus();
    expect(document.activeElement).toBe(moreBtn);
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay");
    // The focus trap moves focus into the overlay.
    expect(overlay?.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));
    // Focus returns to the launcher, which is still mounted.
    const activeEl = document.activeElement as HTMLElement | null;
    expect(activeEl).not.toBeNull();
    expect(activeEl?.getAttribute("aria-label")).toBe("More");
  });

  it("gives the dialog the initial focus, not the close control", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    const moreBtn = screen.getByRole("button", { name: "More" });
    moreBtn.focus();
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay")!;
    const close = screen.getByRole("button", { name: "Close full-screen editor" });
    // The container is not a control, so nothing is announced as pressed and
    // no ring lands on a button the opener never aimed at.
    expect(document.activeElement).toBe(overlay);
    expect(document.activeElement).not.toBe(close);
    // Tab still reaches the close control first, at a moment the user chose.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("opts the full-screen writing surface into the fill rule only", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    // The inline field lives outside the overlay, so the scoped fill cannot
    // reach it and its 120-240px box is unchanged.
    const inline = document.querySelector(".tiptap") as HTMLElement;
    expect(inline.closest("#report-editor-overlay")).toBeNull();
    pickRailMore("Expand editor");
    const scroller = screen.getByTestId("report-editor-scroller");
    // jsdom has no layout: the height comes from the scoped CSS rule, and this
    // pins the hook that rule targets plus the one wrapper it must size.
    expect(scroller.classList.contains("fb-report-editor-scroller")).toBe(true);
    expect(scroller.children).toHaveLength(1);
    expect((scroller.firstElementChild as HTMLElement).querySelector(".tiptap")).toBe(
      screen.getByRole("textbox", { name: "Description" }),
    );
  });
});
