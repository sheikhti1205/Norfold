/* global URL, setTimeout, clearTimeout */
'use strict';

// Secure, bounded HTTPS egress for the link-preview metadata service.
// Node builtins only. This module never follows a redirect itself: the caller
// validates each hop's URL and re-enters, so every hop gets fresh DNS and a
// fresh pin. It never logs, never reuses a socket and never disables TLS
// verification.

const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');
const { Buffer } = require('node:buffer');

const MAX_URL_LENGTH = 2048;
const HTML_MAX_BYTES = 524288;
const IMAGE_MAX_BYTES = 262144;
const MAX_REDIRECTS = 3;
const DNS_TIMEOUT_MS = 1500;
const HTML_TIMEOUT_MS = 4000;
const IMAGE_TIMEOUT_MS = 2000;
const AUTH_TIMEOUT_MS = 2000;
const WALL_TIMEOUT_MS = 7500;
const MAX_HEADER_BYTES = 8192;
const USER_AGENT = 'NorfoldLinkPreview/1.0';
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid', '.example', '.onion'];
const BLOCKED_EXACT = new Set(['localhost']);
const BLOCKED_PRODUCT_SUFFIXES = ['.findbackapp.social', '.supabase.co'];

// RFC 6890 / operator-hostile ranges. Everything else in IPv4 is public.
const IPV4_DENIED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
// Inside 2000::/3 only these protocol/documentation blocks are denied.
const IPV6_DENIED = [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
];

const ipv4BlockList = new net.BlockList();
for (const [address, prefix] of IPV4_DENIED) ipv4BlockList.addSubnet(address, prefix, 'ipv4');
const ipv6BlockList = new net.BlockList();
for (const [address, prefix] of IPV6_DENIED) ipv6BlockList.addSubnet(address, prefix, 'ipv6');

class FetchError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FetchError';
    this.code = code;
  }
}

/** 2000::/3 is the only IPv6 space we accept; everything else is internal. */
function isGlobalUnicastIpv6(address) {
  const value = String(address).toLowerCase();
  // A dotted tail is an IPv4-mapped/NAT64 textual form, never a global unicast.
  if (value.includes('.')) return false;
  const first = value.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
  const prefix = Number.parseInt(first, 16);
  return prefix >= 0x2000 && prefix <= 0x3fff;
}

/** True when an address must not be dialled. Unknown families fail closed. */
function isBlockedAddress(address, family) {
  if (typeof address !== 'string') return true;
  try {
    if (family === 4) return ipv4BlockList.check(address, 'ipv4');
    if (family === 6) {
      if (!isGlobalUnicastIpv6(address)) return true;
      return ipv6BlockList.check(address, 'ipv6');
    }
  } catch {
    return true;
  }
  return true;
}

function isBlockedHostname(hostname, blockedHosts) {
  const name = String(hostname).toLowerCase();
  if (BLOCKED_EXACT.has(name)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  if (name === 'findbackapp.social') return true;
  if (BLOCKED_PRODUCT_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  if (blockedHosts) {
    for (const blocked of blockedHosts) {
      if (name === blocked || name.endsWith(`.${blocked}`)) return true;
    }
  }
  return false;
}

/**
 * Normalize one request-target. Returns null for anything the service must not
 * dial: non-HTTPS, a non-default port, credentials, an IP literal (even a
 * public one), a trailing dot, a single-label name, an internal suffix or one
 * of our own hosts. WHATWG parsing is the only normalizer used.
 */
function normalizeTarget(raw, blockedHosts) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port !== '') return null;
  const hostname = url.hostname;
  if (hostname === '') return null;
  if (hostname.endsWith('.')) return null;
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (net.isIP(bare) !== 0) return null;
  if (!hostname.includes('.')) return null;
  if (isBlockedHostname(hostname, blockedHosts)) return null;
  url.hash = '';
  return { href: url.href, hostname: hostname.toLowerCase(), path: `${url.pathname}${url.search}` };
}

function withTimeout(promise, timeoutMs, timers, code) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(handle);
      fn(value);
    };
    const handle = timers.setTimeout(() => finish(reject, new FetchError(code)), Math.max(0, timeoutMs));
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error instanceof FetchError ? error : new FetchError('dns')),
    );
  });
}

/** Resolve once, reject the whole answer when any address is unsafe, then pin one. */
async function resolvePinned(hostname, { resolve, timers, timeoutMs }) {
  const answers = await withTimeout(resolve(hostname, { all: true, verbatim: true }), timeoutMs, timers, 'dns_timeout');
  if (!Array.isArray(answers) || answers.length === 0) throw new FetchError('dns');
  for (const answer of answers) {
    if (!answer || typeof answer.address !== 'string') throw new FetchError('dns');
    if (answer.family !== 4 && answer.family !== 6) throw new FetchError('dns');
    if (isBlockedAddress(answer.address, answer.family)) throw new FetchError('blocked_address');
  }
  const preferred = answers.find((answer) => answer.family === 4);
  return preferred || answers[0];
}

/**
 * The pinned lookup Node calls while connecting. It never performs a second
 * DNS query: the answer chosen above is the only address dialled.
 */
function pinnedLookup(pinned) {
  return (hostname, options, callback) => {
    let lookupOptions = options;
    let done = callback;
    if (typeof lookupOptions === 'function') {
      done = lookupOptions;
      lookupOptions = {};
    }
    if (lookupOptions && lookupOptions.all) {
      done(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    done(null, pinned.address, pinned.family);
  };
}

function createLinkFetcher(options = {}) {
  const resolve = options.resolve || ((hostname, lookupOptions) => dns.promises.lookup(hostname, lookupOptions));
  const request = options.request || https.request;
  const timers = options.timers || { setTimeout, clearTimeout };

  /**
   * One HTTPS GET with a pinned address. Redirects are returned to the caller;
   * no body is read for them, and the response is destroyed rather than
   * resumed so an unbounded redirect body can never be buffered.
   */
  function fetchOnce(target, settings = {}) {
    const kind = settings.kind === 'image' ? 'image' : 'html';
    const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : HTML_MAX_BYTES;
    const accept = kind === 'image'
      ? 'image/jpeg, image/png, image/webp'
      : 'text/html, application/xhtml+xml';
    const timeoutMs = settings.timeoutMs;
    const dnsTimeoutMs = Math.min(typeof settings.dnsTimeoutMs === 'number' ? settings.dnsTimeoutMs : DNS_TIMEOUT_MS, timeoutMs);
    const signal = settings.signal;

    return new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      let req = null;
      let timer = null;

      const cleanup = () => {
        if (timer !== null) timers.clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const succeed = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise(value);
      };
      const fail = (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(new FetchError(code));
      };
      const onAbort = () => {
        try { req?.destroy(); } catch { /* already gone */ }
        fail('timeout');
      };

      if (signal && signal.aborted) {
        rejectPromise(new FetchError('timeout'));
        return;
      }
      if (!(timeoutMs > 0)) {
        rejectPromise(new FetchError('timeout'));
        return;
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      timer = timers.setTimeout(() => {
        try { req?.destroy(); } catch { /* already gone */ }
        fail('timeout');
      }, timeoutMs);

      resolvePinned(target.hostname, { resolve, timers, timeoutMs: dnsTimeoutMs }).then((pinned) => {
        if (settled) return;
        const requestOptions = {
          hostname: target.hostname,
          servername: target.hostname,
          port: 443,
          path: target.path,
          method: 'GET',
          agent: false,
          autoSelectFamily: false,
          family: pinned.family,
          lookup: pinnedLookup(pinned),
          signal,
          headers: {
            accept,
            'accept-encoding': 'identity',
            'user-agent': USER_AGENT,
          },
          maxHeaderSize: MAX_HEADER_BYTES,
          rejectUnauthorized: true,
        };
        try {
          req = request(requestOptions, (res) => {
            const status = Number(res.statusCode) || 0;
            const headers = res.headers || {};

            if (REDIRECT_STATUS.has(status)) {
              try { res.destroy(); } catch { /* nothing to release */ }
              succeed({ status, headers, body: null, redirect: true, contentType: '' });
              return;
            }
            if (status < 200 || status > 299) {
              try { res.destroy(); } catch { /* nothing to release */ }
              succeed({ status, headers, body: null, redirect: false, contentType: '' });
              return;
            }

            const disposition = String(headers['content-disposition'] || '');
            if (/attachment/i.test(disposition)) {
              try { res.destroy(); } catch { /* nothing to release */ }
              succeed({ status, headers, body: null, redirect: false, contentType: '' });
              return;
            }
            // Compressed bodies are refused rather than buffered: the wire and
            // decoded limits would otherwise have to be tracked twice. This is
            // a documented functionality gap, not an unbounded read.
            const encoding = String(headers['content-encoding'] || '').trim().toLowerCase();
            if (encoding !== '' && encoding !== 'identity') {
              try { res.destroy(); } catch { /* nothing to release */ }
              succeed({ status, headers, body: null, redirect: false, contentType: '' });
              return;
            }
            const contentType = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (contentType !== '') {
              if (kind === 'html' && contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
                try { res.destroy(); } catch { /* nothing to release */ }
                succeed({ status, headers, body: null, redirect: false, contentType });
                return;
              }
              if (kind === 'image' && !contentType.startsWith('image/')) {
                try { res.destroy(); } catch { /* nothing to release */ }
                succeed({ status, headers, body: null, redirect: false, contentType });
                return;
              }
            }
            if (headers['content-length'] !== undefined) {
              const declared = Number(headers['content-length']);
              if (!Number.isFinite(declared) || declared < 0 || declared > maxBytes) {
                try { res.destroy(); } catch { /* nothing to release */ }
                succeed({ status, headers, body: null, redirect: false, contentType });
                return;
              }
            }

            let total = 0;
            const chunks = [];
            res.on('data', (chunk) => {
              if (settled) return;
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              total += buffer.length;
              // The stream is authoritative even when Content-Length is absent,
              // chunked, or deliberately wrong.
              if (total > maxBytes) {
                try { res.destroy(); } catch { /* nothing to release */ }
                fail('too_large');
                return;
              }
              chunks.push(buffer);
            });
            res.on('end', () => {
              succeed({ status, headers, body: Buffer.concat(chunks, total), redirect: false, contentType });
            });
            res.on('error', () => fail('network'));
            res.on('aborted', () => fail('network'));
          });
        } catch {
          fail('network');
          return;
        }
        req.on('error', (error) => fail(error && error.code === 'ABORT_ERR' ? 'timeout' : 'network'));
        try {
          req.end();
        } catch {
          fail('network');
        }
      }, (error) => fail(error && error.code ? error.code : 'dns'));
    });
  }

  return { fetchOnce };
}

module.exports = {
  AUTH_TIMEOUT_MS,
  DNS_TIMEOUT_MS,
  FetchError,
  HTML_MAX_BYTES,
  HTML_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_TIMEOUT_MS,
  MAX_HEADER_BYTES,
  MAX_REDIRECTS,
  MAX_URL_LENGTH,
  REDIRECT_STATUS,
  USER_AGENT,
  WALL_TIMEOUT_MS,
  createLinkFetcher,
  isBlockedAddress,
  isBlockedHostname,
  normalizeTarget,
  pinnedLookup,
  resolvePinned,
};
