import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  detectSlashQuery,
  rankCommands,
  type FormattingCommand,
} from "../components/formattingCommands";

export interface SlashRange {
  from: number;
  to: number;
}

export interface SlashCommandState {
  /** True when a query is live and there is at least one matching command. */
  open: boolean;
  /** Text typed after the "/" (may be ""). */
  query: string;
  /** Commands to show: ranked and capped. */
  items: FormattingCommand[];
  /** Index into `items` currently highlighted; -1 when nothing is highlighted. */
  activeIndex: number;
  /** Moves the highlight, clamped into range. */
  setActiveIndex: (index: number) => void;
  /** Absolute document range covering "/" + query, or null when closed. */
  range: SlashRange | null;
  /** Viewport rect of the trigger character, for anchoring a popup; null when closed. */
  getAnchorRect: () => DOMRect | null;
  /** Runs the command at `index`; chainable commands remove the trigger in the same undo step. */
  accept: (index: number) => boolean;
  /**
   * Closes the menu without editing the document. The same trigger stays closed
   * until its slash is deleted or a different slash is typed.
   */
  dismiss: () => void;
}

export interface UseSlashCommandsOptions {
  editor: Editor | null;
  /** When false the hook reports closed and ignores transactions (read-only/disabled editors). */
  enabled: boolean;
  /**
   * Executes a command. Receives the editor and the range to delete, and is
   * responsible for building ONE chain, e.g.
   *   editor.chain().focus().deleteRange(range).toggleBold().run()
   * Commands with no chain form (undo, link) are documented where they use more
   * than one transaction and so break the single-step guarantee.
   * Return false when the command could not be applied, so the trigger is left alone.
   */
  runCommand: (editor: Editor, commandId: string, range: SlashRange) => boolean;
  /**
   * Reports whether a node lives inside the portalled menu panel. The panel is
   * rendered outside this hook's tree, so without it a press inside the menu
   * would count as an outside press and close the menu.
   */
  isMenuTarget?: (target: Node) => boolean;
}

interface SlashSnapshot {
  open: boolean;
  query: string;
  items: FormattingCommand[];
  activeIndex: number;
  range: SlashRange | null;
}

const NO_ITEMS: FormattingCommand[] = [];

function closedSnapshot(): SlashSnapshot {
  return { open: false, query: "", items: NO_ITEMS, activeIndex: -1, range: null };
}

function sameItems(a: readonly FormattingCommand[], b: readonly FormattingCommand[]): boolean {
  return a.length === b.length && a.every((command, index) => command.id === b[index]?.id);
}

function sameRange(a: SlashRange | null, b: SlashRange | null): boolean {
  return a === b || (a !== null && b !== null && a.from === b.from && a.to === b.to);
}

function sameSnapshot(a: SlashSnapshot, b: SlashSnapshot): boolean {
  return a.open === b.open
    && a.query === b.query
    && a.activeIndex === b.activeIndex
    && sameRange(a.range, b.range)
    && sameItems(a.items, b.items);
}

/** True when the document still holds the dismissed trigger's slash. */
function slashStillAt(editor: Editor, position: number): boolean {
  try {
    return editor.state.doc.textBetween(position, position + 1) === "/";
  } catch {
    return false;
  }
}

export function useSlashCommands(options: UseSlashCommandsOptions): SlashCommandState {
  const optionsRef = useRef(options);
  const stateRef = useRef<SlashSnapshot>(closedSnapshot());
  const [state, setState] = useState<SlashSnapshot>(stateRef.current);
  // Absolute offset of the trigger the user dismissed, so it cannot reopen on
  // the next transaction. Null means no dismissal is in force.
  const dismissedAtRef = useRef<number | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  });

  const apply = useCallback((next: SlashSnapshot): void => {
    const prev = stateRef.current;
    const activeIndex = !next.open
      ? -1
      : !prev.open || prev.query !== next.query
        ? 0
        : Math.max(0, Math.min(prev.activeIndex, next.items.length - 1));
    const snapshot = { ...next, activeIndex };
    if (sameSnapshot(prev, snapshot)) return;
    stateRef.current = snapshot;
    setState(snapshot);
  }, []);

  const readSnapshot = useCallback((): SlashSnapshot => {
    const { editor, enabled } = optionsRef.current;
    // Never resolve mid-composition: the browser is still assembling the
    // characters, so textBefore would expose half of an IME candidate.
    if (!enabled || !editor || editor.isDestroyed || editor.view.composing) {
      return closedSnapshot();
    }
    // A dismissed trigger that is gone frees the next slash to open normally.
    if (dismissedAtRef.current !== null && !slashStillAt(editor, dismissedAtRef.current)) {
      dismissedAtRef.current = null;
    }
    const { selection } = editor.state;
    if (!selection.empty) return closedSnapshot();
    const { $from } = selection;
    if (!$from.parent.isTextblock) return closedSnapshot();

    // leafText "\n" keeps a hard break a line boundary, matching what the user
    // sees as the start of the current line.
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
    const query = detectSlashQuery(textBefore);
    if (!query) return closedSnapshot();
    const items = rankCommands(query.query);
    // A query that matches nothing is ordinary prose; closing here is what lets
    // "/ and then we left" stop being a command once no name matches.
    if (items.length === 0) return closedSnapshot();

    // detectSlashQuery works in offsets inside the block's text; the chain
    // commands need absolute document positions, so shift by the block start.
    const from = $from.start() + query.start;
    if (dismissedAtRef.current !== null) {
      // The same trigger the user dismissed: stay closed, even when more
      // characters arrive after it.
      if (from === dismissedAtRef.current) return closedSnapshot();
      // A different slash replaced the dismissed one; it may open.
      dismissedAtRef.current = null;
    }
    return {
      open: true,
      query: query.query,
      items,
      activeIndex: 0,
      range: { from, to: $from.start() + query.end },
    };
  }, []);

  const setActiveIndex = useCallback((index: number): void => {
    const prev = stateRef.current;
    if (!prev.open || prev.items.length === 0) return;
    const activeIndex = Math.max(0, Math.min(index, prev.items.length - 1));
    if (activeIndex === prev.activeIndex) return;
    const snapshot = { ...prev, activeIndex };
    stateRef.current = snapshot;
    setState(snapshot);
  }, []);

  const getAnchorRect = useCallback((): DOMRect | null => {
    const current = stateRef.current;
    if (!current.open || !current.range) return null;
    const { editor } = optionsRef.current;
    if (!editor || editor.isDestroyed) return null;
    try {
      // Measured fresh every call: the visual viewport moves under the
      // keyboard, so a cached rect would anchor the popup in the wrong place.
      const coords = editor.view.coordsAtPos(current.range.from);
      return new DOMRect(coords.left, coords.bottom, 0, 0);
    } catch {
      return null;
    }
  }, []);

  const accept = useCallback((index: number): boolean => {
    const { editor, runCommand } = optionsRef.current;
    if (!editor || editor.isDestroyed) return false;
    const snapshot = readSnapshot();
    if (!snapshot.open || !snapshot.range) return false;
    const command = snapshot.items[index];
    if (!command) return false;
    if (!runCommand(editor, command.id, snapshot.range)) return false;
    apply(readSnapshot());
    return true;
  }, [apply, readSnapshot]);

  const dismiss = useCallback((): void => {
    const { editor } = optionsRef.current;
    if (!editor || editor.isDestroyed) return;
    const snapshot = readSnapshot();
    if (!snapshot.open || !snapshot.range) return;
    // Tapping away or pressing Escape cancels the menu; it never deletes the
    // characters the user typed. Remember the offset so the same slash does not
    // reopen on the next transaction. Backspace already cancels the query.
    dismissedAtRef.current = snapshot.range.from;
    apply(closedSnapshot());
  }, [apply, readSnapshot]);

  const { editor, enabled } = options;

  useEffect(() => {
    if (!editor || !enabled) {
      apply(readSnapshot());
      return;
    }
    const recompute = (): void => apply(readSnapshot());
    editor.on("transaction", recompute);
    recompute();
    return () => {
      editor.off("transaction", recompute);
    };
  }, [editor, enabled, apply, readSnapshot]);

  // A menu the user left behind must not stay on screen over the form. Only
  // registered while open, and only a press or focus move that really leaves
  // both the editor DOM and the portalled panel closes it.
  useEffect(() => {
    if (!state.open) return;
    const { editor: current, isMenuTarget } = optionsRef.current;
    if (!current || current.isDestroyed) return;
    const dom = current.view.dom as HTMLElement;

    const isInside = (target: Node | null): boolean => {
      if (!target) return false;
      if (dom.contains(target)) return true;
      return isMenuTarget?.(target) ?? false;
    };

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && isInside(target)) return;
      dismiss();
    };
    // A preventDefaulted rail press never moves focus, so it never reaches this
    // handler; a real move into the editor or the menu keeps the menu open.
    const onBlur = (event: FocusEvent): void => {
      if (event.relatedTarget instanceof Node && isInside(event.relatedTarget)) return;
      dismiss();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    dom.addEventListener("blur", onBlur, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      dom.removeEventListener("blur", onBlur, true);
    };
  }, [state.open, dismiss]);

  return {
    open: state.open,
    query: state.query,
    items: state.items,
    activeIndex: state.activeIndex,
    setActiveIndex,
    range: state.range,
    getAnchorRect,
    accept,
    dismiss,
  };
}
