const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleUpdates } = require('./index.cjs');

async function select(tags) {
  const releases = tags.map(tag_name => ({ tag_name, draft: false, assets: [{ name: 'catalogue.v1.json' }] }));
  let selected;
  const fetch = async url => {
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify(releases));
    selected = url.split('/').at(-2);
    return new Response(JSON.stringify({ schemaVersion: 1, releases: [{ tag: selected, versionName: selected.slice(1) }] }));
  };
  const response = await handleUpdates({ method: 'GET' }, fetch);
  return { selected, status: response.status };
}

test('selects the higher strict SemVer release regardless of listing order', async () => {
  // Hyphenated prereleases are single alphanumeric identifiers, not numeric segments.
  const pairs = [
    ['v1.0.0-beta-2', 'v1.0.0-beta-1'],
    ['v1.0.0-beta-9', 'v1.0.0-beta-10'],
    ['v0.16.0-beta.2', 'v0.16.0-beta.1'],
    ['v0.16.0-beta.10', 'v0.16.0-beta.9'],
    ['v0.16.0', 'v0.16.0-beta.9'],
    ['v0.16.0-beta.1', 'v0.16.0-alpha'],
    ['v1.0.0-beta.a', 'v1.0.0-beta.9'],
    ['v1.0.0-beta.1', 'v1.0.0-beta'],
  ];
  for (const [higher, lower] of pairs) {
    for (const tags of [[higher, lower], [lower, higher]]) {
      assert.deepEqual(await select(tags), { selected: higher, status: 200 });
    }
  }
});

test('build metadata does not affect precedence', async () => {
  const a = 'v1.0.0-beta.1+build.1', b = 'v1.0.0-beta.1+build.2';
  assert.deepEqual(await select([a, b]), { selected: a, status: 200 });
  assert.deepEqual(await select([b, a]), { selected: b, status: 200 });
});

test('rejects non-version tags and invalid numeric identifiers', async () => {
  for (const tag of ['latest', 'v01.0.0', 'v1.0.0-beta.01']) {
    assert.deepEqual(await select([tag]), { selected: undefined, status: 503 });
  }
});
