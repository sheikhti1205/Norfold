import { extractYouTubeId } from "@norfold/shared";
import { parseReportLink } from "./reportLinks";

/**
 * R19-2 plain-text link segmentation.
 *
 * Pure and synchronous: no fetch, DOM, storage, media request or preview
 * rendering. Input is text that is already allowed to be visible (ordinary
 * body or an accepted caption); serialized-media filtering belongs to the
 * caller. Segment text always concatenates back to the original body exactly.
 */
export type ChatTextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; reportId?: string; youtubeId?: string };

export interface ChatTextLinkOptions {
  /** Canonical share origin for report links; defaults to the app's configured one. */
  reportOrigin?: string;
}

const HTTPS_SCHEME = "https://";
const HTTP_SCHEME = "http://";
/** A scheme may begin after whitespace or an opening wrapper/punctuation mark. */
const LEADING_BOUNDARIES = "([{<\"'\u2018\u201C:,;";
const TRAILING_PUNCTUATION = new Set([".", ",", "!", ";", ":", "…", "»", "›", "’", "”", "'", "\""]);
const BRACKET_PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
/** JS whitespace, so a URL ends exactly where a link is allowed to start. */
const URL_WHITESPACE = /\s/;

function lowerAscii(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

function matchesScheme(body: string, index: number, scheme: string): boolean {
  if (index + scheme.length > body.length) return false;
  for (let offset = 0; offset < scheme.length; offset++) {
    if (lowerAscii(body.charCodeAt(index + offset)) !== lowerAscii(scheme.charCodeAt(offset))) {
      return false;
    }
  }
  return true;
}

function isLinkStart(body: string, index: number): boolean {
  const code = body.charCodeAt(index);
  if (code !== 0x68 && code !== 0x48) return false;
  if (index > 0) {
    const previous = body[index - 1]!;
    if (!URL_WHITESPACE.test(previous) && !LEADING_BOUNDARIES.includes(previous)) return false;
  }
  return matchesScheme(body, index, HTTPS_SCHEME) || matchesScheme(body, index, HTTP_SCHEME);
}

/** Raw URL characters stop at whitespace (Unicode included), controls, quotes, brackets and angle quotes. */
function isUrlStop(char: string): boolean {
  if (URL_WHITESPACE.test(char)) return true;
  const code = char.charCodeAt(0);
  return code <= 0x20 || code === 0x7f
    || code === 0x22 || code === 0x27 || code === 0x3c || code === 0x3e
    || code === 0x5c || code === 0x60;
}

function scanUrlEnd(body: string, start: number): number {
  let end = start;
  while (end < body.length && !isUrlStop(body[end]!)) end++;
  return end;
}

/**
 * Drop prose punctuation that followed the URL, never part of it. A closing
 * bracket is removed only while it is unbalanced, so a legitimate path such as
 * `/wiki/Rust_(programming_language)` keeps its own parenthesis.
 */
function trimUrlEnd(candidate: string): string {
  let end = candidate.length;
  const counts: Record<string, number> = { "(": 0, ")": 0, "[": 0, "]": 0, "{": 0, "}": 0 };
  for (let index = 0; index < end; index++) {
    const char = candidate[index]!;
    if (char in counts) counts[char] = counts[char]! + 1;
  }
  const firstQuestion = candidate.indexOf("?");
  for (;;) {
    if (end === 0) break;
    const char = candidate[end - 1]!;
    const open = BRACKET_PAIRS[char];
    if (open !== undefined) {
      if (counts[char]! > counts[open]!) {
        counts[char] = counts[char]! - 1;
        end--;
        continue;
      }
      break;
    }
    // A final `?` is prose unless the URL already opened a query.
    if (char === "?") {
      if (firstQuestion !== end - 1) break;
      end--;
      continue;
    }
    if (!TRAILING_PUNCTUATION.has(char)) break;
    end--;
  }
  return candidate.slice(0, end);
}

/** Only an uncredentialed http(s) URL with a host, kept exactly as written. */
function isSafeHttpUrl(candidate: string): boolean {
  // A C0 control or DEL never belongs in a link. The scan above already stops
  // there, so this stays as the last guard on the exact candidate.
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function classifyLink(href: string, reportOrigin?: string): ChatTextSegment | null {
  if (!isSafeHttpUrl(href)) return null;
  const report = parseReportLink(href, reportOrigin);
  if (report) return { kind: "link", text: href, href, reportId: report.postId };
  const youtubeId = extractYouTubeId(href);
  return youtubeId
    ? { kind: "link", text: href, href, youtubeId }
    : { kind: "link", text: href, href };
}

/**
 * Split a visible chat body into exact text and safe link segments. Links that
 * repeat stay separate: deduplicating cards by `reportId`/`youtubeId` belongs
 * to the renderer that already owns those cards.
 */
export function segmentChatTextLinks(body: string, options: ChatTextLinkOptions = {}): ChatTextSegment[] {
  const segments: ChatTextSegment[] = [];
  let textStart = 0;
  let index = 0;
  while (index < body.length) {
    if (!isLinkStart(body, index)) {
      index++;
      continue;
    }
    const rawEnd = scanUrlEnd(body, index);
    const candidate = trimUrlEnd(body.slice(index, rawEnd));
    const link = classifyLink(candidate, options.reportOrigin);
    if (!link) {
      // Skip the failed run instead of rescanning it, keeping the scan linear.
      index = Math.max(index + 1, rawEnd);
      continue;
    }
    if (index > textStart) segments.push({ kind: "text", text: body.slice(textStart, index) });
    segments.push(link);
    index += candidate.length;
    textStart = index;
  }
  if (textStart < body.length) segments.push({ kind: "text", text: body.slice(textStart) });
  return segments;
}
