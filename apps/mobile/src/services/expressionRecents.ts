import type { KlipyItem } from "./klipy";

/**
 * Recently used emoji, GIFs and stickers.
 *
 * One picker holds all three and remembers what
 * this device used last. The history is device-local by design: it lives in
 * `localStorage` under one key and never travels to the account, another
 * device or the server. A storage that refuses (private mode, a full quota) is
 * not an error — the picker simply shows no history.
 *
 * Only the fields the composer can send again are kept; a provider payload is
 * not history. Reads validate every entry because this store is user-writable.
 */
export type ExpressionRecent =
  | { type: "emoji"; key: string; emoji: string }
  | { type: "klipy"; key: string; item: Omit<KlipyItem, "raw"> };

export const EXPRESSION_RECENTS_KEY = "findback.expression_recents";
export const EXPRESSION_RECENTS_LIMIT = 16;

function store(): Storage | null {
  try {
    const candidate = globalThis.localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function isHttpsKlipyUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "klipy.com" || host.endsWith(".klipy.com");
  } catch {
    return false;
  }
}

function parseItem(value: unknown): Omit<KlipyItem, "raw"> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind;
  if (kind !== "gifs" && kind !== "stickers") return null;
  if (typeof row.slug !== "string" || row.slug.length === 0 || row.slug.length > 200) return null;
  if (typeof row.mediaUrl !== "string" || !isHttpsKlipyUrl(row.mediaUrl)) return null;
  const preview = typeof row.previewUrl === "string" && isHttpsKlipyUrl(row.previewUrl) ? row.previewUrl : row.mediaUrl;
  const width = typeof row.width === "number" && Number.isFinite(row.width) && row.width > 0 ? row.width : undefined;
  const height = typeof row.height === "number" && Number.isFinite(row.height) && row.height > 0 ? row.height : undefined;
  const title = typeof row.title === "string" && row.title.trim() ? row.title.trim().slice(0, 200) : "GIF";
  return {
    kind,
    slug: row.slug,
    title,
    mediaUrl: row.mediaUrl,
    previewUrl: preview,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

export function parseExpressionRecents(raw: unknown): ExpressionRecent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExpressionRecent[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    let next: ExpressionRecent | null = null;
    if (row.type === "emoji" && typeof row.emoji === "string" && row.emoji.length > 0 && row.emoji.length <= 32) {
      next = { type: "emoji", key: `emoji:${row.emoji}`, emoji: row.emoji };
    } else if (row.type === "klipy") {
      const item = parseItem(row.item);
      if (item) next = { type: "klipy", key: `klipy:${item.kind}:${item.slug}`, item };
    }
    if (!next || seen.has(next.key)) continue;
    seen.add(next.key);
    out.push(next);
    if (out.length >= EXPRESSION_RECENTS_LIMIT) break;
  }
  return out;
}

export function readExpressionRecents(): ExpressionRecent[] {
  const storage = store();
  if (!storage) return [];
  try {
    const raw = storage.getItem(EXPRESSION_RECENTS_KEY);
    if (!raw) return [];
    return parseExpressionRecents(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function rememberExpression(recent: ExpressionRecent): ExpressionRecent[] {
  const next = [recent, ...readExpressionRecents().filter((item) => item.key !== recent.key)]
    .slice(0, EXPRESSION_RECENTS_LIMIT);
  const storage = store();
  if (storage) {
    try {
      storage.setItem(EXPRESSION_RECENTS_KEY, JSON.stringify(next));
    } catch {
      // History is a convenience, never a reason to fail a pick.
    }
  }
  return next;
}

export function rememberedEmoji(emoji: string): ExpressionRecent {
  return { type: "emoji", key: `emoji:${emoji}`, emoji };
}

export function rememberedKlipy(item: KlipyItem): ExpressionRecent {
  return {
    type: "klipy",
    key: `klipy:${item.kind}:${item.slug}`,
    item: {
      kind: item.kind,
      slug: item.slug,
      title: item.title,
      mediaUrl: item.mediaUrl,
      previewUrl: item.previewUrl,
      ...(item.width !== undefined ? { width: item.width } : {}),
      ...(item.height !== undefined ? { height: item.height } : {}),
    },
  };
}
