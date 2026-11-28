// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { RichTextEditor, markdownToTiptap, tiptapToMarkdown } from "./RichTextEditor";
import { openRailMore, pickRailMore } from "../test-utils/editorRail";
import { settleSelectionRender } from "../test-utils/editorSelection";
import { polyfillRangeGeometry, restoreRangeGeometry } from "../test-utils/jsdomRangeGeometry";
import { closeSoftKeyboard, openSoftKeyboard, renderFocused, restoreSoftKeyboard } from "../test-utils/softKeyboard";

beforeEach(openSoftKeyboard);
beforeEach(polyfillRangeGeometry);
afterEach(restoreRangeGeometry);
afterEach(restoreSoftKeyboard);
afterEach(cleanup);

describe("richTextEditor converters", () => {
  it("round-trips supported markdown through tiptap JSON", () => {
    for (const md of [
      "**black wallet** near *Central Park*",
      "# Lost wallet",
      "## Details",
      "- lobby\n- gym",
      "> Ask at reception.",
      "> Guard said *it was found Tuesday*",
      "[photo](https://example.com/photo)",
      "**[photo](https://example.com/photo)**",
      "*[map](https://example.com/map)*",
      "***black*** ***[case](https://example.com/c)***",
      "3. one\n4. two",
      "# Lost keys\n\nSilver keychain.\n\n- lobby\n- gym\n\n> Ask at reception.",
    ]) {
      expect(tiptapToMarkdown(markdownToTiptap(md))).toBe(md);
    }
  });

  it("keeps a mixed quote in a single block", () => {
    const md = "> Guard said *it was found Tuesday*";
    const json = markdownToTiptap(md);
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0]?.type).toBe("blockquote");
    expect(json.content?.[0]?.content).toHaveLength(1);
    expect(tiptapToMarkdown(json)).toBe(md);
  });

  it("preserves bold+link and italic+link editor marks", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "photo",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com/p" } }],
            },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "map",
              marks: [{ type: "italic" }, { type: "link", attrs: { href: "https://example.com/m" } }],
            },
          ],
        },
      ],
    };
    expect(tiptapToMarkdown(json)).toBe("**[photo](https://example.com/p)** and *[map](https://example.com/m)*");
  });

  it("keeps escaped metacharacters literal", () => {
    const md = "100\\* sure \\[not a link\\] \\(parens\\) \\\\ backslash";
    expect(tiptapToMarkdown(markdownToTiptap(md))).toBe(md);
  });

  it("preserves hard breaks inside a paragraph", () => {
    const md = "line one\nline two";
    const json = markdownToTiptap(md);
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0]?.type).toBe("paragraph");
    expect(tiptapToMarkdown(json)).toBe(md);
  });

  it("keeps adjacent marks intact", () => {
    const md = "**black***wallet*[photo](https://example.com/p)";
    expect(tiptapToMarkdown(markdownToTiptap(md))).toBe(md);
  });

  it("persists numbered lists as real Markdown list blocks", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          ],
        },
      ],
    };
    expect(tiptapToMarkdown(json)).toBe("1. one\n2. two");
  });

  it("drops unsafe link marks, keeps the display text", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
      ],
    };
    const md = tiptapToMarkdown(json);
    expect(md).toContain("click");
    expect(md).not.toContain("javascript:");
  });

  it("never throws on hostile JSON", () => {
    for (const bad of [null, undefined, 42, "nope", { type: "doc" }, { content: "nope" }, { content: [{ nope: true }] }]) {
      expect(() => tiptapToMarkdown(bad)).not.toThrow();
      expect(() => markdownToTiptap(bad as unknown as string)).not.toThrow();
    }
    expect(tiptapToMarkdown(null)).toBe("");
  });
});

describe("RichTextEditor", () => {
  it("exposes the description as a named multiline textbox with its editing state", () => {
    const { rerender } = renderFocused(<RichTextEditor label="Description" value="Blue wallet" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Description" });
    expect(input.textContent).toBe("Blue wallet");
    expect(input.getAttribute("aria-multiline")).toBe("true");
    expect(input.getAttribute("contenteditable")).toBe("true");
    expect(input.getAttribute("aria-disabled")).toBe("false");
    rerender(<RichTextEditor label="Description" value="Blue wallet" onChange={() => {}} disabled />);
    expect(screen.getByRole("textbox", { name: "Description" })).toBe(input);
    expect(input.getAttribute("contenteditable")).toBe("false");
    expect(input.getAttribute("aria-disabled")).toBe("true");
  });

  it("locks the same editor in fullscreen and drops the dead rail while read-only", () => {
    const ref = createRef<Editor | null>();
    const { rerender } = renderFocused(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} editorRef={ref} />);
    pickRailMore("Expand editor");
    rerender(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} editorRef={ref} disabled />);
    expect(ref.current?.isEditable).toBe(false);
    expect(ref.current?.view.dom.getAttribute("contenteditable")).toBe("false");
    // Read-only means no rail at all: every slot would be a dead control, so
    // the overlay keeps only its own actions.
    expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /close full-screen editor/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} editorRef={ref} />);
    expect(ref.current?.isEditable).toBe(true);
    expect(ref.current?.getText()).toBe("Wallet");
    // Re-enabling restores the rail with live controls.
    expect(screen.getByRole("toolbar", { name: "Description formatting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bold" })).toHaveProperty("disabled", false);
  });

  it("keeps the seven slots in one unwrapped row and the six composing slots pannable", () => {
    renderFocused(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} />);
    const rail = screen.getByRole("toolbar", { name: "Description formatting" });
    // jsdom has no layout, so pixel geometry is verified in the deployed build.
    // Here we pin the slot contract: the row never wraps or scrolls itself, and
    // the six composing slots share a labelled horizontal group instead of
    // squeezing targets below 48px at 320px.
    expect(rail.className).not.toContain("overflow-x-auto");
    expect(rail.className).toContain("flex-nowrap");
    const scroller = rail.querySelector('[data-testid="rich-text-rail-scroll"]');
    expect(scroller?.querySelectorAll("button")).toHaveLength(6);
    const names: Array<string | RegExp> = ["Undo", /^Block type: Body$/, "Bold", "Italic", "Bullets", "Link", "More"];
    const slots = within(rail).getAllByRole("button");
    expect(slots).toHaveLength(names.length);
    for (const name of names) {
      const slot = within(rail).getByRole("button", { name });
      expect(slot.className).toMatch(/min-h-\[48px\]/);
      expect(slot.className).toMatch(/min-w-\[48px\]/);
      expect(slot.className).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(slots).toContain(slot);
    }
  });

  it("renders the composing actions, placeholder text, and character count", () => {
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} placeholder="Describe the item" />);
    for (const name of ["Bold", "Italic", "Link", "Bullets", "Undo"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /Block type/i })).toBeTruthy();
    // Actions that are not pressed while composing stay one tap away, named
    // in the trailing menu rather than hidden.
    const more = openRailMore();
    for (const name of ["Numbered list", "Quote", "Paste as Markdown", "Clear formatting", "Expand editor"]) {
      expect(within(more).getByRole("option", { name })).toBeTruthy();
    }
    // Block menu options.
    fireEvent.click(screen.getByRole("button", { name: /Block type/i }));
    for (const name of ["Body", "Heading 1", "Heading 2", "Heading 3"]) {
      expect(screen.getByRole("menuitemradio", { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Body" }));
    expect(screen.getByText("Describe the item")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByLabelText("Character count").textContent).toBe("0 characters");
  });

  it("shows the initial markdown value", () => {
    const { container } = renderFocused(<RichTextEditor label="Description" value="# Lost wallet" onChange={() => {}} />);
    expect(container.querySelector(".tiptap")?.textContent).toContain("Lost wallet");
  });

  it("reports edits immediately so submit/unmount keeps final keystrokes", () => {
    const seen: string[] = [];
    const ref = createRef<Editor | null>();
    const { unmount } = renderFocused(
      <RichTextEditor label="Description" value="" onChange={(md) => seen.push(md)} editorRef={ref} />,
    );
    expect(ref.current).toBeTruthy();
    act(() => {
      ref.current?.commands.setContent(markdownToTiptap("final keystrokes"));
    });
    expect(seen).toContain("final keystrokes");
    unmount();
    expect(seen[seen.length - 1]).toBe("final keystrokes");
  });

  it("applies external value changes without change loops", () => {
    const onChange = vi.fn();
    const ref = createRef<Editor | null>();
    const { rerender } = renderFocused(
      <RichTextEditor label="Description" value="first" onChange={onChange} editorRef={ref} />,
    );
    expect(ref.current?.getText()).toContain("first");
    onChange.mockClear();
    rerender(<RichTextEditor label="Description" value="second" onChange={onChange} editorRef={ref} />);
    expect(ref.current?.getText()).toContain("second");
    expect(ref.current?.getText()).not.toContain("first");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not reset the editor when the parent echoes the emitted value", () => {
    let emitted = "";
    const onChange = vi.fn((md: string) => {
      emitted = md;
    });
    const ref = createRef<Editor | null>();
    const { rerender } = renderFocused(
      <RichTextEditor label="Description" value="" onChange={onChange} editorRef={ref} />,
    );
    act(() => {
      ref.current?.commands.setContent(markdownToTiptap("**typed**"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("**typed**");
    rerender(<RichTextEditor label="Description" value={emitted} onChange={onChange} editorRef={ref} />);
    expect(ref.current?.getText()).toContain("typed");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("resets to empty on external clear", () => {
    const onChange = vi.fn();
    const ref = createRef<Editor | null>();
    const { rerender } = renderFocused(
      <RichTextEditor label="Description" value="**typed**" onChange={onChange} editorRef={ref} />,
    );
    expect(ref.current?.getText()).toContain("typed");
    rerender(<RichTextEditor label="Description" value="" onChange={onChange} editorRef={ref} />);
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("");
  });

  it("shows a live character count", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="hi" onChange={() => {}} editorRef={ref} />);
    expect(screen.getByLabelText("Character count").textContent).toBe("2 characters");
    act(() => {
      ref.current?.commands.setContent(markdownToTiptap("hello world"));
    });
    expect(screen.getByLabelText("Character count").textContent).toBe("11 characters");
  });

  it("supports undo and redo from the toolbar", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => {
      ref.current?.commands.insertContent("hello");
    });
    expect(ref.current?.getText()).toContain("hello");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(ref.current?.getText()).not.toContain("hello");
    pickRailMore("Redo");
    expect(ref.current?.getText()).toContain("hello");
  });

  it("clears formatting back to plain text", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => {
      ref.current?.commands.setContent(markdownToTiptap("**bold** and *italic*"));
      ref.current?.commands.selectAll();
    });
    pickRailMore("Clear formatting");
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("bold and italic");
  });

  it("toggles a numbered list from the toolbar", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => {
      ref.current?.commands.insertContent("item");
    });
    pickRailMore("Numbered list");
    expect(ref.current?.isActive("orderedList")).toBe(true);
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("1. item");
  });
});

describe("RichTextEditor formatting rail pointer class", () => {
  const FINE = "(hover: hover) and (pointer: fine)";

  function stubMatchMedia(matches: boolean): () => void {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === FINE ? matches : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    return () => Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
  }

  it("does not attach a rail to focus on a touch pointer without a soft keyboard", () => {
    const restore = stubMatchMedia(false);
    closeSoftKeyboard();
    try {
      renderFocused(
        <div>
          <RichTextEditor label="Description" value="hello" onChange={() => {}} />
          <input aria-label="Title" />
        </div>,
      );
      const textbox = screen.getByRole("textbox", { name: "Description" });
      act(() => textbox.focus());
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
      // A real viewport shrink is the trigger, not the pointer class.
      openSoftKeyboard();
      act(() => window.dispatchEvent(new Event("resize")));
      expect(screen.getByRole("toolbar", { name: "Description formatting" })).toBeTruthy();
      // Focus belongs to another field: the rail does not sit over its keyboard.
      act(() => screen.getByRole("textbox", { name: "Title" }).focus());
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
      act(() => textbox.focus());
      closeSoftKeyboard();
      act(() => window.dispatchEvent(new Event("resize")));
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps the rail off a fine pointer until a soft keyboard is proved", () => {
    const restore = stubMatchMedia(true);
    closeSoftKeyboard();
    try {
      renderFocused(
        <div>
          <RichTextEditor label="Description" value="hello" onChange={() => {}} />
          <input aria-label="Title" />
        </div>,
      );
      const textbox = screen.getByRole("textbox", { name: "Description" });
      act(() => textbox.focus());
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
      openSoftKeyboard();
      act(() => window.dispatchEvent(new Event("resize")));
      expect(screen.getByRole("toolbar", { name: "Description formatting" })).toBeTruthy();
      act(() => screen.getByRole("textbox", { name: "Title" }).focus());
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps the rail mounted while the link dialog has focus on a touch pointer", async () => {
    const restore = stubMatchMedia(false);
    try {
      const ref = createRef<Editor | null>();
      renderFocused(<RichTextEditor label="Description" value="see map here" onChange={() => {}} editorRef={ref} />);
      const textbox = screen.getByRole("textbox", { name: "Description" });
      act(() => textbox.focus());
      act(() => ref.current?.commands.setTextSelection({ from: 5, to: 8 }));
      await settleSelectionRender();
      const link = screen.getByRole("button", { name: "Link" }) as HTMLButtonElement;
      expect(link.disabled).toBe(false);

      fireEvent.click(link);

      const dialog = screen.getByRole("dialog", { name: "Add link" });
      // The trap moved focus into the dialog, so the editor is no longer the
      // focused surface and only the dialog state can be keeping the rail
      // mounted. It must anchor to this exact button, not a detached node.
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(screen.getByRole("button", { name: "Link" })).toBe(link);
      expect(document.contains(link)).toBe(true);
    } finally {
      restore();
    }
  });

  it("keeps the caret in the field when a rail slot is pressed", () => {
    renderFocused(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
    const textbox = screen.getByRole("textbox", { name: "Description" });
    act(() => textbox.focus());
    const bold = screen.getByRole("button", { name: "Bold" });
    // Default prevented is the mechanism: the browser would otherwise move
    // focus (and collapse the selection) before the click handler runs.
    expect(fireEvent.mouseDown(bold)).toBe(false);
    expect(fireEvent.pointerDown(bold)).toBe(false);
    expect(document.activeElement).toBe(textbox);
  });

  it("reaches every action from the seven-slot rail, including redo once it can run", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    for (const name of ["Undo", "Bold", "Italic", "Bullets", "Link", "More"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /^Block type/ })).toBeTruthy();
    const more = openRailMore();
    for (const name of ["Numbered list", "Quote", "Paste as Markdown", "Clear formatting", "Expand editor"]) {
      expect(within(more).getByRole("option", { name })).toBeTruthy();
    }
    // Redo is not offered while it would no-op; it appears when it can act.
    expect(within(more).queryByRole("option", { name: "Redo" })).toBeNull();
    act(() => ref.current?.commands.insertContent("typed"));
    act(() => ref.current?.commands.undo());
    expect(within(more).getByRole("option", { name: "Redo" })).toBeTruthy();
  });
});

describe("RichTextEditor slash commands", () => {
  it("opens on a line-leading slash, narrows to matching commands, and accepts with keyboard", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    const viewDom = ref.current!.view.dom;
    act(() => ref.current?.commands.insertContent("/"));
    const menu = screen.getByRole("listbox", { name: "Formatting commands" });
    expect(within(menu).getByRole("option", { name: "Bold" })).toBeTruthy();
    act(() => ref.current?.commands.insertContent("bo"));
    const narrowed = screen.getByRole("listbox", { name: "Formatting commands" });
    expect(within(narrowed).getAllByRole("option").map((row) => row.textContent)).toEqual(["Body", "Bold"]);
    // ArrowDown moves from Body to Bold; Enter runs it and removes the trigger.
    fireEvent.keyDown(viewDom, { key: "ArrowDown" });
    fireEvent.keyDown(viewDom, { key: "Enter" });
    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
    act(() => ref.current?.commands.insertContent("word"));
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("**word**");
  });

  it("dismisses on Escape without closing the surface around it", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    pickRailMore("Expand editor");
    const overlay = document.getElementById("report-editor-overlay");
    expect(overlay).not.toBeNull();
    act(() => ref.current?.commands.insertContent("/"));
    expect(screen.getByRole("listbox", { name: "Formatting commands" })).toBeTruthy();
    fireEvent.keyDown(ref.current!.view.dom, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
    // One Escape closed the menu only, not the full-screen editor beneath it.
    expect(document.getElementById("report-editor-overlay")).not.toBeNull();
  });

  it("leaves a slash in ordinary prose alone", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.insertContent("see pages 1/2"));
    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
  });

  it("closes on an outside tap without deleting the typed query", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.insertContent("/bold"));
    expect(screen.getByRole("listbox", { name: "Formatting commands" })).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
    expect(ref.current?.getText()).toBe("/bold");
  });

  it("keeps the menu open through a press on one of its own rows", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.insertContent("/bold"));
    const menu = screen.getByRole("listbox", { name: "Formatting commands" });
    const row = within(menu).getByRole("option", { name: "Bold" });
    // A real press hits the document's capture handler on the way down, before
    // the row's click. The menu must survive that press or no row is clickable.
    fireEvent.pointerDown(row);
    expect(screen.getByRole("listbox", { name: "Formatting commands" })).toBeTruthy();

    fireEvent.click(row);

    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
    act(() => ref.current?.commands.insertContent("word"));
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("**word**");
  });

  it("closes the typed menu when focus leaves the editor", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      act(() => ref.current?.commands.insertContent("/bold"));
      expect(screen.getByRole("listbox", { name: "Formatting commands" })).toBeTruthy();

      fireEvent.blur(ref.current!.view.dom, { relatedTarget: outside });

      expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
      expect(ref.current?.getText()).toBe("/bold");
    } finally {
      outside.remove();
    }
  });

  it("keeps redo out of the typed menu even while the redo stack is live", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.insertContent("x"));
    act(() => ref.current?.commands.undo());
    expect(ref.current?.can().redo()).toBe(true);
    // Bring in a line-leading query without a history step, so opening the menu
    // does not itself clear the redo stack it must be tested against.
    act(() => {
      const tr = ref.current!.state.tr.insertText("/re", 1).setMeta("addToHistory", false);
      tr.setSelection(TextSelection.create(tr.doc, 4));
      ref.current!.view.dispatch(tr);
    });
    expect(ref.current?.can().redo()).toBe(true);

    const menu = screen.getByRole("listbox", { name: "Formatting commands" });
    expect(within(menu).getByRole("option", { name: "Clear formatting" })).toBeTruthy();
    expect(within(menu).queryByRole("option", { name: "Redo" })).toBeNull();
  });

  it.each([
    ["/bold", "Bold"],
    ["/italic", "Italic"],
    ["/body", "Body"],
    ["/h1", "Heading 1"],
    ["/h2", "Heading 2"],
    ["/h3", "Heading 3"],
    ["/ul", "Bulleted list"],
    ["/ol", "Numbered list"],
    ["/quote", "Quote"],
    ["/clear", "Clear formatting"],
  ])("restores the typed trigger after one undo for %s", (trigger, option) => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.insertContent(trigger));
    const menu = screen.getByRole("listbox", { name: "Formatting commands" });
    fireEvent.click(within(menu).getByRole("option", { name: option }));
    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();

    act(() => ref.current?.commands.undo());

    expect(ref.current?.getText()).toBe(trigger);
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe(trigger);
    expect(ref.current?.isActive("bold")).toBe(false);
    expect(ref.current?.isActive("heading")).toBe(false);
    expect(ref.current?.isActive("bulletList")).toBe(false);
    expect(ref.current?.isActive("orderedList")).toBe(false);
    expect(ref.current?.isActive("blockquote")).toBe(false);
  });

  it("pastes Markdown from the typed menu as one undo step", async () => {
    const readText = vi.fn().mockResolvedValue("**hi**");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    try {
      const ref = createRef<Editor | null>();
      renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
      act(() => ref.current?.commands.insertContent("/paste"));
      const menu = screen.getByRole("listbox", { name: "Formatting commands" });
      fireEvent.click(within(menu).getByRole("option", { name: "Paste as Markdown" }));
      await waitFor(() => expect(ref.current?.getText()).toContain("hi"));

      act(() => ref.current?.commands.undo());

      expect(ref.current?.getText()).toBe("/paste");
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }
  });
});

describe("RichTextEditor security", () => {
  it("drops unsafe link targets from markdown, keeps display text", () => {
    const cases: Array<[string, string]> = [
      ["[evil](javascript:alert(1))", "evil"],
      ["[d](data:text/html,hi)", "d"],
      ["[f](file:///etc/passwd)", "f"],
      ["[v](vbscript:msgbox(1))", "v"],
      ["**[evil](javascript:alert(1))**", "evil"],
      ["*[evil](javascript:alert(1))*", "evil"],
    ];
    for (const [md, text] of cases) {
      const out = tiptapToMarkdown(markdownToTiptap(md));
      expect(out).not.toMatch(/\[[^\]]*\]\(\s*(javascript|data|file|vbscript):/i);
      expect(out).toContain(text);
    }
    expect(tiptapToMarkdown(markdownToTiptap("[evil](javascript:alert(1))"))).toBe("evil");
    expect(tiptapToMarkdown(markdownToTiptap("**[evil](javascript:alert(1))**"))).toBe("**evil**");
  });

  it("treats malformed links as inert text", () => {
    for (const md of [
      "[text](javascript:alert(1)",
      "[text]()",
      "[text](   )",
      "[unclosed",
      "[](https://example.com)",
      "[[nested]](https://example.com)",
    ]) {
      const out = tiptapToMarkdown(markdownToTiptap(md));
      expect(out).not.toMatch(/\[[^\]]*\]\(\s*javascript:/i);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("neutralizes pasted HTML and script-like content", () => {
    const ref = createRef<Editor | null>();
    renderFocused(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => {
      ref.current?.commands.insertContent(
        '<p>Hello <script>alert("x")</script> <b>raw</b> <img src="x" onerror="alert(1)"></p><p><a href="javascript:alert(1)">evil</a> <a href="https://example.com">safe</a></p>',
      );
    });
    const out = tiptapToMarkdown(ref.current?.getJSON() ?? null);
    expect(out).not.toMatch(/<script|<img|onerror|javascript:/i);
    expect(out).toContain("Hello");
    expect(out).toContain("evil");
    expect(out).toContain("[safe](https://example.com)");
  });

  it("keeps script-like markdown inert", () => {
    const out = tiptapToMarkdown(markdownToTiptap('<script>alert("x")</script>'));
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("script");
  });
});
