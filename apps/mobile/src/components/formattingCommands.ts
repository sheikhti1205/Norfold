/**
 * `/` command model for the report description editor.
 *
 * Detection is positional, not lexical: a slash opens a query only as the first
 * non-whitespace character of its line, so `https://…`, `12/03/2026`, `1/2` and
 * file paths are suppressed by one rule instead of a growing exception list.
 *
 * Pure data and pure functions: the editor calls both per keystroke, so this
 * module must stay free of React, Tiptap and DOM imports.
 */

export type FormattingGroupId = "history" | "text" | "structure" | "insert" | "actions";

export interface FormattingCommand {
  /** Stable id, e.g. "bold", "block.h1", "list.bullet". */
  id: string;
  /** Menu row label, e.g. "Bold", "Heading 1", "Bulleted list". */
  label: string;
  /** Extra match terms ("b", "strong", "h1"). Lowercase. */
  aliases: string[];
  group: FormattingGroupId;
}

export interface SlashQuery {
  /** Index in the inspected text where the trigger "/" sits. */
  start: number;
  /** Text typed after the "/" up to and including the caret's position (may be ""). */
  query: string;
  /** Index just past the query: `text.slice(start, end)` is "/" + query. */
  end: number;
}

/** A longer query cannot be a command name, so the slash is treated as prose. */
export const SLASH_MAX_QUERY_LENGTH = 32;

export const SLASH_DEFAULT_LIMIT = 8;

export const FORMATTING_GROUPS: ReadonlyArray<{ id: FormattingGroupId; label: string }> = [
  { id: "history", label: "History" },
  { id: "text", label: "Text" },
  { id: "structure", label: "Structure" },
  { id: "insert", label: "Insert" },
  { id: "actions", label: "Actions" },
];

/** Declaration order is the menu order for an empty query and the tie-break order. */
export const FORMATTING_COMMANDS: ReadonlyArray<FormattingCommand> = [
  { id: "undo", label: "Undo", aliases: ["z"], group: "history" },
  { id: "redo", label: "Redo", aliases: ["y"], group: "history" },
  { id: "block.body", label: "Body", aliases: ["text", "paragraph", "p"], group: "text" },
  { id: "block.h1", label: "Heading 1", aliases: ["h1", "heading", "title", "#"], group: "text" },
  { id: "block.h2", label: "Heading 2", aliases: ["h2", "heading", "subheading", "##"], group: "text" },
  { id: "block.h3", label: "Heading 3", aliases: ["h3", "heading", "subtitle", "###"], group: "text" },
  { id: "bold", label: "Bold", aliases: ["b", "strong", "bi"], group: "text" },
  { id: "italic", label: "Italic", aliases: ["i", "em"], group: "text" },
  { id: "list.bullet", label: "Bulleted list", aliases: ["ul", "bullet", "bullets", "list", "dots"], group: "structure" },
  { id: "list.number", label: "Numbered list", aliases: ["ol", "number", "numbered", "numbers", "1."], group: "structure" },
  { id: "quote", label: "Quote", aliases: ["q", "blockquote", ">"], group: "structure" },
  { id: "link", label: "Link", aliases: ["url", "href"], group: "insert" },
  { id: "paste.markdown", label: "Paste as Markdown", aliases: ["paste", "md", "markdown"], group: "insert" },
  { id: "clear", label: "Clear formatting", aliases: ["reset", "remove", "plain"], group: "actions" },
  { id: "expand", label: "Expand editor", aliases: ["fullscreen", "full", "maximize"], group: "actions" },
];

/** Space, tab and NBSP are the only indentation a block ever holds. */
const INDENT_ONLY = /^[ \t\u00a0]*$/;

/**
 * Pure text analysis. `textBefore` is the text of the block up to the caret.
 *
 * A query runs from its slash to the caret, so `textBefore` is exactly the
 * span the caller can re-slice with `start`/`end`.
 */
export function detectSlashQuery(textBefore: string): SlashQuery | null {
  const lineStart = textBefore.lastIndexOf("\n") + 1;
  const line = textBefore.slice(lineStart);
  const slash = line.lastIndexOf("/");
  if (slash === -1) return null;
  const start = lineStart + slash;

  // Only line-leading slash is a trigger; this is the one rule that keeps URLs,
  // dates, fractions and paths out of the menu without naming any of them.
  if (!INDENT_ONLY.test(line.slice(0, slash))) return null;

  // An escaped literal slash (`//`) never opens a query.
  if (line.charAt(slash + 1) === "/") return null;

  const query = textBefore.slice(start + 1);
  if (query.includes("\n") || query.includes("\r")) return null;
  if (query.length > SLASH_MAX_QUERY_LENGTH) return null;

  return { start, query, end: start + 1 + query.length };
}

/** Lower scores rank first; the order is part of the `/` menu's feel. */
const SCORE_ID_EXACT = 0;
const SCORE_ALIAS_EXACT = 1;
const SCORE_LABEL_EXACT = 2;
const SCORE_LABEL_PREFIX = 3;
const SCORE_ALIAS_PREFIX = 4;
const SCORE_ID_TAIL_PREFIX = 5;
const SCORE_LABEL_CONTAINS = 6;
const SCORE_ALIAS_CONTAINS = 7;
const SCORE_ID_CONTAINS = 8;

/** Best score for one command, or null when it does not match. `query` is lowercase. */
function scoreCommand(command: FormattingCommand, query: string): number | null {
  const id = command.id.toLowerCase();
  const label = command.label.toLowerCase();

  if (id === query) return SCORE_ID_EXACT;
  if (command.aliases.includes(query)) return SCORE_ALIAS_EXACT;
  if (label === query) return SCORE_LABEL_EXACT;
  if (label.startsWith(query)) return SCORE_LABEL_PREFIX;
  if (command.aliases.some((alias) => alias.startsWith(query))) return SCORE_ALIAS_PREFIX;

  // "h1" should find "block.h1" without typing the namespace.
  const tail = id.slice(id.lastIndexOf(".") + 1);
  if (tail.startsWith(query)) return SCORE_ID_TAIL_PREFIX;

  if (label.includes(query)) return SCORE_LABEL_CONTAINS;
  if (command.aliases.some((alias) => alias.includes(query))) return SCORE_ALIAS_CONTAINS;
  if (id.includes(query)) return SCORE_ID_CONTAINS;
  return null;
}

/** Commands worth showing for a query, best first, at most `limit`. */
export function rankCommands(
  query: string,
  options?: { limit?: number; commands?: ReadonlyArray<FormattingCommand> },
): FormattingCommand[] {
  const commands = options?.commands ?? FORMATTING_COMMANDS;
  const limit = Math.max(0, options?.limit ?? SLASH_DEFAULT_LIMIT);
  // Leading and trailing whitespace is typing, not part of the name; spaces
  // inside the query ("heading 1") are matched as typed.
  const normalized = query.toLowerCase().trim();

  if (normalized === "") return commands.slice(0, limit);

  const scored: Array<{ command: FormattingCommand; score: number; order: number }> = [];
  commands.forEach((command, order) => {
    const score = scoreCommand(command, normalized);
    if (score !== null) scored.push({ command, score, order });
  });

  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((entry) => entry.command);
}
