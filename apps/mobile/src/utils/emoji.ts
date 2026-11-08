/**
 * Chat emoji behaviour.
 *
 * Text emoticons are normalised once, on the outgoing path, so local
 * persistence, sync, search and every device agree on the same body. Legacy
 * messages are never rewritten on read.
 *
 * Conversion is anchored rather than token-split: an emoticon converts when it
 * is not glued to a URL, path, handle or code span, and when it is not the
 * prefix of a longer word. `hi:)` converts; `https://x/a:)`, `me/a:)`,
 * `user@host:)`, `#tag:)` and `` `:)` `` do not.
 */
const EMOTICONS: ReadonlyArray<readonly [string, string]> = [
  [":-)", "🙂"],
  [":)", "🙂"],
  [":-D", "😃"],
  [":D", "😃"],
  [";-)", "😉"],
  [";)", "😉"],
  [":-(", "🙁"],
  [":(", "🙁"],
  [":-P", "😛"],
  [":P", "😛"],
  [":-p", "😛"],
  [":p", "😛"],
  ["<3", "❤️"],
];

/** Characters that mean "this is a URL, path, handle, tag or code". */
const NOT_AFTER = /[/\\@#`]/;
const WORD = /[\w/]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Spans that must never be rewritten: links, bare www hosts, emails, code. */
const PROTECTED = /(?:https?:\/\/|www\.)\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|`[^`]*`/g;

function convertSegment(segment: string): string {
  return segment.split(/(\s+)/).map((token) => {
    // A token carrying a path/URL/email/tag/code character is not prose.
    if (!token || /^\s+$/.test(token) || NOT_AFTER.test(token)) return token;
    return convertToken(token);
  }).join("");
}

/** Replace unambiguous textual emoticons; never touches URLs, emails or code. */
export function convertEmoticons(text: string): string {
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(PROTECTED)) {
    const at = match.index ?? 0;
    result += convertSegment(text.slice(cursor, at)) + match[0];
    cursor = at + match[0].length;
  }
  return result + convertSegment(text.slice(cursor));
}

/**
 * Live conversion for a composer.
 *
 * The send path converts once, but a messenger also converts as you type. The
 * risky part is the caret: replacing `:)` with 🙂 moves every later offset, so
 * the caller gets a mapped caret back. Three rules keep typing predictable:
 *
 *  - a token the caret sits inside is never rewritten (you are still typing it);
 *  - the token ending at the caret is deferred when it ends in a letter or
 *    digit, because `:p` may still become `:please` and `:D` may become `:Done`;
 *  - protected spans (URLs, emails, code) are untouched, exactly as on send.
 */
export function convertEmoticonsLive(text: string, caret: number): { text: string; caret: number } {
  const limit = Math.min(Math.max(caret, 0), text.length);
  let out = "";
  let cursor = 0;
  let mapped = limit;

  const convertProse = (segment: string, start: number) => {
    // Keep the separators so the rebuilt text is byte-identical outside matches.
    for (const part of segment.split(/(\s+)/)) {
      if (!part) continue;
      const partStart = start;
      const partEnd = start + part.length;
      const inside = limit > partStart && limit < partEnd;
      const atEnd = limit === partEnd;
      const whitespace = /^\s+$/.test(part);
      const deferrable = atEnd && /[\w]$/.test(part);
      const converted = whitespace || inside || deferrable || NOT_AFTER.test(part)
        ? part : convertToken(part);
      out += converted;
      if (partEnd <= limit) mapped += converted.length - part.length;
      start = partEnd;
    }
  };

  for (const match of text.matchAll(PROTECTED)) {
    const at = match.index ?? 0;
    convertProse(text.slice(cursor, at), cursor);
    out += match[0];
    cursor = at + match[0].length;
  }
  convertProse(text.slice(cursor), cursor);
  return { text: out, caret: mapped };
}

/** One token, already known to be prose. */
function convertToken(token: string): string {
  let converted = token;
  for (const [emoticon, emoji] of EMOTICONS) {
    // Longest-first ordering above keeps `:-)` from being read as `:-` + `)`.
    const pattern = new RegExp(
      `(?<!${NOT_AFTER.source})${escapeRegExp(emoticon)}(?!${WORD.source})`,
      "g",
    );
    converted = converted.replace(pattern, emoji);
  }
  return converted;
}

// A unit is a complete emoji: a keycap, a flag, or one base glyph. A base
// renders as emoji by default (`\p{Emoji_Presentation}`) or asks for that
// presentation with VS16; ZWJ joins, skin tones and tag sequences (England's
// flag) stay attached to their base.
const EMOJI_BASE = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)`;
const EMOJI_UNIT = String.raw`(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|${EMOJI_BASE}\uFE0F?\p{Emoji_Modifier}?[\u{E0020}-\u{E007F}]*(?:\u200D${EMOJI_BASE}\uFE0F?\p{Emoji_Modifier}?[\u{E0020}-\u{E007F}]*)*)`;
const EMOJI_ONLY = new RegExp(String.raw`^(?:\s*${EMOJI_UNIT})+\s*$`, "u");

/**
 * True only when the entire message is complete emoji sequences and
 * whitespace. A message with any ordinary letter, bare digit, punctuation or
 * text-presentation symbol ("123", "2👍", "©") is not emoji-only, so it keeps
 * its bubble instead of rendering at double size.
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && EMOJI_ONLY.test(trimmed);
}
