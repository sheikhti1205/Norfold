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
    let converted = token;
    for (const [emoticon, emoji] of EMOTICONS) {
      const pattern = new RegExp(
        // Longest-first ordering above keeps `:-)` from being read as `:-` + `)`.
        `(?<!${NOT_AFTER.source})${escapeRegExp(emoticon)}(?!${WORD.source})`,
        "g",
      );
      converted = converted.replace(pattern, emoji);
    }
    return converted;
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

const KEYCAP = /[0-9#*]\uFE0F?\u20E3/;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL_PAIR = /\p{Regional_Indicator}\p{Regional_Indicator}/u;

/**
 * True only when the entire message is emoji grapheme sequences and
 * whitespace. A message with any ordinary letter/digit/punctuation is not
 * emoji-only (so "123" never renders at double size).
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!PICTOGRAPHIC.test(trimmed) && !REGIONAL_PAIR.test(trimmed) && !KEYCAP.test(trimmed)) return false;
  // Every grapheme must be part of an emoji sequence or whitespace. Building
  // the character class from the standard properties covers ZWJ, skin tones,
  // variation selectors, flags and keycaps without a third-party table.
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3|[0-9#*]|\p{Emoji_Component}|\s)+$/u.test(trimmed);
}
