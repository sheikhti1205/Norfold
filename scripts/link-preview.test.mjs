import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLinkPreviewHandler } = require('../apps/share-preview/link-preview-handler.cjs');
const {
  createLinkFetcher,
  isBlockedAddress,
  normalizeTarget,
} = require('../apps/share-preview/lib/link-fetch.cjs');

const USER = '5b6f7c8d-1234-4abc-8def-123456789012';
const OTHER_USER = '5b6f7c8d-1234-4abc-8def-123456789013';
const config = {
  url: 'https://project.supabase.co',
  key: 'sb_publishable_fixture',
  origin: 'https://findbackapp.social',
  css: '',
};
const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2a00:1450:4001::1';

const parser = {
  extractMetadata(buffer) {
    return JSON.parse(buffer.toString('utf8'));
  },
  validatePreviewImage() {
    return { mime: 'image/png', width: 64, height: 64 };
  },
};

function createServer(resolverImpl = () => [{ address: PUBLIC_V4, family: 4 }], routeMap = () => ({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'missing' })) {
  const state = { resolverCalls: [], requests: [] };
  const resolve = async (hostname, options) => {
    state.resolverCalls.push({ hostname, options });
    return resolverImpl(hostname, state.resolverCalls.length);
  };
  const request = (options, onResponse) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.setTimeout = () => req;
    req.end = () => {
      state.requests.push({ options });
      const route = routeMap(options);
      if (route === 'hang') return;
      const res = new EventEmitter();
      res.statusCode = route.status ?? 200;
      res.headers = route.headers || {};
      res.destroyed = false;
      res.destroy = () => { res.destroyed = true; };
      res.resume = () => {};
      queueMicrotask(() => {
        onResponse(res);
        if (res.destroyed) return;
        const chunks = route.chunks ?? (route.body !== undefined ? [route.body] : []);
        for (const chunk of chunks) {
          if (res.destroyed) return;
          res.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        if (!res.destroyed) res.emit('end');
      });
    };
    return req;
  };
  return { resolve, request, state };
}

function byRoute(mapping) {
  return (options) => mapping[`${options.hostname}${options.path}`]
    || { status: 404, headers: { 'content-type': 'text/plain' }, body: 'missing' };
}

function htmlRoute(metadata, extra = {}) {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extra },
    body: JSON.stringify(metadata),
  };
}

const IMAGE_ROUTE = { status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };

function build(server, overrides = {}) {
  return createLinkPreviewHandler({
    auth: overrides.auth || (async (token) => (token === 'good' ? USER : null)),
    parser: overrides.parser || parser,
    resolve: server.resolve,
    request: server.request,
    now: overrides.now,
    limits: overrides.limits,
  });
}

function post(target, options = {}) {
  const headers = {
    'content-type': 'application/json',
    'x-norfold-authorization': 'Bearer good',
    ...(options.headers || {}),
  };
  const request = {
    method: options.method || 'POST',
    url: options.url || 'https://findbackapp.social/api/link-preview',
    headers,
  };
  if (options.raw !== undefined) {
    request.rawBody = options.raw;
  } else if (options.body !== undefined) {
    request.rawBody = JSON.stringify(options.body);
    request.body = options.body;
  } else {
    const body = { url: target };
    request.rawBody = JSON.stringify(body);
    request.body = body;
  }
  return request;
}

function payload(result) {
  return JSON.parse(result.body);
}

test('representative preview returns the frozen success shape and no caller headers reach the target', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({
      'example.com/': htmlRoute({ title: 'Example', description: 'A description', siteName: 'Example Site', imageUrl: 'https://cdn.example.com/pic.png' }),
      'cdn.example.com/pic.png': IMAGE_ROUTE,
    }),
  );
  const handler = build(server);
  const result = await handler.handle(post('https://example.com/'), config);
  assert.equal(result.status, 200);
  const body = payload(result);
  assert.deepEqual(Object.keys(body).sort(), ['description', 'imageDataUrl', 'siteName', 'title', 'url']);
  assert.equal(body.url, 'https://example.com/');
  assert.equal(body.title, 'Example');
  assert.equal(body.description, 'A description');
  assert.equal(body.siteName, 'Example Site');
  assert.match(body.imageDataUrl, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(server.state.requests.length, 2);

  for (const record of server.state.requests) {
    const headers = record.options.headers;
    assert.equal(headers.authorization, undefined);
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers.referer, undefined);
    assert.equal(headers.Referer, undefined);
    assert.equal(headers['accept-encoding'], 'identity');
    assert.equal(headers['user-agent'], 'NorfoldLinkPreview/1.0');
  }
  const htmlOptions = server.state.requests[0].options;
  assert.equal(htmlOptions.hostname, 'example.com');
  assert.equal(htmlOptions.servername, 'example.com');
  assert.equal(htmlOptions.path, '/');
  assert.equal(htmlOptions.port, 443);
  assert.equal(htmlOptions.method, 'GET');
  assert.equal(htmlOptions.agent, false);
  assert.equal(htmlOptions.autoSelectFamily, false);
  assert.equal(htmlOptions.rejectUnauthorized, true);
  assert.equal(htmlOptions.maxHeaderSize, 8192);
  assert.match(htmlOptions.headers.accept, /text\/html/);
  assert.match(server.state.requests[1].options.headers.accept, /image\/jpeg/);
});

test('the pinned lookup never resolves a second time and SNI keeps the original hostname', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'example.com/': htmlRoute({ title: 'Pinned' }) }),
  );
  const handler = build(server);
  await handler.handle(post('https://example.com/'), config);
  const options = server.state.requests[0].options;
  const before = server.state.resolverCalls.length;
  assert.equal(before, 1);

  let all;
  options.lookup('example.com', { all: true }, (error, list) => {
    assert.ifError(error);
    all = list;
  });
  let single;
  options.lookup('example.com', { family: 4 }, (error, address, family) => {
    assert.ifError(error);
    single = { address, family };
  });
  assert.deepEqual(all, [{ address: PUBLIC_V4, family: 4 }]);
  assert.deepEqual(single, { address: PUBLIC_V4, family: 4 });
  assert.equal(server.state.resolverCalls.length, before);
  assert.equal(options.servername, 'example.com');
  assert.equal(options.hostname, 'example.com');
});

test('the custom x-norfold-authorization header alone authenticates with the frozen success shape', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'custom.example.com/': htmlRoute({ title: 'Custom header' }) }),
  );
  const handler = build(server);
  const request = post('https://custom.example.com/');
  assert.equal(request.headers.authorization, undefined);
  const result = await handler.handle(request, config);
  assert.equal(result.status, 200);
  assert.deepEqual(payload(result), { url: 'https://custom.example.com/', title: 'Custom header' });
  assert.equal(server.state.requests.length, 1);
});

test('a plain Authorization header remains an accepted fallback', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'fallback.example.com/': htmlRoute({ title: 'Fallback header' }) }),
  );
  const handler = build(server);
  const request = post('https://fallback.example.com/');
  delete request.headers['x-norfold-authorization'];
  request.headers.authorization = 'Bearer good';
  const result = await handler.handle(request, config);
  assert.equal(result.status, 200);
  assert.deepEqual(payload(result), { url: 'https://fallback.example.com/', title: 'Fallback header' });
  assert.equal(server.state.requests.length, 1);
});

test('missing or invalid bearer tokens never reach DNS or a target', async () => {
  const server = createServer();
  const handler = build(server, { auth: async () => null });

  const anonymous = post('https://example.com/');
  delete anonymous.headers['x-norfold-authorization'];

  const fallbackBasic = post('https://example.com/', { headers: { authorization: 'Basic abc' } });
  delete fallbackBasic.headers['x-norfold-authorization'];
  const fallbackBad = post('https://example.com/', { headers: { authorization: 'Bearer bad' } });
  delete fallbackBad.headers['x-norfold-authorization'];

  for (const request of [
    anonymous,
    post('https://example.com/', { headers: { 'x-norfold-authorization': 'Basic abc' } }),
    post('https://example.com/', { headers: { 'x-norfold-authorization': 'Bearer bad' } }),
    fallbackBasic,
    fallbackBad,
  ]) {
    const result = await handler.handle(request, config);
    assert.equal(result.status, 401);
    assert.deepEqual(payload(result), { error: 'unauthorized' });
    assert.doesNotMatch(result.body, /bad|Basic|5b6f7c8d/);
  }
  assert.equal(server.state.resolverCalls.length, 0);
  assert.equal(server.state.requests.length, 0);
});

test('an auth outage is neutral and bounded by the auth budget', async () => {
  const server = createServer();
  const realHandler = createLinkPreviewHandler({
    fetchImpl: () => new Promise(() => {}),
    parser,
    resolve: server.resolve,
    request: server.request,
    limits: { authMs: 15, wallMs: 200 },
  });
  const started = Date.now();
  const result = await realHandler.handle(post('https://example.com/'), config);
  assert.equal(result.status, 401);
  assert.deepEqual(payload(result), { error: 'unauthorized' });
  assert.ok(Date.now() - started < 1000);
  assert.equal(server.state.resolverCalls.length, 0);
  assert.equal(server.state.requests.length, 0);
});

test('non-dialable request targets are rejected before any network work', async () => {
  const server = createServer();
  const handler = build(server, { limits: { rateCapacity: 1000 } });
  const targets = [
    'http://example.com/',
    'ftp://example.com/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://0x7f.0.0.1/',
    'https://localhost/',
    'https://foo.local/',
    'https://foo.internal/',
    'https://foo.test/',
    'https://foo.invalid/',
    'https://foo.example/',
    'https://foo.onion/',
    'https://singlelabel/',
    'https://example.com./',
    'https://findbackapp.social/r/abc',
    'https://api.findbackapp.social/',
    'https://project.supabase.co/rest/v1/',
    'https://anything.supabase.co/',
    `https://${'a'.repeat(2060)}.com/`,
    'data:text/html,<b>x</b>',
  ];
  for (const target of targets) {
    const result = await handler.handle(post(target), config);
    assert.equal(result.status, 400, target);
    assert.deepEqual(payload(result), { error: 'invalid_url' }, target);
    assert.doesNotMatch(result.body, /127\.0\.0\.1|localhost|supabase|findbackapp|a{20}/, target);
  }
  assert.equal(server.state.resolverCalls.length, 0);
  assert.equal(server.state.requests.length, 0);
});

test('private, mixed, mapped, NAT64 and special IPv6 answers are refused as a whole', async () => {
  const answers = {
    'private.example.com': [{ address: '10.1.2.3', family: 4 }],
    'mixed.example.com': [{ address: PUBLIC_V4, family: 4 }, { address: '10.1.2.3', family: 4 }],
    'mapped.example.com': [{ address: '::ffff:5db8:d822', family: 6 }],
    'mappeddotted.example.com': [{ address: '::ffff:93.184.216.34', family: 6 }],
    'nat64.example.com': [{ address: '64:ff9b::5db8:d822', family: 6 }],
    'doc.example.com': [{ address: '2001:db8::1', family: 6 }],
    'teredo.example.com': [{ address: '2001::1', family: 6 }],
    'docs6.example.com': [{ address: '3fff::1', family: 6 }],
    'ula.example.com': [{ address: 'fc00::1', family: 6 }],
    'linklocal.example.com': [{ address: 'fe80::1', family: 6 }],
    'multicast.example.com': [{ address: 'ff02::1', family: 6 }],
    'six.example.com': [{ address: '2002::1', family: 6 }],
    'public6.example.com': [{ address: PUBLIC_V6, family: 6 }],
  };
  const server = createServer(
    (hostname) => answers[hostname] || [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'public6.example.com/': htmlRoute({ title: 'Six' }) }),
  );
  const handler = build(server, { limits: { rateCapacity: 1000 } });

  for (const hostname of Object.keys(answers)) {
    if (hostname === 'public6.example.com') continue;
    const result = await handler.handle(post(`https://${hostname}/`), config);
    assert.equal(result.status, 200, hostname);
    assert.deepEqual(payload(result), { url: `https://${hostname}/`, title: null }, hostname);
  }
  assert.equal(server.state.requests.length, 0);

  const success = await handler.handle(post('https://public6.example.com/'), config);
  assert.equal(success.status, 200);
  assert.equal(payload(success).title, 'Six');
  assert.equal(server.state.requests.length, 1);
});

test('every denied IPv4 and non-global IPv6 literal is classified as blocked', () => {
  for (const address of ['0.0.0.1', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1']) {
    assert.equal(isBlockedAddress(address, 4), true, address);
  }
  for (const address of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '198.20.0.1']) {
    assert.equal(isBlockedAddress(address, 4), false, address);
  }
  for (const address of ['::1', '::', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2001:db8::1', '2001::1', '2002::1', '3fff::1']) {
    assert.equal(isBlockedAddress(address, 6), true, address);
  }
  for (const address of ['2606:4700:4700::1111', '2a00:1450:4001::1', '2001:4860:4860::8888']) {
    assert.equal(isBlockedAddress(address, 6), false, address);
  }
  assert.equal(normalizeTarget('https://[2001:4860:4860::8888]/'), null);
});

test('redirects are followed at most three times, each hop revalidated with fresh DNS', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({
      'start.example.com/': { status: 302, headers: { location: 'https://hop.example.com/final' } },
      'hop.example.com/final': htmlRoute({ title: 'Redirected' }),
      'private-hop.example.com/': { status: 302, headers: { location: 'https://127.0.0.1/steal' } },
      'internal-hop.example.com/': { status: 302, headers: { location: 'https://intranet.local/' } },
      'chain.example.com/1': { status: 301, headers: { location: 'https://chain.example.com/2' } },
      'chain.example.com/2': { status: 301, headers: { location: 'https://chain.example.com/3' } },
      'chain.example.com/3': { status: 301, headers: { location: 'https://chain.example.com/4' } },
      'chain.example.com/4': { status: 301, headers: { location: 'https://chain.example.com/5' } },
    }),
  );
  const handler = build(server, { limits: { rateCapacity: 1000 } });

  const ok = await handler.handle(post('https://start.example.com/'), config);
  assert.equal(ok.status, 200);
  assert.equal(payload(ok).title, 'Redirected');
  assert.equal(payload(ok).url, 'https://start.example.com/');
  assert.equal(server.state.resolverCalls.length, 2);
  assert.equal(server.state.requests.length, 2);

  const privateHop = await handler.handle(post('https://private-hop.example.com/'), config);
  assert.deepEqual(payload(privateHop), { url: 'https://private-hop.example.com/', title: null });
  const internalHop = await handler.handle(post('https://internal-hop.example.com/'), config);
  assert.deepEqual(payload(internalHop), { url: 'https://internal-hop.example.com/', title: null });
  assert.equal(server.state.requests.length, 4);

  const chain = await handler.handle(post('https://chain.example.com/1'), config);
  assert.deepEqual(payload(chain), { url: 'https://chain.example.com/1', title: null });
  assert.equal(server.state.requests.length, 8);
});

test('relative image URLs resolve against the final document URL and never the request URL', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({
      'start.example.com/page': { status: 301, headers: { location: 'https://cdn.example.com/dir/page' } },
      'cdn.example.com/dir/page': htmlRoute({ title: 'Final base', imageUrl: 'pic.png' }),
      'cdn.example.com/dir/pic.png': IMAGE_ROUTE,
    }),
  );
  const handler = build(server);
  const result = await handler.handle(post('https://start.example.com/page'), config);
  assert.equal(result.status, 200);
  const body = payload(result);
  assert.equal(body.url, 'https://start.example.com/page');
  assert.equal(body.title, 'Final base');
  assert.match(body.imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(server.state.requests.length, 3);
  assert.equal(server.state.requests[2].options.hostname, 'cdn.example.com');
  assert.equal(server.state.requests[2].options.path, '/dir/pic.png');
});

test('a private or failing image is omitted without losing the title', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({
      'keep.example.com/private': htmlRoute({ title: 'Keep private image' , imageUrl: 'https://127.0.0.1/x.png' }),
      'keep.example.com/missing': htmlRoute({ title: 'Keep missing image', imageUrl: 'https://cdn.example.com/404.png' }),
      'keep.example.com/follow': htmlRoute({ title: 'Keep private redirect', imageUrl: 'https://cdn.example.com/go.png' }),
      'cdn.example.com/go.png': { status: 302, headers: { location: 'https://10.0.0.1/x.png' } },
    }),
  );
  const handler = build(server, { limits: { rateCapacity: 1000 } });

  const privateImage = await handler.handle(post('https://keep.example.com/private'), config);
  const privateBody = payload(privateImage);
  assert.equal(privateBody.title, 'Keep private image');
  assert.equal(privateBody.imageDataUrl, undefined);
  assert.equal(server.state.requests.length, 1);

  const missing = await handler.handle(post('https://keep.example.com/missing'), config);
  const missingBody = payload(missing);
  assert.equal(missingBody.title, 'Keep missing image');
  assert.equal(missingBody.imageDataUrl, undefined);

  const before = server.state.requests.length;
  const redirect = await handler.handle(post('https://keep.example.com/follow'), config);
  const redirectBody = payload(redirect);
  assert.equal(redirectBody.title, 'Keep private redirect');
  assert.equal(redirectBody.imageDataUrl, undefined);
  // HTML plus the public redirect hop only; the private target is never dialled.
  assert.equal(server.state.requests.length, before + 2);
});

test('oversize, misleading, compressed and attachment responses degrade to unavailable', async () => {
  const big = 'x'.repeat(600 * 1024);
  const map = {
    'oversize.example.com/declared': { status: 200, headers: { 'content-type': 'text/html', 'content-length': String(900 * 1024) }, body: 'small' },
    'oversize.example.com/stream': { status: 200, headers: { 'content-type': 'text/html', 'content-length': '10' }, chunks: [big] },
    'oversize.example.com/chunked': { status: 200, headers: { 'content-type': 'text/html' }, chunks: [big] },
    'gzip.example.com/': { status: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: JSON.stringify({ title: 'Compressed' }) },
    'attach.example.com/': { status: 200, headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename=x.html' }, body: JSON.stringify({ title: 'Attachment' }) },
    'pdf.example.com/': { status: 200, headers: { 'content-type': 'application/pdf' }, body: JSON.stringify({ title: 'PDF' }) },
    'ok.example.com/chunked': { status: 200, headers: { 'content-type': 'text/html' }, chunks: [JSON.stringify({ title: 'Chunked ok' })] },
    'slow.example.com/': 'hang',
  };
  const server = createServer(() => [{ address: PUBLIC_V4, family: 4 }], byRoute(map));
  const handler = build(server, { limits: { rateCapacity: 1000, htmlMs: 25, wallMs: 60 } });

  for (const hostname of ['oversize.example.com/declared', 'oversize.example.com/stream', 'oversize.example.com/chunked', 'gzip.example.com/', 'attach.example.com/', 'pdf.example.com/']) {
    const result = await handler.handle(post(`https://${hostname}`), config);
    assert.equal(result.status, 200, hostname);
    assert.deepEqual(payload(result), { url: `https://${hostname}`, title: null }, hostname);
  }

  const chunked = await handler.handle(post('https://ok.example.com/chunked'), config);
  assert.equal(payload(chunked).title, 'Chunked ok');

  const started = Date.now();
  const slow = await handler.handle(post('https://slow.example.com/'), config);
  assert.deepEqual(payload(slow), { url: 'https://slow.example.com/', title: null });
  assert.ok(Date.now() - started < 2000);
});

test('the request body is bounded and has exactly one string url key', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'example.com/': htmlRoute({ title: 'Body ok' }) }),
  );
  const handler = build(server, { limits: { rateCapacity: 1000 } });

  const extraKey = await handler.handle(post(null, { body: { url: 'https://example.com/', extra: 1 } }), config);
  assert.equal(extraKey.status, 400);
  const nonString = await handler.handle(post(null, { body: { url: 5 } }), config);
  assert.equal(nonString.status, 400);
  const array = await handler.handle(post(null, { body: [] }), config);
  assert.equal(array.status, 400);
  const empty = await handler.handle(post(null, { body: {} }), config);
  assert.equal(empty.status, 400);
  const malformed = await handler.handle(post(null, { raw: '{' }), config);
  assert.equal(malformed.status, 400);

  const wrongType = await handler.handle(post('https://example.com/', { headers: { 'content-type': 'text/plain' } }), config);
  assert.equal(wrongType.status, 415);

  const declaredTooLarge = await handler.handle(post(null, { raw: '{"url":"https://example.com/"}', headers: { 'content-length': '5000' } }), config);
  assert.equal(declaredTooLarge.status, 413);

  const rawTooLarge = await handler.handle(post(null, { raw: 'x'.repeat(5000) }), config);
  assert.equal(rawTooLarge.status, 413);

  const hugeUrl = await handler.handle(post(null, { body: { url: `https://example.com/${'a'.repeat(5000)}` } }), config);
  assert.equal(hugeUrl.status, 413);

  // No Content-Length is required: platform middleware may strip it.
  const allowed = await handler.handle(post('https://example.com/'), config);
  assert.equal(allowed.status, 200);
  assert.equal(payload(allowed).title, 'Body ok');

  for (const result of [extraKey, nonString, array, empty, malformed, wrongType, declaredTooLarge, rawTooLarge, hugeUrl]) {
    assert.doesNotMatch(result.body, /example\.com|https?:|extra|5000/);
    assert.equal(typeof payload(result).error, 'string');
  }
  assert.equal(server.state.requests.length, 1);
});

test('GET and query-based proxying are refused without touching the network', async () => {
  const server = createServer();
  const handler = build(server);
  const get = await handler.handle({ ...post('https://example.com/'), method: 'GET' }, config);
  assert.equal(get.status, 405);
  assert.equal(get.headers.Allow, 'POST, OPTIONS');
  const query = await handler.handle(post('https://example.com/', { url: 'https://findbackapp.social/api/link-preview?url=https://example.com/' }), config);
  assert.equal(query.status, 400);
  assert.deepEqual(payload(query), { error: 'invalid_request' });
  assert.equal(server.state.resolverCalls.length, 0);
  assert.equal(server.state.requests.length, 0);
});

test('CORS preflight answers without auth or network and unknown origins are refused', async () => {
  const server = createServer();
  const handler = build(server);
  const preflight = await handler.handle({ method: 'OPTIONS', url: 'https://findbackapp.social/api/link-preview', headers: { origin: 'https://findbackapp.social' } }, config);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://findbackapp.social');
  assert.match(preflight.headers['Access-Control-Allow-Methods'], /POST/);
  assert.match(preflight.headers['Access-Control-Allow-Methods'], /OPTIONS/);
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /Authorization/);
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /x-norfold-authorization/);
  assert.equal(preflight.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization, x-norfold-authorization, sentry-trace, baggage');
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /Content-Type/);
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /sentry-trace/);
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /baggage/);
  assert.equal(preflight.headers['Access-Control-Allow-Credentials'], undefined);

  const forbidden = await handler.handle({ method: 'OPTIONS', url: 'https://findbackapp.social/api/link-preview', headers: { origin: 'https://evil.test' } }, config);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers['Access-Control-Allow-Origin'], undefined);

  const nativeRequest = post(null, { headers: { authorization: 'Bearer bad' } });
  delete nativeRequest.headers['x-norfold-authorization'];
  const native = await handler.handle(nativeRequest, config);
  assert.equal(native.headers['Access-Control-Allow-Origin'], '*');

  const allowed = await handler.handle({
    method: 'POST',
    url: 'https://findbackapp.social/api/link-preview',
    headers: { 'content-type': 'application/json', origin: 'https://localhost', authorization: 'Bearer bad' },
    rawBody: '{"url":"https://example.com/"}',
  }, config);
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://localhost');
  assert.equal(server.state.resolverCalls.length, 0);
  assert.equal(server.state.requests.length, 0);
});

test('a positive cache answers the same account+URL once and still re-authenticates', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'cache.example.com/': htmlRoute({ title: 'Cached' }) }),
  );
  let tokenValid = true;
  const handler = build(server, { auth: async (token) => (token === 'good' && tokenValid ? USER : null) });
  const first = await handler.handle(post('https://cache.example.com/'), config);
  const second = await handler.handle(post('https://cache.example.com/'), config);
  assert.equal(payload(first).title, 'Cached');
  assert.deepEqual(payload(second), payload(first));
  assert.equal(server.state.requests.length, 1);
  assert.equal(server.state.resolverCalls.length, 1);

  tokenValid = false;
  const unsigned = await handler.handle(post('https://cache.example.com/'), config);
  assert.equal(unsigned.status, 401);
  assert.equal(server.state.requests.length, 1);
});

test('negative results are cached for ten minutes and then retried', async () => {
  let time = 1_000_000;
  const now = () => time;
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({}),
  );
  const handler = build(server, { now, limits: { rateCapacity: 1000 } });
  const first = await handler.handle(post('https://gone.example.com/'), config);
  assert.deepEqual(payload(first), { url: 'https://gone.example.com/', title: null });
  assert.equal(server.state.requests.length, 1);

  time += 9 * 60 * 1000;
  await handler.handle(post('https://gone.example.com/'), config);
  assert.equal(server.state.requests.length, 1);

  time += 2 * 60 * 1000;
  await handler.handle(post('https://gone.example.com/'), config);
  assert.equal(server.state.requests.length, 2);
});

test('five token-bucket slots per account then 429, with separate buckets per account', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({}),
  );
  const handler = build(server, { auth: async (token) => (token === 'a' ? USER : (token === 'b' ? OTHER_USER : null)) });
  for (let index = 0; index < 5; index += 1) {
    const result = await handler.handle(post(`https://rate${index}.example.com/`, { headers: { 'x-norfold-authorization': 'Bearer a' } }), config);
    assert.equal(result.status, 200);
  }
  const limited = await handler.handle(post('https://rate5.example.com/', { headers: { 'x-norfold-authorization': 'Bearer a' } }), config);
  assert.equal(limited.status, 429);
  assert.deepEqual(payload(limited), { error: 'rate_limited' });

  const other = await handler.handle(post('https://rate5.example.com/', { headers: { 'x-norfold-authorization': 'Bearer b' } }), config);
  assert.equal(other.status, 200);
});

test('the outbound semaphore caps six chains and fails a seventh fast with 429', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    () => 'hang',
  );
  const handler = build(server, { limits: { htmlMs: 40, wallMs: 80, maxConcurrent: 6, rateCapacity: 1000 } });
  const pending = [];
  for (let index = 0; index < 6; index += 1) {
    pending.push(handler.handle(post(`https://busy${index}.example.com/`), config));
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(handler.stats().active, 6);
  const seventh = await handler.handle(post('https://busy7.example.com/'), config);
  assert.equal(seventh.status, 429);
  assert.deepEqual(payload(seventh), { error: 'busy' });
  const settled = await Promise.all(pending);
  for (const result of settled) assert.equal(result.status, 200);
  assert.equal(handler.stats().active, 0);
});

test('the cache is bounded per account and by total bytes', async () => {
  const routes = {};
  for (let index = 0; index < 45; index += 1) {
    routes[`cap${index}.example.com/`] = htmlRoute({ title: `Entry ${index}` });
  }
  const server = createServer(() => [{ address: PUBLIC_V4, family: 4 }], byRoute(routes));
  const handler = build(server, { limits: { rateCapacity: 1000, cachePerAccount: 40 } });
  for (let index = 0; index < 45; index += 1) {
    const result = await handler.handle(post(`https://cap${index}.example.com/`), config);
    assert.equal(result.status, 200);
  }
  assert.ok(handler.stats().cacheEntries <= 40, String(handler.stats().cacheEntries));

  const byteRoutes = {};
  for (let index = 0; index < 12; index += 1) {
    byteRoutes[`bytes${index}.example.com/`] = htmlRoute({ title: `B${index}-${'y'.repeat(240)}` });
  }
  const byteServer = createServer(() => [{ address: PUBLIC_V4, family: 4 }], byRoute(byteRoutes));
  const byteHandler = build(byteServer, { limits: { rateCapacity: 1000, cacheBytes: 1500, cachePerAccount: 40 } });
  for (let index = 0; index < 12; index += 1) {
    await byteHandler.handle(post(`https://bytes${index}.example.com/`), config);
  }
  assert.ok(byteHandler.stats().cacheBytes <= 1500, String(byteHandler.stats().cacheBytes));
});

test('in-flight work is shared for the same account and URL', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({ 'shared.example.com/': htmlRoute({ title: 'Shared' }) }),
  );
  const handler = build(server, { limits: { rateCapacity: 1000 } });
  const [first, second] = await Promise.all([
    handler.handle(post('https://shared.example.com/'), config),
    handler.handle(post('https://shared.example.com/'), config),
  ]);
  assert.equal(payload(first).title, 'Shared');
  assert.deepEqual(payload(second), payload(first));
  // Both callers may arrive before the first response, but only one chain runs.
  assert.ok(server.state.requests.length <= 1);
});

test('every target failure is neutral and never reflects the URL or token', async () => {
  const server = createServer(
    () => [{ address: PUBLIC_V4, family: 4 }],
    byRoute({}),
  );
  const handler = build(server, { limits: { rateCapacity: 1000 } });
  const result = await handler.handle(post('https://secret.example.com/private-path?token=leak'), config);
  assert.equal(result.status, 200);
  assert.deepEqual(payload(result), { url: 'https://secret.example.com/private-path?token=leak', title: null });
  assert.doesNotMatch(result.body, /error|stack|FetchError|Bearer good/);

  const unauthorizedRequest = post('https://secret.example.com/x', { headers: { authorization: 'Bearer topsecret' } });
  delete unauthorizedRequest.headers['x-norfold-authorization'];
  const unauthorized = await handler.handle(unauthorizedRequest, config);
  assert.equal(unauthorized.status, 401);
  assert.doesNotMatch(unauthorized.body, /topsecret|secret\.example\.com/);
});

test('the fetcher refuses an already-aborted wall signal without dialling', async () => {
  const resolverCalls = [];
  const requestCalls = [];
  const fetcher = createLinkFetcher({
    resolve: async (hostname) => { resolverCalls.push(hostname); return [{ address: PUBLIC_V4, family: 4 }]; },
    request: () => { requestCalls.push(1); return new EventEmitter(); },
  });
  const controller = new AbortController();
  controller.abort();
  const target = normalizeTarget('https://example.com/', null);
  await assert.rejects(
    fetcher.fetchOnce(target, { kind: 'html', timeoutMs: 100, signal: controller.signal }),
    /timeout/,
  );
  assert.equal(resolverCalls.length, 0);
  assert.equal(requestCalls.length, 0);
});
