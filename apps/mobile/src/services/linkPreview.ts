import { PUBLIC_ORIGIN } from "../brand";
import { getSupabase } from "./supabaseClient";

/**
 * Automatic server metadata for ordinary chat links, beyond the fixed YouTube
 * provider and Norfold report cards.
 *
 * Owner decision 2026-11-20: a chat link fetches its preview automatically when
 * it becomes visible. The app itself never contacts the linked site: it POSTs
 * the normalized address to the Norfold metadata service, which performs the
 * bounded server-side fetch. The URL therefore never appears in a GET query and
 * this module never logs it.
 *
 * The contract is frozen for this client:
 *   POST https://findbackapp.social/api/link-preview
 *   x-norfold-authorization: Bearer <current Supabase access token>
 *   {"url":"<normalized https url>"}
 *   -> 200 {"url":"<the same url>","title":string|null,
 *           "description"?:string,"siteName"?:string,"imageDataUrl"?:string}
 *
 * The token travels in `x-norfold-authorization`, not `Authorization`: Azure
 * Static Web Apps overwrites the caller's Authorization header when it proxies
 * to managed Functions, and the custom header is the documented path.
 *
 * A null title, a non-2xx answer, a timeout and an abort all fall back to the
 * same honest result: no metadata. The caller still has the original safe link.
 */

export const LINK_PREVIEW_ENDPOINT = `${PUBLIC_ORIGIN}/api/link-preview`;
export const LINK_PREVIEW_MAX_URL_LENGTH = 2048;
export const LINK_PREVIEW_TIMEOUT_MS = 8_000;

const TITLE_MAX_LENGTH = 300;
const DESCRIPTION_MAX_LENGTH = 600;
const SITE_NAME_MAX_LENGTH = 80;
/** Bounded data image; roughly 256 KiB of decoded bytes plus the header. */
const IMAGE_DATA_URL_MAX_LENGTH = 350_000;
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/** Chat threads can mention many links; this keeps one account's cache small. */
const CACHE_LIMIT = 40;

export interface LinkPreview {
  /** Exactly the normalized request URL the service echoed back. */
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  imageDataUrl?: string;
}

export interface FetchLinkPreviewOptions {
  /** Consumer cancellation. One consumer never cancels another's request. */
  signal?: AbortSignal;
  /**
   * Explicit refresh: ignore a negative cache entry, still join a flight. The
   * chat card has no retry control; this survives for a caller-driven refresh.
   */
  force?: boolean;
}

interface CachedPreview {
  preview: LinkPreview | null;
  expiresAt: number;
}

interface InFlightRequest {
  key: string;
  generation: number;
  controller: AbortController;
  consumers: number;
  promise: Promise<LinkPreview | null>;
}

type AuthSdk = ReturnType<typeof getSupabase>;

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan", ".intranet", ".corp"];

const cache = new Map<string, CachedPreview>();
const inFlight = new Map<string, InFlightRequest>();

let listening = false;
let accountOwner: string | null = null;
let authGeneration = 0;

/**
 * Observe the canonical SDK only. It never signs anyone in or out and never
 * becomes a second auth owner; it fences cached and pending metadata when the
 * SDK account changes or signs out.
 */
function observeAuth(): void {
  if (listening) return;
  try {
    getSupabase().auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      // A SIGNED_OUT event always fences, even when the next identity is the
      // same account: the prior session's pending work must not fill the cache.
      if (event === "SIGNED_OUT" || next !== accountOwner) {
        accountOwner = next;
        authGeneration += 1;
        clearPreviewState();
      }
    });
    listening = true;
  } catch {
    // Unconfigured SDK: requests re-read the session and fail closed instead.
  }
}

function clearPreviewState(): void {
  for (const request of inFlight.values()) request.controller.abort();
  inFlight.clear();
  cache.clear();
}

function adoptOwner(accountId: string): number {
  if (accountId !== accountOwner) {
    accountOwner = accountId;
    authGeneration += 1;
    clearPreviewState();
  }
  return authGeneration;
}

function readSdk(): AuthSdk | null {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

async function readSession(sdk: AuthSdk): Promise<{ id: string; token: string } | null> {
  try {
    const { data, error } = await sdk.auth.getSession();
    const session = data.session;
    const id = session?.user.id;
    const token = session?.access_token?.trim();
    return !error && id && token ? { id, token } : null;
  } catch {
    return null;
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const first = octets[0]!;
  const second = octets[1]!;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 192 && second === 0)
    || (first === 198 && (second === 18 || second === 19));
}

function isPrivateIpv6(host: string): boolean {
  const raw = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!raw.includes(":")) return false;
  const value = raw.toLowerCase();
  if (value === "::" || value === "::1") return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return value.startsWith("fc") || value.startsWith("fd")
    || value.startsWith("fe8") || value.startsWith("fe9")
    || value.startsWith("fea") || value.startsWith("feb");
}

/** Obvious internal names are rejected here; the service stays authoritative. */
function isBlockedHost(host: string): boolean {
  const name = host.toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  // A bare single label has no public DNS suffix; it is an intranet name.
  if (!name.includes(".") && !name.includes(":")) return true;
  return isPrivateIpv4(name) || isPrivateIpv6(name);
}

function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The original safe destination, preserved for the anchor. HTTP is not upgraded:
 * a server that accepts HTTPS only must not receive an automatic request for a
 * pasted HTTP address, and the reader keeps the link they were given.
 */
export function safeLinkHref(href: string): string | null {
  if (typeof href !== "string") return null;
  const candidate = href.trim();
  if (candidate === "" || candidate.length > LINK_PREVIEW_MAX_URL_LENGTH) return null;
  if (hasControlOrSpace(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.hostname === "" || isBlockedHost(url.hostname)) return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * What may be sent to the service: HTTPS on the default port, no credentials,
 * no fragment, query preserved. `null` means no request at all.
 */
export function normalizePreviewUrl(href: string): string | null {
  const safe = safeLinkHref(href);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    if (url.protocol !== "https:") return null;
    // WHATWG already drops `:443`; any remaining port is a different service.
    if (url.port !== "") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function isPreviewableLink(href: string): boolean {
  return normalizePreviewUrl(href) !== null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text === "" || text.length > maxLength) return null;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return text;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return cleanText(value, maxLength) ?? undefined;
}

/**
 * Strict data URL only: no remote image URL, no SVG, no HTML, no markup.
 * Exported so the view can re-apply the same rule before it touches `src`; a
 * second layer matters because the type alone cannot stop a future caller from
 * passing an unvalidated string through.
 */
const DATA_IMAGE_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isAllowedPreviewImage(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= IMAGE_DATA_URL_MAX_LENGTH
    && DATA_IMAGE_PATTERN.test(value);
}

function cleanImage(value: unknown): string | undefined {
  return isAllowedPreviewImage(value) ? value : undefined;
}

/**
 * Validate the service answer as data. React escapes every string; nothing here
 * is ever treated as markup, and the service-returned URL is never used for
 * navigation. `title:null` is the contract's honest "unavailable".
 */
function parsePreviewPayload(payload: unknown, target: string): LinkPreview | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.url !== target) return null;
  const title = cleanText(record.title, TITLE_MAX_LENGTH);
  if (title === null) return null;
  return {
    url: target,
    title,
    description: optionalText(record.description, DESCRIPTION_MAX_LENGTH),
    siteName: optionalText(record.siteName, SITE_NAME_MAX_LENGTH),
    imageDataUrl: cleanImage(record.imageDataUrl),
  };
}

function trimCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function requestPreview(target: string, token: string, signal: AbortSignal): Promise<LinkPreview | null> {
  try {
    const response = await fetch(LINK_PREVIEW_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-norfold-authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ url: target }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      // A redirect could hand the bearer token, and the pasted address, to a
      // different origin. The endpoint is already the final HTTPS address, so
      // an unexpected redirect is a failure, not something to follow.
      redirect: "error",
      signal,
    });
    // 4xx/5xx, an unsafe redirect and an offline error are all the same
    // consumer outcome: the host-only link stays, with no retry loop.
    if (!response.ok) return null;
    // The whole answer is one bounded metadata object plus an optional 350k
    // data image; anything larger is not a response this client accepts.
    const raw = await response.text();
    if (raw.length > IMAGE_DATA_URL_MAX_LENGTH + 8_000) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    return parsePreviewPayload(payload, target);
  } catch {
    return null;
  }
}

/**
 * One shared flight per account+URL. A consumer's abort only removes that
 * consumer; the request is aborted when the last one leaves. Cache fill is
 * fenced by the account and generation captured when the request started.
 */
function consume(request: InFlightRequest, signal?: AbortSignal): Promise<LinkPreview | null> {
  if (signal?.aborted) return Promise.resolve(null);
  request.consumers += 1;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: LinkPreview | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      if (settled) return;
      request.consumers -= 1;
      if (request.consumers <= 0) {
        if (inFlight.get(request.key) === request) inFlight.delete(request.key);
        request.controller.abort();
      }
      finish(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    request.promise.then(finish, () => finish(null));
  });
}

async function startRequest(
  sdk: AuthSdk,
  owner: string,
  token: string,
  generation: number,
  target: string,
  signal?: AbortSignal,
): Promise<LinkPreview | null> {
  const key = `${owner}\u0000${target}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LINK_PREVIEW_TIMEOUT_MS);
  const request: InFlightRequest = {
    key,
    generation,
    controller,
    consumers: 0,
    promise: Promise.resolve(null),
  };
  request.promise = (async () => {
    const preview = await requestPreview(target, token, controller.signal);
    // A request cancelled because its last consumer left is not a provider
    // failure and must not seed the negative cache.
    if (controller.signal.aborted && !timedOut) return null;
    const finished = await readSession(sdk);
    if (!finished || finished.id !== owner || generation !== authGeneration) return null;
    cache.set(key, {
      preview,
      expiresAt: Date.now() + (preview ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
    trimCache(Date.now());
    return preview;
  })().finally(() => {
    clearTimeout(timer);
    // A late finish from an older request must never delete the current flight
    // for the same key (for example after an account switch and a new request).
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return consume(request, signal);
}

/**
 * Read or request metadata for one link. Resolves to `null` for every
 * non-preview outcome: invalid/unsupported address, no session, cancellation,
 * timeout, provider failure or malformed answer. It never throws and never
 * touches storage, the network for display, or the DOM.
 */
export async function fetchLinkPreview(
  href: string,
  options: FetchLinkPreviewOptions = {},
): Promise<LinkPreview | null> {
  const target = normalizePreviewUrl(href);
  if (!target) return null;
  const signal = options.signal;
  if (signal?.aborted) return null;

  observeAuth();
  const sdk = readSdk();
  if (!sdk) return null;
  const started = await readSession(sdk);
  if (!started) return null;
  if (signal?.aborted) return null;

  const generation = adoptOwner(started.id);
  const key = `${started.id}\u0000${target}`;
  const now = Date.now();
  if (!options.force) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.preview;
  }

  const shared = inFlight.get(key);
  if (shared && shared.generation === authGeneration) return consume(shared, signal);

  return startRequest(sdk, started.id, started.token, generation, target, signal);
}
