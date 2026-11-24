/**
 * Allowlist a media address must pass before it becomes a `src`.
 *
 * A preview is either a `blob:` object URL for a locally staged file or an
 * absolute `https:` remote URL (uploaded media, provider GIFs). Nothing else
 * is renderable media, so nothing else is accepted. The rule lives here, once,
 * with no React or component imports: a composer, a picker and a viewer all
 * reach the same answer without pulling a picker's module graph along.
 */

/**
 * Scheme of a media address, read from the parsed URL or "" when the value is
 * not an absolute URL at all.
 *
 * A prefix test is not a scheme check: `" JavaScript:alert(1)"`, `"HTTPS://…"`
 * and an unparseable string all disagree with what the browser would do with
 * the attribute. `new URL` answers the question the browser asks.
 */
function mediaScheme(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return "";
  }
}

/** The only two schemes a media address may use. */
export function isSafeMediaScheme(scheme: string): boolean {
  return scheme === "blob:" || scheme === "https:";
}

/** True for an absolute `https:` address (uploaded or provider media). */
export function isHttpsMediaUrl(value: string): boolean {
  return mediaScheme(value) === "https:";
}

/** True for a `blob:` object URL (a locally staged preview). */
export function isBlobMediaUrl(value: string): boolean {
  return mediaScheme(value) === "blob:";
}

/**
 * Safe `src` for a staged preview, or "" when it must not be rendered.
 *
 * A preview is either a `blob:` object URL for a locally staged file or an
 * absolute `https:` provider URL. Every other scheme — `javascript:`, `data:`,
 * `file:`, a protocol-relative `//host` — and any unparseable value resolves
 * to "" so the caller omits the attribute instead of handing it to the
 * element. The href is the parsed one, so the caller never re-serialises it.
 */
export function safeMediaSrc(value: string): string {
  try {
    const url = new URL(value);
    return isSafeMediaScheme(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
