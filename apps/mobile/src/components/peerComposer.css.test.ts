// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static contract for the R19 dock composer at 320dp.
 *
 * The served build at 320px with a 32px root left the chat dock's textarea about
 * 108 CSS px wide, so a 27-character draft painted as "r19 / comp" over clipped
 * lines. jsdom has no container queries and no layout engine, so this file
 * pins the declared mechanism only: below 20rem the field owns the whole first
 * row, the attachment tray and the trailing controls keep a second row of real
 * targets with Send at the trailing edge, the wide flex row is unchanged, the
 * documented DOM order (tray, field, picker trigger, Send) holds, and the
 * field's over-cap draft stays scrollable instead of hidden. Rendered geometry
 * remains a deployed-browser acceptance item, not a claim from here.
 *
 * The tray and the docked picker live in the shared sheet the composer
 * imports, so the narrow placement is declared there, not in this one.
 */
const css = readFileSync(new URL("./peerComposer.css", import.meta.url), "utf8");
const dockCss = readFileSync(new URL("./composerDock.css", import.meta.url), "utf8");
const composerTsx = readFileSync(new URL("./PeerChatComposer.tsx", import.meta.url), "utf8");

/** Comments removed and whitespace collapsed, so checks ignore line wrapping. */
const flat = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");
const dockFlat = dockCss.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");
const tsxFlat = composerTsx.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

const QUERY = "@container composer (max-width: 20rem)";

/** The narrow block's contents, matched by balanced braces. */
function containerBody(source: string) {
  const start = source.indexOf(QUERY);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

/** One selector's declaration body in flat source. No body here nests braces. */
function body(selector: string, source: string) {
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${selector} {`, from);
    if (at < 0) return "";
    const boundary = at === 0 ? "" : source[at - 1]!;
    if (boundary === "" || /[\s;}]/.test(boundary)) {
      const open = source.indexOf("{", at);
      const close = source.indexOf("}", open);
      return close < 0 ? "" : source.slice(open + 1, close);
    }
    from = at + selector.length;
  }
}

const narrow = containerBody(flat);
const wide = flat.slice(0, flat.indexOf(QUERY));
const dockNarrow = containerBody(dockFlat);

describe("peer composer narrow container layout", () => {
  it("gives the field the whole first row in the narrow query", () => {
    expect(flat).toContain(QUERY);
    const field = body(".fb-peer-field", narrow);
    expect(field).toContain("grid-column: 1 / -1;");
    expect(field).toContain("grid-row: 1;");
    // The row is a grid only inside the query; the field's own surface is not
    // repainted with a frame, background or second border.
    const row = body(".fb-peer-composer-row", narrow);
    expect(row).toContain("display: grid;");
    expect(field).not.toMatch(/border/);
    expect(row).not.toMatch(/border|background|box-shadow/);
  });

  it("keeps every action at a real target with Send at the trailing edge", () => {
    // The row's controls are the attachment tray, the picker trigger and Send.
    // The voice slot moved into the tray, so the shipped narrow band places
    // three tracks; the shared sheet declares that and outranks this sheet's
    // still-present four-column rule on specificity.
    const row = body(".fb-peer-composer .fb-peer-composer-row", dockNarrow);
    expect(row).toContain("grid-template-columns: minmax(0, 1fr) auto auto;");
    const tray = body(".fb-peer-composer-row .fb-attachment-tray", dockNarrow);
    expect(tray).toContain("grid-column: 1;");
    expect(tray).toContain("grid-row: 2;");
    const trigger = body(".fb-peer-composer-row .fb-peer-icon:not(.fb-peer-send)", dockNarrow);
    expect(trigger).toContain("grid-column: 2;");
    expect(trigger).toContain("grid-row: 2;");
    const send = body(".fb-peer-composer-row .fb-peer-send", dockNarrow);
    expect(send).toContain("grid-column: 3;");
    expect(send).toContain("justify-self: end;");
    // Every action still declares a real target: the row icons keep 48px and
    // the tray keeps Messenger's measured 44px disclosure and 40px shortcuts
    // instead of the old one-size row shrink.
    const icon = body(".fb-peer-icon", wide);
    expect(icon).toContain("min-width: 48px;");
    expect(icon).toContain("min-height: 48px;");
    const disclosure = body(".fb-attachment-disclosure", dockFlat);
    expect(disclosure).toContain("width: 44px;");
    expect(disclosure).toContain("height: 44px;");
    const shortcut = body(".fb-attachment-shortcut", dockFlat);
    expect(shortcut).toContain("width: 40px;");
    expect(shortcut).toContain("height: 40px;");
    // The narrow band squeezes no target below the size its sheet declares.
    expect(dockNarrow).not.toMatch(/min-(?:width|height):\s*\d+px/);
    expect(narrow).not.toMatch(/min-width:\s*40px/);
  });

  it("leaves the wide single row exactly as it was", () => {
    const row = body(".fb-peer-composer-row", wide);
    expect(row).toContain("display: flex;");
    expect(row).toContain("align-items: flex-end;");
    expect(row).toContain("gap: 4px;");
    expect(row).toContain("padding: 4px;");
    expect(row).not.toContain("grid");
    const field = body(".fb-peer-field", wide);
    expect(field).toContain("flex: 1;");
    expect(field).not.toContain("grid");
    // One query, one narrow branch: nothing outside it changes the row.
    expect(flat.match(/@container composer/g)?.length).toBe(1);
  });

  it("keeps an over-cap draft scrollable instead of hidden", () => {
    const textarea = body(".fb-peer-field textarea", wide);
    expect(textarea).toContain("min-height: 48px;");
    expect(textarea).toContain("max-height: 160px;");
    // The component sets `overflow-y: hidden` inline while blurred; the
    // stylesheet has to outrank that inline value or the draft stays clipped.
    expect(textarea).toContain("overflow-y: auto !important;");
    expect(textarea).not.toMatch(/overflow(?:-y)?:\s*hidden/);
    expect(flat).not.toMatch(/\.fb-peer-field textarea[^{]*\{[^}]*overflow(?:-y)?:\s*hidden/);
    // Height stays the component's single owner: no CSS height, only the bound.
    expect(textarea).not.toMatch(/(?:^|;)\s*height:/);
  });

  it("keeps the documented DOM order, so tab order and names do not move", () => {
    // Tray, field, picker trigger, Send. Voice is one of the tray's shortcuts
    // now, never a fifth control between the trigger and Send.
    const attach = tsxFlat.indexOf('label="Add attachment"');
    const field = tsxFlat.indexOf('className="fb-peer-field"');
    const expressions = tsxFlat.indexOf("<ExpressionDockTrigger");
    const send = tsxFlat.indexOf('aria-label="Send message"');
    expect(attach).toBeGreaterThan(-1);
    expect(attach).toBeLessThan(field);
    expect(field).toBeLessThan(expressions);
    expect(expressions).toBeLessThan(send);
    // The option list, not the row, owns voice; the standalone microphone the
    // old row carried has no control of its own.
    const options = tsxFlat.indexOf("const attachmentOptions");
    expect(tsxFlat.indexOf('label: "Voice note"')).toBeGreaterThan(options);
    expect(tsxFlat).not.toContain('aria-label="Voice message"');
    // The docked picker renders after the row inside the same form, so it can
    // never stand between the field and Send.
    expect(send).toBeLessThan(tsxFlat.indexOf("{dock.open && ("));
    // The second row comes from CSS placement only: one row element remains.
    expect(tsxFlat.match(/className="fb-peer-composer-row"/g)?.length).toBe(1);
  });
});
