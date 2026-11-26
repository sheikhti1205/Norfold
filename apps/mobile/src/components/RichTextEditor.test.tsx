// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import type { Editor } from "@tiptap/react";
import { RichTextEditor, markdownToTiptap, tiptapToMarkdown } from "./RichTextEditor";
import { openRailMore, pickRailMore } from "../test-utils/editorRail";

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
    const { rerender } = render(<RichTextEditor label="Description" value="Blue wallet" onChange={() => {}} />);
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

  it("locks the same editor and formatting rail in fullscreen without trapping the close action", () => {
    const ref = createRef<Editor | null>();
    const { rerender } = render(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} editorRef={ref} />);
    pickRailMore("Expand editor");
    rerender(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} editorRef={ref} disabled />);
    expect(ref.current?.isEditable).toBe(false);
    expect(ref.current?.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /close full-screen editor/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} editorRef={ref} />);
    expect(ref.current?.isEditable).toBe(true);
    expect(ref.current?.getText()).toBe("Wallet");
  });

  it("fits every formatting slot in one row without a horizontal scroller", () => {
    render(<RichTextEditor label="Description" value="Wallet" onChange={() => {}} />);
    const rail = screen.getByRole("toolbar", { name: "Description formatting" });
    // The rail no longer clips: every slot is laid out in the row itself, so
    // there is no focus-scrolling hack and nothing can sit off-screen.
    expect(rail.className).not.toContain("overflow-x-auto");
    expect(rail.className).toContain("flex-nowrap");
    expect(rail.scrollWidth).toBeLessThanOrEqual(rail.clientWidth);
    expect(rail.querySelectorAll("button")).toHaveLength(7);
  });

  it("renders the composing actions, placeholder text, and character count", () => {
    render(<RichTextEditor label="Description" value="" onChange={() => {}} placeholder="Describe the item" />);
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
    const { container } = render(<RichTextEditor label="Description" value="# Lost wallet" onChange={() => {}} />);
    expect(container.querySelector(".tiptap")?.textContent).toContain("Lost wallet");
  });

  it("reports edits immediately so submit/unmount keeps final keystrokes", () => {
    const seen: string[] = [];
    const ref = createRef<Editor | null>();
    const { unmount } = render(
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
    const { rerender } = render(
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
    const { rerender } = render(
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
    const { rerender } = render(
      <RichTextEditor label="Description" value="**typed**" onChange={onChange} editorRef={ref} />,
    );
    expect(ref.current?.getText()).toContain("typed");
    rerender(<RichTextEditor label="Description" value="" onChange={onChange} editorRef={ref} />);
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("");
  });

  it("shows a live character count", () => {
    const ref = createRef<Editor | null>();
    render(<RichTextEditor label="Description" value="hi" onChange={() => {}} editorRef={ref} />);
    expect(screen.getByLabelText("Character count").textContent).toBe("2 characters");
    act(() => {
      ref.current?.commands.setContent(markdownToTiptap("hello world"));
    });
    expect(screen.getByLabelText("Character count").textContent).toBe("11 characters");
  });

  it("supports undo and redo from the toolbar", () => {
    const ref = createRef<Editor | null>();
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
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
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => {
      ref.current?.commands.setContent(markdownToTiptap("**bold** and *italic*"));
      ref.current?.commands.selectAll();
    });
    pickRailMore("Clear formatting");
    expect(tiptapToMarkdown(ref.current?.getJSON())).toBe("bold and italic");
  });

  it("toggles a numbered list from the toolbar", () => {
    const ref = createRef<Editor | null>();
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
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

  it("attaches the rail to focus on a touch pointer", () => {
    const restore = stubMatchMedia(false);
    try {
      render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
      const textbox = screen.getByRole("textbox", { name: "Description" });
      act(() => textbox.focus());
      expect(screen.getByRole("toolbar", { name: "Description formatting" })).toBeTruthy();
      act(() => textbox.blur());
      expect(screen.queryByRole("toolbar", { name: "Description formatting" })).toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps the rail visible on a fine pointer, focused or not", () => {
    const restore = stubMatchMedia(true);
    try {
      render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
      const textbox = screen.getByRole("textbox", { name: "Description" });
      expect(screen.getByRole("toolbar", { name: "Description formatting" })).toBeTruthy();
      act(() => textbox.focus());
      act(() => textbox.blur());
      expect(screen.getByRole("toolbar", { name: "Description formatting" })).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("keeps the caret in the field when a rail slot is pressed", () => {
    render(<RichTextEditor label="Description" value="hello" onChange={() => {}} />);
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
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
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
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
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
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
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
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
    act(() => ref.current?.commands.insertContent("see pages 1/2"));
    expect(screen.queryByRole("listbox", { name: "Formatting commands" })).toBeNull();
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
    render(<RichTextEditor label="Description" value="" onChange={() => {}} editorRef={ref} />);
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
