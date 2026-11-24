// Handler outcomes, not SemVer ordering (see version.test.cjs for that).
// The empty payload is asserted literally: it must be the exact shape the
// mobile client's parseAndroidCatalogue accepts, not merely plausible JSON.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleUpdates } = require('./index.cjs');

const API = 'https://api.github.com/repos/sheikhti1205/Norfold/releases?per_page=20';
const asset = tag => `https://github.com/sheikhti1205/Norfold/releases/download/${tag}/catalogue.v1.json`;
const catalogue = tag => JSON.stringify({ schemaVersion: 1, releases: [{ tag, versionName: tag.slice(1) }] });
const listing = entries => new Response(JSON.stringify(entries));
const carried = tag_name => ({ tag_name, draft: false, assets: [{ name: 'catalogue.v1.json' }] });

async function run(fetchImpl, req = { method: 'GET' }) {
  const log = [];
  const response = await handleUpdates(req, fetchImpl, line => log.push(line));
  return { ...response, log };
}

test('serves the newest valid catalogue and marks the response as a release', async () => {
  const { status, body, headers, log } = await run(async url => {
    if (url === API) return listing([carried('v1.2.0')]);
    assert.equal(url, asset('v1.2.0'));
    return new Response(catalogue('v1.2.0'));
  });
  assert.equal(status, 200);
  assert.equal(body, catalogue('v1.2.0'));
  assert.equal(headers['X-Catalogue-State'], 'release');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.deepEqual(log, ['release: v1.2.0']);
});

test('an existing release with no catalogue asset is an empty catalogue, not an outage', async () => {
  const { status, body, headers, log } = await run(async url => {
    assert.equal(url, API);
    return listing([
      { tag_name: 'android-latest', draft: false, assets: [] },
      { tag_name: 'v1.2.0', draft: false, assets: [{ name: 'catalogue.v1.json.sha256' }] },
    ]);
  });
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { schemaVersion: 1, releases: [], history: [] });
  assert.equal(headers['X-Catalogue-State'], 'empty');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.deepEqual(log, ['empty: no published release carries a catalogue']);
});

test('a repository with no releases at all is an empty catalogue', async () => {
  const { status, body } = await run(async () => listing([]));
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { schemaVersion: 1, releases: [], history: [] });
});

test('a repository with only draft releases carries no published catalogue', async () => {
  const { status } = await run(async url => {
    if (url === API) return listing([{ ...carried('v1.2.0'), draft: true }]);
    return new Response('unexpected asset fetch');
  });
  // Drafts are invisible to readers, so no published release carries a catalogue.
  assert.equal(status, 200);
});

test('HEAD carries no body in either 200 state', async () => {
  const released = await run(async url => url === API ? listing([carried('v1.2.0')]) : new Response(catalogue('v1.2.0')), { method: 'HEAD' });
  assert.equal(released.status, 200);
  assert.equal(released.body, '');
  assert.equal(released.headers['X-Catalogue-State'], 'release');

  const empty = await run(async () => listing([]), { method: 'HEAD' });
  assert.equal(empty.status, 200);
  assert.equal(empty.body, '');
  assert.equal(empty.headers['X-Catalogue-State'], 'empty');
});

test('a malformed newest catalogue falls through to the next highest valid release', async () => {
  const { status, body, headers, log } = await run(async url => {
    if (url === API) return listing([carried('v1.0.0'), carried('v1.1.0')]);
    if (url === asset('v1.1.0')) return new Response('{"schemaVersion":1,"releases":[{"tag":"v1.1.0","versionName":"9.9.9"}]}');
    assert.equal(url, asset('v1.0.0'));
    return new Response(catalogue('v1.0.0'));
  });
  assert.equal(status, 200);
  assert.equal(body, catalogue('v1.0.0'));
  assert.equal(headers['X-Catalogue-State'], 'release');
  assert.deepEqual(log, ['release: v1.0.0']);
});

test('a candidate whose asset is missing is skipped without failing the request', async () => {
  const { status, body } = await run(async url => {
    if (url === API) return listing([carried('v1.0.0'), carried('v1.1.0')]);
    if (url === asset('v1.1.0')) return new Response('', { status: 404 });
    return new Response(catalogue('v1.0.0'));
  });
  assert.equal(status, 200);
  assert.equal(body, catalogue('v1.0.0'));
});

test('every candidate malformed is unavailable, never an empty catalogue', async () => {
  const bad = [
    new Response('not json'),
    new Response('{"releases":[]}'),                                   // no schemaVersion
    new Response('{"schemaVersion":2,"releases":[]}'),                 // unsupported version
    new Response('x'.repeat(128 * 1024 + 1)),                          // over the size cap
    new Response('', { status: 500 }),
    new Response('{"schemaVersion":1,"releases":[{"tag":"v9.9.9","versionName":"1.0.0"}]}'),
  ];
  for (const response of bad) {
    const { status, body, headers } = await run(async url => url === API ? listing([carried('v1.0.0')]) : response);
    assert.equal(status, 503);
    assert.deepEqual(JSON.parse(body), { error: 'Updates are temporarily unavailable.' });
    assert.equal(headers['X-Catalogue-State'], undefined);
  }
});

test('carriers without a usable version tag are a broken source, not an empty one', async () => {
  const { status, log } = await run(async url => {
    if (url === API) return listing([carried('latest')]);
    return new Response('unexpected asset fetch');
  });
  assert.equal(status, 503);
  assert.deepEqual(log, ['unavailable: no catalogued release has a usable version tag']);
});

test('an upstream failure is a 503 even when the body would look like a catalogue', async () => {
  const failures = [
    async () => { throw new Error('network'); },
    async () => new Response('', { status: 403 }),                     // rate limited
    async () => new Response('', { status: 500 }),
    async () => new Response('not json'),
    async () => new Response('{"releases":[]}'),
    async () => new Response('[null]'),
    async () => new Response('x'.repeat(1024 * 1024 + 1)),
  ];
  for (const failure of failures) {
    const { status, body } = await run(failure);
    assert.equal(status, 503);
    assert.deepEqual(JSON.parse(body), { error: 'Updates are temporarily unavailable.' });
  }
});

test('a catalogue that disagrees with its release tag is malformed, not empty', async () => {
  const { status } = await run(async url => url === API
    ? listing([carried('v1.0.0')])
    : new Response(JSON.stringify({ schemaVersion: 1, releases: [{ tag: 'v0.9.0', versionName: '0.9.0' }] })));
  assert.equal(status, 503);
});
