/**
 * `/` command detection and ranking: the positional trigger rule, the length
 * and line-break guards, and the score order the menu rows rely on.
 */
import { describe, expect, it } from "vitest";
import {
  FORMATTING_COMMANDS,
  SLASH_DEFAULT_LIMIT,
  SLASH_MAX_QUERY_LENGTH,
  detectSlashQuery,
  rankCommands,
  type FormattingCommand,
} from "./formattingCommands";

describe("detectSlashQuery", () => {
  it("opens a query at the start of a line", () => {
    expect(detectSlashQuery("/")).toEqual({ start: 0, query: "", end: 1 });
    expect(detectSlashQuery("/bold")).toEqual({ start: 0, query: "bold", end: 5 });
  });

  it("opens a query after leading indentation", () => {
    expect(detectSlashQuery("   /bo")).toEqual({ start: 3, query: "bo", end: 6 });
    expect(detectSlashQuery("\t/bo")).toEqual({ start: 1, query: "bo", end: 4 });
    expect(detectSlashQuery("\u00a0/bo")).toEqual({ start: 1, query: "bo", end: 4 });
  });

  it("scopes the trigger to the last line", () => {
    expect(detectSlashQuery("intro\n/quote")).toEqual({ start: 6, query: "quote", end: 12 });
    // A break before the slash resets the line, so earlier prose cannot veto it.
    expect(detectSlashQuery("some words\n   /h1")).toEqual({ start: 14, query: "h1", end: 17 });
    // A break after the slash leaves no trigger on the last line.
    expect(detectSlashQuery("/bo\nld")).toBeNull();
  });

  it("ignores a slash in mid-sentence", () => {
    expect(detectSlashQuery("hello /bold")).toBeNull();
    expect(detectSlashQuery("and/or")).toBeNull();
    expect(detectSlashQuery("3 / 4")).toBeNull();
  });

  it("ignores a slash inside a URL or path", () => {
    expect(detectSlashQuery("https://example.com")).toBeNull();
    expect(detectSlashQuery("see https://example.com/x")).toBeNull();
    expect(detectSlashQuery("/usr/local/bin")).toBeNull();
  });

  it("ignores a slash inside a date", () => {
    expect(detectSlashQuery("12/03/2026")).toBeNull();
    expect(detectSlashQuery("1/2")).toBeNull();
  });

  it("treats a doubled slash as an escaped literal", () => {
    expect(detectSlashQuery("//bold")).toBeNull();
    expect(detectSlashQuery("  //bold")).toBeNull();
  });

  it("ignores a second slash typed into the query", () => {
    expect(detectSlashQuery(" /a/b")).toBeNull();
  });

  it("keeps a query at the length limit and rejects one past it", () => {
    const atLimit = "/" + "a".repeat(SLASH_MAX_QUERY_LENGTH);
    expect(detectSlashQuery(atLimit)).toEqual({
      start: 0,
      query: "a".repeat(SLASH_MAX_QUERY_LENGTH),
      end: SLASH_MAX_QUERY_LENGTH + 1,
    });
    expect(detectSlashQuery("/" + "a".repeat(SLASH_MAX_QUERY_LENGTH + 1))).toBeNull();
  });

  it("rejects a query carrying a carriage return", () => {
    expect(detectSlashQuery("/bo\rld")).toBeNull();
  });

  it("reports offsets that slice back to the trigger and query", () => {
    for (const textBefore of ["/", "/bold", "  /heading 1", "first line\n  /list.bullet", "\u00a0/quote"]) {
      const found = detectSlashQuery(textBefore);
      expect(found).not.toBeNull();
      if (!found) continue;
      expect(textBefore.slice(found.start, found.end)).toBe("/" + found.query);
      expect(found.end).toBe(textBefore.length);
    }
  });
});

const PROBE: ReadonlyArray<FormattingCommand> = [
  { id: "x.nine", label: "Nothing", aliases: ["zzz"], group: "text" },
  { id: "x.skate", label: "Zed eight", aliases: [], group: "text" },
  { id: "x.seven", label: "Zed seven", aliases: ["bazooka"], group: "text" },
  { id: "x.six", label: "Okapi", aliases: [], group: "text" },
  { id: "x.kaleidoscope", label: "Zed five", aliases: [], group: "text" },
  { id: "x.four", label: "Zed four", aliases: ["kayak"], group: "text" },
  { id: "x.three", label: "Karma editor", aliases: [], group: "text" },
  { id: "x.two", label: "Ka", aliases: [], group: "text" },
  { id: "x.one", label: "Zed one", aliases: ["ka"], group: "text" },
  { id: "ka", label: "Zed", aliases: [], group: "text" },
];

describe("rankCommands", () => {
  it("returns the catalogue in declaration order for an empty query", () => {
    const all = rankCommands("", { limit: FORMATTING_COMMANDS.length });
    expect(all.map((command) => command.id)).toEqual(FORMATTING_COMMANDS.map((command) => command.id));
  });

  it("treats a whitespace-only query as empty", () => {
    expect(rankCommands("   ", { limit: 4 })).toEqual(rankCommands("", { limit: 4 }));
  });

  it("caps the result at the default limit", () => {
    const ranked = rankCommands("");
    expect(ranked).toHaveLength(SLASH_DEFAULT_LIMIT);
    expect(ranked.map((command) => command.id)).toEqual(
      FORMATTING_COMMANDS.slice(0, SLASH_DEFAULT_LIMIT).map((command) => command.id),
    );
  });

  it("honours an explicit limit", () => {
    expect(rankCommands("", { limit: 3 }).map((command) => command.id)).toEqual([
      "undo",
      "redo",
      "block.body",
    ]);
    expect(rankCommands("", { limit: 0 })).toEqual([]);
  });

  it("orders id exact, alias exact, label exact, prefixes, then contains", () => {
    expect(rankCommands("ka", { commands: PROBE, limit: 20 }).map((command) => command.id)).toEqual([
      "ka",
      "x.one",
      "x.two",
      "x.three",
      "x.four",
      "x.kaleidoscope",
      "x.six",
      "x.seven",
      "x.skate",
    ]);
  });

  it("breaks score ties by catalogue order", () => {
    expect(rankCommands("head", { limit: 5 }).map((command) => command.id)).toEqual([
      "block.h1",
      "block.h2",
      "block.h3",
    ]);
  });

  it("ranks an exact id above an alias or id tail", () => {
    expect(rankCommands("list.bullet")[0]?.id).toBe("list.bullet");
    expect(rankCommands("bullet")[0]?.id).toBe("list.bullet");
  });

  it("matches the id tail after the namespace", () => {
    expect(rankCommands("h1")[0]?.id).toBe("block.h1");
    expect(rankCommands("body")[0]?.id).toBe("block.body");
  });

  it("matches ids, labels and aliases case-insensitively", () => {
    expect(rankCommands("BOLD")[0]?.id).toBe("bold");
    expect(rankCommands("Strong")[0]?.id).toBe("bold");
    expect(rankCommands("HEADING 2")[0]?.id).toBe("block.h2");
  });

  it("matches a query with an internal space as typed", () => {
    expect(rankCommands("heading 1")[0]?.id).toBe("block.h1");
    expect(rankCommands("numbered list")[0]?.id).toBe("list.number");
  });

  it("returns nothing for an unknown query", () => {
    expect(rankCommands("zzzz")).toEqual([]);
    expect(rankCommands("heading 9")).toEqual([]);
  });
});
