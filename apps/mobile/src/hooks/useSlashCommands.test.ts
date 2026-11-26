// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { SLASH_DEFAULT_LIMIT, rankCommands } from "../components/formattingCommands";
import { useSlashCommands, type SlashRange } from "./useSlashCommands";

const editors: Editor[] = [];

function createEditor(content = "<p></p>"): Editor {
  const editor = new Editor({ extensions: [StarterKit], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

function caretTo(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

function caretToEnd(editor: Editor): void {
  caretTo(editor, editor.state.doc.content.size - 1);
}

function type(editor: Editor, text: string): void {
  const from = editor.state.selection.from;
  const tr = editor.state.tr.insertText(text, from);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  editor.view.dispatch(tr);
}

function deleteBeforeCaret(editor: Editor, count: number): void {
  const from = editor.state.selection.from;
  editor.view.dispatch(editor.state.tr.delete(from - count, from));
}

function renderSlash(
  editor: Editor,
  options?: {
    enabled?: boolean;
    runCommand?: (editor: Editor, commandId: string, range: SlashRange) => boolean;
    isMenuTarget?: (target: Node) => boolean;
  },
) {
  const runCommand = options?.runCommand ?? vi.fn(() => false);
  const view = renderHook(() => useSlashCommands({
    editor,
    enabled: options?.enabled ?? true,
    runCommand,
    isMenuTarget: options?.isMenuTarget,
  }));
  return { ...view, runCommand };
}

describe("useSlashCommands", () => {
  it("opens on a slash in an empty paragraph with the capped default list", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);
    expect(result.current.open).toBe(false);

    act(() => type(editor, "/"));

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("");
    expect(result.current.items.map((command) => command.id))
      .toEqual(rankCommands("").map((command) => command.id));
    expect(result.current.items).toHaveLength(SLASH_DEFAULT_LIMIT);
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.range).toEqual({ from: 1, to: 2 });
  });

  it("filters the list as the query grows and resets the highlight", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);

    act(() => type(editor, "/"));
    act(() => type(editor, "b"));
    act(() => type(editor, "o"));

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("bo");
    expect(result.current.items.map((command) => command.id))
      .toEqual(rankCommands("bo").map((command) => command.id));
    expect(result.current.items.some((command) => command.id === "bold")).toBe(true);
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.range).toEqual({ from: 1, to: 4 });
  });

  it("does not open for a slash inside a sentence", () => {
    const editor = createEditor("<p>see http</p>");
    const { result } = renderSlash(editor);

    act(() => {
      caretToEnd(editor);
      type(editor, "/");
    });

    expect(result.current.open).toBe(false);
    expect(result.current.range).toBeNull();
  });

  it("does not open inside a URL", () => {
    const editor = createEditor("<p>https://example.com</p>");
    const { result } = renderSlash(editor);

    act(() => caretToEnd(editor));
    expect(result.current.open).toBe(false);

    act(() => type(editor, "x"));
    expect(result.current.open).toBe(false);
  });

  it("does not open when a non-indent character precedes the slash", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);

    act(() => type(editor, "</"));

    expect(result.current.open).toBe(false);
  });

  it("still opens when only indentation precedes the slash", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);

    act(() => type(editor, " /"));

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("");
    expect(result.current.range).toEqual({ from: 2, to: 3 });
  });

  it("closes when the slash is deleted", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);

    act(() => type(editor, "/"));
    expect(result.current.open).toBe(true);

    act(() => deleteBeforeCaret(editor, 1));

    expect(result.current.open).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.range).toBeNull();
  });

  it("closes when the query matches nothing", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);

    act(() => type(editor, "/zzzz"));

    expect(result.current.open).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.activeIndex).toBe(-1);
  });

  it("reports closed for a range selection", () => {
    const editor = createEditor("<p>/bo</p>");
    const { result } = renderSlash(editor);

    act(() => caretToEnd(editor));
    expect(result.current.open).toBe(true);

    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 3),
      ));
    });

    expect(result.current.open).toBe(false);
  });

  it("reports closed for a non-textblock selection", () => {
    const editor = createEditor("<p>a</p><hr>");
    const { result } = renderSlash(editor);

    act(() => {
      const rulePos = editor.state.doc.child(0).nodeSize;
      editor.view.dispatch(editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, rulePos),
      ));
    });

    expect(result.current.open).toBe(false);
  });

  it("returns no anchor when closed", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);

    expect(result.current.getAnchorRect()).toBeNull();
  });

  it("anchors a fresh zero-width rect at the trigger and nulls on measurement failure", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);
    act(() => type(editor, "/"));

    const coords = vi.spyOn(editor.view, "coordsAtPos")
      .mockReturnValue({ left: 12, top: 20, right: 12, bottom: 34 });

    const rect = result.current.getAnchorRect();
    expect(rect).not.toBeNull();
    expect(rect?.x).toBe(12);
    expect(rect?.y).toBe(34);
    expect(rect?.width).toBe(0);
    expect(rect?.height).toBe(0);
    expect(rect?.top).toBe(34);
    expect(rect?.bottom).toBe(34);
    expect(rect?.left).toBe(12);
    expect(rect?.right).toBe(12);

    coords.mockImplementation(() => { throw new Error("no layout"); });
    expect(result.current.getAnchorRect()).toBeNull();

    coords.mockRestore();
  });

  it("accepts a command with the trigger range and closes immediately", () => {
    const editor = createEditor();
    const calls: Array<{ commandId: string; range: SlashRange; text: string }> = [];
    const runCommand = vi.fn((ed: Editor, commandId: string, range: SlashRange) => {
      calls.push({ commandId, range, text: ed.state.doc.textBetween(range.from, range.to) });
      ed.chain().focus().deleteRange(range).run();
      return true;
    });
    const { result } = renderSlash(editor, { runCommand });

    act(() => type(editor, "/bo"));
    expect(result.current.open).toBe(true);
    const expected = rankCommands("bo")[0];
    expect(expected).toBeDefined();

    let accepted = false;
    act(() => { accepted = result.current.accept(0); });

    expect(accepted).toBe(true);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.commandId).toBe(expected?.id);
    expect(calls[0]?.text).toBe("/bo");
    expect(calls[0]?.range).toEqual({ from: 1, to: 4 });
    expect(editor.getText()).toBe("");
    expect(result.current.open).toBe(false);
  });

  it("leaves the state untouched when the command cannot be applied", () => {
    const editor = createEditor();
    const runCommand = vi.fn(() => false);
    const { result } = renderSlash(editor, { runCommand });

    act(() => type(editor, "/bo"));
    const items = result.current.items;
    const range = result.current.range;
    expect(result.current.open).toBe(true);

    let accepted = true;
    act(() => { accepted = result.current.accept(0); });

    expect(accepted).toBe(false);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("bo");
    expect(result.current.items).toBe(items);
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.range).toBe(range);
    expect(editor.getText()).toBe("/bo");
  });

  it("returns false from accept when closed or out of range", () => {
    const editor = createEditor();
    const runCommand = vi.fn(() => true);
    const { result } = renderSlash(editor, { runCommand });

    let accepted = true;
    act(() => { accepted = result.current.accept(0); });
    expect(accepted).toBe(false);

    act(() => type(editor, "/"));
    act(() => { accepted = result.current.accept(99); });
    expect(accepted).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("dismiss closes without touching the typed query", () => {
    const editor = createEditor("<p>/bo</p>");
    const { result } = renderSlash(editor);
    act(() => caretToEnd(editor));
    expect(result.current.open).toBe(true);

    act(() => result.current.dismiss());

    expect(result.current.open).toBe(false);
    expect(editor.getText()).toBe("/bo");
  });

  it("does not reopen the dismissed trigger on later transactions", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);
    act(() => type(editor, "/bo"));
    expect(result.current.open).toBe(true);

    act(() => result.current.dismiss());
    act(() => type(editor, "l"));
    act(() => type(editor, "d"));

    expect(result.current.open).toBe(false);
    expect(editor.getText()).toBe("/bold");
  });

  it("opens for a new slash at a different position", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);
    act(() => type(editor, "/bo"));
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);

    act(() => {
      editor.commands.setContent("<p>/bo</p><p>/b</p>");
      caretToEnd(editor);
    });

    expect(result.current.open).toBe(true);
    expect(result.current.query).toBe("b");
    expect(result.current.range).toEqual({ from: 6, to: 8 });
  });

  it("opens again once the dismissed slash is deleted", () => {
    const editor = createEditor("<p>/bo</p>");
    const { result } = renderSlash(editor);
    act(() => caretToEnd(editor));
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);

    act(() => deleteBeforeCaret(editor, 3));
    act(() => type(editor, "/"));

    expect(editor.getText()).toBe("/");
    expect(result.current.open).toBe(true);
  });

  it("closes on an outside pointerdown but not inside the editor or the menu", () => {
    const editor = createEditor();
    const menu = document.createElement("div");
    document.body.append(menu);
    try {
      const { result } = renderSlash(editor, {
        isMenuTarget: (target) => target === menu || menu.contains(target),
      });
      act(() => type(editor, "/"));
      expect(result.current.open).toBe(true);

      act(() => fireEvent.pointerDown(editor.view.dom));
      expect(result.current.open).toBe(true);

      act(() => fireEvent.pointerDown(menu));
      expect(result.current.open).toBe(true);

      act(() => fireEvent.pointerDown(document.body));
      expect(result.current.open).toBe(false);
      expect(editor.getText()).toBe("/");
    } finally {
      menu.remove();
    }
  });

  it("closes on blur unless focus lands in the editor or the menu", () => {
    const editor = createEditor();
    const menuButton = document.createElement("button");
    document.body.append(menuButton);
    try {
      const { result } = renderSlash(editor, { isMenuTarget: (target) => target === menuButton });
      act(() => type(editor, "/"));
      expect(result.current.open).toBe(true);

      act(() => fireEvent.blur(editor.view.dom, { relatedTarget: editor.view.dom }));
      expect(result.current.open).toBe(true);

      act(() => fireEvent.blur(editor.view.dom, { relatedTarget: menuButton }));
      expect(result.current.open).toBe(true);

      act(() => fireEvent.blur(editor.view.dom));
      expect(result.current.open).toBe(false);
      expect(editor.getText()).toBe("/");
    } finally {
      menuButton.remove();
    }
  });

  it("does nothing on dismiss when closed", () => {
    const editor = createEditor("<p>plain</p>");
    const { result } = renderSlash(editor);

    act(() => result.current.dismiss());

    expect(editor.getText()).toBe("plain");
    expect(result.current.open).toBe(false);
  });

  it("clamps the highlight into the item range", () => {
    const editor = createEditor();
    const { result } = renderSlash(editor);
    act(() => type(editor, "/"));

    act(() => { result.current.setActiveIndex(99); });
    expect(result.current.activeIndex).toBe(SLASH_DEFAULT_LIMIT - 1);

    act(() => { result.current.setActiveIndex(-5); });
    expect(result.current.activeIndex).toBe(0);

    act(() => { result.current.setActiveIndex(2); });
    expect(result.current.activeIndex).toBe(2);

    act(() => type(editor, "o"));
    expect(result.current.query).toBe("o");
    expect(result.current.activeIndex).toBe(0);
  });

  it("never opens while disabled and opens when re-enabled", () => {
    const editor = createEditor();
    const view = renderHook(
      ({ enabled }: { enabled: boolean }) => useSlashCommands({
        editor,
        enabled,
        runCommand: () => false,
      }),
      { initialProps: { enabled: false } },
    );

    act(() => type(editor, "/"));
    expect(view.result.current.open).toBe(false);
    expect(view.result.current.getAnchorRect()).toBeNull();

    view.rerender({ enabled: true });
    expect(view.result.current.open).toBe(true);
  });

  it("ignores transactions mid-composition", () => {
    const editor = createEditor();
    let composing = false;
    Object.defineProperty(editor.view, "composing", {
      configurable: true,
      get: () => composing,
    });
    const { result } = renderSlash(editor);

    composing = true;
    act(() => type(editor, "/"));
    expect(result.current.open).toBe(false);

    composing = false;
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection));
    });
    expect(result.current.open).toBe(true);
  });
});
