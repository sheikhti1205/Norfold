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
  /** Runs the command at `index` and removes the trigger in the same undo step. */
  accept: (index: number) => boolean;
  /** Closes the menu and removes the typed "/query" as one undoable step. */
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
   * Commands with no chain form (undo, redo, expand, paste) may delete the range
   * in their own chain and then act.
   * Return false when the command could not be applied, so the trigger is left alone.
   */
  runCommand: (editor: Editor, commandId: string, range: SlashRange) => boolean;
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

export function useSlashCommands(options: UseSlashCommandsOptions): SlashCommandState {
  const optionsRef = useRef(options);
  const stateRef = useRef<SlashSnapshot>(closedSnapshot());
  const [state, setState] = useState<SlashSnapshot>(stateRef.current);

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

    return {
      open: true,
      query: query.query,
      items,
      activeIndex: 0,
      // detectSlashQuery works in offsets inside the block's text; the chain
      // commands need absolute document positions, so shift by the block start.
      range: { from: $from.start() + query.start, to: $from.start() + query.end },
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
    // One chain is one transaction, so one undo brings the typed trigger back
    // instead of leaving the characters eaten.
    editor.chain().focus().deleteRange(snapshot.range).run();
    apply(readSnapshot());
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
