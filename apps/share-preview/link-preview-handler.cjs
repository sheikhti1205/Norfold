/* global AbortController, URL, setTimeout, clearTimeout */
'use strict';

// Automatic link metadata service. It accepts one HTTPS URL authenticated by
// `x-norfold-authorization: Bearer <Supabase access token>`, with a plain
// `Authorization` header accepted as a fallback. The custom header is the
// caller-facing contract because Azure Static Web Apps overwrites
// `Authorization` when it proxies to managed Functions. The service performs
// its own bounded fetch and answers with a small title/description/site-name
// payload plus an optional bounded data image. Plaintext only: it never runs
// page JavaScript, never forwards caller headers, never logs or reflects a
// token, and never echoes a URL in an error body.

const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const {
  AUTH_TIMEOUT_MS,
  DNS_TIMEOUT_MS,
  HTML_TIMEOUT_MS,
  IMAGE_TIMEOUT_MS,
  MAX_REDIRECTS,
  REDIRECT_STATUS,
  WALL_TIMEOUT_MS,
  createLinkFetcher,
  normalizeTarget,
} = require('./lib/link-fetch.cjs');
const { validConfig } = require('./handler.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_HEADER = 'x-norfold-authorization';
const ALLOWED_ORIGINS = new Set([
  'https://findbackapp.social',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MAX_BODY_BYTES = 4096;
const AUTH_MAX_BYTES = 16 * 1024;
const TITLE_MAX_LENGTH = 300;
const DESCRIPTION_MAX_LENGTH = 600;
const SITE_NAME_MAX_LENGTH = 80;
const IMAGE_DATA_URL_MAX_LENGTH = 350000;
const IMAGE_MAX_DIMENSION = 4096;
const IMAGE_MAX_PIXELS = 16 * 1024 * 1024;

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_LIMITS = {
  wallMs: WALL_TIMEOUT_MS,
  authMs: AUTH_TIMEOUT_MS,
  dnsMs: DNS_TIMEOUT_MS,
  htmlMs: HTML_TIMEOUT_MS,
  imageMs: IMAGE_TIMEOUT_MS,
  maxConcurrent: 6,
  rateCapacity: 5,
  rateRefillPerMs: 10 / 60000,
  rateIdleMs: 10 * 60 * 1000,
  rateUsers: 500,
  cachePerAccount: 40,
  cacheBytes: 16 * 1024 * 1024,
  cacheEntries: 20000,
};

function readHeader(request, name) {
  const headers = request && request.headers ? request.headers : {};
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function baseHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-norfold-authorization, sentry-trace, baggage',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function jsonResponse(status, payload, origin, extra) {
  const headers = { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' };
  if (origin !== null) Object.assign(headers, corsHeaders(origin));
  if (extra) Object.assign(headers, extra);
  return { status, headers, body: JSON.stringify(payload) };
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '' || text.length > maxLength) return null;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return text;
}

function cacheKey(accountId, url) {
  return createHash('sha256').update(accountId).update('\n').update(url).digest('hex');
}

async function readBoundedFetchText(response, maxBytes) {
  const body = response && response.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    return Buffer.byteLength(text) > maxBytes ? null : text;
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      total += buffer.length;
      if (total > maxBytes) return null;
      chunks.push(buffer);
    }
  } catch {
    return null;
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function defaultAuth(token, config, context) {
  const budget = Math.min(context.limits.authMs, context.deadline - context.now());
  if (!(budget > 0)) return null;
  const controller = new AbortController();
  let settled = false;
  return new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      context.timers.clearTimeout(timer);
      resolve(value);
    };
    const timer = context.timers.setTimeout(() => {
      try { controller.abort(); } catch { /* already done */ }
      finish(null);
    }, budget);
    (async () => {
      try {
        // The caller's token and the publishable key are sent here and only
        // here. This result is never cached.
        const response = await context.fetchImpl(`${config.url}/auth/v1/user`, {
          method: 'GET',
          headers: { apikey: config.key, Authorization: `Bearer ${token}` },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response || !response.ok) return finish(null);
        const text = await readBoundedFetchText(response, AUTH_MAX_BYTES);
        if (text === null) return finish(null);
        const payload = JSON.parse(text);
        // GoTrue returns the user object directly; accept the wrapped SDK
        // shape too, but trust only a UUID id.
        const id = payload && (payload.user && payload.user.id ? payload.user.id : payload.id);
        finish(typeof id === 'string' && UUID.test(id) ? id : null);
      } catch {
        finish(null);
      }
    })();
  });
}

function createLinkPreviewHandler(deps = {}) {
  const timers = deps.timers || { setTimeout, clearTimeout };
  const now = deps.now || Date.now;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const limits = { ...DEFAULT_LIMITS, ...(deps.limits || {}) };
  const fetcher = deps.fetcher || createLinkFetcher({ resolve: deps.resolve, request: deps.request, timers });

  const cache = new Map();
  let cacheBytes = 0;
  const flights = new Map();
  const buckets = new Map();
  let active = 0;

  function removeCacheEntry(key) {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    cacheBytes -= entry.bytes;
    if (cacheBytes < 0) cacheBytes = 0;
  }

  function trimCache(accountId) {
    let owned = 0;
    for (const entry of cache.values()) if (entry.accountId === accountId) owned += 1;
    while (owned > limits.cachePerAccount) {
      let removed = false;
      for (const [key, entry] of cache) {
        if (entry.accountId !== accountId) continue;
        removeCacheEntry(key);
        owned -= 1;
        removed = true;
        break;
      }
      if (!removed) break;
    }
    while (cache.size > limits.cacheEntries) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      removeCacheEntry(oldest.value);
    }
    while (cacheBytes > limits.cacheBytes) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      removeCacheEntry(oldest.value);
    }
  }

  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      removeCacheEntry(key);
      return undefined;
    }
    return entry.payload;
  }

  function cacheSet(key, accountId, payload) {
    const bytes = payload ? Buffer.byteLength(JSON.stringify(payload)) : 32;
    removeCacheEntry(key);
    cache.set(key, {
      accountId,
      payload,
      bytes,
      expiresAt: now() + (payload ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
    cacheBytes += bytes;
    trimCache(accountId);
  }

  function pruneBuckets(time) {
    for (const [accountId, bucket] of buckets) {
      if (time - bucket.updated >= limits.rateIdleMs) buckets.delete(accountId);
    }
    while (buckets.size >= limits.rateUsers) {
      let oldestKey = null;
      let oldestValue = Infinity;
      for (const [accountId, bucket] of buckets) {
        if (bucket.updated < oldestValue) {
          oldestValue = bucket.updated;
          oldestKey = accountId;
        }
      }
      if (oldestKey === null) break;
      buckets.delete(oldestKey);
    }
  }

  function consumeRate(accountId, time) {
    pruneBuckets(time);
    const existing = buckets.get(accountId);
    if (!existing) {
      buckets.set(accountId, { tokens: limits.rateCapacity - 1, updated: time });
      return true;
    }
    const elapsed = Math.max(0, time - existing.updated);
    const tokens = Math.min(limits.rateCapacity, existing.tokens + elapsed * limits.rateRefillPerMs);
    if (tokens < 1) {
      existing.tokens = tokens;
      existing.updated = time;
      return false;
    }
    existing.tokens = tokens - 1;
    existing.updated = time;
    return true;
  }

  function acquireSlot() {
    if (active >= limits.maxConcurrent) return false;
    active += 1;
    return true;
  }

  function releaseSlot() {
    active = Math.max(0, active - 1);
  }

  async function readTarget(target, kind, phaseMs, deadline, blockedHosts) {
    const phaseDeadline = Math.min(deadline, now() + phaseMs);
    let current = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const remaining = phaseDeadline - now();
      if (!(remaining > 0)) return null;
      const timeoutMs = Math.min(phaseMs, remaining);
      let response;
      try {
        response = await fetcher.fetchOnce(current, {
          kind,
          timeoutMs,
          dnsTimeoutMs: Math.min(limits.dnsMs, timeoutMs),
        });
      } catch {
        return null;
      }
      if (REDIRECT_STATUS.has(response.status)) {
        if (hop === MAX_REDIRECTS) return null;
        const location = response.headers && response.headers.location;
        if (typeof location !== 'string') return null;
        let nextRaw;
        try {
          nextRaw = new URL(location, current.href).href;
        } catch {
          return null;
        }
        const next = normalizeTarget(nextRaw, blockedHosts);
        if (!next) return null;
        current = next;
        continue;
      }
      if (response.status < 200 || response.status > 299) return null;
      if (!response.body) return null;
      return {
        body: response.body,
        contentType: response.contentType,
        finalUrl: current.href,
      };
    }
    return null;
  }

  async function buildPreview(target, deadline, blockedHosts, parser) {
    const html = await readTarget(target, 'html', limits.htmlMs, deadline, blockedHosts);
    if (!html) return null;
    let metadata;
    try {
      metadata = parser.extractMetadata(html.body, { contentType: html.contentType, finalUrl: html.finalUrl });
    } catch {
      return null;
    }
    if (!metadata || typeof metadata !== 'object') return null;
    const title = cleanText(metadata.title, TITLE_MAX_LENGTH);
    // A missing title is the contract's honest "unavailable": do not keep a
    // half-filled preview whose only content is a description.
    if (!title) return null;

    const payload = { url: target.href, title };
    const description = cleanText(metadata.description, DESCRIPTION_MAX_LENGTH);
    if (description) payload.description = description;
    const siteName = cleanText(metadata.siteName, SITE_NAME_MAX_LENGTH);
    if (siteName) payload.siteName = siteName;

    if (typeof metadata.imageUrl === 'string' && metadata.imageUrl !== '') {
      const imageRemaining = deadline - now();
      if (imageRemaining > 0) {
        let imageTarget = null;
        try {
          imageTarget = normalizeTarget(new URL(metadata.imageUrl, html.finalUrl).href, blockedHosts);
        } catch {
          imageTarget = null;
        }
        if (imageTarget) {
          const image = await readTarget(imageTarget, 'image', limits.imageMs, deadline, blockedHosts);
          if (image) {
            let info = null;
            try {
              info = parser.validatePreviewImage(image.body);
            } catch {
              info = null;
            }
            if (
              info
              && ALLOWED_IMAGE_MIME.has(info.mime)
              && Number.isInteger(info.width) && info.width > 0 && info.width <= IMAGE_MAX_DIMENSION
              && Number.isInteger(info.height) && info.height > 0 && info.height <= IMAGE_MAX_DIMENSION
              && info.width * info.height <= IMAGE_MAX_PIXELS
            ) {
              const dataUrl = `data:${info.mime};base64,${image.body.toString('base64')}`;
              if (dataUrl.length <= IMAGE_DATA_URL_MAX_LENGTH) payload.imageDataUrl = dataUrl;
            }
          }
        }
      }
    }
    return payload;
  }

  async function handle(request, config) {
    const deadline = now() + limits.wallMs;
    const req = request || {};
    const method = String(req.method || '').toUpperCase();

    const rawOrigin = readHeader(req, 'origin');
    let origin;
    if (rawOrigin === undefined || rawOrigin === '') {
      origin = '*';
    } else if (ALLOWED_ORIGINS.has(String(rawOrigin))) {
      origin = String(rawOrigin);
    } else {
      // Unknown origins get no CORS grant and no target work.
      return jsonResponse(403, { error: 'forbidden' }, null);
    }

    if (method === 'OPTIONS') {
      return { status: 204, headers: { ...baseHeaders(), ...corsHeaders(origin) }, body: '' };
    }
    if (method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' }, origin, { Allow: 'POST, OPTIONS' });
    }

    let query = '';
    try {
      query = new URL(String(req.url || ''), 'https://placeholder.invalid').search;
    } catch {
      query = '';
    }
    // A GET-style query proxy is not part of the contract.
    if (query !== '') return jsonResponse(400, { error: 'invalid_request' }, origin);

    const contentType = readHeader(req, 'content-type');
    if (!contentType || !/^application\/json\b/i.test(String(contentType))) {
      return jsonResponse(415, { error: 'unsupported_media_type' }, origin);
    }

    const declaredLength = readHeader(req, 'content-length');
    if (declaredLength !== undefined) {
      if (!/^\d+$/.test(String(declaredLength))) return jsonResponse(400, { error: 'invalid_request' }, origin);
      if (Number(declaredLength) > MAX_BODY_BYTES) return jsonResponse(413, { error: 'payload_too_large' }, origin);
    }

    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : (typeof req.body === 'string' ? req.body : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null));
    if (rawBody !== null && Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: 'payload_too_large' }, origin);
    }

    let parsed;
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      parsed = req.body;
    } else if (rawBody !== null) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return jsonResponse(400, { error: 'invalid_request' }, origin);
      }
    } else {
      return jsonResponse(400, { error: 'invalid_request' }, origin);
    }

    let serialized;
    try {
      serialized = JSON.stringify(parsed);
    } catch {
      return jsonResponse(400, { error: 'invalid_request' }, origin);
    }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: 'payload_too_large' }, origin);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse(400, { error: 'invalid_request' }, origin);
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== 'url' || typeof parsed.url !== 'string') {
      return jsonResponse(400, { error: 'invalid_request' }, origin);
    }

    if (!validConfig(config)) return jsonResponse(503, { error: 'unavailable' }, origin);

    // The custom header wins; `Authorization` stays as a fallback for a direct
    // local call or a proxy that still forwards it.
    const authorization = readHeader(req, AUTH_HEADER) ?? readHeader(req, 'authorization');
    const bearer = typeof authorization === 'string'
      ? /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization.trim())
      : null;
    if (!bearer) return jsonResponse(401, { error: 'unauthorized' }, origin);

    const auth = deps.auth || ((token, cfg, context) => defaultAuth(token, cfg, context));
    let accountId = null;
    try {
      accountId = await auth(bearer[1], config, { deadline, now, timers, limits, fetchImpl });
    } catch {
      accountId = null;
    }
    if (typeof accountId !== 'string' || !UUID.test(accountId)) {
      return jsonResponse(401, { error: 'unauthorized' }, origin);
    }

    // Authentication and the token bucket run before the cache, so a cached
    // result can never be read by an unauthenticated or over-quota caller.
    if (!consumeRate(accountId, now())) return jsonResponse(429, { error: 'rate_limited' }, origin);

    let blockedHosts = null;
    try {
      blockedHosts = new Set([new URL(config.url).hostname.toLowerCase()]);
    } catch {
      blockedHosts = new Set();
    }
    const target = normalizeTarget(parsed.url, blockedHosts);
    if (!target) return jsonResponse(400, { error: 'invalid_url' }, origin);

    const key = cacheKey(accountId, target.href);
    const cached = cacheGet(key);
    if (cached !== undefined) {
      return jsonResponse(200, cached || { url: target.href, title: null }, origin);
    }

    let parser;
    try {
      parser = deps.parser || require('./lib/metadata.cjs');
    } catch {
      return jsonResponse(503, { error: 'unavailable' }, origin);
    }

    const existingFlight = flights.get(key);
    if (existingFlight) {
      const shared = await existingFlight;
      return jsonResponse(200, shared || { url: target.href, title: null }, origin);
    }

    if (!acquireSlot()) return jsonResponse(429, { error: 'busy' }, origin);

    const flight = (async () => {
      try {
        const preview = await buildPreview(target, deadline, blockedHosts, parser);
        cacheSet(key, accountId, preview);
        return preview;
      } finally {
        flights.delete(key);
        releaseSlot();
      }
    })();
    flights.set(key, flight);
    const preview = await flight;
    return jsonResponse(200, preview || { url: target.href, title: null }, origin);
  }

  function stats() {
    return {
      cacheEntries: cache.size,
      cacheBytes,
      rateUsers: buckets.size,
      active,
      flights: flights.size,
    };
  }

  return { handle, stats };
}

module.exports = { ALLOWED_ORIGINS, DEFAULT_LIMITS, createLinkPreviewHandler, defaultAuth };
